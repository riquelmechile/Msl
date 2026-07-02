# Tasks: Operational Catalog Competition Ingestion

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 550-750 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 ingestion core → PR 2 evidence/tests |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add bounded safe-read pricing ingestion | PR 1 | Base main; include ingestion unit tests. |
| 2 | Prove lane evidence and safety contracts | PR 2 | Base main after PR 1; include provider/store tests. |

## Phase 1: Foundation / Contracts

- [x] 1.1 Update `packages/agent/src/conversation/backgroundIngestion.ts` imports and `BackgroundIngestionConfig` with `pricingMaxItemsPerCycle`.
- [x] 1.2 Add `pricing` TTL/cap constants and exported defaults beside `KIND_FRESHNESS_TTL` / `KIND_DEFAULT_MAX_PAGES`.
- [x] 1.3 Add helpers in `backgroundIngestion.ts` for deterministic rotated listing selection and graceful price-to-win no-data errors.

## Phase 2: Pricing Ingestion Core

- [x] 2.1 Create exported `processSellerPricing(config, sellerId, listings)` in `backgroundIngestion.ts` using existing `getItemPriceToWin`.
- [x] 2.2 Persist successful snapshots as `kind: "pricing"`, entity item ID, deterministic evidence ID, freshness/completeness/confidence, and `noMutationExecuted: true`.
- [x] 2.3 Catch unsupported, unauthorized, non-catalog, and no-data per item; continue the bounded batch and count skipped items.
- [x] 2.4 Write the `pricing` checkpoint only after all capped items are attempted and snapshot writes complete.
- [x] 2.5 Wire `processSellerPricing` into `startBackgroundIngestion` after listings are available and before cross-account analysis.

## Phase 3: Lane Evidence / Read Model Proof

- [x] 3.1 Keep `packages/agent/src/conversation/operationalEvidenceProvider.ts` mapping for market/margin `pricing`; adjust line text only if needed for read-only wording.
- [x] 3.2 Add `packages/memory/src/operationalReadModel.ts` tests only if generic pricing persistence needs proof beyond ingestion tests.

## Phase 4: Tests / Verification

- [x] 4.1 Extend `packages/agent/tests/conversation/backgroundIngestion.test.ts` for deterministic rotated batch cap and configured cap calls.
- [x] 4.2 Test pricing snapshot persistence, evidence ID format, `noMutationExecuted`, and no price/promotions/media mutation calls.
- [x] 4.3 Test checkpoint order: no checkpoint before bounded batch completion; no checkpoint when snapshot persistence fails.
- [x] 4.4 Test per-item graceful failures for unsupported, unauthorized, non-catalog, and no-data responses.
- [x] 4.5 Extend `packages/agent/tests/conversation/operationalEvidenceProvider.test.ts` for market/margin pricing evidence and missing/partial evidence.
- [x] 4.6 Run `npm test` and targeted Vitest for changed conversation tests.
