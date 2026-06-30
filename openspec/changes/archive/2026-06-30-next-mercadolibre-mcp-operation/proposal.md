# Proposal: Read-Only Product Sync Proposal Inspection

## Intent

Operators can prepare durable `sync_product` proposals with preview evidence, but cannot inspect them after restart. Add a safe MCP status tool so prepared product-sync actions can be reviewed without approving, executing, or replaying anything.

## Scope

### In Scope
- Add a read-only MCP operation that accepts an exact action ID and returns sanitized status/metadata for stored `sync_product` proposals.
- Reuse durable approval storage and existing preview evidence when available.
- Report pending/approved/expired-style status without mutating proposal state.
- Preserve auth, anti-enumeration, redaction, and degradation metadata.

### Out of Scope
- Approval recording, execution, audit replay, mutation APIs, or `ProductSyncEngine` coupling.
- `sync_all`, multi-product sync, and separate preview-only tools.
- Generic browsing or listing by seller/account.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `custom-business-mcp-tools`: Add read-only stored `sync_product` proposal inspection/status behavior to the custom MCP tool surface.
- `action-approval-safety`: Allow non-mutating retrieval of stored product-sync proposals while preserving pending/no-execution safety boundaries.

## Approach

Add a scoped MCP tool that requires API-key auth, accepts one exact action ID, reads the approval repository, verifies a product-sync proposal, and returns only redacted status, expiry, risk, target, rationale, preview summary, and storage metadata. Unknown, unauthorized, expired, unsupported, or non-sync actions return controlled redacted responses.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mcp/src/index.ts` | Modified | Tool registration and response shaping. |
| `packages/mcp/src/runtimeDependencies.ts` | Modified | Approval repository read dependency. |
| `packages/tools/src/index.ts` | Modified | `findAction()` shape and sanitization boundaries. |
| `packages/mcp/src/mcp.test.ts` | Modified | Safety, redaction, no-execution regressions. |
| `packages/mcp/src/mcp.integration.test.ts` | Modified | SDK-level status behavior. |
| `openspec/specs/custom-business-mcp-tools/spec.md` | Modified | Read-only inspection requirements. |
| `openspec/specs/action-approval-safety/spec.md` | Modified | Non-mutating status retrieval requirements. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Enumeration or leakage through action IDs | Med | Require auth, exact IDs, generic not-found responses, redaction. |
| Accidental state mutation while calculating status | Low | Treat expiry/status as derived response data only. |
| Scope creep into approval/execution | Med | Specs and tests assert no approval tools, no mutation, no replay. |

## Rollback Plan

Remove the new MCP tool, tests, and delta specs. Existing `sync_product` preparation and durable storage remain unchanged.

## Dependencies

- Existing `findAction()` and durable `MSL_APPROVAL_QUEUE_DB_PATH` storage.
- Existing `sync_product` proposal and preview metadata shape.

## Success Criteria

- [ ] A stored `sync_product` proposal can be inspected by exact ID after restart when durable storage is configured.
- [ ] Responses never approve, execute, replay audits, expose secrets/DB paths, or call `ProductSyncEngine`.
- [ ] Non-sync, missing, expired, degraded-storage, and unauthorized cases return controlled redacted responses.
