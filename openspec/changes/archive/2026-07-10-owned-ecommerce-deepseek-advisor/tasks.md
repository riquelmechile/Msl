# Tasks: DeepSeek Merchandising Advisor

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,150 |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Advisor class + prompt + 15 tests | PR 1 | ~500 lines; base=main; zero wiring |
| 2 | Validator + evidence planner + 10 tests | PR 2 | ~330 lines; base=main; depends on PR 1 types |
| 3 | Integration wiring + feature flag + exports | PR 3 | ~210 lines; depends on PR 1+2 |
| 4 | Architecture docs | PR 4 | ~110 lines; base=main; can merge with PR 3 |

## Phase 1: Advisor Foundation (New Files, No Wiring) — PR 1

- [x] 1.1 Create `packages/agent/src/ecommerce/ownedEcommerceMerchandisingAdvisor.ts` — class with constructor (`DeepSeekTransport?`, `clock?`, `logger?`, `sellerId?`), lazy `getGateway()`, 5 methods (`rankCandidatesWithReasoning`, `draftSeoGeoCopy`, `explainChannelTradeoffs`, `proposeStorefrontExperiment`, `identifyMissingEvidence`), deterministic fallback when transport absent. ~200 lines, exports: class + `RankingReasoning`, `ChannelTradeoffExplanation`, `ExperimentProposal`, `MissingEvidenceReport` types.
- [x] 1.2 Create `packages/agent/src/ecommerce/ownedEcommerceAdvisorPrompt.ts` — 4-block prompt builder: (A) stable identity/safety, (B) seller/channel context, (C) volatile evidence, (D) output JSON schema. Hash strategy: `sha256(A+B+D)` for stable prefix, `sha256(candidateIds+scores)` for evidence. ~80 lines.
- [x] 1.3 Write unit tests in `packages/agent/src/ecommerce/ownedEcommerceMerchandisingAdvisor.test.ts` — 15+ scenarios: all 5 methods with `DeepSeekFakeTransport`, all 5 methods fallback when transport absent, prompt hash stability across identical inputs, prompt hash change on different evidence, fixture parsing, `noMutationExecuted: true` everywhere. ~220 lines, 0 real HTTP.

## Phase 2: Validator + Evidence Planner (New Files, No Wiring) — PR 2

- [x] 2.1 Create `packages/agent/src/ecommerce/merchandisingAdvisorValidator.ts` — pure function `validate(result): AdvisorValidationResult` with 6 blocked patterns: superlatives without evidenceIds, publish/checkout language, medical/technical claims without evidenceIds, mixed-account cross-references without comparison flag, invalid targetAgentIds, invented stock/margin data. ~260 lines.
- [x] 2.2 Create `packages/agent/src/ecommerce/ecommerceEvidenceRequestPlanner.ts` — converts `missingEvidenceRequests` into typed `EvidenceRequestMessage[]` by target agent. Dedupe by `messageHash` (sha256 of candidateId + targetAgentId + question). Fire-and-forget when `messageBus` present; returns structured messages when absent. ~150 lines.
- [x] 2.3 Write unit tests in `packages/agent/src/ecommerce/merchandisingAdvisorValidator.test.ts` (17 tests) and `.../ecommerceEvidenceRequestPlanner.test.ts` (13 tests) — validator: table-driven per blocked pattern + clean-pass case + edge cases. Planner: dedupe suppression, message type assignment, no-op fallback, seller isolation. 30 tests total, ~430 lines combined, 0 real HTTP.

## Phase 3: Integration + End-to-End (Wiring) — PR 3

- [x] 3.1 Wire advisor into `packages/agent/src/ecommerce/ownedEcommerceIntelligenceService.ts` step 7 — gate with `MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED` env flag (default `false`). Instantiate advisor with `deepSeekTransport` from deps. Call `draftSeoGeoCopy` and `explainChannelTradeoffs` when transport present. Pass `DeepSeekEnrichment` to `buildProjection`. Blocked candidates remain excluded. ~40 lines.
- [x] 3.2 Pass `DeepSeekEnrichment` into `buildProjection` calls in `discoverStorefrontCandidates` (line 400-401) — currently calls `buildProjection(scoredCandidates)`, add optional second arg. ~10 lines.
- [x] 3.3 Export new classes and types from `packages/agent/src/index.ts` — add `OwnedEcommerceMerchandisingAdvisor`, `MerchandisingAdvisorValidator`, `EcommerceEvidenceRequestPlanner`, `OwnedEcommerceAdvisorPrompt`, and related types. ~25 lines.
- [x] 3.4 Write integration tests — full pipeline in `prepareFromSupplierWebSignal` with fake Cortex + fake transport: advisor enabled does not crash pipeline, flag disabled skips step 7, blocked candidate stays blocked, transport absent yields deterministic fallback, transport throws degrades gracefully, projection `noMutationExecuted: true`. ~130 lines, 0 real HTTP.

## Phase 4: Documentation — PR 4 (can merge into PR 3)

- [x] 4.1 Create `docs/architecture/owned-ecommerce-deepseek-advisor.md` — architecture diagram, component descriptions, transport/fallback pattern, validator safety gate, cache-friendly prompt architecture, feature flag lifecycle. ~80 lines.
- [x] 4.2 Update `docs/architecture/owned-ecommerce-intelligence.md` — add advisor step between scoring and projection, note feature flag and fallback behavior. ~30 lines.

## Verification Checklist

- [x] All existing `storefrontCandidateScorer.test.ts` and `ownedEcommerceCortexReasoner.test.ts` tests pass unchanged
- [x] `npm run build` succeeds with new exports
- [x] 0 real HTTP calls in any test — `DeepSeekFakeTransport` only
- [x] `noMutationExecuted: true` on all results
- [x] 0 secrets in code/tests
- [x] `MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED` defaults to `false` — no behavior change without opt-in
- [x] Integration tests pass: 10 tests covering advisor wiring, flag gating, graceful degradation
