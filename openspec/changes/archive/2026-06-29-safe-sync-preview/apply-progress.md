# Apply Progress: Safe Sync Preview

## Mode

Standard.

## Completed Tasks

- [x] 1.1 Add read-only `MlcApiClient.getItem` normalization.
- [x] 1.2 Add pure `previewStrategyChanges` helper with scalar evidence.
- [x] 1.3 Add MCP preview contracts without sync-engine coupling.
- [x] 2.1-2.4 Wire optional inline preview and degraded metadata.
- [x] 3.1-3.4 Add focused unit and integration regression coverage.
- [x] 4.1-4.2 Run targeted tests and typecheck.

## Verification

- `npm test -- packages/mercadolibre/src/sync/sync.test.ts packages/mcp/src/mcp.test.ts packages/mcp/src/mcp.integration.test.ts` — passed, 125 tests.
- `npm run typecheck` — passed.

## Notes

- Runtime preview injection is enabled only when OAuth read runtime, account roles, and `MSL_SYNC_PREVIEW_STRATEGIES_JSON` strategy provider are present; otherwise `sync_product` returns degraded preview metadata.
- Stored preview evidence is limited to scalar `ExactChange` entries.
