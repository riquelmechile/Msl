# Design: DeepSeek Merchandising Advisor

## Quick Path

Adds a DeepSeek-powered merchandising advisor **between** the deterministic scorer and projection builder in `prepareFromSupplierWebSignal` step 7 (currently deferred). The advisor is **optional** — absent transport → deterministic fallback. Output passes through a pure-function validator before reaching `buildProjection`.

## Architecture

```
SupplierWebSignal → Cortex query → build candidate → scoreCandidate (deterministic)
                                                           │
                                    ┌──────────────────────┘
                                    ▼
                        ┌─────────────────────────┐
                        │ MerchandisingAdvisor    │  step 7 (new)
                        │ (DeepSeek, optional)    │
                        │  ├ rankWithReasoning    │
                        │  ├ draftSeoGeoCopy      │
                        │  ├ explainTradeoffs     │
                        │  ├ proposeExperiment    │
                        │  └ identifyMissingEvidence
                        └───────────┬─────────────┘
                                    ▼
                        ┌─────────────────────────┐
                        │ AdvisorValidator        │  pure function
                        │ blocks: superlatives w/o │
                        │ evidence, publish lang, │
                        │ unsupported claims       │
                        └───────────┬─────────────┘
                                    ▼
                        ┌─────────────────────────┐
                        │ buildProjection         │
                        │ (DeepSeekEnrichment)    │
                        └───────────┬─────────────┘
                                    ▼
                              CEO proposal
```

Blocked candidates remain blocked — advisor does not unblock.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transport optional | Constructor `deepSeekTransport?` | Pipeline degrades gracefully. Deterministic scorer is authority — advisor adds reasoning, not control. |
| Separate prompt class | `OwnedEcommerceAdvisorPrompt` (not inline) | Enables hash-based cache testing. Stable prefix at token 0 for DeepSeek prefix-cache. |
| Validator as pure function | `validate(result): AdvisorValidationResult` | No side effects. Deterministic. Testable without transport. |
| Advisor wraps gateway lazily | Same pattern as `CreativeDeepSeekAdvisor` / `CostSupplierDeepSeekAdvisor` | Consistency. Shared `DeepSeekReasoningGateway` handles model selection, timeout, cost ledger. |
| Evidence planner returns structured messages | Typed by target agent, NOT raw strings | Aligns with `AgentMessageBusStore` schema (sender/receiver/message_type/payload_json). |

## Component Design

### `OwnedEcommerceMerchandisingAdvisor`

```typescript
constructor(input: {
  deepSeekTransport?: DeepSeekTransport;
  clock?: () => Date;
  logger?: Logger;
  sellerId?: string;
})

// Methods — all synchronous-except-where-gateway-called:
rankCandidatesWithReasoning(candidates, scores, channelComparison)
  → RankingReasoning

draftSeoGeoCopy(candidate, score, evidenceContext)
  → DeepSeekEnrichment  // matches existing type in projection builder

explainChannelTradeoffs(candidates, channelComparison)
  → ChannelTradeoffExplanation

proposeStorefrontExperiment(candidates)
  → ExperimentProposal

identifyMissingEvidence(candidates, scores)
  → MissingEvidenceReport
```

**Fallback**: When `deepSeekTransport` is absent, every method returns deterministic defaults derived from scorer output (e.g., `seoTitle = "${title} — Owned Ecommerce Storefront"`).

### `OwnedEcommerceAdvisorPrompt`

Four-block architecture matching `DeepSeekReasoningGateway` 3-block pattern (stablePrefix + cacheableContext + volatileInput):

1. **(A) Stable identity/safety** — role, rules, no-mutation boundary. Never changes.
2. **(B) Account/channel context** — seller ID, channel fit, slow-changing. Cache-friendly but may differ per seller.
3. **(C) Variable evidence** — candidate scores, stock, margin, blockers. Changes per invocation.
4. **(D) Output JSON schema** — expected shape, field constraints.

**Hash strategy**: `stablePromptHash = sha256(blocks A+B+D)`. `evidenceHash = sha256(candidateIds + scores)`.

### `MerchandisingAdvisorValidator`

