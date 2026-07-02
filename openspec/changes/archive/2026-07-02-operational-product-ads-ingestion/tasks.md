# Tasks: Operational Product Ads Ingestion

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 280-380 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR with work-unit commits |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add Product Ads processor and cycle wiring | PR 1 | Keep persistence tests with code. |
| 2 | Prove lane evidence retrieval | PR 1 | Test-only if mapping remains correct. |

## Phase 1: Foundation

- [x] 1.1 In `packages/agent/src/conversation/backgroundIngestion.ts`, add `product-ads-insights` TTL/default max-page constants if missing.
- [x] 1.2 In `backgroundIngestion.ts`, define helpers for Product Ads date-range `entityId`, evidence ID, and graceful no-access detection.
- [x] 1.3 Export `processSellerProductAds(config, sellerId)` returning `{ persisted: boolean }` for direct unit tests.

## Phase 2: Core Implementation

- [x] 2.1 In `processSellerProductAds`, call optional `config.mlcClient.getProductAdsInsights(sellerId, defaultRange)` once per seller.
- [x] 2.2 Persist one `product-ads-insights` snapshot through `config.operationalStore.upsertSnapshot` with freshness, completeness, confidence, ROAS metadata, and `noMutationExecuted`.
- [x] 2.3 Update `product-ads-insights` checkpoint only after successful snapshot persistence; do not checkpoint missing client/no-data paths.
- [x] 2.4 Treat disabled, unauthorized, forbidden, missing advertiser, or not-found Product Ads errors as graceful no-data without throwing or mutating.
- [x] 2.5 Wire `processSellerProductAds` into `startBackgroundIngestion` after reputation for each seller.

## Phase 3: Tests

- [x] 3.1 In `packages/agent/tests/conversation/backgroundIngestion.test.ts`, test Product Ads snapshot persistence including deterministic evidence ID, date-range `item_id`, ROAS metadata, and `noMutationExecuted`.
- [x] 3.2 In `backgroundIngestion.test.ts`, test checkpoint writes only after `upsertSnapshot` succeeds and is skipped when persistence fails.
- [x] 3.3 In `backgroundIngestion.test.ts`, test missing Product Ads client and 401/403/404/no-advertiser errors return no-data without snapshots or mutations.
- [x] 3.4 In `packages/agent/tests/conversation/operationalEvidenceProvider.test.ts`, keep or tighten market-catalog and creative-commercial Product Ads evidence assertions for evidence ID and timestamp.

## Phase 4: Verification

- [x] 4.1 Run `npm test -- packages/agent/tests/conversation/backgroundIngestion.test.ts packages/agent/tests/conversation/operationalEvidenceProvider.test.ts` or nearest supported Vitest filter.
- [x] 4.2 Run `npm test` before handoff; record unsupported E2E behavior only during verify phase.
