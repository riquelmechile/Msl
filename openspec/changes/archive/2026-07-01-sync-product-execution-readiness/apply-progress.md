# Apply Progress: Sync Product Execution Readiness

## Mode

- Artifact store: OpenSpec
- Apply mode: Standard (strict TDD disabled in `openspec/config.yaml`)
- Delivery strategy: stacked-to-main
- Current PR boundary: PR 4 to `main` — MCP integration tests and final checks prep only
- Review budget: 400 changed lines

## Completed Tasks

- [x] 1.1 Add readiness input schema, status/reason/response types, and `noMutationExecuted: true` contract in `packages/mcp/src/index.ts`.
- [x] 1.2 Add local helpers in `packages/mcp/src/index.ts` for exact action lookup, `sync_product` shape, approval expiry, approval binding, and redacted reason aggregation.
- [x] 1.3 Add read-only preview comparison, seller/account, target availability, idempotency candidate, rollback evidence, API evidence, and error-mapping helpers in `packages/mcp/src/index.ts`.
- [x] 2.1 Register `read_sync_product_execution_readiness` in `packages/mcp/src/index.ts` with auth-first validation and exact `actionId` input.
- [x] 2.2 Wire readiness to `prepareWrite.repository.findAction/findApproval` only; do not call `save`, `saveApproval`, `saveAudit`, `listAudits`, execution replay, or rollback automation.
- [x] 2.3 Update `packages/mcp/src/runtimeDependencies.ts` to pass optional read-only rollback/API evidence providers, defaulting to missing evidence and no mutation clients.
- [x] 2.4 Keep forbidden surfaces absent from `packages/mcp/src/index.ts`: no `ProductSyncEngine`, `sync_all`, mutation APIs, bulk sync, or execution/audit replay.
- [x] 3.1 Update `packages/mcp/src/mcp.test.ts` registered tool count/schema assertions for the new exact-action readiness tool.
- [x] 3.2 Add `mcp.test.ts` coverage for auth failure, approved eligible/degraded/blocked paths, exact lookup, expiry, proposal type, approval mismatch, and preview drift.
- [x] 3.3 Add `mcp.test.ts` coverage for seller/account roles, target unavailable, idempotency candidate evidence, rollback missing, API evidence missing, rate/upstream/reconnect/storage mapping, and redaction.
- [x] 4.1 Extend `packages/mcp/src/mcp.integration.test.ts` SDK helpers and scenarios for eligible, blocked, and degraded readiness responses.
- [x] 4.2 Verify integration tests assert no mutation/audit calls and response text omits credentials, DB paths, raw upstream errors, `ProductSyncEngine`, and `sync_all`.
- [x] 4.3 Run `npm test`; then run configured verify commands in the verification phase.

## Remaining Tasks

- None.

## Evidence

- Added readiness-only local schema, response contract, reason/status unions, and sanitized response builder.
- Added repository read helpers for exact action/approval lookup that map storage failures without writing to storage.
- Added non-mutating validation helpers for supported `sync_product` shape, expiry, approval binding, preview drift, seller scope, target availability, stable idempotency candidate evidence, rollback evidence, API evidence, and redacted error mapping.
- Registered `read_sync_product_execution_readiness` with auth-first validation and exact `actionId` input.
- Wired readiness storage access through `prepareWrite.repository.findAction` and `findApproval` only; readiness does not call repository writes, audit reads/writes, execution replay, or rollback automation.
- Added optional read-only rollback/API evidence providers to MCP runtime dependencies, defaulting to missing evidence without mutation clients.
- Updated MCP tool-count/schema assertions for the readiness tool.
- Added readiness unit coverage for schema registration, auth failure, eligible/degraded/blocked paths, exact lookup, expiry, proposal type, approval mismatch, preview drift, seller/target/idempotency candidate/rollback/API evidence/rate/upstream/reconnect/storage mappings, redaction, and no-mutation invariants.
- Confirmed readiness exposes stable idempotency candidate evidence from the exact approved action; no idempotency conflict branch is reachable under current exact `findAction(actionId)` repository semantics.
- Extended MCP SDK integration coverage with a reusable `read_sync_product_execution_readiness` helper and eligible, blocked, and degraded readiness scenarios.
- Added integration assertions that readiness calls only read exact action/approval records, never call `save`, `saveApproval`, `saveAudit`, or `listAudits`, and keep response text free of credentials, DB paths, raw upstream/storage errors, `ProductSyncEngine`, and `sync_all`.
- Ran `npm test -- packages/mcp/src/mcp.integration.test.ts`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:e2e`, and `npm run build` successfully.

## Deviations

None — implementation matches the PR 4 MCP integration-test and final-checks boundary in the design.
