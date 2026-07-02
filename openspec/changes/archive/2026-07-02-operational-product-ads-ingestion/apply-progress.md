# Apply Progress: Operational Product Ads Ingestion

## Mode

Standard Mode. Strict TDD is disabled in `openspec/config.yaml` and the orchestrator preflight.

## Completed Tasks

- [x] 1.1 Added `product-ads-insights` freshness TTL and default max-page constants.
- [x] 1.2 Added Product Ads date-range entity ID, evidence ID, and graceful no-data error helpers.
- [x] 1.3 Exported `processSellerProductAds(config, sellerId)` returning `{ persisted: boolean }`.
- [x] 2.1 Calls optional `config.mlcClient.getProductAdsInsights(sellerId, defaultRange)` once per seller.
- [x] 2.2 Persists one `product-ads-insights` operational snapshot with freshness, completeness, confidence, ROAS metadata, and `noMutationExecuted`.
- [x] 2.3 Updates the Product Ads checkpoint only after snapshot persistence succeeds.
- [x] 2.4 Treats disabled, unauthorized, forbidden, missing advertiser, and not-found Product Ads errors as graceful no-data.
- [x] 2.5 Wires Product Ads ingestion into `startBackgroundIngestion` after reputation.
- [x] 3.1 Added Product Ads snapshot persistence test coverage.
- [x] 3.2 Added checkpoint ordering and persistence-failure skip coverage.
- [x] 3.3 Added missing client and no-access graceful no-data coverage.
- [x] 3.4 Tightened market-catalog and creative-commercial Product Ads evidence assertions.
- [x] 4.1 Ran focused Vitest filter for background ingestion and operational evidence provider tests.
- [x] 4.2 Ran full `npm test` before handoff.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modified | Added Product Ads constants/helpers, exported processor, snapshot persistence/checkpointing, graceful no-data handling, and cycle wiring. |
| `packages/agent/tests/conversation/backgroundIngestion.test.ts` | Modified | Added Product Ads processor tests for persistence, checkpoint behavior, missing client, and no-access errors. |
| `packages/agent/tests/conversation/operationalEvidenceProvider.test.ts` | Modified | Tightened durable Product Ads evidence ID/timestamp assertions for market-catalog and creative-commercial lanes. |
| `openspec/changes/operational-product-ads-ingestion/tasks.md` | Modified | Marked all implementation, test, and verification tasks complete. |
| `openspec/changes/operational-product-ads-ingestion/apply-progress.md` | Added | Recorded cumulative apply progress and verification evidence. |

## Verification

| Command | Result |
|---------|--------|
| `npm test -- packages/agent/tests/conversation/backgroundIngestion.test.ts packages/agent/tests/conversation/operationalEvidenceProvider.test.ts` | Passed: 2 files, 40 tests. |
| `npm run typecheck && npm test` | Passed typecheck and full Vitest suite: 41 files, 1071 tests. |
| `npm run lint && npm run format:check` | Initial format check failed on changed files. |
| `npx prettier --write packages/agent/src/conversation/backgroundIngestion.ts packages/agent/tests/conversation/backgroundIngestion.test.ts packages/agent/tests/conversation/operationalEvidenceProvider.test.ts && npm run lint && npm run format:check` | Passed lint and format check. |
| `npm test -- packages/agent/tests/conversation/backgroundIngestion.test.ts packages/agent/tests/conversation/operationalEvidenceProvider.test.ts && npm run typecheck` | Passed after formatting. |

## Deviations from Design

None — implementation matches the design. The Product Ads snapshot stores a seller-level date-range entity ID, reuses the existing safe-read client, and keeps lane mapping unchanged.

## Issues Found

- `OperationalReadModel.readSnapshot` reconstructs `maxAgeMs` from generic risk defaults, so tests assert persisted Product Ads freshness status and the exported TTL constant rather than expecting a round-tripped 24h max age from the reader.

## Workload / PR Boundary

- Mode: single PR / work-unit commit boundary.
- Current work unit: Product Ads processor, cycle wiring, and focused evidence tests.
- Boundary: starts from existing safe-read Product Ads client and operational store; ends with durable `product-ads-insights` snapshots/checkpoints and lane evidence proof.
- Estimated review budget impact: implementation stayed in the forecasted medium range; `git diff --stat` for tracked code showed 298 changed lines before OpenSpec artifact files.

## Status

14/14 tasks complete. Ready for `sdd-verify`.
