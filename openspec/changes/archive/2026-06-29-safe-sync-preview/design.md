# Design: Safe Sync Preview

## Technical Approach

Add optional inline preview evidence to the existing `sync_product` prepare-only path in `packages/mcp/src/index.ts`. The implementation should validate the request exactly as today, compute preview evidence only through injected read-only item access plus pure strategy application, then save the same pending `listing-edit` prepared action. If preview dependencies, source reads, or strategies are unavailable, the proposal still succeeds with explicit preview-unavailable metadata. No MCP execution, approval, audit replay, bulk sync, mutation, credential persistence, or `ProductSyncEngine` import is introduced.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Preview surface | Attach `metadata.preview` and scalar preview entries in `exactChange` on existing `sync_product` responses. | New `preview_product_sync`; execution dry-run. | Keeps the MCP tool surface unchanged and preserves approval-required semantics. |
| Dependency boundary | Add a narrow optional preview dependency to `McpServerConfig`, backed by read-only `getItem` and strategy data. | Import `ProductSyncEngine`; use `MlClient` write-capable interface. | MCP must not couple to publish/update paths. A narrow contract is easier to audit. |
| Strategy reuse | Extract/use a pure preview helper around `applyStrategies` in `packages/mercadolibre/src/sync/strategyApplier.ts`. | Duplicate transformation logic in MCP. | Reuses current transformation order without bringing sync-engine mutation behavior into MCP. |
| Storage shape | Persist only non-sensitive scalar evidence in prepared `exactChange`; keep richer preview details response-only metadata. | Persist nested raw source/strategy/API payloads. | `ExactChange` supports only scalar values and durable storage must not contain credentials/raw API errors. |

## Data Flow

```text
MCP sync_product request
  -> existing auth/scope/risk/expiry/direction validation
  -> optional preview dependency: get source item + strategies
  -> applyStrategies preview helper (pure, no publish)
  -> createPreparedActionTool.save(pending listing-edit)
  -> response metadata includes approval + preview status + noMutationExecuted
```

Unavailable preview path:

```text
preview dependency/read/strategy missing or failed
  -> no raw error returned or saved
  -> save pending proposal with preview.status = "unavailable"
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/mcp/src/index.ts` | Modify | Add preview contract types, optional preview calculation in `sync_product`, response metadata, scalar exact-change evidence, and tests guards against `ProductSyncEngine`. |
| `packages/mcp/src/runtimeDependencies.ts` | Modify | Wire optional read-only preview dependencies only when OAuth read runtime and account roles are configured. |
| `packages/mercadolibre/src/index.ts` | Modify | Add `getItem(sellerId, itemId)` to the read-only `MlcApiClient` path using GET `/items/{itemId}` and safe normalization. |
| `packages/mercadolibre/src/sync/strategyApplier.ts` | Modify | Expose a pure preview helper that maps `applyStrategies` output to field-change evidence. |
| `packages/mcp/src/mcp.test.ts` | Modify | Update no-preview regression to allow only inline safe preview shape and keep no-mutation/no-tool-surface assertions. |
| `packages/mcp/src/mcp.integration.test.ts` | Modify | Verify SDK response metadata, degraded preview, no mutation tools, and redaction. |
| `packages/mercadolibre/src/sync/sync.test.ts` | Modify | Cover preview helper field-change and category-excluded behavior. |

## Interfaces / Contracts

```ts
type SyncProductPreview =
  | { status: "available"; fieldChanges: ExactChange[]; evidenceSource: "read-only-item" }
  | { status: "unavailable"; reason: "missing-preview-dependency" | "source-read-failed" | "strategy-unavailable" };

type SyncPreviewDependency = {
  getSourceItem(sellerId: string, itemId: string): Promise<MlItem>;
  getStrategies(): Promise<Strategy[]>;
};
```

Response metadata MUST keep `approvalStatus: "pending"`, `requiresApproval: true`, `noMutationExecuted: true`, `auditReplay: "not-available"`, and include `preview.status`. Stored `exactChange` MAY include scalar fields such as `preview.price`, `preview.available_quantity`, and `preview.status`; it MUST NOT store raw item payloads, tokens, database paths, or raw API errors.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Preview helper emits scalar field changes and handles category exclusion. | Vitest in `packages/mercadolibre/src/sync/sync.test.ts`. |
| Unit | `sync_product` available/degraded preview paths preserve pending/no-mutation metadata. | Mock preview dependency in `packages/mcp/src/mcp.test.ts`. |
| Integration | MCP SDK response exposes only existing tools and safe inline preview metadata. | `packages/mcp/src/mcp.integration.test.ts`. |

## Migration / Rollout

No migration required. Existing stored proposals remain valid. Roll out as one reviewable first slice; expected scope should stay under the 400-line budget if limited to contracts, helper, wiring, and focused tests.

## Open Questions

- [ ] Where should production strategy data come from? The current MCP `list_strategies` stub returns an empty list, so initial runtime may legitimately report preview unavailable until a strategy source is injected.
