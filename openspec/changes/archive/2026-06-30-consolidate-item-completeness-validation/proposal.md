# Proposal: Consolidate Item Completeness Validation

## Intent

Centralize MercadoLibre item completeness validation so `@msl/mercadolibre` owns item payload correctness and MCP sync preview consumes the same boundary defensively. This prevents drift between production `getItem()` normalization and preview-only injected dependencies while preserving prepare-only safety.

## Scope

### In Scope
- Export a MercadoLibre-owned assertion/normalizer for complete MLC item payloads.
- Compose `getItem()` through the shared assertion/normalizer.
- Replace MCP duplicate preview completeness checks with defensive shared validation.
- Map validation failures to existing degraded `source-read-failed` preview behavior.

### Out of Scope
- Sync execution, audit replay, or mutation behavior.
- Importing or coupling MCP preview to `ProductSyncEngine`.
- New preview tools, bulk sync, or approval execution surface changes.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `ml-api-integration`: Item reads must use shared runtime completeness validation for MLC item payloads.
- `custom-business-mcp-tools`: `sync_product` preview must treat incomplete source items as unavailable source evidence without execution.
- `action-approval-safety`: Product sync preview safety must remain pending, read-only, and degraded on validation failure.

## Approach

Add an exported `@msl/mercadolibre` assertion/normalizer that accepts unknown MercadoLibre item payloads and returns `MlItem` only when required fields are complete. Use it inside `getItem()` and in MCP sync preview before strategy calculation. MCP catches validation failures, redacts details, and returns the existing degraded preview reason.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/index.ts` | Modified | Export shared item assertion/normalizer and compose `getItem()` through it. |
| `packages/mercadolibre/src/types.ts` | Modified | Preserve `MlItem` shape; expose helper types only if needed. |
| `packages/mcp/src/index.ts` | Modified | Remove duplicate completeness predicate; map validator failures to degraded preview. |
| `packages/*/src/*.test.ts` | Modified | Cover shared validation and prepare-only degraded preview behavior. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Public helper becomes over-generic API | Med | Name it specifically around MercadoLibre/MLC item payload completeness. |
| MCP leaks validation internals | Low | Catch and map to `source-read-failed` with redacted metadata. |
| Runtime checks weaken while sharing logic | Low | Test raw payloads and typed injected dependency objects. |

## Rollback Plan

Revert the exported helper and MCP import, restore the private MCP completeness predicate, and keep `getItem()` using its prior private normalization.

## Dependencies

- Existing `MlItem`, `getItem()`, and `sync_product` preview behavior.

## Success Criteria

- [ ] `getItem()` and MCP preview use one MercadoLibre-owned completeness boundary.
- [ ] Incomplete preview source items degrade as `source-read-failed` without mutation.
- [ ] No sync-engine import, audit replay, new preview tool, or approval execution surface is added.
