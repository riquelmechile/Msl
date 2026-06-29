# Tasks: Safe Sync Preview

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 300-390 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR with work-unit commits |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Preview contracts and pure helper | PR 1 | Include `strategyApplier` tests. |
| 2 | MCP inline preview wiring | PR 1 | Include degraded-path and no-surface tests. |

## Phase 1: Foundation

- [x] 1.1 Add `getItem(sellerId, itemId)` to `MlcApiClient` in `packages/mercadolibre/src/index.ts` using read-only GET `/items/{itemId}` normalization.
- [x] 1.2 Export a pure preview helper from `packages/mercadolibre/src/sync/strategyApplier.ts` that maps `applyStrategies` results to scalar field-change evidence.
- [x] 1.3 Add `SyncProductPreview` and optional narrow `SyncPreviewDependency` types in `packages/mcp/src/index.ts`; do not import `ProductSyncEngine`.

## Phase 2: MCP Wiring

- [x] 2.1 Extend `McpServerConfig` in `packages/mcp/src/index.ts` with optional preview dependency injection for read-only source item access and strategy provider.
- [x] 2.2 Update `sync_product` in `packages/mcp/src/index.ts` to attach `metadata.preview` and scalar `exactChange` entries while preserving pending approval and no-mutation metadata.
- [x] 2.3 Implement degraded preview in `packages/mcp/src/index.ts` for missing dependency, failed source read, or absent strategy source; redact raw errors.
- [x] 2.4 Wire `packages/mcp/src/runtimeDependencies.ts` to inject preview only when read runtime, account roles, and a narrow strategy provider are available; otherwise omit it.

## Phase 3: Tests

- [x] 3.1 Add `packages/mercadolibre/src/sync/sync.test.ts` coverage for preview field changes and category-excluded unavailable evidence.
- [x] 3.2 Update `packages/mcp/src/mcp.test.ts` for available preview, degraded preview, pending approval, `requiresApproval`, and `noMutationExecuted`.
- [x] 3.3 Update `packages/mcp/src/mcp.integration.test.ts` to assert unchanged tool surface, no `preview_product_sync`, no execution tools, and no raw sensitive metadata.
- [x] 3.4 Add regression assertions that MCP preview does not call `publishItem`, `updateItem`, `changeItemStatus`, or import `ProductSyncEngine`.

## Phase 4: Verification

- [x] 4.1 Run `npm test -- packages/mercadolibre/src/sync/sync.test.ts packages/mcp/src/mcp.test.ts packages/mcp/src/mcp.integration.test.ts`.
- [x] 4.2 Run `npm run typecheck` and confirm `openspec/changes/safe-sync-preview/tasks.md` remains the only SDD artifact changed during planning.
