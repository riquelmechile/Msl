# Tasks: DeepSeekReasoningGateway

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~500 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Foundation Types & Logic

- [x] 1.1 Create `reasoningTypes.ts` — `ReasoningCall`, `ReasoningResult`, `CostTelemetry` types per design spec (spec RQ: ReasoningCall Contract, ReasoningResult Contract)
- [x] 1.2 Create `reasoningLevels.ts` — `ReasoningLevel` enum with 5 levels, timeout map (5s/15s/30s), auto-execute set, autonomy gate risk mapping (spec RQ: Five Reasoning Levels, Model Selection by Level, Timeout Strategy)
- [x] 1.3 Create `modelRouter.ts` — `selectModel(level, forcePro)` Flash/Pro decision table, exports model constants for policy integration (spec RQ: Model Selection)
- [x] 1.4 Create `costEstimator.ts` — consolidated pricing tables (Flash/Pro), `estimateCost(model, tokenCounts)` → CostTelemetry (spec RQ: Cost Recording)

## Phase 2: Gateway Core

- [x] 2.1 Create `DeepSeekReasoningGateway.ts` — class wrapping `OpenAI` client with `reason()`: `selectModel` → `buildPrompt()` (3-block cache) → `AbortController` timeout → `chat.completions.create` → `validateOutput()` (JSON + schema) → `recordCost()` via `insertEntry` → `checkAutonomy()` (`canAutoApprove`) → `ReasoningResult`. NEVER throws, returns `status: "fallback"` on all errors. (spec RQ: Unified Reasoning Interface, Prompt Cache Strategy, Timeout Strategy, Fallback Behavior, Structured Output Validation, Autonomy Gate Integration)
- [x] 2.2 Create `reasoning/index.ts` — barrel: `DeepSeekReasoningGateway`, `ReasoningLevel`, types (`ReasoningCall`, `ReasoningResult`, `CostTelemetry`) (design: Exports)
- [x] 2.3 Update `packages/agent/src/index.ts` — add reasoning exports per design spec (spec RQ: Unified Reasoning Interface)

## Phase 3: Refactor Callers

- [x] 3.1 Refactor `CeoDeepSeekClientImpl` — build `ReasoningCall` with `level: recommendation`, delegate `gateway.reason()`, keep Cortex enrichment + `proposalType` enum validation + `SIGNAL_TO_ACTION` mapping. Remove direct OpenAI call, inline timeout, ledger recording. Factory creates gateway with `getDeepSeekClient()` + ledger + autonomy engine. (spec RQ: Refactored callers route through gateway, CeoDeepSeekClient delta spec)
- [x] 3.2 Refactor `SupplierMirrorDeepSeekAdvisor` — build `ReasoningCall` with `level: classification`, delegate `gateway.reason()`, keep Spanish system prompt + `SupplierMirrorStore` evidence gathering + `SupplierMirrorAnalysis` mapping. Remove direct OpenAI call, model selection, cost estimation. (spec RQ: Gateway Routing for Advisor)
- [x] 3.3 Consolidate `SupplierMirrorDeepSeekPolicy` — remove `SUPPLIER_MIRROR_DEEPSEEK_PRICING` table and `selectSupplierMirrorDeepSeekModel()` into gateway's `modelRouter.ts` + `costEstimator.ts`. Keep `buildSupplierMirrorDeepSeekPromptPlan()`. Re-export from policy for backward compat. (spec RQ: Pricing and Model Selection Consolidation)

## Phase 4: Tests & Verification

- [x] 4.1 Gateway unit tests — model selection decision table, 3-block prompt concatenation, per-level timeout (5s/15s/30s), `status: "fallback"` on network/timeout/invalid JSON/schema mismatch, autonomy gate passing and blocking, cost ledger entry structure
- [x] 4.2 Verify `tests/workers/ceoDeepSeekClient.test.ts` passes — factory returns null without key, Cortex enrichment, valid JSON parsing, invalid proposalType throws, timeout throws, ledger entry recorded
- [x] 4.3 Verify existing SupplierMirrorDeepSeekAdvisor behavior — `analyze()` preserves Spanish system prompt, evidence gathering from `SupplierMirrorStore`, return type mapping, cost micros from gateway telemetry
