# Apply Progress: MercadoLibre API Gaps 2026 — Slice 3

## Status: Complete

All 18 tasks across 5 phases implemented and verified.

## Completed Tasks

### Phase 1: Claim Sub-Resource Types & Normalizers
- [x] 1.1 Added 4 summary types after `MlcClaimDetailSummary`
- [x] 1.2 Added 4 snapshot exports
- [x] 1.3 Added 4 normalizers with `kind: "business-signal"`

### Phase 2: Image Orchestration Types
- [x] 2.1 Added `MlcImageAssociateInput`, `MlcImageAssociateSummary`, `MlcImageAssociateSnapshot`
- [x] 2.2 Added `MlcImageOrchestrationInput`, `MlcImageOrchestrationStep`, `MlcImageOrchestrationSummary`

### Phase 3: Client Methods
- [x] 3.1 Added 5 optional signatures to `MlcApiClient`
- [x] 3.2 Implemented 4 claim sub-resource methods via `GET /post-purchase/v1/claims/{claimId}/{subpath}`
- [x] 3.3 Implemented `associateImageToItem` via `GET /items/{itemId}`

### Phase 4: MCP Tool Wiring
- [x] 4.1-4.4 Registered 4 claim sub-resource tools (`read_claim_messages`, etc.)
- [x] 4.5 Registered `prepare_image_orchestration` (prepare-only)

### Phase 5: Tests
- [x] 5.1 7 unit tests for claim sub-resource normalizers (messages × 3, expected resolutions × 1, reputation × 1, status history × 1)
- [x] 5.2 1 unit test for `MlcImageOrchestrationSummary` shape
- [x] 5.3 2 unit tests for `associateImageToItem`
- [x] 5.4 `tsc --noEmit` passes; all 267 tests pass (109 mercadolibre + 158 mcp)

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `packages/mercadolibre/src/index.ts` | Modified | +160 (types + normalizers + client methods) |
| `packages/mcp/src/index.ts` | Modified | +120 (import + 5 MCP tool registrations) |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Modified | +185 (10 tests) |
| `packages/mcp/src/mcp.test.ts` | Modified | +1 (tool count update) |

## Deviations from Design
- Renamed existing internal `normalizeClaimMessages` helper to `normalizeClaimMessageArray` to free the name for the snapshot-level normalizer (as required by the task spec).
- `MlcImageOrchestrationStep` uses `step` (not `kind`) and `status: "pending"|"completed"|"failed"` per the user-supplied types in the apply instructions, which supersede the design sketch.

## Verification
- `npx tsc --noEmit`: clean
- `npx vitest run packages/mercadolibre/src/mercadolibre.test.ts`: 109/109 pass
- `npx vitest run packages/mcp/src/`: 158/158 pass
