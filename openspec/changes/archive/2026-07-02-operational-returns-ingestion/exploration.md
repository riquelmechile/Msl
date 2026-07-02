## Exploration: Operational Returns Ingestion

### Current State
MSL already has project-owned MercadoLibre safe reads for listings, orders, messages, reputation, Product Ads insights, pricing/price-to-win, promotion reads, visits, listing performance, claims search/detail/sub-resources, shipment status, and prepare-only image orchestration. The MCP surface exposes Product Ads, listings/orders/messages/reputation, category reads, listing prices, claims, claim sub-resources, shipment status, notices, answer preparation, and image orchestration; it intentionally does not expose visits/listing-quality tools yet. Operational ingestion persists listings, claims, questions, orders, messages, reputation, Product Ads insights, and pricing snapshots, but claims ingestion currently stores claim summaries and does not mirror return details, return reviews, or return-cost evidence.

Official MercadoLibre docs now document safe-return reads under post-purchase claims: `GET /post-purchase/v2/claims/{claim_id}/returns`, `GET /post-purchase/v1/returns/{return_id}/reviews`, and `GET /post-purchase/v1/claims/{claim_id}/charges/return-cost`. The same page also documents mutation-like return-review and attachment endpoints, which must remain prepare-only/out of scope.

### Affected Areas
- `openspec/specs/ml-api-integration/spec.md` — add returns capability matrix entries with safe-read and mutation-like classifications.
- `openspec/specs/ml-claims/spec.md` — extend claims/post-purchase read contract to include return detail, return reviews, and return-cost snapshots.
- `openspec/specs/business-memory-cache/spec.md` — add optional `return` operational snapshots/checkpoints if the first implementation slice persists returns.
- `openspec/specs/operational-lane-evidence/spec.md` — map return evidence to catalog/outcome/risk-sensitive lane context if persisted.
- `packages/mercadolibre/src/index.ts` — currently has claims sub-resources but no return read methods or typed return snapshots.
- `packages/mcp/src/index.ts` — currently exposes claim tools, but no `read_claim_return`, `read_return_reviews`, or `read_return_cost` tools.
- `packages/agent/src/conversation/backgroundIngestion.ts` — currently ingests claim summaries only; return mirroring would attach return evidence to claim-driven ingestion.
- `packages/domain/src/*` and `packages/memory/src/operationalReadModel.ts` — may need `return` as a supported business signal kind if durable lane evidence is in scope.

### Candidate Gap Assessment
| Candidate | Business value | API doc confidence | MLC applicability | Implementation risk | Review size | Safety classification |
|---|---:|---:|---:|---:|---:|---|
| Returns read support under claims/post-purchase | High: refund timing, retained money, return shipment status, product condition, and return cost directly affect margin/reputation decisions. | High for endpoints and fields; docs updated 2025-12. | Medium: docs were fetched with MLC filter, but examples are mostly MLB/BR and no explicit MLC availability table appears. | Medium: new typed snapshots plus optional ingestion; mutation endpoints must be explicitly excluded. | Medium; first slice can stay near 400 lines by adding client + MCP safe reads before durable ingestion. | `safe-read` for GET return detail/reviews/cost; `prepare-only`/mutation-like for review, attachments, and return-review POST. |
| Price automation/reference price reads | Medium-high: prevents invalid price edits and improves pricing safety after 2026 automation blocking. | High: docs updated 2026-05 and 2026-02. | Medium: docs examples use MLA/MLB/MLM; existing MSL methods are generic MLC item-safe. | Low-medium: most client methods/tests already exist; missing work is mostly spec/MCP/operationalization. | Low for MCP tool exposure; medium for ingestion. | `safe-read` for automation/rules/history/items and item prices; mutations are `prepare-only` or future approval. |
| Promotions/pricing operationalization or prepare-only actions | High: promotion opportunities, boosts, SMART/PRICE_MATCHING campaigns, and candidate items can improve sales/margin. | High: central promotions updated 2026-06; availability table includes MLC for most promotion families. | High for central promotions reads; coupon exceptions are site-specific. | Medium-high: promotion types and cursor pagination are broad; writes/deletes are seller-impacting and must stay prepare-only. | Medium-high unless sliced to read-only promotion list/item details first. | `safe-read` for list/detail/items; `prepare-only` for joining/removing/modifying campaigns. |
| Image upload prepared-action hardening | Medium: useful for listing quality, but no public AI image generation endpoint exists and image upload/association mutate CDN/listings. | Medium-high for upload/diagnostic/moderation docs; AI generation absent. | Low-medium: existing project classifies MLC as to-confirm. | Medium: safety hardening is mostly validation/storage, but upload execution must remain blocked. | Low-medium. | `prepare-only` for upload/associate; diagnostic/check are safe-read-like. |
| Visits/quality operational mirroring | Medium: traffic and listing health are useful for market/catalog lanes. | Medium: visits docs updated 2026-01; quality docs exist but project confidence is still low/unknown for MLC. | Visits likely site-prefixed but no explicit MLC confirmation in current spec; quality still unknown. | Low-medium: client code already exists and background ingestion writes Cortex visit/performance nodes, but not durable operational evidence. | Medium if adding new signal kinds and persistence. | `safe-read`. |

### Approaches
1. **Returns safe-read client/MCP first** — Add typed return detail, review, and return-cost reads plus MCP tools, without durable ingestion in the first slice.
   - Pros: closes a true duplicate-free gap, high business value, naturally extends existing claims tools, keeps mutation risk low, and can be scoped near the 400-line review budget.
   - Cons: does not yet make returns available to lane prompts unless a later ingestion slice persists them.
   - Effort: Medium

2. **Returns operational ingestion first** — Add return reads and immediately persist return snapshots during claims ingestion.
   - Pros: fastest path to CEO/lane usefulness and local-first evidence.
   - Cons: likely exceeds the 400-line budget because it touches client types/normalizers, MCP or internal reads, domain signal kinds, memory specs, ingestion loops, and tests in one slice.
   - Effort: High

3. **Promotions/pricing read-tool exposure** — Promote existing pricing automation/promotion client reads into MCP and/or operational snapshots.
   - Pros: reuses already implemented client methods; strong docs; MLC availability is clearer for promotions.
   - Cons: less of a net-new API gap than returns, and promotion mutation semantics increase safety review complexity.
   - Effort: Medium

### Recommendation
Recommend `operational-returns-ingestion`, starting with a first implementation slice that adds safe-read return support under claims/post-purchase: typed `MlcApiClient` return detail, return reviews, and return-cost snapshots plus MCP read tools and specs. Keep return-review POST, attachment upload, and any refund/dispute actions explicitly out of scope as prepare-only/mutation-like.

This is the best next change because it is a high-risk business signal currently absent from code and specs, it composes directly with the completed claims work, and it can be sliced safely: first expose safe reads under/near the 400-line budget, then follow with durable operational ingestion and lane evidence if needed.

### Risks
- MLC applicability is not explicit in the retrieved returns page examples, so implementation should classify site support as `MLC-to-confirm` and degrade gracefully on 400/401/404.
- Return docs mix safe GET endpoints with seller-impacting POST/upload flows; specs and code must block mutation execution in the first slice.
- Durable ingestion may exceed the review budget if combined with client/MCP reads; keep persistence as a second slice unless the task planner proves otherwise.

### Ready for Proposal
Yes — propose `operational-returns-ingestion` with first-slice scope limited to safe-read return detail/reviews/return-cost support and explicit prepare-only classification for return-review/attachments.
