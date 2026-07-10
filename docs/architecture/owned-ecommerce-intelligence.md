# Owned Ecommerce Intelligence

## Overview

The Owned Ecommerce Intelligence pipeline detects supplier-side signals (new products, stock gaps, price changes, restocks, stock-outs, publish opportunities) via the Supplier Manager daemon, routes them through the Agent Message Bus to the Owned Ecommerce lane, and prepares evidence-backed storefront candidates for CEO review — without executing any mutations.

## Pipeline

```text
Supplier Manager Daemon
  ├─ Reads SupplierMirrorStore + Cortex listing snapshots
  ├─ Detects 6 signal kinds (see below)
  ├─ Enqueues CEO proposals (existing behavior)
  └─ Enqueues supplier-web-signal → owned-ecommerce lane (new)

Agent Message Bus
  └─ receiverAgentId: "owned-ecommerce"
       messageType: "supplier-web-signal"

Owned Ecommerce Daemon (planned)
  ├─ Claims signals from bus
  ├─ OwnedEcommerceIntelligenceService
  │   ├─ CortexReasoner (spreadActivation, queryByMetadata)
  │   ├─ StorefrontCandidateScorer (deterministic)
  │   └─ StorefrontProjectionBuilder (static assembly)
  ├─ Optional: AccountBrainService, DeepSeekTransport, CreativeJobQueue
  └─ Returns CEO proposal (no mutation)

CEO Agent (Telegram)
  └─ Human approves, rejects, or redirects
```

## Supported Signals

| Signal Kind               | Trigger                                            | Severity   | Recommended Action                                        |
| ------------------------- | -------------------------------------------------- | ---------- | --------------------------------------------------------- |
| `new-supplier-product`    | Supplier item with no `ml_item_id` and no mappings | `warning`  | `prepare-storefront-candidate` or `collect-more-evidence` |
| `stock-gap`               | One seller has stock, another has zero             | `critical` | `review-storefront-availability`                          |
| `supplier-price-change`   | Supplier price delta >5%                           | `warning`  | `prepare-price-review`                                    |
| `supplier-stock-restored` | All mapped sellers show stock > 0                  | `info`     | `prepare-reactivation-review`                             |
| `supplier-stock-out`      | All mapped sellers show stock === 0                | `critical` | `prepare-availability-pause`                              |
| `publish-opportunity`     | Unfilled mirror item has price evidence            | `info`     | `prepare-product-page`                                    |

## Scoring

The deterministic `StorefrontCandidateScorer` (planned PR 2) evaluates:

- **Stock**: out-of-stock or no stock evidence → `do-not-publish`
- **Margin**: no margin evidence → `do-not-publish`
- **Images**: missing → `request-creative-assets`
- **Reputation**: risk lowers score
- **Evidence freshness**: stale → `collect-more-evidence`

## SEO / GEO Validation

When DeepSeek is configured, SEO titles and GEO copy are validated for:

- Superlative claims ("best", "guaranteed", "official") blocked without evidence
- GEO intent matched to FAQ IDs
- Missing DeepSeek → deterministic fallback (no hardcoded rules)

## DeepSeek Merchandising Advisor

Between scoring and projection assembly, the pipeline optionally invokes the `OwnedEcommerceMerchandisingAdvisor` (step 7) to enrich candidates with AI-generated SEO/GEO copy and channel tradeoff analysis. Gated by `MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED` (default `false`).

| Condition                        | Behavior                                               |
| -------------------------------- | ------------------------------------------------------ |
| Flag enabled + transport present | Advisor enriches projection with SEO/GEO and tradeoffs |
| Flag disabled                    | Step 7 skipped — zero transport calls                  |
| Transport absent                 | Deterministic fallback — zero failure                  |
| Advisor throws                   | Graceful degradation — enrichment skipped              |

All advisor output passes through `MerchandisingAdvisorValidator` — a pure-function safety gate that blocks superlatives without evidence, publish language, unsupported medical/technical claims, and invented stock/margin data. Blocked claims are stripped; safe content passes through.

Blocked candidates remain blocked — the advisor never unblocks.

See [DeepSeek Merchandising Advisor](./owned-ecommerce-deepseek-advisor.md) for architecture details.

## Creative Studio Delegation

When candidates lack images, the pipeline (planned PR 3) enqueues a `CreativeAssetRequest` to the creative lane. Duplicate requests are suppressed via 24h dedup.

## Safety Gates

- `noMutationExecuted: true` on every signal, projection, and tool output
- No publish, no checkout activation, no price changes, no stock mutations
- All execution gated behind CEO approval via Telegram
- Backend executor revalidates stock/margin/readiness before execution
- Seller isolation: Plasticov and Maustian evidence never mixed

## Seller Isolation

All Cortex queries carry a `sellerId` argument. Plasticov supplier data is never mixed with Maustian supplier data. The Supplier Manager daemon emits `affectedSellerIds` on stock-gap signals so the intelligence service can scope queries per seller.

## Feature Flag

`MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED` (default: disabled).

- When `"true"`: Supplier Manager enqueues `supplier-web-signal` messages to the owned-ecommerce lane.
- When unset or `"false"`: No signal enqueue. Existing CEO proposal behavior is unchanged.

## Degradation

- **Cortex unavailable**: Intelligence service returns `cortexUnavailable`, no hardcoded fallback rules.
- **AccountBrain absent**: Channel recommendation is skipped.
- **DeepSeek absent**: SEO/GEO uses deterministic fallback.
- **CreativeJobQueue absent**: Creative requests are skipped.
- **WorkSessionStore absent**: Observations are skipped silently.

## Implementation Status

| Component                                | PR   | Status         |
| ---------------------------------------- | ---- | -------------- |
| Domain types (`supplierWebSignal.ts`)    | PR 1 | ✅ Implemented |
| Supplier Manager bridge (6 signal kinds) | PR 1 | ✅ Implemented |
| Dedupe keys (`sws:...`)                  | PR 1 | ✅ Implemented |
| OwnedEcommerceDaemon (signal consumer)   | PR 2 | ✅ Implemented |
| OwnedEcommerceIntelligenceService        | PR 2 | ✅ Implemented |
| CortexReasoner (spreadActivation)        | PR 2 | ✅ Implemented |
| StorefrontCandidateScorer                | PR 2 | ✅ Implemented |
| StorefrontProjectionBuilder              | PR 2 | ✅ Implemented |
| Daemon integration + tools               | PR 3 | ✅ Implemented |
| Creative Studio delegation               | PR 3 | ✅ Implemented |
| AccountBrain channel comparison          | PR 3 | ✅ Implemented |
| Work session observations                | PR 3 | ✅ Implemented |
| DeepSeek Merchandising Advisor           | PR 4 | ✅ Implemented |
| Advisor Validator                        | PR 4 | ✅ Implemented |
| Evidence Request Planner                 | PR 4 | ✅ Implemented |
| Integration wiring + feature flag        | PR 4 | ✅ Implemented |
