# Tasks: Consolidate Item Completeness Validation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 180-280 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | automatic PR forecasting |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Share MLC item validation across MercadoLibre reads and MCP preview | PR 1 | Base main; include unit tests and optional SDK coverage |

## Phase 1: MercadoLibre Boundary

- [x] 1.1 In `packages/mercadolibre/src/index.ts`, rename/export `normalizeItem()` as `assertCompleteMlcItem(payload: unknown): MlItem`.
- [x] 1.2 In `packages/mercadolibre/src/index.ts`, route `createMlcApiClient().getItem()` through `assertCompleteMlcItem()` after `/items/{id}`.
- [x] 1.3 In `packages/mercadolibre/src/index.ts`, route `createMlClient().getItem()` through `assertCompleteMlcItem()` instead of casting payloads.

## Phase 2: MCP Preview Integration

- [x] 2.1 In `packages/mcp/src/index.ts`, import `assertCompleteMlcItem` from `@msl/mercadolibre` and remove local `isCompletePreviewItem()`.
- [x] 2.2 In `packages/mcp/src/index.ts`, validate `syncPreview.getSourceItem()` output with `assertCompleteMlcItem()` inside the existing `source-read-failed` try/catch.
- [x] 2.3 In `packages/mcp/src/strategyValidation.ts`, stop exporting `isFiniteNumber` if only local strategy validation still uses it.

## Phase 3: Tests

- [x] 3.1 In `packages/mercadolibre/src/mercadolibre.test.ts`, add direct tests that `assertCompleteMlcItem()` normalizes complete raw payloads and rejects missing required fields without defaults.
- [x] 3.2 In `packages/mercadolibre/src/mercadolibre.test.ts`, assert both item-read clients return helper-normalized `MlItem` values and reject incomplete payloads.
- [x] 3.3 In `packages/mcp/src/mcp.test.ts`, update incomplete source preview tests to prove malformed injected evidence degrades to `source-read-failed` with no raw detail leakage.
- [x] 3.4 In `packages/mcp/src/mcp.integration.test.ts`, add SDK-level incomplete evidence coverage only if unit coverage does not exercise prepare-only response serialization. Unit and existing SDK coverage were sufficient, so no integration change was needed.

## Phase 4: Safety Verification

- [x] 4.1 In `packages/mcp/src/mcp.test.ts`, keep assertions that no `ProductSyncEngine`, `preview_product_sync`, approval execution, `sync_all`, or mutation tool appears.
- [x] 4.2 Run `npm test` and targeted package tests for MercadoLibre and MCP before SDD verify.
