# Proposal: MercadoLibre API Gaps 2026 — Slice 3

## Intent

Complete the deferred work from Slice 2: 4 claim sub-resource GET endpoints + the `associateImageToItem` client method and image orchestration prepared action.

## Scope

| Item | Classification | Description | Lines |
|------|---------------|-------------|-------|
| 4 claim sub-resources | `safe-read` | `GET /post-purchase/v1/claims/{id}/{messages,expected_resolutions,affects_reputation,status_history}` | ~80 |
| `associateImageToItem` | `safe-read` (reads existing listing) | Client method to get current pictures array for item | ~30 |
| Image orchestration action | `prepare-only` | Prepared action wiring for diagnose→upload→associate→check flow | ~40 |

**Total code: ~150 lines. Tests: ~100 lines. Single PR.**

## Out of Scope

- Claims mutation actions (deferred)
- Image upload/associate execution (prepare-only; no MCP execution tool)
- Expanding `MlcReadTools` in the tools package

## Approach

Follow the same per-endpoint pattern from Slice 1-2: summary types → normalizers → optional `MlcApiClient` methods → implementations in `createMlcReadMethods`. All changes additive, zero refactoring.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Sub-resource response shapes unknown | Low | Use simple summary types hand-designed from API docs patterns |
| Image associate duplicates existing pictures | Low | Read existing `pictures` array first, append new pictureId |

## Rollback

Revert commit. All safe-reads; prepared action has no execution path.

## Success Criteria

- [ ] 4 claim sub-resource methods return typed `MlcReadSnapshot` with `noMutationExecuted: true`
- [ ] `associateImageToItem` added to `MlcApiClient`
- [ ] Image orchestration prepared action registered in MCP
- [ ] Pass `npm run typecheck && npm test`
