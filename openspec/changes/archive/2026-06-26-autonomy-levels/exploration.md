## Exploration: Autonomy Levels with KPIs and Auto-Degradation

### Current State

The agent operates at a single implicit autonomy level: **always requires "dale" confirmation for all writes**, regardless of risk. The safety architecture has three layers:

1. **Input guardrails** (`spanishValidator`, `harmfulContentFilter` in `guardrails.ts`) — block/reject bad input
2. **Output guardrails** (`actionSafetyValidator`, `strategyValidator`, `honeyPotValidator` in `guardrails.ts`) — validate proposals before presenting to seller
3. **Confirmation gate** (`isConfirmation` in `agentLoop.ts`) — "dale" required for every action

Key existing infrastructure:
- **`RiskLevel`**: `"low" | "medium" | "high" | "critical"` — already mapped per `WriteActionKind` via `riskLevelForAction()` in `domain/preparedAction.ts`
- **`Strategy` store**: SQLite-backed CEO strategies with lifecycle (active/archived/superseded) in `agent/conversation/strategyStore.ts`
- **`AgentLoop`**: processes turns, validates proposals, waits for confirmation in `agent/conversation/agentLoop.ts`
- **Cortex `GraphEngine`**: SQLite graph with Hebbian learning, convergence detection, traversal — could store KPI history in new tables or as weighted edges
- **No KPI tracking, no level model, no degradation logic exists today**

### Affected Areas

- `packages/agent/src/conversation/agentLoop.ts` — primary integration point: level check before confirmation gate
- `packages/agent/src/conversation/types.ts` — new types: `AutonomyLevel`, `KpiSnapshot`, `DegradationDecision`
- `packages/agent/src/conversation/guardrails.ts` — new guardrail: `autonomyLevelGate(proposal, level): GuardResult`
- `packages/agent/src/conversation/strategyStore.ts` — schema extension or sibling store for `autonomy_state` table
- `packages/domain/src/preparedAction.ts` — no change needed (`RiskLevel` already defined)
- `packages/memory/src/cortex/database.ts` — new tables: `kpi_history`, `autonomy_events`
- `packages/memory/src/cortex/engine.ts` — new methods: `recordKpi()`, `getKpiWindow()`, `checkDegradation()`
- `packages/agent/tests/conversation/` — new test suite for autonomy gating and degradation rules
- `packages/memory/tests/cortex/` — tests for KPI storage and time-window queries

### Approaches

#### 1. Domain-Level Autonomy Engine in Agent Package (Recommended)

Add `AutonomyLevel` enum (0–5), an `AutonomyEngine` in the agent package backed by SQLite (extending the strategy store or a sibling `autonomyStore`), and a pre-confirmation gate in `agentLoop`. Cortex stores KPI history. Degradation checked at agent initialization and after each action.

- **Design**:
  - New file `packages/agent/src/conversation/autonomyEngine.ts` with `AutonomyEngine` class
  - New file `packages/agent/src/conversation/autonomyStore.ts` with `createAutonomyStore(db)` factory (sibling pattern to `strategyStore`)
  - New tables in Cortex: `kpi_history(id, kpi_name, value, recorded_at)` and `autonomy_events(id, event_type, from_level, to_level, reason, created_at)`
  - `autonomyLevelGate(proposal, level)` guardrail: if `riskLevelForAction(proposal.action.kind)` ≤ `level.autoExecuteRisk`, skip "dale"
  - Degradation function `evaluateDegradation()` called before each `converse()` turn
  - Promotion requires CEO "dale" on a generated promotion proposal

- **Pros**:
  - Follows established patterns: SQLite store (like `strategyStore`), guardrail function (like `actionSafetyValidator`), closure injection (like `agentLoop` config)
  - Minimal new packages — stays within agent + memory boundaries
  - Cortex as KPI historian is natural extension — graph already has learned outcome tracking via Hebbian
  - Tests follow existing structure exactly
  - Risk-level mapping is already done (`riskLevelForAction`)

- **Cons**:
  - Agent loop grows more complex (though `converse()` is already 300+ lines)
  - KPI tracking requires real-time writes inside the hot path (can be deferred async)
  - Need to decide KPI window queries (SQLite date math is simple but needs indexes)

- **Effort**: Medium (4–6 files changed, ~300 new lines of core logic, ~400 lines of tests)

#### 2. Autonomy as CEO Strategy (Strategy-Based)

Add `"autonomy"` as a new `RuleType` in the strategy parser. CEO sets level via natural language ("operá autónomo nivel 3"). Existing strategy lifecycle handles promotion/degradation as strategy updates. KPI tracking uses Cortex Hebbian learning on action outcomes.

- **Design**:
  - Add `"autonomy"` to `RuleType` union in `types.ts`
  - Add regex pattern to `strategyParser.ts` for "nivel de autonomía N" / "operá autónomo nivel N"
  - `strategyValidator` gains autonomy-check logic
  - KPI compliance tracked as Hebbian edge weights on existing strategy nodes
  - CEO triggers degradation conversationally (or system detects and prompts)

- **Pros**:
  - CEO already knows strategy management flow — no new UX
  - Reuses parser, store, and lifecycle patterns
  - Degradation/Promotion becomes strategy CRUD — natural audit trail

