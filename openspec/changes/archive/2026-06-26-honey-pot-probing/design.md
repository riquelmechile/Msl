# Design: Honey-Pot Probing — Active Counterintelligence

## Technical Approach

Extend the existing actor/guardrail/strategy/agent-loop quartet per Exploration Approach 3. Two new specialized modules (`probeDetector.ts`, `honeyPotProposer.ts`) sit alongside existing conversation modules. The Cortex graph gains three new tables for probe lifecycle persistence. Every honey-pot operation is gated behind `honeyPotGuardrail`: default-deny, requires active CEO probe strategy + "dale" confirmation.

## Architecture Decisions

### Decision: New modules vs. extending existing files

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Extend `actorSimulator.ts` + `tools.ts` inline | Fewer files, but bloats modules beyond single responsibility | Rejected |
| New `probeDetector.ts` + `honeyPotProposer.ts` | Clean separation, testable independently, follows existing pattern of focused modules | **Chosen** |

**Rationale**: The existing conversation directory already separates concerns (`guardrails.ts`, `strategyParser.ts`, `actorSimulator.ts`). Probe detection and decoy proposal are distinct responsibilities that would violate SRP if folded into existing modules. New tools register via the existing `tools.ts` factory pattern — no new architectural paradigm.

### Decision: Default-deny guardrail posture

**Choice**: `honeyPotGuardrail` blocks ALL honey-pot operations unless (a) active CEO strategy of type `probe` authorizes the target category AND (b) seller confirms with "dale".
**Rationale**: Honey-pot operations create fake MLS listings — ethically and commercially sensitive. The existing guardrail pipeline (`strategyValidator` → `actionSafetyValidator`) already proves the deny-by-default pattern works. This extends it with an additional gate, not a replacement.

### Decision: Hebbian learning via existing Cortex, not new learning engine

**Choice**: `GraphEngine.storeProbeResult()` uses existing `createNode`/`createEdge`/`reinforceEdge` methods with `probe: true` metadata tag. No new learning algorithm.
**Rationale**: Cortex already has Hebbian reinforcement (+0.1/−0.15), spreading activation, and Darwinian pruning. Probe learning is a specialized use of the same mechanism — just scoped to probe-tagged nodes to prevent graph pollution of real business learning.

## Data Flow

```
CEO directive ("probá competidores en electrónica")
    │
    ▼
strategyParser.ts ──► strategyStore ──► activeStrategies[]
    │
    ▼
seller: "dale" ──► agentLoop ──► honeyPotGuardrail (check probe strategy + dale)
    │                                  │
    │ pass                             │ block → Spanish TOS warning
    ▼                                  ▼
simulate_actor("competidor", ...)    return
    │
    ▼
probeDetector.analyzeQuestions() ──► ProbeAlert
    │
    ▼
honeyPotProposer.proposeDecoy() ──► DecoyProposal (honey-pot-deploy)
    │
    ▼
seller: "dale" ──► honeyPotGuardrail (double confirm)
    │
    ▼
execute ──► Cortex.storeProbeResult() ──► probe_operations table
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/probeDetector.ts` | Create | `analyzeQuestions()`, `detectViewAnomalies()`, `analyzeCompetitorReaction()` — pattern detection returning `ProbeAlert[]` |
| `packages/agent/src/conversation/honeyPotProposer.ts` | Create | `proposeDecoy()` — generates `DecoyProposal` with mandatory TOS warning |
| `packages/agent/src/conversation/guardrails.ts` | Modify | Add `honeyPotValidator(proposal, strategies): GuardResult` — default-deny, checks for active probe strategy + "dale" |
| `packages/agent/src/conversation/tools.ts` | Modify | Add `createDetectProbesTool()` and `createProposeHoneyPotTool()` factory functions |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Register new tools in constructor; invoke `honeyPotValidator` after strategy check in proposal path |
| `packages/agent/src/conversation/types.ts` | Modify | Add `ProbeAlert`, `DecoyProposal`, `ProbeOutcome` types; add `probe` to `RuleType` |
| `packages/agent/src/conversation/strategyParser.ts` | Modify | Add probe regex patterns (`PROBE_CATEGORY_RE`, `DEPLOY_DECOY_RE`, `MONITOR_COMPETITOR_RE`) |
| `packages/agent/src/conversation/actorSimulator.ts` | Modify | Add `simulateCounterintelligence()` export + enhanced `COMPETIDOR_PROMPT` with counterintelligence awareness |
| `packages/memory/src/cortex/engine.ts` | Modify | Add `storeProbeResult()` method creating probe-tagged nodes and Hebbian edges |
| `packages/memory/src/cortex/database.ts` | Modify | Add `probe_operations`, `competitor_observations`, `suspicious_events` tables |
| `packages/domain/src/preparedAction.ts` | Modify | Add `honey-pot-deploy` and `probe-analysis` to `WriteActionKind`; add risk mappings |

## Interfaces / Contracts

```typescript
// probeDetector.ts
type ProbeAlert = {
  pattern: "rapid_fire" | "price_probe" | "category_sweep";
  confidence: number;        // 0.0-1.0, threshold >= 0.6
  competitorId: string;
  detectedAt: string;        // ISO timestamp
  recommendedAction: "deploy_decoy" | "monitor" | "alert_ceo";
};

// honeyPotProposer.ts
type DecoyProposal = {
  decoyType: "price_probe" | "category_entry" | "stock_signal";
  targetCategory: string;
  baitDescription: string;
  riskLevel: RiskLevel;
  tosWarning: string;        // MANDATORY — populated in Spanish
  tosCompliant: boolean;
};

// guardrails.ts — follows existing GuardResult pattern
function honeyPotValidator(proposal: DecoyProposal, strategies: Strategy[]): GuardResult;

// Cortex engine.ts
function storeProbeResult(
  engine: GraphEngine,
  probe: DecoyProposal,
  outcome: ProbeOutcome
): void;
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Probe detection confidence scoring, guardrail block/allow logic, strategy parser regex extraction | Vitest, mock Cortex, pure functions |
| Unit | `HoneyPotProposer.proposeDecoy()`: decoy generation, TOS warning presence | Vitest, mock ProbeAlert input |
| Integration | Agent loop: honey-pot tool registration, guardrail integration in proposal path | Vitest with mock client, tool-aware |
| Integration | Cortex `storeProbeResult`: node creation, edge Hebbian adjustment | Vitest, in-memory SQLite |

## Migration / Rollout

No data migration required — new tables are additive only. Rollback: deactivate probe strategies in `ceo_strategies` (guardrail blocks all operations). Revert `competidor` persona prompt from git.

## Open Questions

- None — all blocking decisions resolved in exploration (Approach 3 chosen, Hebbian scoping via `probe: true` tag, double confirmation pattern proven).
