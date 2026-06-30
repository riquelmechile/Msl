# Proposal: Record sync_product Approval

## Intent

Add the next safe MCP slice for `sync_product`: record seller approval for one exact existing prepared proposal without MercadoLibre mutations. This closes the approval-state gap while preserving the prepare/status-only boundary.

## Scope

### In Scope
- Add a narrow MCP approval-recording operation for exact stored `sync_product` proposal IDs.
- Authenticate before repository lookup, validate sync-only supported proposal shape, and record approval only for pending unexpired proposals.
- Return sanitized metadata proving no execution, audit replay, `ProductSyncEngine`, `sync_all`, or multi-product behavior occurred.

### Out of Scope
- MercadoLibre mutations, sync execution, audit replay, rollback automation, or ProductSyncEngine wiring.
- Generic prepared-action approval through MCP or approval of non-`sync_product` proposals.
- New multi-product, `sync_all`, or separate preview-only tool behavior.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `custom-business-mcp-tools`: add sync-only approval recording for stored `sync_product` proposals.
- `action-approval-safety`: allow approval-state recording without execution or audit replay.

## Approach

Implement a local MCP helper/tool, e.g. `approve_sync_product_proposal`, accepting one action ID. It authenticates first, loads the exact record, reuses the status tool's `sync_product` support predicate, blocks/redacts missing, unsupported, expired, or finalized proposals, saves only approval state plus a matching `ApprovalRecord`, and returns sanitized metadata with `noMutationExecuted: true`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mcp/src/index.ts` | Modified | Tool registration, validation, redaction, no-execution boundary. |
| `packages/mcp/src/runtimeDependencies.ts` | Modified | Approval ID/clock dependency if needed. |
| `packages/mcp/src/mcp.test.ts` | Modified | Auth-before-lookup, pending-only recording, redaction, no mutation calls. |
| `packages/mcp/src/mcp.integration.test.ts` | Modified | SDK-level approval recording without execution. |
| `openspec/specs/custom-business-mcp-tools/spec.md` | Modified | MCP operation delta. |
| `openspec/specs/action-approval-safety/spec.md` | Modified | Record-only approval delta. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Approval leaks enumeration or sensitive data | Med | Use shared redacted unavailable responses and sanitized metadata. |
| Generic helper approves unsupported actions | Med | Prevalidate exact sync shape before writes; avoid broad MCP exposure. |
| Approval triggers execution/audit behavior | Low | Tests assert no ML clients, audit replay, ProductSyncEngine, `sync_all`, or multi-product calls/imports. |

## Rollback Plan

Remove the new MCP tool/handler, tests, and delta specs. Existing `sync_product` prepare-only and `read_sync_product_status` behavior remains unchanged.

## Dependencies

- Approval repository methods and `ApprovalRecord` invariants.
- Stored `sync_product` proposal shape and status support predicate.

## Success Criteria

- [ ] Only authenticated exact pending unexpired `sync_product` proposals can be approved.
- [ ] Missing, unsupported, expired, rejected, or finalized records return controlled redacted responses.
- [ ] Tests prove approval recording writes no MercadoLibre mutation, execution, audit replay, ProductSyncEngine, `sync_all`, or multi-product behavior.
