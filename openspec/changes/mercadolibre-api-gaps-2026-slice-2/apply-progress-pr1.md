# Apply Progress — mercadolibre-api-gaps-2026-slice-2 PR #1

## Summary

PR #1 (Claims + Shipping types, normalizers, client methods) implemented in `packages/mercadolibre/src/index.ts`. Domain type prerequisites added to `packages/domain/src/readSnapshot.ts` and `packages/domain/src/cacheFreshness.ts`.

## Completed Tasks

### Phase 1: Types & Normalizers

- [x] 1.1 Claims types (8 new types): MlcClaimPlayer, MlcClaimPlayerAction, MlcClaimResolution, MlcClaimMessage, MlcClaimSummary, MlcClaimsSearchResult, MlcClaimDetailSummary
- [x] 1.2 MlcShipmentStatusSummary (1 new type)
- [x] 1.3 Snapshot exports: MlcClaimsSearchSnapshot, MlcClaimDetailSnapshot, MlcShipmentStatusSnapshot
- [x] 1.4 normalizeClaimsSearch (with helper functions: normalizeSingleClaim, normalizeClaimPlayers, normalizeClaimActions, normalizeClaimMessages)
- [x] 1.5 normalizeShipmentStatus

### Phase 2: Client Methods

- [x] 2.1 Interface methods: searchClaims?, getClaimDetail?, getShipmentStatus?
- [x] 2.2 searchClaims → GET /post-purchase/v1/claims/search
- [x] 2.3 getClaimDetail → GET /post-purchase/v1/claims/{id}
- [ ] 2.4 Sub-resource methods (deferred to PR #2)
- [x] 2.5 getShipmentStatus → GET /marketplace/shipments/{id} (x-format-new: true)

## Files Changed

| File | Action | Lines | Description |
|------|--------|-------|-------------|
| `packages/domain/src/readSnapshot.ts` | Modified | +1 | Added `\| "business-signal"` to ReadSnapshotKind |
| `packages/domain/src/cacheFreshness.ts` | Modified | +1 | Added `\| "business-signal"` to BusinessSignalKind |
| `packages/mercadolibre/src/index.ts` | Modified | +230 | 9 new types + 3 snapshot exports + 3 interface methods + 7 internal functions (3 normalizers + 4 helpers) + 3 client methods |

## Implementation Notes

- All normalizers use `asRecord`, `asArray`, `stringValue`, `numberValue`, `pushOptional` helpers consistent with existing patterns
- `normalizeSingleClaim` helper extracted to avoid duplication between search and detail normalizers
- `normalizeClaimPlayers`, `normalizeClaimActions`, `normalizeClaimMessages` as reusable helpers
- Kind: `"business-signal"` added to both `ReadSnapshotKind` (domain) and `BusinessSignalKind` (cacheFreshness)
- Snapshot confidence uses `snapshotConfidence()` with item count; freshness uses `createFreshness("business-signal", now)`
- Prerequisite: domain package rebuilt with `tsc -b` (clean build, packages/domain)

## Quality Gates

- `npx tsc --noEmit`: Clean (0 errors from new code; pre-existing test type errors remain from Slice 1)
- `npx vitest run`: 139 tests passed (89 mercadolibre + 50 sync)
- Domain build: Clean

## Deviations from design.md

1. **Type shapes**: User-provided types use flat/summary-style shapes (e.g., `MlcClaimPlayer` with `{ id, role, nickname }`) instead of the design.md field-level types. User instructions override design.md.
2. **Client method names**: `searchClaims` instead of `getClaims`, `getShipmentStatus` instead of `getShipment` — per user instructions.
3. **Reduced scope**: 3 interface methods instead of 7 (4 sub-resource methods deferred to PR #2).
4. **No `dimensions` sub-object on shipment**: User-provided `MlcShipmentStatusSummary` uses flat fields instead of the nested `dimensions` object in design.md.

## Remaining for PR #2

- [ ] 2.4: 4 claim sub-resource methods (getClaimMessages, getClaimExpectedResolutions, getClaimAffectsReputation, getClaimStatusHistory)
- [ ] Phase 3: MCP tool wiring (3 custom registrations in `packages/mcp/src/index.ts`)
- [ ] Phase 4: Unit + integration tests
- [ ] Fix pre-existing test type errors from Slice 1 `ReadonlyArray` changes
