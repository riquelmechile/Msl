# Proposal: Wire MercadoLibre MCP Business Operations

## Intent

Replace the fake-success MCP `sync_product` stub with a prepare-only Plasticov -> Maustian product sync proposal. The change creates auditable approval work without executing MercadoLibre mutations.

## Scope

### In Scope
- Convert MCP `sync_product` into an approval-required prepared action for a single product/listing sync intent.
- Validate API-key auth, configured account direction, target, rationale, risk, expiry, and `requiresApproval: true` metadata.
- Test proposal creation, controlled blocked responses, and no sync execution.

### Out of Scope
- `ProductSyncEngine` calls or MercadoLibre writes.
- `sync_all`, raw write APIs, persistent approval storage, audit replay, or sync preview calculation.
- Supporting reversed Maustian -> Plasticov or arbitrary seller-pair syncs.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `custom-business-mcp-tools`: `sync_product` changes from stubbed success to project-owned prepare-only business-operation proposal.
- `action-approval-safety`: sync-like MCP operations must remain pending prepared actions and block execution without an approved future slice.
- `mercadolibre-account-integration`: MCP sync preparation must enforce configured MLC source/target seller roles and reject unsafe directions or mismatches.

## Approach

Use the existing MCP runtime and prepared-action boundary. `sync_product` will validate input and account roles, create a prepared action through the current approval repository, and return proposal metadata. It must not import or call `ProductSyncEngine`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mcp/src/index.ts` | Modified | Replace stub response with prepare-only `sync_product` behavior. |
| `packages/mcp/src/runtimeDependencies.ts` | Modified | Ensure dependencies support the approval repository without sync executor wiring. |
| `packages/tools/src/index.ts` | Modified | Reuse prepared-action helpers and kinds for sync proposal creation. |
| `packages/mercadolibre/src/accountRoles.ts` | Modified | Enforce Plasticov -> Maustian role direction for MCP sync preparation. |
| `openspec/changes/wire-mercadolibre-mcp-business-operations/specs/` | New | Delta specs for modified capabilities. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Existing action kind is imprecise for product sync | Med | Use the closest current kind; defer a dedicated kind. |
| In-memory approval proposals disappear on restart | Med | Disclose limitation; defer persistence explicitly. |
| Accidental mutation execution | Low | Tests assert no `ProductSyncEngine` wiring and `requiresApproval: true`. |

## Rollback Plan

Revert the `sync_product` MCP wiring and tests to the previous stub. No external MercadoLibre state or persistent approval data should require migration because this slice performs no mutations.

## Dependencies

- Existing MCP API-key auth, account-role configuration, and prepared-action approval repository.

## Success Criteria

- [ ] `sync_product` returns an approval-required prepared proposal instead of fake success.
- [ ] Unsafe auth, account direction, seller mismatch, or missing target produces controlled blocked responses.
- [ ] No `ProductSyncEngine`, `sync_all`, persistent storage, or MercadoLibre mutation execution is introduced.
