# Tasks: Autonomy Levels with KPI-Based Auto-Degradation

## Implementation Phases

### Phase 1: Foundation — Types, Store, Cortex Tables
- [x] **Task 1.1**: Define `AutonomyLevel`, `KpiSnapshot`, `DegradationDecision` types in `types.ts`
- [x] **Task 1.2**: Create `autonomyStore.ts` with SQLite `autonomy_state` singleton table and `createAutonomyStore(db)` factory (mirrors `createStrategyStore` pattern) — *consolidated into `autonomyEngine.ts`*
- [ ] **Task 1.3**: Add `kpi_history` and `autonomy_events` tables to Cortex `database.ts` migration
- [ ] **Task 1.4**: Add `recordKpi()` and `getKpiWindow()` methods to Cortex `GraphEngine`

**Verification**: Store CRUD works; Cortex tables create and accept inserts; `getKpiWindow()` returns correct time-bounded rows.
**Changed lines (est.)**: ~120

### Phase 2: Engine Core — AutonomyEngine + Guardrail Gate
- [x] **Task 2.1**: Implement `AutonomyEngine` class in `autonomyEngine.ts`:
  - Constructor receives `AutonomyStore`, `GraphEngine`, optional `now: Date`
  - `getCurrentLevel()`: reads from store
  - `evaluateDegradation()`: queries 7-day window, applies 3 degradation rules
  - `evaluatePromotion()`: queries 30-day window, generates Spanish proposal when eligible
  - `promote()`: increments level after CEO dale, writes `autonomy_events`
  - `degrade(newLevel, reasons)`: persists level + event record
- [x] **Task 2.2**: Implement `autonomyLevelGate(proposal, level): GuardResult` in `guardrails.ts`
  - Map level → max auto-execute risk via `levelThresholdMap`
  - Compare against `riskLevelForAction(proposal.action.kind)`
  - Return `autoApproved: true` when risk ≤ threshold, Spanish reason when blocked
- [ ] **Task 2.3**: Integrate into `agentLoop.ts`:
  - Inject `AutonomyEngine` via `AgentLoopConfig`
  - Call `evaluateDegradation()` before each `converse()` turn
  - Insert `autonomyLevelGate()` before existing dale confirmation
  - Record KPIs after action execution via `engine.recordKpi()`
  - Generate auto-approval `AuditRecord` with `approvalMethod: "auto"`

**Verification**: Engine degrades on 3 safety violations; low-risk action auto-approved at level 2; critical always requires dale.
**Changed lines (est.)**: ~200

### Phase 3: Test Suite
- [x] **Task 3.1**: `autonomyEngine.test.ts` — Vitest unit tests:
  - Degradation: 3 safety violations → −1 level; cumulative degradation; insufficient data no-op
  - Gating: level 0 always blocks; level 5 auto-approves high; critical always blocked
  - Promotion: healthy 30-day window → proposal; CEO dale → increment; violation blocks promotion
  - Date injection: frozen `now` for window boundary tests
  - Store persistence: level survives engine re-initialization
- [ ] **Task 3.2**: `kpi-history.test.ts` — Vitest integration tests:
  - `recordKpi()` writes correct values
  - `getKpiWindow(7, frozenNow)` returns correct row count
  - Index performance on time-range queries

**Verification**: `npm test` passes all new suites; guardrail function tested in isolation.
**Changed lines (est.)**: ~280

---

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| Core implementation lines | ~320 |
| Test lines | ~280 |
| **Total changed lines (est.)** | **~600** |
| Decision needed before apply | No (auto-chain) |
| Chained PRs recommended | Yes |
| 400-line budget risk | **Medium** |

> Each phase stays under 400 lines. Phase 1 (120) + Phase 2 (200) = 320 core — under budget if merged as one PR. Phase 3 (280) is under budget as a second PR. With `auto-chain` + `stacked-to-main`, use two stacked PRs to keep each reviewable under 60 minutes.

### Chained PR Plan (Stacked to Main)

**PR #1 → main**: Foundation + Engine Core (Phases 1 + 2)
- Types, autonomyStore, Cortex tables, AutonomyEngine, guardrail gate, agentLoop integration
- ~320 lines
- Dependency: none → targets `main`
- Verification: manual smoke test (start agent at level 0, verify dale still required)

**PR #2 → main** (stacked): Test Suite (Phase 3)
- All unit + integration tests
- ~280 lines
- Dependency: PR #1 merged → targets `main`
- Verification: `npm test` passes all suites

### Dependency Diagram

```
main
 ├── PR #1: Foundation + Engine Core (320 lines) 📍 current planning target
 └── PR #2: Test Suite (280 lines) — blocked on PR #1 merge
```

---

## Commit Strategy (per work-unit-commits)

Each task maps to one conventional commit. Tests and code ship together per work unit:

```
PR #1 commits:
  feat(autonomy): add AutonomyLevel types and autonomyStore
  feat(cortex): add kpi_history and autonomy_events tables
  feat(autonomy): implement AutonomyEngine with degradation and promotion
  feat(guardrails): add autonomyLevelGate guardrail function
  feat(agent): integrate AutonomyEngine into agentLoop

PR #2 commits:
  test(autonomy): add AutonomyEngine gating and degradation tests
  test(cortex): add KPI history storage and window query tests
```

---

## Rollback per PR

| PR | Rollback |
|----|----------|
| PR #1 | Remove `autonomyLevelGate()` call from agentLoop; set all `autonomy_state.current_level` to 0; drop new Cortex tables |
| PR #2 | Revert test files only — no production code change |