- **Cons**:
  - **Mixes safety infrastructure with business rules** — autonomy is infrastructure, not a margin/category directive
  - Auto-degradation harder: strategies don't auto-update, CEO must issue command
  - KPI tracking via Hebbian edges is an abstraction stretch — edges represent semantic associations, not time-series dashboards
  - Hard to test degradation independently from strategies

- **Effort**: Low (parser + validator changes only), but **conceptual risk is high** due to category error

#### 3. Middleware Pipeline (Composable Chain)

Refactor the agent loop's proposal handling into a middleware chain: `AutonomyGate → KpiRecorder → StrategyValidator → PresentToCEO`. Each middleware is a pure function. Auto-degradation runs as a separate rule engine service.

- **Design**:
  - New type `ProposalMiddleware = (ctx: ProposalContext, next: () => Promise<ProposalResult>) => Promise<ProposalResult>`
  - `AutonomyGate` middleware: checks `ctx.level.autoExecuteRisk >= ctx.proposal.riskLevel`
  - `KpiRecorder` middleware: writes to Cortex after action confirmed
  - `DegradationScheduler`: periodic check via `setInterval` or on-demand trigger
  - Clean function composition — each middleware testable in isolation

- **Pros**:
  - Elegant separation of concerns — each middleware does one thing
  - Pure functions are trivial to test
  - Easy to add/remove middleware layers later

- **Cons**:
  - Middleware pattern is **not established** in this codebase (everything is direct function calls)
  - Adds indirection that doesn't match current architecture style
  - `DegradationScheduler` needs external trigger (cron/worker) — adds deployment complexity
  - Middleware chain harder to debug than sequential calls with early returns

- **Effort**: High (architectural shift + middleware infrastructure + scheduler)

#### 4. Separate Autonomy Package (Clean Separation)

Extract autonomy into a new `packages/autonomy/` workspace package with its own engine, store, and KPI tracker. Agent loop imports and delegates to it.

- **Design**:
  - `packages/autonomy/src/index.ts`, `autonomy/src/engine.ts`, `autonomy/src/store.ts`, `autonomy/src/types.ts`
  - `AutonomyEngine` owns level state, KPI computation, degradation rules
  - Cortex integration via same `GraphEngine` import
  - Agent loop receives `autonomyEngine` via `AgentLoopConfig` (same pattern as `engine: GraphEngine`)

- **Pros**:
  - Cleanest separation — autonomy is its own bounded context
  - Independent testing, independent evolution
  - Can be reused if agent loop is replaced later

- **Cons**:
  - **More infrastructure**: package.json, tsconfig, build step, new dependency
  - Adds burden for what is fundamentally a 200-line decision engine
  - Coordination with agent loop still needs tight coupling (call before each action)
  - Over-engineering for Phase 6 of 7 — 6 files for concepts that fit in 2

- **Effort**: High (package setup + engine + store + types + tests + integration)

### Recommendation

**Approach 1 — Domain-Level Autonomy Engine in Agent Package.**

This is the right fit for the project's current size and patterns:
- **Fits existing architecture**: SQLite store factory (`createAutonomyStore` mirrors `createStrategyStore`), guardrail function pattern (`autonomyLevelGate` mirrors `actionSafetyValidator`), config injection (`AutonomyEngine` in `AgentLoopConfig` mirrors `engine: GraphEngine`)
- **Uses what's already built**: `RiskLevel`/`riskLevelForAction()` map already exists, Cortex is ready for new tables, strategy store pattern is proven
- **Right granularity for Phase 6**: The ROADMAP says 6 phases are built, 2 remain — this is not the time to introduce new packages or middleware patterns
- **Degradation is straightforward**: time-windowed SQLite queries (`WHERE recorded_at > datetime('now', '-7 days')`) are simple and testable. The degradation rule engine is ~50 lines.

Tradeoff accepted: agent loop complexity grows, but `converse()` can extract autonomy logic into private helper methods (`evaluateKpisAndDegrade`, `shouldAutoApprove`) to keep it readable.

### Risks

- **KPI definitions are subjective**: `customer_satisfaction` estimated from conversation tone has no implementation path yet — this KPI should be deferred to Phase 7+ (needs sentiment analysis or post-action survey). Start with measurable KPIs: `margin_compliance`, `safety_violations`, `success_rate`.
- **Degradation timing**: 7-day windows require persistent dates. SQLite `datetime('now')` is UTC — consistent but may drift vs. Chile timezone (−4/−3). Document that all KPI windows use UTC.
- **CEO must understand levels**: Level descriptions need clear Spanish messages. The agent must explain what changed when degrading ("Bajé tu nivel de autonomía a 1 porque...") and what's needed for promotion ("Para subir a nivel 4 necesitás mantener ≥ 90% de margen compliance por 30 días").
- **No counter-agency**: Auto-degradation is irreversible by agent — CEO must manually promote. This is by design (safety-first). Document this in the system prompt (Block A).
- **Test complexity**: Time-windowed KPI queries need mock dates — use dependency injection for `now: Date` in KPI query functions.

### Ready for Proposal

Yes — the approaches are clear, the recommendation is well-grounded in the existing architecture, and the risks are documented. The orchestrator should proceed to `sdd-propose` with the recommendation for Approach 1.
