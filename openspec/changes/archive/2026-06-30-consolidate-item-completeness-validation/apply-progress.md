# Apply Progress: Consolidate Item Completeness Validation

## Mode

Standard Mode. Strict TDD is not active (`openspec/config.yaml` has `strict_tdd: false` and `rules.apply.tdd: false`).

## Workload / PR Boundary

- Mode: single PR
- Current work unit: Share MLC item validation across MercadoLibre reads and MCP preview
- Boundary: based on `main`; one reviewable work unit covering shared validation export, MCP preview integration, focused tests, and verification
- Estimated review budget impact: low; implementation stayed within the forecasted 180-280 changed-line range

## Completed Tasks

- [x] 1.1 Exported `assertCompleteMlcItem(payload: unknown): MlItem` from `packages/mercadolibre/src/index.ts`.
- [x] 1.2 Routed `createMlcApiClient().getItem()` through `assertCompleteMlcItem()` after `/items/{id}`.
- [x] 1.3 Routed `createMlClient().getItem()` through `assertCompleteMlcItem()` instead of casting payloads.
- [x] 2.1 Imported `assertCompleteMlcItem` in `packages/mcp/src/index.ts` and removed `isCompletePreviewItem()`.
- [x] 2.2 Validated `syncPreview.getSourceItem()` output with `assertCompleteMlcItem()` inside the existing `source-read-failed` catch boundary.
- [x] 2.3 Made `isFiniteNumber` local to `packages/mcp/src/strategyValidation.ts`.
- [x] 3.1 Added direct `assertCompleteMlcItem()` normalization and rejection tests.
- [x] 3.2 Added item-read client coverage for helper-normalized direct reads and incomplete fetch-backed reads.
- [x] 3.3 Existing MCP unit coverage now exercises malformed injected evidence through the shared assertion and keeps redacted `source-read-failed` degradation.
- [x] 3.4 No new SDK integration test was needed because existing SDK coverage already exercises prepare-only response serialization and source-read-failed redaction.
- [x] 4.1 Preserved no-mutation/no-execution tool surface assertions.
- [x] 4.2 Ran targeted tests, typecheck, and format check.

## Verification Commands

| Command | Result |
|---------|--------|
| `npm test -- packages/mercadolibre/src/mercadolibre.test.ts packages/mcp/src/mcp.test.ts packages/mcp/src/mcp.integration.test.ts` | Passed: 3 files, 139 tests |
| `npm run typecheck` | Passed |
| `npm run format:check` | Passed |

## Deviations from Design

None — implementation matches design. `SyncPreviewDependency.getSourceItem()` now returns `unknown` so MCP can defensively validate injected preview evidence with the shared MercadoLibre boundary before strategy calculation.

## Issues Found

None.
