# Apply Progress: Operational Catalog Competition Ingestion

## Mode

Standard Mode. Strict TDD was not enabled by `openspec/config.yaml` or the SDD init cache.

## Workload / PR Boundary

- Mode: chained PR slice
- Chain strategy: stacked-to-main
- Current work unit: PR 2 / Unit 2 — lane evidence and read-model proof
- Boundary: starts after PR 1 durable `pricing` ingestion snapshots; ends with provider evidence formatting/tests, generic read-model pricing persistence proof, and updated SDD progress artifacts.
- Estimated review budget impact: PR 2 is a narrow evidence/test reconciliation slice. PR 1 history is preserved below; no price, promotions, media mutation, or AI image generation changes were introduced.

## Completed Tasks

- [x] 1.1 Update `backgroundIngestion.ts` imports and `BackgroundIngestionConfig` with `pricingMaxItemsPerCycle`.
- [x] 1.2 Add `pricing` TTL/cap constants and exported defaults beside existing freshness/default constants.
- [x] 1.3 Add deterministic rotated listing selection and graceful price-to-win no-data helpers.
- [x] 2.1 Create exported `processSellerPricing(config, sellerId, listings)` using existing `getItemPriceToWin`.
- [x] 2.2 Persist successful snapshots as `kind: "pricing"` with item entity ID, deterministic evidence ID, metadata, and `noMutationExecuted: true`.
- [x] 2.3 Catch unsupported, unauthorized, non-catalog, no-data, and per-item read failures while continuing the bounded batch.
- [x] 2.4 Write the `pricing` checkpoint only after capped item attempts and successful snapshot writes complete.
- [x] 2.5 Wire `processSellerPricing` into `startBackgroundIngestion` after listings are available and before cross-account analysis.
- [x] 4.1 Add deterministic rotated batch cap and configured cap tests.
- [x] 4.2 Add pricing snapshot persistence, evidence ID, read-only metadata, and no mutation tests.
- [x] 4.3 Add checkpoint ordering and persistence-failure tests.
- [x] 4.4 Add graceful failure and no-data tests.
- [x] 4.6 Run full `npm test`, targeted Vitest, and typecheck.
- [x] 3.1 Keep provider mapping for market/margin `pricing`; label pricing prompt context as read-only/limited evidence.
- [x] 3.2 Add operational read model proof that generic SQLite snapshots persist and retrieve `pricing` evidence with `noMutationExecuted`.
- [x] 4.5 Extend `operationalEvidenceProvider.test.ts` for market and margin pricing evidence, missing evidence, and partial/limited evidence.

## Remaining Tasks

None.

## Verification

| Command | Result |
|---------|--------|
| `npx vitest run "packages/agent/tests/conversation/backgroundIngestion.test.ts"` | Passed — 38 tests |
| `npx vitest run "packages/agent/tests/conversation/operationalEvidenceProvider.test.ts" "packages/memory/tests/operationalReadModel.test.ts"` | Passed — 2 files, 39 tests |
| `npm run typecheck` | Passed |
| `npm test` | Passed — 41 files, 1085 tests |

## Deviations from Design

None — implementation matches the chained PR design. PR 1 delivered ingestion core. PR 2 preserved the existing market/margin-to-`pricing` mapping, added read-only pricing evidence labels in provider output, and proved generic read-model `pricing` persistence through tests.

## Issues Found

- `BusinessSignalKind` already included `pricing`, but `ReadSnapshotKind` did not. This prevented typed MercadoLibre/read-model snapshots from compiling until `pricing` was added to `packages/domain/src/readSnapshot.ts`.
- The original PR 2 apply report was empty, but the working tree contained valid PR 2 provider/read-model test changes. This reconciliation verified the diff, completed the SDD checkboxes, and merged PR 2 details without losing PR 1 history.