```typescript
function validate(input: MerchandisingAdvisorResult): AdvisorValidationResult

type AdvisorValidationResult = {
  usable: boolean
  blockedClaims: Array<{ claim: string; reason: string }>
  warnings: string[]
  sanitizedResult: MerchandisingAdvisorResult
}
```

**Blocked patterns**:
| Pattern | Example | Condition |
|---------|---------|-----------|
| Superlatives | "best", "guaranteed", "official" | Without evidenceIds |
| Publish/checkout language | "publish now", "activate checkout" | Always blocked |
| Medical/technical claims | "curativo", "certified by X" | Without evidenceIds |
| Mixed accounts | Cross-referencing Plasticov/Maustian | Without comparison flag |
| Invalid targetAgentIds | Unknown agent in evidence request | Always blocked |

### `EcommerceEvidenceRequestPlanner`

Converts `missingEvidenceRequests` into `AgentMessage` typed by target:

| Target Agent | Trigger |
|-------------|---------|
| `cost-supplier` | Margin/cost evidence missing |
| `market-catalog` | Category/pricing evidence missing |
| `creative-assets` | Image/media evidence missing |
| `account-brain` | Channel comparison data missing |
| `supplier-manager` | Supplier freshness stale |

Dedupe: `candidateId + targetAgentId + questionHash` before enqueue. When no `AgentMessageBusStore` available, stores as pending plan (no-op fallback).

## File Changes

| File | Action | What |
|------|--------|------|
| `ecommerce/ownedEcommerceMerchandisingAdvisor.ts` | New | Advisor class with fallback |
| `ecommerce/ownedEcommerceAdvisorPrompt.ts` | New | Prompt builder with hash support |
| `ecommerce/merchandisingAdvisorValidator.ts` | New | Pure-function output validator |
| `ecommerce/ecommerceEvidenceRequestPlanner.ts` | New | Evidence-gap → inter-agent messages |
| `ecommerce/ownedEcommerceIntelligenceService.ts` | Modify | Wire advisor into step 7, gate with `MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED` |
| `ecommerce/storefrontProjectionBuilder.ts` | Modify | Accept enrichment from advisor (already has `DeepSeekEnrichment` param) |
| `index.ts` | Modify | Export new classes + types |

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit — advisor fallback | All 5 methods return deterministic defaults when transport absent | Direct instantiation, assert no HTTP |
| Unit — advisor with fake transport | `rankCandidatesWithReasoning` with `DeepSeekFakeTransport` returning known fixtures | Inject `DeepSeekFakeTransport`, verify parsed output |
| Unit — prompt hash stability | Stable blocks produce identical hash; evidence change alters hash | `sha256(A+B+D)` invariant across runs |
| Unit — validator | Each blocked pattern tested independently | Pure function, table-driven |
| Unit — evidence planner | Dedupe logic, message type assignment | In-memory store, hash collision test |
| Integration — intelligence service | Full pipeline with/without advisor, feature flag on/off | `ownedEcommerceIntelligenceService` with fake Cortex + fake transport |
| Seller isolation | Plasticov output never contains Maustian evidence | Separate seller IDs, verify `evidenceIds` |


## Feature Flag

`MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED` (env, default `false`). When `false`, pipeline skips advisor entirely (step 7 no-op). When `true` but transport absent, advisor instantiated with deterministic fallback — identical behavior to disabled.

## PR Plan

Stacked PRs (~400 lines each):

**PR 1**: `OwnedEcommerceMerchandisingAdvisor` + `OwnedEcommerceAdvisorPrompt` + `MerchandisingAdvisorValidator` + 15+ tests. Foundation — fully testable in isolation.

**PR 2**: `EcommerceEvidenceRequestPlanner` + integration wiring in `OwnedEcommerceIntelligenceService` + feature flag + barrel exports. 5+ integration tests.

## Open Questions

- [ ] Should `explainChannelTradeoffs` and `proposeStorefrontExperiment` be async (gateway) or sync? Proposal describes both as synchronous wrappers around gateway — confirm.
- [ ] `EvidenceRequestPlanner` — should enqueued messages auto-expire or require explicit resolution?
