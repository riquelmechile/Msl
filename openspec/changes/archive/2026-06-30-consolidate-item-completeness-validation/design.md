# Design: Consolidate Item Completeness Validation

## Technical Approach

Promote the current private MercadoLibre `normalizeItem()` runtime boundary into an exported, MercadoLibre-owned assertion/normalizer and reuse it from both `getItem()` and MCP `sync_product` preview. MCP remains prepare-only: it reads source evidence through injected preview dependencies, validates the returned unknown/item payload with the shared boundary, maps failures to `source-read-failed`, and redacts all validation details.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Export `assertCompleteMlcItem(payload: unknown): MlItem` from `packages/mercadolibre/src/index.ts` | Keeps the boundary close to existing helper functions and package exports; adds a small public API. | Chosen. `getItem()` calls this helper after `/items/{id}` and MCP imports it instead of duplicating completeness logic. |
| Add helper to `types.ts` | Mixes runtime validation into a type-only module. | Rejected to preserve current `types.ts` as shape definitions. |
| Keep MCP predicate private | Avoids new export but keeps duplicated business validation and drift risk. | Rejected by proposal/specs. |
| Use `ProductSyncEngine` for preview | Reuses sync internals but couples MCP preview to execution-oriented code. | Rejected to preserve prepare-only boundaries and existing MCP source check. |

## Data Flow

```text
MercadoLibre transport ── unknown payload ──> assertCompleteMlcItem ──> MlItem
                                           │
getItem() <───────────────────────────────┘

sync_product ──> syncPreview.getSourceItem ──> assertCompleteMlcItem
      │                                      ├─ success: previewStrategyChanges
      │                                      └─ failure: preview unavailable/source-read-failed
      └─ createPreparedActionTool ──> pending proposal only
```

No mutation path, approval execution tool, audit replay, sync-engine import, or separate preview tool is introduced.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/index.ts` | Modify | Rename/export the existing item normalizer as `assertCompleteMlcItem(payload: unknown): MlItem`; keep `getItem()` composed through it. |
| `packages/mcp/src/index.ts` | Modify | Import `assertCompleteMlcItem`; remove `isCompletePreviewItem`; validate preview source evidence inside the existing `try`/degrade flow; keep `source-read-failed` redacted. |
| `packages/mcp/src/strategyValidation.ts` | Modify | Stop exporting `isFiniteNumber` if no external caller remains; keep `areStrategies()` unchanged for strategy config validation. |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Modify | Add direct helper tests for complete normalization and incomplete rejection; keep `getItem()` incomplete-payload test. |
| `packages/mcp/src/mcp.test.ts` | Modify | Update incomplete-source preview coverage to prove shared validation rejects malformed injected evidence and redacts details. |
| `packages/mcp/src/mcp.integration.test.ts` | Modify | Add/adjust SDK-level degraded preview coverage for incomplete evidence if needed. |

## Interfaces / Contracts

```ts
export function assertCompleteMlcItem(payload: unknown): MlItem;
```

Contract: accepts unknown payloads, requires `id` to be a normalized MLC item ID, requires non-empty `title` and `category_id`, finite `price`, `available_quantity`, and `seller_id`, and status in `active | paused | closed`. It returns a normalized `MlItem` with filtered `pictures` and `attributes`; it throws on incomplete payloads and never invents required business fields.

MCP contract: any thrown validation/source-read error becomes `{ status: "unavailable", reason: "source-read-failed" }` without exposing messages, stack traces, item payloads, tokens, or DB paths.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Shared assertion success/failure and `getItem()` composition | Vitest in `packages/mercadolibre/src/mercadolibre.test.ts` with raw complete/incomplete payloads and transport mocks. |
| Unit | MCP preview degradation and no duplicate predicate | Vitest in `packages/mcp/src/mcp.test.ts`; assert pending proposal, `source-read-failed`, no raw detail leakage, no `ProductSyncEngine`/`preview_product_sync`. |
| Integration | MCP SDK response remains prepare-only | Existing `mcp.integration.test.ts` path for `sync_product`; add incomplete evidence case only if unit coverage is insufficient. |

## Migration / Rollout

No migration required. This is a runtime validation/API consolidation with unchanged storage schema and unchanged MCP tool surface.

## Open Questions

None.
