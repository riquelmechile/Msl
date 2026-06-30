# Apply Progress: Record sync_product Approval

## Mode

Standard Mode. Strict TDD is not active (`openspec/config.yaml` has `strict_tdd: false`).

## Workload / PR Boundary

- Delivery strategy: auto-chain
- Chain strategy: stacked-to-main
- Current work unit: PR 3 / Work Unit 3 — SDK integration and final checks prep
- Target boundary: PR 3 targets `main` after PR #38 and PR #40 and includes only `packages/mcp/src/mcp.integration.test.ts` SDK approval coverage plus OpenSpec apply progress/task updates.
- Scope excluded from this PR: OpenSpec archive/spec sync, MercadoLibre mutation, sync execution, audit replay, rollback automation, `ProductSyncEngine`, `sync_all`, multi-product sync, and separate preview-only tool behavior.

## Completed Tasks

- [x] 1.1 Updated `packages/domain/src/approval.ts` so `ApprovalRecord` requires `executionStatus: "not-executed"` without changing `canExecutePreparedAction` semantics.
- [x] 1.2 Updated `packages/tools/src/index.ts` so `approvePreparedAction` writes `executionStatus: "not-executed"`; existing JSON serialization/deserialization preserves the marker without a SQL migration.
- [x] 1.3 Updated `packages/domain/src/domain.test.ts` approval fixtures to require the marker and preserve approval eligibility behavior.
- [x] 1.4 Updated `packages/tools/src/index.test.ts` SQLite approval tests to assert reopened approvals and raw `approval_json` retain the marker.
- [x] 2.1 Added `ApproveSyncProductProposalInput` and response/schema types in `packages/mcp/src/index.ts` for exact `actionId` plus `msl_api_key` only.
- [x] 2.2 Added `unavailableSyncProductApproval()` so missing, malformed, non-sync, expired, rejected, approved/finalized, and repository-error failures share one redacted unavailable response.
- [x] 2.3 Implemented local `approveSyncProductProposal()` logic that authenticates before lookup at the tool boundary, finds the exact action, reuses `isSupportedSyncProductProposal`, requires pending/unexpired state, saves approved queue state, and writes `saveApproval` with `executionStatus: "not-executed"`.
- [x] 2.4 Registered `approve_sync_product_proposal` and return sanitized approved metadata with `actionId: "redacted"`, `noMutationExecuted: true`, and no audit/execution/mutation response fields.
- [x] 2.5 Confirmed `packages/mcp/src/runtimeDependencies.ts` required no changes and adds no MercadoLibre, `ProductSyncEngine`, audit replay, `sync_all`, or execution dependency for approval recording.
- [x] 3.1 Updated MCP registration/schema assertions to include only `approve_sync_product_proposal`, not generic approval or preview-only tools.
- [x] 3.2 Added auth-before-lookup coverage proving invalid API keys skip repository lookup and do not enumerate records.
- [x] 3.3 Added pending sync approval coverage asserting `save` and `saveApproval` payloads preserve exact changes, risk, seller, timestamp, and non-executed status.
- [x] 3.4 Added table coverage for missing, blank, non-sync, expired, rejected, approved/finalized, and repository-error cases returning identical unavailable responses with no writes.
- [x] 3.5 Added forbidden-surface assertions proving no MercadoLibre mutation, audit replay, `ProductSyncEngine`, `sync_all`, multi-product sync, or rollback automation is called/imported.
- [x] 4.1 Updated `packages/mcp/src/mcp.integration.test.ts` to call `approve_sync_product_proposal` through the MCP SDK and assert approval recording succeeds without MercadoLibre mutation, audit replay, or execution surfaces.
- [x] 4.2 Ran affected MCP workspace tests and fixed no failures within this PR 3 scope.
- [x] 4.3 Ran TypeScript typecheck and confirmed modified contracts compile.

## Command Evidence

- `npm test -- packages/domain/src/domain.test.ts packages/tools/src/index.test.ts` — passed (44 tests).
- `npm run typecheck` — passed.
- `npm test -- packages/mcp/src/mcp.test.ts` — passed (87 tests).
- `npm run typecheck` — passed.
- `npm run format:check` — passed after formatting `packages/mcp/src/mcp.test.ts`.
- `npm test -- packages/mcp/src/mcp.integration.test.ts` — passed (19 tests).
- `npm test -- packages/mcp/src/mcp.test.ts packages/mcp/src/mcp.integration.test.ts` — passed (108 tests).
- `npm run typecheck` — passed.
- `npm run format:check` — passed.
- `npm run lint` — passed.

## Remaining Tasks

- None — all apply tasks are complete.

## Deviations from Design

None — implementation matches the PR 3 design boundary. The approved MCP response remains sanitized while the SDK test proves persisted approval state carries `executionStatus: "not-executed"` and does not touch audit/execution surfaces.

## Issues Found

None.
