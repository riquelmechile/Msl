# Proposal: Deep Evidence Provider

## Intent

Agents and daemons can only fetch evidence IDs from `OperationalEvidenceProvider` — not actual data. `listSnapshots()` has minimal filtering (sellerId, kind, limit) and all deeper filters happen client-side inside each daemon. Agents asking "Dame publicaciones activas de Plasticov con baja visita" or "Dame reclamos abiertos capturados en las últimas 2 horas" cannot get structured answers without ad-hoc code.

## Scope

### In Scope
- `searchSnapshots()`: new reader method with rich filters (sellerId, kind[], status, categoryId, itemId, capturedAfter/Before, freshness, limit)
- `OperationalEvidenceProvider`: return structured evidence (`{ data, evidence }[]`) alongside legacy ID-only lines
- Refactor 4 daemons to use `searchSnapshots()`, eliminating repeated client-side filtering

### Out of Scope
- New snapshot kinds or data sources
- Consensus reviews (PR 5)
- Process separation (PR 7)
- Natural-language query parsing

## Capabilities

### New Capabilities
- `deep-evidence-query`: Rich-filter snapshot search with structured results and SQL-level filtering

### Modified Capabilities
- `operational-lane-evidence`: Provider returns structured evidence data, not just compact ID lines
- `specialist-daemons`: Daemons use `searchSnapshots()` instead of `listSnapshots()` + manual filtering

## Approach

Add `searchSnapshots()` with SQLite dynamic WHERE for table-column filters (sellerId, kind[], capturedAt, itemId, freshness) + typed post-query filtering for `data_json` fields (status, price). Generic `<TData>` return. `OperationalEvidenceProvider` gains `getStructuredEvidenceForLane()` returning arrays with parsed data; `getEvidenceForLane()` stays backward-compatible. Daemons replace `listSnapshots() + manual filter` with `searchSnapshots()`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/memory/src/operationalReadModel.ts` | Modified | Add `searchSnapshots()` with dynamic WHERE |
| `packages/agent/src/conversation/operationalEvidenceProvider.ts` | Modified | Add structured evidence return path |
| `packages/agent/src/workers/marketCatalogDaemon.ts` | Modified | Use `searchSnapshots()` |
| `packages/agent/src/workers/operationsManagerDaemon.ts` | Modified | Use `searchSnapshots()` |
| `packages/agent/src/workers/costSupplierDaemon.ts` | Modified | Use `searchSnapshots()` |
| `packages/agent/src/workers/creativeCommercialDaemon.ts` | Modified | Use `searchSnapshots()` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Dynamic SQL breaks prepared-statement perf | Low | SQLite handles dynamic WHERE; benchmark with 10k rows |
| Structured return breaks existing prompt templates | Medium | New method, no signature change to existing `getEvidenceForLane()` |
| Daemon behavior regression | Low | Daemon tests verify same findings via new API |

## Rollback Plan

1. Revert `operationalReadModel.ts` — remove `searchSnapshots()`
2. Revert daemons to prior `listSnapshots()` + manual filter
3. Remove `getStructuredEvidenceForLane()`; existing `getEvidenceForLane()` untouched

## Dependencies

- `@msl/memory` exports `OperationalReadModelReader` (already exists)
- `@msl/domain` types: `BusinessSignalKind`, `SellerId`, `OperationalEvidence` (unchanged)

## Success Criteria

- [ ] `searchSnapshots()` returns filtered results for multi-kind, date-range, freshness, and status queries
- [ ] Daemon findings are identical before and after refactor
- [ ] `getEvidenceForLane()` backward-compatible — same output format
- [ ] Existing tests pass with no changes to test assertions
