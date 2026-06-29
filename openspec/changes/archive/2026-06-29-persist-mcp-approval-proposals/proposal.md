# Proposal: Persist MCP Approval Proposals

## Intent

Make prepared MCP `sync_product` approval proposals survive process restarts without expanding the mutation surface. The current prepare-only flow is safety-correct but stores proposals in memory, so pending work disappears on restart and cannot be trusted as a durable approval queue.

## Scope

### In Scope
- Add a SQLite-backed `ApprovalQueueRepository` in `@msl/tools` with repository-contract coverage.
- Wire MCP runtime to use durable approval storage only when configured.
- Update `sync_product` metadata to disclose durable proposal storage when active while preserving prepare-only behavior.

### Out of Scope
- `ProductSyncEngine` execution, `sync_all`, approval/execution MCP tools, or sync preview calculation.
- Arbitrary seller IDs or unsupported Plasticov -> Maustian MLC direction changes.
- OAuth token, API key, client secret, or raw credential storage/leakage.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `action-approval-safety`: Allow persistent prepared product sync proposal storage while still forbidding execution, audit replay, and preview calculation.
- `custom-business-mcp-tools`: Extend prepare-only `sync_product` behavior to report durable proposal storage when configured.

## Approach

Implement the recommended SQLite repository behind the existing `ApprovalQueueRepository` boundary. Default MCP runtime remains in-memory; configured runtime opens the SQLite repository, exposes durability metadata, and closes the handle on shutdown. Store proposal payloads as JSON and timestamps as ISO strings, following existing `better-sqlite3` patterns.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/tools/src/index.ts` | Modified | Export SQLite-backed approval queue repository factory. |
| `packages/mcp/src/runtimeDependencies.ts` | Modified | Select durable repository when configured and close it safely. |
| `packages/mcp/src/index.ts` | Modified | Report persistent storage metadata without adding execution tools. |
| `packages/mcp/src/*.test.ts` | Modified | Cover durable metadata and no-mutation boundaries. |
| `packages/tools/src/*.test.ts` | Modified | Prove saved proposals survive repository reopen. |
| `openspec/specs/*` | Modified | Focused deltas for approval safety and MCP tool behavior. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Bad JSON/date restore breaks approval matching | Med | Contract tests for `expiresAt`, `requestedAt`, exact change, risk, and status after reopen. |
| Persistence is mistaken for execution enablement | Med | Specs/tests assert no `ProductSyncEngine`, execution MCP tools, `sync_all`, mutation, preview, or audit replay. |
| Secrets leak into persisted payloads or errors | Low | Persist proposal data only; keep MCP repository failures controlled and redacted. |

## Rollback Plan

Unset the approval queue DB configuration to return MCP runtime to in-memory storage, then revert the repository/wiring changes if needed. Existing prepared proposals remain non-executing and cannot mutate MercadoLibre state.

## Dependencies

- Existing `better-sqlite3` dependency and local SQLite patterns.
- Existing `ApprovalQueueRepository` contract in `@msl/tools`.

## Success Criteria

- [ ] A prepared `sync_product` proposal can be found after closing and reopening the SQLite repository.
- [ ] MCP defaults to in-memory storage unless durable storage is configured.
- [ ] MCP still exposes no approval/execution tools and performs no MercadoLibre mutations.
