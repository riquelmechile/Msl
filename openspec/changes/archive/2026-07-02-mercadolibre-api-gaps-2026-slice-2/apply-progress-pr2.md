# Apply Progress — mercadolibre-api-gaps-2026-slice-2 PR #2

## Summary

PR #2 (MCP Wiring + Tests) wired 6 tools into the MCP server and added unit + integration tests. All changes are additive: `packages/mcp/src/index.ts` (+170 lines), `packages/mercadolibre/src/mercadolibre.test.ts` (+310 lines), `packages/mcp/src/mcp.test.ts` (+340 lines).

## Completed Tasks

### Phase 3: MCP Tool Wiring

- [x] 3.1 `read_moderation_status` — exposes `getModerationStatus(sellerId, itemId)` with auth gate
- [x] 3.2 `read_notices` — exposes `getNotices(sellerId, { limit, offset })` with auth gate
- [x] 3.3 `prepare_answer` — exposes `prepareAnswer(sellerId, { questionId, text })` with auth gate
- [x] 3.x `read_claims` — exposes `searchClaims(sellerId, { limit, offset, status, sort })` with auth gate
- [x] 3.x `read_claim_detail` — exposes `getClaimDetail(sellerId, claimId)` with auth gate
- [x] 3.x `read_shipment_status` — exposes `getShipmentStatus(sellerId, shipmentId)` with auth gate

### Phase 4: Testing

- [x] 4.1 `normalizeClaimsSearch` — 4 tests: happy path, empty results, missing field, partial data
- [x] 4.2 `getClaimDetail` — 2 tests: full detail with messages/actions, endpoint path
- [x] 4.3 `normalizeShipmentStatus` — 3 tests: delivered, in-transit, partial (not-an-object)
- [x] 4.4 `getShipmentStatus` — 2 tests: x-format-new header, searchClaims with filters
- [x] 4.5 MCP tool registration test updated — added 6 mock methods, count 17→23
- [x] 4.6 `read_moderation_status` integration — valid call + auth gate
- [x] 4.7 `read_notices` integration — valid call with pagination
- [x] 4.8 `prepare_answer` integration — valid call + empty input degraded
- [x] 4.9 Auth gate tests for new tools

## Files Changed

| File | Action | Lines | Description |
|------|--------|-------|-------------|
| `packages/mcp/src/index.ts` | Modified | +170 | 6 MCP tool registrations in `if (config.mlcClient)` block |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Modified | +310 | 4 test blocks: normalizeClaimsSearch, getClaimDetail, normalizeShipmentStatus, getShipmentStatus |
| `packages/mcp/src/mcp.test.ts` | Modified | +340 | Updated registration test + 7 new integration tests |
| `openspec/changes/mercadolibre-api-gaps-2026-slice-2/tasks.md` | Modified | — | Marked Phase 3-4 tasks as [x] |

## Implementation Notes

- MCP tools use local `const mlcClient = config.mlcClient` binding inside the guard to avoid TypeScript narrowing issues
- Option parameters use conditionally-built objects to satisfy `exactOptionalPropertyTypes: true`
- Test mock IDs switched from numeric to string to match `stringValue()` helper behavior
- 3 Slice 1 tools (read_moderation_status, read_notices, prepare_answer) + 3 Slice 2 tools (read_claims, read_claim_detail, read_shipment_status)
- `prepare_answer` returns `requiresApproval: true, noMutationExecuted: true, status: "pending"` as specified

## Quality Gates

- `npx tsc --noEmit` (packages/mcp): Clean (0 errors)
- `npx vitest run` (mercadolibre): 150 tests passed (100 mercadolibre + 50 sync)
- `npx vitest run` (mcp): 158 tests passed (135 mcp.test.ts + 23 mcp.integration.test.ts)

## Deviations from Design

- **Option handling**: Used conditionally-built option objects instead of inline `{ limit, offset }` due to `exactOptionalPropertyTypes` — functionally identical, slightly more verbose
- **Tool registration block**: Uses `if (config.mlcClient)` with local binding pattern instead of reusing `readTools` object — directly calls client methods per spec

## Issues Found

None.

## Remaining Tasks

- [ ] 2.4: 4 claim sub-resource methods (deferred beyond PR #2)
