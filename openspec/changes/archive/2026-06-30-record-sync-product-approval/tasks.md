# Tasks: Record sync_product Approval

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 450-650 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 domain/tools marker → PR 2 MCP tool → PR 3 tests/integration hardening |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Persist explicit non-execution approval records | PR 1 | `packages/domain`, `packages/tools`; no SQL migration |
| 2 | Add sync-only MCP approval recording | PR 2 | `packages/mcp/src/index.ts`, `runtimeDependencies.ts`; depends on PR 1 |
| 3 | Complete unit and SDK verification | PR 3 | MCP/domain/tools tests; depends on PR 2 |

## Phase 1: Approval Record Foundation

- [x] 1.1 Update `packages/domain/src/approval.ts` so `ApprovalRecord` requires `executionStatus: "not-executed"` without changing `canExecutePreparedAction` semantics.
- [x] 1.2 Update `packages/tools/src/index.ts` serialization/deserialization and `approvePreparedAction` to preserve/write `executionStatus: "not-executed"`; do not add a SQL migration.
- [x] 1.3 Update `packages/domain/src/domain.test.ts` fixtures to require the marker and preserve approval eligibility behavior.
- [x] 1.4 Update `packages/tools/src/index.test.ts` SQLite approval tests to assert reopened `approval_json` retains the marker.

## Phase 2: MCP Approval Recording

- [x] 2.1 Add `ApproveSyncProductProposalInput` and response types/schema in `packages/mcp/src/index.ts` for exact `actionId` plus `msl_api_key` only.
- [x] 2.2 Add a redacted unavailable response helper in `packages/mcp/src/index.ts` matching missing, malformed, non-sync, expired, rejected, approved/finalized, and repository-error failures.
- [x] 2.3 Implement a local helper in `packages/mcp/src/index.ts`: validate auth before lookup, find exact action, reuse `isSupportedSyncProductProposal`, require pending/unexpired, then save approved state and `saveApproval` with `executionStatus: "not-executed"`.
- [x] 2.4 Register `approve_sync_product_proposal` in `packages/mcp/src/index.ts`; return sanitized approved metadata with `actionId: "redacted"`, `noMutationExecuted: true`, and no execution/audit/mutation fields.
- [x] 2.5 Confirm `packages/mcp/src/runtimeDependencies.ts` adds no MercadoLibre, `ProductSyncEngine`, audit replay, `sync_all`, or execution dependency.

## Phase 3: MCP Unit Verification

- [x] 3.1 Update `packages/mcp/src/mcp.test.ts` registration/schema assertions to include only `approve_sync_product_proposal`, not generic approval or preview-only tools.
- [x] 3.2 Add auth-before-lookup tests in `packages/mcp/src/mcp.test.ts` proving invalid API keys skip repository lookup and do not enumerate records.
- [x] 3.3 Add pending sync approval tests in `packages/mcp/src/mcp.test.ts` asserting `save` and `saveApproval` payloads preserve exact changes, risk, seller, timestamp, and non-executed status.
- [x] 3.4 Add table tests in `packages/mcp/src/mcp.test.ts` for missing, blank, non-sync, expired, rejected, approved/finalized, and repository-error cases returning identical unavailable responses with no writes.
- [x] 3.5 Add forbidden-surface assertions in `packages/mcp/src/mcp.test.ts` proving no MercadoLibre mutation, audit replay, `ProductSyncEngine`, `sync_all`, multi-product sync, or rollback automation is called/imported.

## Phase 4: Integration and Final Checks

- [x] 4.1 Update `packages/mcp/src/mcp.integration.test.ts` to call `approve_sync_product_proposal` through the SDK and assert approval recording succeeds without mutation, audit replay, or execution.
- [x] 4.2 Run `npm test` for the affected workspace tests and fix only failures within this change scope.
- [x] 4.3 Run `npm run typecheck` and ensure all modified TypeScript contracts compile.
