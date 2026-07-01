# Tasks: MercadoLibre API Gaps 2026 — Slice 2

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 330 code + 200 tests = ~530 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Delivery strategy | single-pr |
| Suggested split | PR #1: Claims + Shipping types/client (Phases 1-2, ~300 lines); PR #2: MCP wiring + tests (Phases 3-4, ~230 lines) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Claims types, normalizers, client methods | PR 1 | ~200 lines; follow patterns from normalizeNotices/getNotices |
| 2 | Shipping types, normalizer, client method | PR 1 | ~70 lines; flat record with dimensions sub-object |
| 3 | MCP wiring (3 custom registrations) | PR 2 | ~80 lines; follow read_product_ads_insights pattern |
| 4 | Unit + integration tests | PR 2 | ~200 lines; snapshots + tool auth gates |

## Phase 1: Types & Normalizers

**File**: `packages/mercadolibre/src/index.ts`

- [x] 1.1 Add claims types after `MlcNoticesSummary` (line ~214): `MlcClaimPlayerAction`, `MlcClaimPlayer`, `MlcClaimResolution`, `MlcClaimSummary`, `MlcClaimMessage`, `MlcClaimsSearchResult`, `MlcClaimDetailSummary`. Follow field shapes from user-provided type definitions (simplified summary-style).
- [x] 1.2 Add `MlcShipmentStatusSummary` after claims block (line ~290): id, status, substatus, dateCreated, lastUpdated, trackingNumber, trackingMethod, logisticType, senderId, receiverId, siteId. Follow user-provided type definition.
- [x] 1.3 Add snapshot exports after `MlcAnswerSnapshot` (line ~584): `MlcClaimsSearchSnapshot`, `MlcClaimDetailSnapshot`, `MlcShipmentStatusSnapshot`. All wrap `<TData>` in `MlcReadSnapshot`.
- [x] 1.4 Add `normalizeClaimsSearch()` after `normalizeAnswer`: parse `paging` + `results[]`, flatMap claims via `normalizeSingleClaim` helper, normalize nested `players`/`resolution`. Return `MlcClaimsSearchSnapshot` with `kind: "business-signal"`.
- [x] 1.5 Add `normalizeShipmentStatus()` after `normalizeClaimsSearch`: flat record normalization with `pushOptional` for all fields (`date_created`→`dateCreated`, `tracking_number`→`trackingNumber`, etc.). Return `MlcShipmentStatusSnapshot` with `kind: "business-signal"`.

## Phase 2: Client Methods

**File**: `packages/mercadolibre/src/index.ts`

- [x] 2.1 Add 3 optional method signatures to `MlcApiClient` interface (after `prepareAnswer`, line ~817): `searchClaims?`, `getClaimDetail?`, `getShipmentStatus?`. Follow `getNotices?`/`getModerationStatus?` signature patterns. (4 sub-resource methods deferred to PR #2.)
- [x] 2.2 Add `searchClaims(sellerId, options?)` to `createMlcReadMethods` (after `prepareAnswer`, line ~3230): `GET /post-purchase/v1/claims/search` with optional `limit`/`offset`/`status`/`sort` query params → `normalizeClaimsSearch`.
- [x] 2.3 Add `getClaimDetail(sellerId, claimId)` → `GET /post-purchase/v1/claims/{claimId}` → `normalizeClaimDetail`.
- [ ] 2.4 Add 4 claim sub-resource methods: `getClaimMessages` → `/post-purchase/v1/claims/{claimId}/messages`, `getClaimExpectedResolutions` → `.../expected_resolutions`, `getClaimAffectsReputation` → `.../affects-reputation`, `getClaimStatusHistory` → `.../status_history`. Each returns `MlcReadSnapshot` with `noMutationExecuted: true`. **Deferred to PR #2.**
- [x] 2.5 Add `getShipmentStatus(sellerId, shipmentId)` → `GET /marketplace/shipments/{shipmentId}` with `x-format-new: true` header → `normalizeShipmentStatus`.

## Phase 3: MCP Tool Wiring

**File**: `packages/mcp/src/index.ts`

- [x] 3.1 Inside `if (config.mlcClient)` block after `registerMlcListingPricesReadTool` (line ~1671), add `server.registerTool("read_moderation_status", ...)`: inputSchema `{ sellerId: z.string(), itemId: z.string(), msl_api_key: z.string().optional() }`, calls `config.mlcClient.getModerationStatus!(sellerId, itemId)`. Auth gate first.
- [x] 3.2 Add `server.registerTool("read_notices", ...)`: inputSchema `{ sellerId: z.string(), limit: z.number().optional(), offset: z.number().optional(), msl_api_key: z.string().optional() }`, calls `config.mlcClient.getNotices!(sellerId, { limit, offset })`. Auth gate first.
- [x] 3.3 Add `server.registerTool("prepare_answer", ...)`: inputSchema `{ sellerId: z.string(), questionId: z.string(), text: z.string(), msl_api_key: z.string().optional() }`, calls `config.mlcClient.prepareAnswer!(sellerId, { questionId, text })`. Auth gate first. Returns `requiresApproval: true`.

## Phase 4: Testing

**File**: `packages/mercadolibre/src/mercadolibre.test.ts`

- [x] 4.1 `describe("normalizeClaimsSearch")`: test with real ML response shape (paging + results with players/actions), verify player flattening, empty results, missing nested fields, partial completeness.
- [x] 4.2 `describe("getClaims + getClaimDetail")`: mock transport → call client methods → verify endpoint paths, query params, snapshot shape (`source`, `noMutationExecuted`, freshness).
- [x] 4.3 `describe("normalizeShipmentStatus")`: test delivered, in-transit, cancelled statuses, dimensions sub-object present/absent, 404 not-found error snapshot.
- [x] 4.4 `describe("getShipment")`: verify `x-format-new` header on request, snapshot `kind` and `source`.

**File**: `packages/mcp/src/mcp.test.ts`

- [x] 4.5 Extend "registers injected MercadoLibre read tools" (line ~408): add mock `getModerationStatus`, `getNotices`, `prepareAnswer` to `mlcClient`; assert `read_moderation_status`, `read_notices`, `prepare_answer` in `registeredTools`. Update `registeredTools.size` expectation.
- [x] 4.6 Test `read_moderation_status`: call tool with `{ sellerId, itemId }` → verify client method called with correct args → check snapshot `noMutationExecuted: true`.
- [x] 4.7 Test `read_notices`: call tool with `{ sellerId, limit: 5, offset: 10 }` → verify options passed → check pagination metadata in response.
- [x] 4.8 Test `prepare_answer`: call tool with questionId/text → verify `requiresApproval: true`, `noMutationExecuted: true`, `status: "pending"`. Test empty questionId returns degraded snapshot.
- [x] 4.9 Auth gate tests: each new tool rejects without `msl_api_key` when `MSL_MCP_API_KEY` is set (reuse `vi.stubEnv` pattern from line ~2194).
