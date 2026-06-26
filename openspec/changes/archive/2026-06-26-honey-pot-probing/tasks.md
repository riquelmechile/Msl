# Tasks: Honey-Pot Probing — Active Counterintelligence (Phase 5a)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 500–700 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Foundation: types, regex patterns, DB schema, action kinds | PR 1 | All downstream deps; testable alone |
| 2 | Core modules: probeDetector, honeyPotProposer, guardrail, actor, Cortex store | PR 2 | Depends on PR 1 types; fully unit-testable |
| 3 | Integration: tool registration, agentLoop wiring, integration tests | PR 3 | Depends on PR 2 modules |

## Phase 1: Foundation (types, strategy, schema)

- [x] 1.1 `packages/agent/src/conversation/types.ts` — add `"probe"` to `RuleType` union; add `ProbeAlert`, `DecoyProposal`, `ProbeOutcome` types
- [x] 1.2 `packages/agent/src/conversation/strategyParser.ts` — add 3 regex patterns: `PROBE_CATEGORY_RE` ("probá competidores en {cat}"), `DEPLOY_DECOY_RE` ("creá listing señuelo"), `MONITOR_COMPETITOR_RE` ("monitoreá reacciones de {competidor}"); wire into `parseStrategy` with `ruleType: "probe"`
- [x] 1.3 `packages/memory/src/cortex/database.ts` — add `probe_operations`, `competitor_observations`, `suspicious_events` tables to `SCHEMA_SQL`
- [x] 1.4 `packages/domain/src/preparedAction.ts` — add `honey-pot-deploy` and `probe-analysis` to `WriteActionKind` union; add both to `riskByKind` map as `"high"`
- [x] 1.5 Write unit tests for new strategy parser patterns (probe directive extraction)
- [x] 1.6 Write unit tests for new `riskByKind` mappings

## Phase 2: Core Modules (detection, proposal, guardrail, actor, Cortex)

- [x] 2.1 `packages/agent/src/conversation/probeDetector.ts` (CREATE) — `analyzeQuestions()`, `detectViewAnomalies()`, `analyzeCompetitorReaction()` returning `ProbeAlert[]` with confidence ≥ 0.6 threshold
- [x] 2.2 `packages/agent/src/conversation/honeyPotProposer.ts` (CREATE) — `proposeDecoy()` generating `DecoyProposal` with mandatory `tosWarning` in Spanish
- [x] 2.3 `packages/agent/src/conversation/guardrails.ts` — add `honeyPotValidator(proposal, strategies): GuardResult` (default-deny: requires active `"probe"` strategy + "dale" confirmation)
- [x] 2.4 `packages/agent/src/conversation/actorSimulator.ts` — enhance `COMPETIDOR_PROMPT` with counterintelligence awareness; export `simulateCounterintelligence(actorType, query)` returning `SimulationResult`
- [x] 2.5 `packages/memory/src/cortex/engine.ts` — add `storeProbeResult()` using `createNode`/`createEdge`/`reinforceEdge` with `probe: true` metadata tag
- [x] 2.6 Write unit tests for `probeDetector.analyzeQuestions` (rapid_fire, price_probe, category_sweep patterns)
- [x] 2.7 Write unit tests for `honeyPotProposer.proposeDecoy` (TOS warning presence, riskLevel)
- [x] 2.8 Write unit tests for `honeyPotValidator` (block without strategy, allow with active probe strategy + "dale")
- [x] 2.9 Write unit tests for `storeProbeResult` (node creation, edge Hebbian adjustment, probe tag)

## Phase 3: Integration & Wiring (tools, agent loop)

- [x] 3.1 `packages/agent/src/conversation/tools.ts` — add `createDetectProbesTool()` and `createProposeHoneyPotTool()` factory functions following existing `createSimulateActorTool` pattern
- [x] 3.2 `packages/agent/src/conversation/agentLoop.ts` — register new tools in constructor's `toolMap`; invoke `honeyPotValidator` in proposal path after `strategyValidator`
- [x] 3.3 Write integration tests for agent loop: honey-pot tool registration, guardrail blocking/allow flow
- [x] 3.4 Write integration tests for Cortex `storeProbeResult` end-to-end with in-memory SQLite
