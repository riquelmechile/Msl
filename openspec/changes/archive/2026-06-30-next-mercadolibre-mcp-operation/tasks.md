# Tasks: Read-Only Product Sync Proposal Inspection

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 300-380 original forecast; actual work split after PR #32 |
| 400-line budget risk | High (materialized during implementation) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 core/unit tests; PR 2 SDK integration tests |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: Resolved — split into stacked-to-main PRs.
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add authenticated exact-ID `read_sync_product_status` core implementation and unit coverage | PR 1 / PR #32 | Merged to `main`; intentionally excluded SDK integration tests to stay reviewable |
| 2 | Add SDK integration coverage for `read_sync_product_status` | PR 2 | Current remaining scope; no core implementation changes expected |

## Phase 1: Foundation / Contracts

- [x] 1.1 Add `mcpReadSyncProductStatusInputSchema` and `ReadSyncProductStatusInput` in `packages/mcp/src/index.ts` with only `actionId` and optional `msl_api_key`.
- [x] 1.2 Add local response/status helper types in `packages/mcp/src/index.ts` for available vs redacted unavailable status responses.
- [x] 1.3 Add pure helpers in `packages/mcp/src/index.ts` to identify supported `sync_product` proposals from `kind`, listing target, high risk, `syncIntent`, and `mutationExecuted: false` markers.

## Phase 2: MCP Tool Implementation

- [x] 2.1 Register `read_sync_product_status` in `packages/mcp/src/index.ts` beside `sync_product`; require valid API key before any `findAction()` call.
- [x] 2.2 Implement exact-ID lookup via `config.prepareWrite.repository.findAction(actionId)` only; do not call save, approval, audit, execution, `ProductSyncEngine`, `sync_all`, or multi-product paths.
- [x] 2.3 Shape available responses in `packages/mcp/src/index.ts` with redacted action ID, effective status, expiry, risk, listing target, rationale, preview summary, approval/storage metadata, and no-mutation flags.
- [x] 2.4 Return one controlled unavailable response for missing, malformed, non-sync, unsupported, or unavailable repository cases without exposing seller/account, storage path, raw record, or validation details.
- [x] 2.5 Derive expired status from `entry.action.expiresAt <= config.prepareWrite.clock.now()` without mutating stored queue state.

## Phase 3: Unit Tests

- [x] 3.1 Update `packages/mcp/src/mcp.test.ts` tool registration assertions for the seventh tool and exact input schema.
- [x] 3.2 Add unit tests proving unauthenticated `read_sync_product_status` rejects before repository lookup.
- [x] 3.3 Add unit tests for stored pending/expired `sync_product` responses, preview summaries, storage metadata, and no save/approval/audit calls.
- [x] 3.4 Add unit tests for unknown, malformed, non-sync, and unsupported IDs returning the same redacted unavailable response.
- [x] 3.5 Add unit guard in `packages/mcp/src/mcp.test.ts` that response text omits DB paths, credentials, raw errors, `ProductSyncEngine`, `sync_all`, and preview-only tool names.

## Phase 4: Integration / Verification

- [x] 4.1 Extend `packages/mcp/src/mcp.integration.test.ts` SDK helper to call `read_sync_product_status` with injectable repository responses.
- [x] 4.2 Add SDK integration tests for durable stored status lookup and controlled missing/unsupported responses.
- [x] 4.3 Run `npm test -- packages/mcp/src/mcp.test.ts packages/mcp/src/mcp.integration.test.ts`, then `npm test` if the focused command is unsupported.
