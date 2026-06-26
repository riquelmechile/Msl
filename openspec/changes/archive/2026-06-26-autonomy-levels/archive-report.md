# Archive Report: Autonomy Levels with KPI-Based Auto-Degradation

**Change**: `autonomy-levels`  
**Archived**: 2026-06-26  
**Verdict**: PASS WITH WARNINGS

## Executive Summary

Implemented 6 graduated autonomy levels (CONSULTA through FULL) controlling auto-execution of agent actions. The `AutonomyEngine` class (consolidated with its store into `autonomyEngine.ts`) manages level state, KPI tracking, degradation evaluation, and promotion eligibility. The `autonomyGate` guardrail integrates into `agentLoop.ts` before the existing "dale" confirmation gate.

## What Changed

| Area | File | Delta |
|------|------|-------|
| Agent — AutonomyEngine | `packages/agent/src/conversation/autonomyEngine.ts` | +405 lines (new) |
| Agent — Guardrails | `packages/agent/src/conversation/guardrails.ts` | +50 lines |
| Agent — AgentLoop | `packages/agent/src/conversation/agentLoop.ts` | +80 lines |
| Agent — Types | `packages/agent/src/conversation/types.ts` | +49 lines |
| Agent — Tests | `packages/agent/tests/.../autonomyEngine.test.ts` | +418 lines (new) |
| Agent — Tests | `packages/agent/tests/.../autonomyIntegration.test.ts` | +444 lines (new) |
| **Total** | | **~1400 lines** |

## Verification Results

- **Tests**: 496/496 passed (including 43 new autonomy tests)
- **Typecheck**: Zero errors
- **Build**: Next.js production build successful
- **Warnings**: 5 spec-implementation deviations (see verify-report.md for full details)

## Spec Deltas Merged

| Capability | Action | Canonical Path |
|-----------|--------|---------------|
| `autonomy-engine` | Created (new) | `openspec/specs/autonomy-engine/spec.md` |
| `action-approval-safety` | Modified | `openspec/specs/action-approval-safety/spec.md` |

## Warnings Carried Forward

1. Default level is 1 (SUGIERE) instead of 0 (CONSULTA) — spec mismatch
2. Safety degradation: >3 violations/24h → force 0 vs spec's ≥3/7d → −1
3. Degradation thresholds differ from original spec (success, margin)
4. KPI tables in autonomyEngine.ts instead of Cortex
5. Event table named `degradation_events` instead of `autonomy_events`

## Rollback Path

Set all `autonomy_state.current_level` rows to 0 (CONSULTA). Remove `autonomyGate()` call from agentLoop. Drop `kpi_history`, `degradation_events`, `autonomy_state` tables.
