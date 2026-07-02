## Exploration: Operational Catalog Competition Ingestion

### Current State
Recent archived work already covers MercadoLibre API gap slices 1-3, operational full-context ingestion, and Product Ads operational ingestion. Current specs and code show broad read coverage: claims/subresources, questions, orders, messages, reputation, notices, shipping status, moderation status, image orchestration preparation, Product Ads insights, category reads, listing fee prices, price intelligence, visits, listing performance, and promotions reads.

The remaining gap is mostly not raw API access; it is durable operational evidence. `@msl/mercadolibre` already exposes `getItemPriceToWin`, `getItemSalePrice`, `getItemPrices`, pricing automation reads, seller promotions reads, item visits, and performance reads. The agent exposes live tools for price intelligence and promotions, and the operational read model already has a `pricing` signal mapped into market/margin lanes, but background ingestion does not persist catalog competition/price-to-win snapshots. Therefore market/catalog and margin reasoning can still miss local, auditable competition evidence unless a live read is triggered.

MercadoLibre MCP docs evidence checked in this exploration:
- `catalog-competition` documents `GET /items/{ITEM_ID}/price_to_win?siteId={SITE_ID}&version=v2`, status values (`winning`, `competing`, `sharing_first_place`, `listed`), `price_to_win`, `visit_share`, boosts, winner summary, and reasons.
- `manage-returns` documents return reads and reviews, including `GET /marketplace/v2/claims/{CLAIM_ID}/returns`, `GET /post-purchase/v1/returns/{RETURN_ID}/reviews`, and return-cost reads; write/review endpoints are mutation-like and should remain approval-bound.
- `pictures` documents upload via `POST /pictures/items/upload`, link via `POST /items/{ITEM_ID}/pictures`, and replace via global item `PUT`; current repo already prepares image orchestration and must not execute media mutation without approval.
- `image-diagnostics` documents diagnostics only. Search results did not expose a public AI image creation/generation endpoint. Treat web UI/editor AI image generation as unavailable/private for API integration until MercadoLibre publishes docs.
- `seller-campaigns` documents seller promotion reads and mutations; repo already has safe read tooling, while create/update/delete/add-item flows are mutation-like.

### Affected Areas
- `packages/agent/src/conversation/backgroundIngestion.ts` — add a bounded processor that calls existing `getItemPriceToWin` for catalog-capable listings and writes `pricing` snapshots/checkpoints.
- `packages/agent/src/conversation/operationalEvidenceProvider.ts` — already maps `market` and `margin` evidence to `pricing`; likely only tests need to prove fresh evidence appears.
- `packages/memory/src/operationalReadModel.ts` — existing generic snapshots can store `pricing`; verify no schema change is needed.
- `packages/mercadolibre/src/index.ts` — reuse existing `getItemPriceToWin`; avoid adding new API endpoints in this first slice.
- `packages/agent/tests/conversation/backgroundIngestion.test.ts` and/or `operationalEvidenceProvider.test.ts` — add focused tests for persistence, checkpointing/rate guard, and graceful partial failures.

### Approaches
1. **Catalog competition operational ingestion** — Persist `price_to_win` snapshots as `pricing` operational evidence for each bounded listing batch.
   - Pros: High business value for market/catalog and margin recommendations; safe-read only; reuses existing client, docs, and domain `pricing` signal; directly fills an operational DB gap; likely reviewable under the 400-line budget if scoped to `price_to_win` only.
   - Cons: Catalog-only value; per-item reads can increase rate pressure; MLC support should be treated as to-confirm unless site evidence is verified during proposal/spec.
   - Effort: Medium

2. **Returns subresource read support** — Add typed return reads under claims.
   - Pros: Clear 2026 docs; valuable for post-purchase recovery, return cost, and claim triage.
   - Cons: Incremental after claims/subresources; Model 6/CBT restrictions and review endpoints add risk; narrower CEO value than market pricing evidence.
   - Effort: Low/Medium

3. **Promotions/pricing operationalization** — Persist seller promotions and richer price intelligence snapshots.
   - Pros: Strong commercial planning value; live tools already exist; campaign recommendations become auditable.
   - Cons: Wider than one slice; promotion mutations are approval-heavy; could exceed review budget if combined with price automation and item promotion shapes.
   - Effort: Medium/High

4. **Image upload prepared action hardening** — Extend image orchestration preparation around upload/link/replace evidence.
   - Pros: Practical listing quality workflow; official docs cover upload/link/replace and diagnostics.
   - Cons: Upload/link/replace are stateful; current prepare-only orchestration already covers the main safety boundary; no public AI image generation API is documented.
   - Effort: Medium

5. **Visits/quality operational mirroring** — Persist existing visit/performance reads into the operational DB.
   - Pros: Safe-read and helpful for opportunity ranking.
   - Cons: Lower incremental value than catalog competition; may require new snapshot-kind decisions for quality/visits beyond current lane mapping.
   - Effort: Medium

### Recommendation
Recommend change name: `operational-catalog-competition-ingestion`.

First slice: persist bounded `getItemPriceToWin` results as `pricing` operational snapshots during background ingestion, keyed by seller + item, with freshness/completeness/confidence metadata, deterministic evidence IDs, checkpoint/rate protection, and graceful per-item degradation. Keep the slice safe-read only and explicitly out of scope for price mutation, pricing automation changes, promotions mutation, returns review, and AI image generation.

This is the best next SDD change because Product Ads evidence is now operationalized, and the next highest-value market signal is catalog competition: the repo already has the API client and lane mapping, but not durable local evidence for the CEO/market-catalog lanes.

### Risks
- Per-item `price_to_win` reads can exhaust API budget; cap listings per cycle and checkpoint by `pricing` kind.
- Non-catalog or unsupported items may return partial/no data; store partial evidence or skip gracefully without failing the cycle.
- Site support for MLC must be verified in proposal/spec; do not infer mutation eligibility from read docs.
- No public MercadoLibre AI image generation endpoint was found; do not propose fake image generation API integration.

### Ready for Proposal
Yes — propose `operational-catalog-competition-ingestion` as a focused safe-read operational evidence change. Tell the user the missing feature is not AI image generation; it is durable catalog competition evidence for better pricing and market recommendations.
