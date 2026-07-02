## Exploration: Operational Product Ads Ingestion

### Current State
The MercadoLibre client already exposes a safe-read Product Ads capability through `getProductAdsInsights`, and the agent exposes it as `read_product_ads_insights`. OpenSpec already marks Product Ads insights as MLC-confirmed and safe-read in `ml-api-integration`. The operational evidence provider also maps the `market` and `campaign` lanes to `product-ads-insights`, but the background ingestion pipeline never writes `product-ads-insights` snapshots into the operational read model. As a result, campaign/market lanes can ask for Product Ads evidence but usually receive none unless a live tool call is made.

Recent work already covers claims, questions, orders, messages, reputation, listing quality reads, visits reads, promotions reads, price intelligence, moderation status, notices, prepare-answer, shipping status, and image orchestration. The remaining best gap is not another standalone read tool; it is making high-value ad performance evidence available to the CEO agent/cortex/operational DB by default.

Official MercadoLibre docs consulted/searches:
- `new-product-ads` (last updated 2026-05-21): current Product Ads endpoints, advertiser lookup with `Api-Version: 1`, campaign/ad search with `api-version: 2`, ROAS-centered metrics, legacy endpoint deprecation on 2026-05-27, 90-day metrics window.
- `traditional-campaigns` and `seller-campaigns` (last updated 2026-01-15): promotions are partly mutation-like; useful but already have read surfaces in this repo and require stricter approval for writes.
- `visits-resource` (last updated 2025-12-30): safe-read visits windows, max 150 days; repo already has item visit tools and Cortex snapshots.
- `listings-quality` (last updated 2026-02-26): `/item/{id}/performance` replaces `/health`; repo already has quality read tools and Cortex quality snapshots.
- `catalog-competition`, `products-search`, `catalog-eligibility`, `ml-returns`, `sellers-reputation`: valid future areas, but either already partially covered or larger/riskier than Product Ads operationalization.

### Affected Areas
- `packages/agent/src/conversation/backgroundIngestion.ts` — add a Product Ads ingestion processor that calls the existing safe-read client and writes `product-ads-insights` snapshots/checkpoints to the operational store.
- `packages/agent/src/conversation/operationalEvidenceProvider.ts` — already maps `market` and `campaign` lanes to `product-ads-insights`; likely no code change needed beyond tests proving evidence appears.
- `packages/domain/src/cacheFreshness.ts` — already includes `product-ads-insights`; no new signal kind needed.
- `packages/mercadolibre/src/index.ts` — existing client read surface should be reused; avoid adding new API endpoints in the first slice.
- `packages/agent/src/agent.test.ts` or related ingestion tests — add focused tests for snapshot persistence, checkpointing, and graceful skip/error behavior.

### Approaches
1. **Product Ads operational ingestion** — Persist existing Product Ads insights into the operational read model on background cycles.
   - Pros: Highest direct CEO value for paid growth decisions; MLC confidence is already high in project specs; safe-read only; reuses existing client/tool/domain kind; fills a real lane-evidence gap; small first slice likely near/under 400 changed lines.
   - Cons: Requires handling sellers without Product Ads enabled (404/no permissions) as a graceful no-data state; metrics freshness is tied to MercadoLibre's daily update cadence.
   - Effort: Low/Medium

2. **Catalog competition operationalization** — Persist `price_to_win`/buy-box competition signals per catalog item.
   - Pros: Strong marketplace intelligence and price decision value; safe-read; already has `getItemPriceToWin` client support.
   - Cons: Only applies to catalog items; could explode per-item API volume; better after campaign evidence is durable.
   - Effort: Medium

3. **Returns subresource support** — Add `/post-purchase/v2/claims/{claim_id}/returns` reads.
   - Pros: Useful for claims loss analysis and operational recovery; official docs are clear and Chile support is likely through post-purchase APIs.
   - Cons: Narrower than ad/campaign ROI; claims slice already exists, so this is an incremental subresource, not the best next capability.
   - Effort: Low/Medium

4. **Promotions prepare-only execution planning** — Prepare add/modify/delete promotion actions from seller/traditional campaign docs.
   - Pros: Potential revenue lift through campaign participation and suggested discounts.
   - Cons: Mutation-like and approval-heavy; existing reads already cover promotions; riskier and likely over 400 lines if done safely.
   - Effort: Medium/High

5. **Visits/quality operational DB mirroring** — Dual-write existing visits and quality Cortex snapshots to the operational read model.
   - Pros: Safe-read and improves operational DB completeness.
   - Cons: Less incremental business value because Cortex/tools already capture these signals; adding new signal kinds for quality/visits may widen the change.
   - Effort: Medium

### Recommendation
Recommend change name: `operational-product-ads-ingestion`.

First slice: persist one seller-level `product-ads-insights` snapshot per ingestion cycle using the existing `getProductAdsInsights` method, including advertiser, campaigns, ads, date range, `noMutationExecuted`, ROAS-oriented metric metadata, freshness/confidence, and an ingestion checkpoint. This wins because it directly feeds CEO/campaign/market intelligence, uses the newest July-2026-relevant official Product Ads docs, aligns with existing MLC-confirmed project capability metadata, avoids mutation risk, and should fit a reviewable under/near-400-line SDD slice.

### Risks
- Product Ads may be disabled for a seller; implementation must treat 404/no-permission as graceful no-data, not a failed ingestion cycle.
- Product Ads metrics are updated daily around the documented cadence, so freshness claims must not imply real-time ad performance.
- Avoid adding campaign/ad mutation endpoints in this change; keep the slice safe-read only.
- If tests require large fixture payloads, review size can exceed 400 lines; use compact fixtures.

### Ready for Proposal
Yes — propose `operational-product-ads-ingestion` with a first slice limited to safe-read background ingestion and operational evidence wiring/tests. Tell the user this is the highest-leverage next capability because the repo already has Product Ads reads and lane mappings, but the CEO agent does not yet get durable campaign/market evidence from the operational DB.
