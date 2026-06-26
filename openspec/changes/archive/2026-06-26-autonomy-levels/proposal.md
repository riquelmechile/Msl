# Proposal: Autonomy Levels with KPI-Based Auto-Degradation

## Intent

The agent currently requires "dale" confirmation for every write action, regardless of risk. This creates friction for experienced sellers who trust the agent for low-risk operations and makes the agent unable to self-regulate when KPIs degrade. We need graduated autonomy so safe operators move faster and unsafe behavior self-corrects.

## Scope

### In Scope
- 6 autonomy levels (0–5) mapping risk tolerance to auto-execution thresholds
- `AutonomyEngine` class with SQLite-backed state persistence
- KPI tracking: `success_rate`, `margin_compliance`, `safety_violations`
- Auto-degradation: 7-day rolling window evaluation via `evaluateDegradation()`
- Promotion requires CEO "dale" on a generated promotion proposal
- Guardrail gate `autonomyLevelGate()` in agentLoop pre-confirmation path
- Migration: new Cortex tables (`kpi_history`, `autonomy_events`)

### Out of Scope
- Real-time KPI data from ML API (Phase 7)
- Customer satisfaction KPI (no sentiment pipeline yet)
- Degradation scheduling via external cron/worker (runs inline per turn)
- CEO-free auto-promotion (safety-first: agent can only degrade, not promote itself)

## Capabilities

### New Capabilities
- `autonomy-engine`: level state machine, KPI tracking, degradation rules, and guardrail gate

### Modified Capabilities
- `action-approval-safety`: Human Approval for Writes requirement relaxes when risk ≤ current autonomy level threshold; auto-approved actions still generate audit records

## Approach

Domain-level engine in the agent package (Approach 1 from exploration). New `autonomyEngine.ts` and `autonomyStore.ts` sibling to existing `strategyStore.ts`. Cortex gets `kpi_history` and `autonomy_events` tables. Guardrail `autonomyLevelGate()` slots into agentLoop before the "dale" confirmation gate — same pattern as existing `strategyValidator`. Degradation evaluated before each `converse()` turn.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/autonomyEngine.ts` | New | AutonomyEngine class with level + KPI logic |
| `packages/agent/src/conversation/autonomyStore.ts` | New | SQLite store for autonomy_state |
| `packages/agent/src/conversation/guardrails.ts` | Modified | Add `autonomyLevelGate(proposal, level)` |
| `packages/agent/src/conversation/agentLoop.ts` | Modified | Inject engine, call gate before confirmation |
| `packages/memory/src/cortex/database.ts` | Modified | Add `kpi_history`, `autonomy_events` tables |
| `packages/memory/src/cortex/engine.ts` | Modified | Add `recordKpi()`, `getKpiWindow()` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| KPI window drift vs Chile timezone | Low | Document all windows use UTC; add `now: Date` DI for tests |
| Low-risk auto-approve surprises CEO | Medium | Log every auto-approved action; gate only `low` risk by default |
| Degradation makes agent too conservative | Low | Promotion path remains CEO-controlled; thresholds configurable |

## Rollback Plan

Set all autonomy levels to 0 (always require "dale") via a one-line SQL update on `autonomy_state`. Gate is a pure function — removing the call from agentLoop restores current behavior. Drop new Cortex tables if needed.

## Dependencies

- Existing `RiskLevel`/`riskLevelForAction()` mapping in `domain/preparedAction.ts`
- Existing `strategyStore` pattern for store factory and schema migration
- Cortex `GraphEngine` (extends, not rewrites)

## Success Criteria

- [ ] Agent auto-approves low-risk actions at level ≥ 2 without "dale"
- [ ] 3 consecutive safety violations within 7 days trigger auto-degradation
- [ ] CEO receives Spanish explanation on degradation: "Bajé tu autonomía a nivel 1 porque..."
- [ ] All auto-approved actions generate audit records distinct from CEO-confirmed ones
- [ ] Unit tests: `autonomyLevelGate()`, `evaluateDegradation()`, `shouldAutoApprove()`
