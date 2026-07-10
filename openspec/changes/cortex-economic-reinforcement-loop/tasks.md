# Tasks: Cortex Economic Reinforcement Loop

## Hardening Gate (pre-work)

- [x] Wire Finance Director tools into agentLoop.ts (hardening PR 2 fix)
- [x] Verify lane contracts (16 lanes, 16 contracts)
- [x] Verify daemon handlers (15 registered)
- [x] Verify validator rules (14 rules, Rule 12 placeholder noted)
- [x] Verify Finance Director work session integration
- [x] Verify no raw reasoning persisted in FinanceDirectorAssessmentStore

## Task 1 — Domain Types
- [ ] Create `packages/domain/src/economicLearning.ts` with all types:
  - `EconomicLearningEligibility`, `BlockReason`
  - `AttributionStrength`, `AttributionTargetType`
  - `EconomicAttributionAssessment`
  - `EconomicSignal`
  - `EconomicReinforcementPlan`, `PlanStatus`, `ReinforcementTarget`, `NodeAdjustment`, `BlockedTarget`, `LessonCandidate`
  - `EconomicLearningEvent`, `LearningEventStatus`, `AppliedAdjustment`
- [ ] Export from `packages/domain/src/index.ts`

## Task 2 — Eligibility Evaluator
- [ ] Create `packages/domain/src/economicLearningEligibility.ts`
  - Pure deterministic function `evaluateEconomicLearningEligibility(outcome, snapshot?)`
  - Status gate: only `verified` passes to next checks
  - Completeness checks: observed impact, snapshot status, currency consistency, evidence quality
  - Already-processed check via callback
  - Seller scope validation
  - Return `EconomicLearningEligibility`
- [ ] Tests: 10+ cases covering all statuses, completeness, currency, seller mismatch, already-processed

## Task 3 — Economic Signal Calculator
- [ ] Create `packages/domain/src/economicSignal.ts`
  - `computeEconomicSignal(outcome, snapshot, baseline?)` → `EconomicSignal`
  - Direction: positive/neutral/negative based on profit vs expected
  - Magnitude: 0..1 bounded score from financial data
  - Confidence: from completeness, evidence quality
  - No NaN/Infinity; Money-safe
- [ ] Tests: 10+ cases: positive, negative, neutral, high-revenue-net-loss, refund, no baseline, low confidence

## Task 4 — Attribution Evaluator
- [ ] Create `packages/agent/src/finance/EconomicAttributionEvaluator.ts`
  - `EconomicAttributionEvaluator` class
  - Fast path: deterministic ID-based linking
  - Optional DeepSeek: hypothesis generation with caps
  - Strength limits enforced: temporal→associated, linked→contributory, baseline→experiment-supported
  - Anti-causality validator
  - Cross-seller rejection
- [ ] Tests: 12+ cases covering all strength levels, caps, alternative explanations, cross-seller, invented evidence rejection

## Task 5 — Reinforcement Planner
- [ ] Create `packages/agent/src/finance/EconomicReinforcementPlanner.ts`
  - `EconomicReinforcementPlanner` class
  - Transform outcome + signal + attribution → `EconomicReinforcementPlan`
  - Per-strength policies: none→no-reinforce, associated→episodic, contributory→moderate, experiment-supported→larger-capped, causal→max-allowed
  - Global magnitude cap
  - Negative signal weakens connections
  - Single outcome cannot create global rule
  - Creates lesson candidates with scope/confidence/expiry
  - Policy versioning
- [ ] Tests: 10+ cases covering all strength levels, magnitude caps, negative signal, isolated outcome

## Task 6 — Cortex Economic Bridge
- [ ] Create `packages/agent/src/finance/CortexEconomicReinforcementBridge.ts`
  - `CortexEconomicReinforcementBridge` class
  - Apply validated plan to Cortex graph
  - Idempotency via compare-and-swap
  - Before/after state hashes
  - Create economic outcome nodes, link evidence
  - Apply bounded edge adjustments
  - Record `EconomicLearningEvent`
  - Safe degradation on Cortex failure (never modifies EconomicOutcome)
  - Seller-scoped operations
- [ ] Tests: 10+ cases: successful apply, idempotency, retry, Cortex failure isolation, seller isolation, node dedup, no raw metadata

## Task 7 — Economic Learning Store
- [ ] Create `packages/memory/src/economicLearningStore.ts`
  - `EconomicLearningStore` interface
  - SQLite implementation with migration
  - `economic_learning_events` table
  - CRUD: insert, get, list by outcome/seller/agent/event
  - Idempotency key claim (compare-and-swap)
  - Status transitions: processed, failed, retryable, reversed
  - Seller isolation on all queries
  - Bounded metadata, no secrets
- [ ] Tests: 12+ cases covering CRUD, idempotency, seller isolation, status transitions, dedup

## Task 8 — Reversal Engine
- [ ] Add reversal logic to `CortexEconomicReinforcementBridge` or `EconomicLearningStore`
  - `reverseOutcomeLearning(outcomeId, sellerId)` 
  - Find learning events, apply inverse adjustments
  - Mark `reversed`, create compensating event
  - Prevent double reversal
  - Handle partial failure
- [ ] Tests: 8+ cases: applied→disputed, invalidated, compensating, double-reversal blocked, partial, new evidence version

## Task 9 — Finance Director Learning Tools
- [ ] Create `packages/agent/src/conversation/tools/economicLearningTools.ts`
  - `createExplainEconomicLearningTool` — outcome, evidence, attribution, signal, lessons
  - `createInspectEconomicLearningStatusTool` — status per outcome
  - `createListEconomicLearningEventsTool` — seller-scoped list
  - All: `noExternalMutationExecuted: true`, seller isolation
- [ ] Wire into agentLoop.ts (extend Finance Director tools or standalone)
- [ ] Tests: 6+ cases: explain/inspect/list, seller isolation, nonexistent, failed, reversed

## Task 10 — Event Processing & Wake Policy
- [ ] Create event handlers for learning pipeline
  - Outcome verified → eligibility → attribution → plan → bridge
  - Outcome disputed/invalidated → reversal
- [ ] Extend agentWakePolicy with economic learning wake reasons
- [ ] Wire into AgentMessageBus for event-driven processing
- [ ] Tests: event flow end-to-end

## Task 11 — Documentation
- [ ] Create `docs/architecture/cortex-economic-reinforcement-loop.md`
- [ ] Update `ARCHITECTURE.md`
- [ ] Update `ROADMAP.md`
- [ ] Update `docs/agent-enterprise-vision.md` (if needed)
- [ ] Update `docs/README.md`

## Task 12 — SDD Archive
- [ ] Create spec delta in `openspec/specs/`
- [ ] Run final verification
- [ ] Archive change

## Review Workload Forecast
- **Estimated changed lines**: ~3000-4000
- **Chained PRs recommended**: Yes (if exceeding review budget)
- **400-line budget risk**: High
- **Decision needed**: Split into stacked PRs or use `size:exception`

## Test File Plan
| Test File | Package | Target Tests |
|-----------|---------|-------------|
| `economicLearningEligibility.test.ts` | domain | 10+ |
| `economicSignal.test.ts` | domain | 10+ |
| `economicLearning.test.ts` | domain | 5+ |
| `economicLearningStore.test.ts` | memory | 12+ |
| `EconomicAttributionEvaluator.test.ts` | agent | 12+ |
| `EconomicReinforcementPlanner.test.ts` | agent | 10+ |
| `CortexEconomicReinforcementBridge.test.ts` | agent | 10+ |
| `economicLearningTools.test.ts` | agent | 6+ |
