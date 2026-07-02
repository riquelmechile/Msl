# Tasks: MercadoLibre API Gaps 2026 — Slice 3

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 150 code + 100 tests = ~250 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | single-pr |

Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: Low

## Phase 1: Claim Sub-Resource Types & Normalizers

**File**: `packages/mercadolibre/src/index.ts`

- [x] 1.1 Add 4 summary types after `MlcClaimDetailSummary`: `MlcClaimMessagesSummary`, `MlcClaimResolutionsSummary`, `MlcClaimReputationSummary`, `MlcClaimStatusHistorySummary`. Use `ReadonlyArray` for list fields.
- [x] 1.2 Add 4 snapshot exports: `MlcClaimMessagesSnapshot`, `MlcClaimResolutionsSnapshot`, `MlcClaimReputationSnapshot`, `MlcClaimStatusHistorySnapshot`.
- [x] 1.3 Add 4 normalizers: `normalizeClaimMessages` (reuse existing helper), `normalizeClaimExpectedResolutions`, `normalizeClaimAffectsReputation`, `normalizeClaimStatusHistory`. Each returns `MlcReadSnapshot<T>` with `kind: "business-signal"`.

## Phase 2: Image Orchestration Types

- [x] 2.1 Add `MlcImageAssociateInput`, `MlcImageAssociateSummary` after image types.
- [x] 2.2 Add `MlcImageOrchestrationInput`, `MlcImageOrchestrationStep`, `MlcImageOrchestrationSummary`.

## Phase 3: Client Methods

- [x] 3.1 Add 5 optional signatures to `MlcApiClient`: `getClaimMessages?`, `getClaimExpectedResolutions?`, `getClaimAffectsReputation?`, `getClaimStatusHistory?`, `associateImageToItem?`.
- [x] 3.2 Implement 4 claim sub-resource methods in `createMlcReadMethods` → `GET /post-purchase/v1/claims/{claimId}/{subpath}` → call respective normalizer.
- [x] 3.3 Implement `associateImageToItem` → `GET /items/{itemId}` → return existing pictures array with new pictureId appended in summary (no PUT, read-only prep).

## Phase 4: MCP Tool Wiring

**File**: `packages/mcp/src/index.ts`

- [x] 4.1 Register `read_claim_messages`: `{ sellerId, claimId }` → `getClaimMessages!`.
- [x] 4.2 Register `read_claim_expected_resolutions`: `{ sellerId, claimId }` → `getClaimExpectedResolutions!`.
- [x] 4.3 Register `read_claim_affects_reputation`: `{ sellerId, claimId }` → `getClaimAffectsReputation!`.
- [x] 4.4 Register `read_claim_status_history`: `{ sellerId, claimId }` → `getClaimStatusHistory!`.
- [x] 4.5 Register `prepare_image_orchestration`: `{ sellerId, itemId, pictureUrl, categoryId, title? }` → returns `MlcImageOrchestrationSummary` with `requiresApproval: true`, `noMutationExecuted: true`. No MCP execution — prepare-only.

## Phase 5: Tests

- [x] 5.1 Unit tests for 4 claim sub-resource normalizers in `mercadolibre.test.ts`.
- [x] 5.2 Unit test for `MlcImageOrchestrationSummary` shape in `mercadolibre.test.ts`.
- [x] 5.3 MCP tool auth gate tests for 5 new registrations in `mcp.test.ts`.
- [x] 5.4 Verify `npm run typecheck && npm test` passes.
