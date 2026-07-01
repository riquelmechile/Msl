# Tasks: Sync Product Execution Readiness

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650-900 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 contracts/helpers → PR 2 MCP wiring → PR 3 tests |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Readiness types/helpers | PR 1 | A main; no tool registration required. |
| 2 | MCP/runtime wiring | PR 2 | Base = PR 1 branch; registers readiness tool. |
| 3 | Unit/integration coverage | PR 3 | Base = PR 2 branch; proves specs and no-mutation guard. |

## Phase 1: Foundation / Contracts

- [x] 1.1 Add readiness input schema, status/reason/response types, and `noMutationExecuted: true` contract in `packages/mcp/src/index.ts`.
- [x] 1.2 Add local helpers in `packages/mcp/src/index.ts` for exact action lookup, `sync_product` shape, approval expiry, approval binding, and redacted reason aggregation.
- [x] 1.3 Add read-only preview comparison, seller/account, target availability, idempotency candidate, rollback evidence, API evidence, and error-mapping helpers in `packages/mcp/src/index.ts`.

## Phase 2: MCP Wiring

- [x] 2.1 Register `read_sync_product_execution_readiness` in `packages/mcp/src/index.ts` with auth-first validation and exact `actionId` input.
- [x] 2.2 Wire readiness to `prepareWrite.repository.findAction/findApproval` only; do not call `save`, `saveApproval`, `saveAudit`, `listAudits`, execution replay, or rollback automation.
- [x] 2.3 Update `packages/mcp/src/runtimeDependencies.ts` to pass optional read-only rollback/API evidence providers, defaulting to missing evidence and no mutation clients.
- [x] 2.4 Keep forbidden surfaces absent from `packages/mcp/src/index.ts`: no `ProductSyncEngine`, `sync_all`, mutation APIs, bulk sync, or execution/audit replay.

## Phase 3: Unit Tests

- [x] 3.1 Update `packages/mcp/src/mcp.test.ts` registered tool count/schema assertions for the new exact-action readiness tool.
- [x] 3.2 Add `mcp.test.ts` coverage for auth failure, approved eligible/degraded/blocked paths, exact lookup, expiry, proposal type, approval mismatch, and preview drift.
- [x] 3.3 Add `mcp.test.ts` coverage for seller/account roles, target unavailable, idempotency candidate evidence, rollback missing, API evidence missing, rate/upstream/reconnect/storage mapping, and redaction.

## Phase 4: Integration / Verification

- [x] 4.1 Extend `packages/mcp/src/mcp.integration.test.ts` SDK helpers and scenarios for eligible, blocked, and degraded readiness responses.
- [x] 4.2 Verify integration tests assert no mutation/audit calls and response text omits credentials, DB paths, raw upstream errors, `ProductSyncEngine`, and `sync_all`.
- [x] 4.3 Run `npm test`; then run configured verify commands in the verification phase.
