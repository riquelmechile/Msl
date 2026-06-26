# Design: Autonomy Levels

## Architecture Decision

**Choice**: Domain-level `AutonomyEngine` in the agent package with SQLite persistence via a sibling `autonomyStore` factory, following the established `strategyStore` pattern (Approach 1 from exploration).

**Rationale**: This is Phase 6 of 7 — introducing new packages or middleware pipelines now adds infrastructure burden for a ~200-line decision engine. The existing patterns (SQLite store factory, guardrail function, config injection) are proven and tested. Cortex already owns KPI history; extending it with new tables is a natural evolution.

**Tradeoff accepted**: agentLoop `converse()` grows, but private helper methods (`evaluateKpisAndDegrade`, `shouldAutoApprove`) keep it readable.

## Component Architecture

```
agentLoop.ts
  └─ AutonomyEngine (injected via AgentLoopConfig)
       ├─ autonomyStore.ts (SQLite: autonomy_state table)
       ├─ Cortex GraphEngine (kpi_history, autonomy_events tables)
       └─ evaluateDegradation() ── called before each turn
       └─ shouldAutoApprove(risk) ── called in guardrail gate

guardrails.ts
  └─ autonomyLevelGate(proposal, level): GuardResult
       └─ riskLevelForAction(kind) ≤ levelThresholdMap[level]?
```

## Data Flow: Action Execution with Autonomy Gate

```
1. converse() receives seller input
2. Agent proposes action → AgentProposal
3. evaluateDegradation() checks KPIs, may degrade level
4. autonomyLevelGate(proposal, engine.level) evaluated
   ├─ passed & autoApproved → execute (no dale), record auto AuditRecord
   └─ passed=false → present to CEO, wait for dale
5. After execution → recordKpi() writes to Cortex kpi_history
```

## SQLite Schema Additions

**Cortex tables** (in `database.ts` migration):

```sql
CREATE TABLE IF NOT EXISTS kpi_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_name TEXT NOT NULL,          -- success_rate | margin_compliance | safety_violations
  value REAL NOT NULL,             -- 0.0 or 1.0 for binary KPIs
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS autonomy_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,        -- promotion | degradation
  from_level INTEGER NOT NULL,
  to_level INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kpi_history_window
  ON kpi_history(kpi_name, recorded_at);
```

**Agent table** (in `autonomyStore.ts`):

```sql
CREATE TABLE IF NOT EXISTS autonomy_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  current_level INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Key Types

```typescript
type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;

interface KpiSnapshot {
  success_rate: number;       // 0 or 1 per action
  margin_compliance: number;  // 0 or 1 per action
  safety_violations: number;  // 0 or 1 per action
  recorded_at: Date;
}

interface DegradationDecision {
  degraded: boolean;
  newLevel: AutonomyLevel;
  reasons: string[];           // Spanish: "3 violaciones de seguridad en 7 días"
}

interface GuardResult {
  passed: boolean;
  autoApproved: boolean;
  reason?: string;             // Spanish explanation if blocked
}
```

## Level-to-Risk Threshold Map

| Level | Auto-Execute Risk | Description |
|-------|-------------------|-------------|
| 0 | none | Siempre requiere "dale" |
| 1 | low | Auto aprueba acciones de bajo riesgo |
| 2 | low | Igual que 1, confianza básica establecida |
| 3 | medium | Auto aprueba acciones medias y bajas |
| 4 | medium | Igual que 3, confianza alta |
| 5 | high | Solo requiere "dale" para critical |

`critical` always requires "dale" regardless of level.

## Degradation Rules

Evaluated via `getKpiWindow(days: 7)` — SQLite `WHERE recorded_at > datetime('now', '-7 days')`.

| Condition | Threshold | Degradation |
|-----------|-----------|-------------|
| safety_violations | ≥ 3 in window | −1 level |
| success_rate | < 0.6 with ≥ 10 actions | −1 level |
| margin_compliance | < 0.7 with ≥ 5 price actions | −1 level |

Cumulative: all breached thresholds apply (max −3 in one evaluation). Minimum level is 0.

## Promotion Rules

Evaluated via `getKpiWindow(days: 30)`:
- `safety_violations = 0` AND
- `success_rate ≥ 0.9` AND
- `margin_compliance ≥ 0.9` AND
- `≥ 20 actions` in window

If met, engine generates a Spanish promotion proposal. CEO "dale" increments level by 1. Agent never auto-promotes.

## `now: Date` Dependency Injection

Time-windowed queries accept `now: Date` parameter for testability:

```typescript
getKpiWindow(days: number, now: Date = new Date()): KpiSnapshot[]
```

Tests inject frozen dates to verify window boundaries and degradation precision.

## Guardrail Integration in agentLoop

Insert before the existing confirmation gate:

```typescript
// Existing: strategy validation
const strategyResult = strategyValidator(proposal, strategies);
if (!strategyResult.passed) { /* block */ }

// NEW: autonomy gate
const autonomyResult = autonomyLevelGate(proposal, autonomyEngine.currentLevel);
if (autonomyResult.autoApproved) {
  return executeAction(proposal, { approvalMethod: "auto", autonomyLevel });
}
// Fall through to existing dale confirmation flow
```

## Files

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `packages/agent/src/conversation/autonomyEngine.ts` | ~120 | Engine class, degradation, promotion |
| `packages/agent/src/conversation/autonomyStore.ts` | ~60 | SQLite store factory + migration |
| `packages/agent/src/conversation/guardrails.ts` | +40 | `autonomyLevelGate()` function |
| `packages/agent/src/conversation/agentLoop.ts` | +30 | Inject engine, call gate |
| `packages/memory/src/cortex/database.ts` | +30 | New tables migration |
| `packages/memory/src/cortex/engine.ts` | +40 | `recordKpi()`, `getKpiWindow()` |
| `packages/agent/tests/conversation/autonomyEngine.test.ts` | ~200 | Degradation, gating, promotion |
| `packages/memory/tests/cortex/kpi-history.test.ts` | ~80 | KPI storage, window queries |
| **Total (core)** | ~320 | |
| **Total (with tests)** | ~600 | |
