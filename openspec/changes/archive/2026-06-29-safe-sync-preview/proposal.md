# Proposal: Safe Sync Preview

## Intent

Add read-only preview evidence to the existing MCP `sync_product` prepared proposal so sellers can understand proposed field changes before approval, while preserving the current prepare-only boundary and preventing any MercadoLibre mutation.

## Scope

### In Scope
- Return inline, optional preview metadata/evidence on valid `sync_product` prepared proposals.
- Store non-sensitive preview evidence with the prepared action exact changes when available.
- Preserve `approvalStatus: "pending"`, `requiresApproval: true`, `noMutationExecuted: true`, durability metadata, and controlled degraded behavior.
- Use only narrow read-only item access and pure strategy application for preview calculation.

### Out of Scope
- New `preview_product_sync`, approval, execution, audit replay, or `sync_all` MCP tools.
- Importing or instantiating `ProductSyncEngine` from MCP.
- Publishing, updating, approving, auditing, or claiming completed sync work.
- Persisting credentials, database paths, raw API errors, or OAuth material.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `custom-business-mcp-tools`: Allow `sync_product` to include safe read-only preview metadata while remaining prepare-only.
- `action-approval-safety`: Permit non-mutating product sync preview evidence without execution, audit replay, or credential persistence.
- `ml-api-integration`: Clarify that MCP preview calculation is not sync-engine execution and must not import `ProductSyncEngine`.

## Approach

Implement the exploration recommendation: enrich the existing `sync_product` proposal response with optional preview evidence computed through injected read-only item access and pure strategy application. If source reads or strategies are unavailable, return a degraded pending proposal with explicit preview-unavailable metadata. Keep all mutation and approval execution paths absent.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mcp/src/index.ts` | Modified | Attach preview metadata to existing prepare-only response. |
| `packages/mcp/src/runtimeDependencies.ts` | Modified | Inject a narrow read-only preview dependency if needed. |
| `packages/mercadolibre/src/sync/strategyApplier.ts` | Modified | Reuse or expose pure preview-friendly strategy application. |
| `packages/mercadolibre/src/index.ts` | Modified | Add narrow read-only single-item access if required. |
| `packages/mcp/src/mcp.test.ts` | Modified | Update no-preview regression to allow only the safe inline shape. |
| `packages/mcp/src/mcp.integration.test.ts` | Modified | Preserve no-mutation and tool-surface assertions. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Preview mistaken for approval readiness | Med | Include pending approval and no-mutation flags in response metadata. |
| MCP gains execution coupling | Med | Forbid `ProductSyncEngine` import and publish/update calls. |
| Sensitive data leaks into storage | Low | Redact credentials, database paths, and raw API errors before save. |

## Rollback Plan

Revert this proposal's future spec deltas and implementation changes. Existing `sync_product` behavior returns pending prepared proposals without preview metadata; no persisted mutation or audit state requires migration.

## Dependencies

- Existing durable approval storage and prepared action flow.
- Narrow read-only MercadoLibre item access if live preview is implemented.

## Success Criteria

- [ ] Valid `sync_product` responses may include preview evidence and still report no mutation.
- [ ] MCP exposes no new preview, approval, execution, audit replay, or bulk sync tools.
- [ ] Tests prove `ProductSyncEngine`, `publishItem`, and credential persistence are not used by MCP preview.
