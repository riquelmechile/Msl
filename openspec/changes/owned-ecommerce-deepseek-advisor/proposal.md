# Proposal: DeepSeek Merchandising Advisor

## Intent

Add non-deterministic commercial reasoning on top of the deterministic owned-ecommerce
pipeline. The current pipeline is purely rule-based (signal → score → proposal) and lacks
hypothesis-driven positioning, channel strategy analysis, opportunity detection, tradeoff
explanation, and evidence-gap reasoning. This change adds a DeepSeek-powered advisor layer
while keeping the deterministic scorer as the safety authority.

## Scope

### In Scope
- `OwnedEcommerceMerchandisingAdvisor` — rankCandidatesWithReasoning, draftSeoGeoCopy,
  explainChannelTradeoffs, proposeStorefrontExperiment, identifyMissingEvidence
- Cache-friendly prompt architecture (stable prefix + variable evidence per existing
  `DeepSeekReasoningGateway` pattern)
- `MerchandisingAdvisorValidator` — blocks unsupported superlatives, publish/checkout language, claims without evidence
- `EcommerceEvidenceRequestPlanner` — converts advisor-detected gaps into inter-agent messages
- Wire advisor into `OwnedEcommerceIntelligenceService` step 7 (currently deferred)
- Populate `DeepSeekEnrichment` in `buildProjection` via advisor output
- 20+ test scenarios via `DeepSeekFakeTransport` — 0 real HTTP

### Out of Scope
No mutations (publish, checkout, payment, price/stock). No dashboard, multi-bot, refactor,
or Medusa writes. Advisor output is validated then folded into read-only projections.

## Capabilities

### New
- `owned-ecommerce-merchandising-advisor`: DeepSeek commercial reasoning class with transport
  injection, cache-friendly prompts, five reasoning methods. Falls back to deterministic
  defaults when absent.
- `merchandising-advisor-validator`: Deterministic filter that blocks superlatives without
  evidence, publish/checkout language, and unsupported claims from advisor output.

### Modified
- `owned-ecommerce-agent`: Wire advisor into pipeline step 7, pass enrichment to
  `buildProjection`. No spec-level requirement change — implementation-only augmentation.

## Approach

Follow existing `DeepSeekReasoningGateway` + transport pattern (same as `CreativeDeepSeekAdvisor`,
`CostSupplierDeepSeekAdvisor`). Advisor accepts `DeepSeekTransport` in constructor; tests inject
`DeepSeekFakeTransport`. Prompt uses stable prefix (system prompt, cache-friendly at token 0)
plus volatile evidence block. Output is structured JSON, parsed and validated before use.
`MerchandisingAdvisorValidator` is a pure-function filter invoked before enrichment reaches
the projection builder. `EcommerceEvidenceRequestPlanner` converts `identifyMissingEvidence`
output into structured messages for the inter-agent bus.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/ecommerce/ownedEcommerceMerchandisingAdvisor.ts` | New | Advisor class |
| `packages/agent/src/ecommerce/merchandisingAdvisorValidator.ts` | New | Output validator |
| `packages/agent/src/ecommerce/ecommerceEvidenceRequestPlanner.ts` | New | Evidence-gap message planner |
| `packages/agent/src/ecommerce/ownedEcommerceIntelligenceService.ts` | Modified | Wire advisor into step 7 |
| `packages/agent/src/ecommerce/storefrontProjectionBuilder.ts` | Modified | Accept enrichment from advisor |
| `packages/agent/src/index.ts` | Modified | Export new classes |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| DeepSeek hallucinated claims | Med | Validator blocks superlatives, publish/checkout, unsupported claims |
| Prompt cache misses → cost | Med | Stable prefix anchored at token 0, volatile evidence appended |
| Advisor output breaks projection | Low | Pure-function validator + existing fallback defaults |
| Transport unavailable | Low | Advisor optional; deterministic pipeline unchanged when absent |

## Rollback Plan

Feature flag `MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED` gates advisor wiring. Set to `false` →
pipeline skips step 7 (current behavior). New files are additive. Projections remain
read-only previews — no state to unwind.

## Dependencies

`DeepSeekTransport`, `DeepSeekFakeTransport`, `DeepSeekReasoningGateway`, `DeepSeekEnrichment`
(type in projection builder), `StorefrontCandidate`, `StorefrontCandidateScore` — all existing.
No new packages.

## Success Criteria

- [ ] Advisor wired into pipeline with `deepSeekTransport` optional — absent → deterministic fallback
- [ ] `rankCandidatesWithReasoning` returns scored candidates with rationale strings
- [ ] `draftSeoGeoCopy` populates `DeepSeekEnrichment` for `buildProjection`
- [ ] Validator blocks "best", "guaranteed", "official" without evidence
- [ ] Validator blocks publish/checkout language
- [ ] `EcommerceEvidenceRequestPlanner` produces structured messages for missing evidence
- [ ] 20+ test scenarios using `DeepSeekFakeTransport` — 0 real HTTP
- [ ] All existing owned-ecommerce tests pass unchanged
- [ ] 0 secrets in code/tests; `noMutationExecuted: true` everywhere
