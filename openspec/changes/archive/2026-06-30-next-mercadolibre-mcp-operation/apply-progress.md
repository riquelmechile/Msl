# Apply Progress: Read-Only Product Sync Proposal Inspection

## Mode

Standard Mode. Strict TDD is not active (`openspec/config.yaml` sets `strict_tdd: false` and `rules.apply.tdd: false`).

## Workload / PR Boundary

- Mode: stacked-to-main split
- PR 1 / PR #32: core `read_sync_product_status` implementation and unit coverage; merged to `main`
- PR 2 / current work unit: SDK integration coverage for `read_sync_product_status`
- Boundary: based on `main` after PR #32 merge; no commit, push, or PR created
- Review budget impact: original implementation exceeded the forecast, so integration coverage was intentionally separated into PR 2 to keep review focused.

## Completed Tasks

- [x] 1.1 Add `mcpReadSyncProductStatusInputSchema` and `ReadSyncProductStatusInput` in `packages/mcp/src/index.ts` with only `actionId` and optional `msl_api_key`.
- [x] 1.2 Add local response/status helper types in `packages/mcp/src/index.ts` for available vs redacted unavailable status responses.
- [x] 1.3 Add pure helpers in `packages/mcp/src/index.ts` to identify supported `sync_product` proposals from `kind`, listing target, high risk, `syncIntent`, and `mutationExecuted: false` markers.
- [x] 2.1 Register `read_sync_product_status` in `packages/mcp/src/index.ts` beside `sync_product`; require valid API key before any `findAction()` call.
- [x] 2.2 Implement exact-ID lookup via `config.prepareWrite.repository.findAction(actionId)` only; do not call save, approval, audit, execution, `ProductSyncEngine`, `sync_all`, or multi-product paths.
- [x] 2.3 Shape available responses in `packages/mcp/src/index.ts` with redacted action ID, effective status, expiry, risk, listing target, rationale, preview summary, approval/storage metadata, and no-mutation flags.
- [x] 2.4 Return one controlled unavailable response for missing, malformed, non-sync, unsupported, or unavailable repository cases without exposing seller/account, storage path, raw record, or validation details.
- [x] 2.5 Derive expired status from `entry.action.expiresAt <= config.prepareWrite.clock.now()` without mutating stored queue state.
- [x] 3.1 Update `packages/mcp/src/mcp.test.ts` tool registration assertions for the seventh tool and exact input schema.
- [x] 3.2 Add unit tests proving unauthenticated `read_sync_product_status` rejects before repository lookup.
- [x] 3.3 Add unit tests for stored pending/expired `sync_product` responses, preview summaries, storage metadata, and no save/approval/audit calls.
- [x] 3.4 Add unit tests for unknown, malformed, non-sync, and unsupported IDs returning the same redacted unavailable response.
- [x] 3.5 Add unit guard in `packages/mcp/src/mcp.test.ts` that response text omits DB paths, credentials, raw errors, `ProductSyncEngine`, `sync_all`, and preview-only tool names.
- [x] 4.1 Extend `packages/mcp/src/mcp.integration.test.ts` SDK helper to call `read_sync_product_status` with injectable repository responses.
- [x] 4.2 Add SDK integration tests for durable stored status lookup and controlled missing/unsupported responses.
- [x] 4.3 Run focused MCP integration/unit tests, typecheck, and format check.

## Verification Run

| Command | Result |
|---------|--------|
| `npm test -- packages/mcp/src/mcp.integration.test.ts` | Passed: 1 file, 18 tests. |
| `npm test -- packages/mcp/src/mcp.test.ts packages/mcp/src/mcp.integration.test.ts` | Passed: 2 files, 94 tests. |
| `npm run typecheck` | Passed. |
| `npm run format:check` | Passed after formatting `packages/mcp/src/mcp.integration.test.ts`. |

## Deviations from Design

None for behavior. The implementation keeps status shaping in `packages/mcp/src/index.ts`, uses `findAction()` only, derives expiry in memory, returns one redacted unavailable response for unsupported cases, and adds SDK integration coverage without changing the already-merged core implementation.

## Issues Found

- Review budget risk materialized in the original apply; the change has been split into stacked-to-main PRs, with PR #32 already merged and this PR 2 limited to integration coverage.
