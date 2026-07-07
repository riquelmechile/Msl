# Tasks: Deep Evidence Provider

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 500–700 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR (within 800-line custom budget) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Medium

## Phase 1: searchSnapshots() — Foundation

- [x] 1.1 Add `SearchSnapshotsFilter` and `SnapshotSearchResult<TData>` types in `packages/memory/src/operationalReadModel.ts`
- [x] 1.2 Add `searchSnapshots<TData>(filter)` to `OperationalReadModelReader` interface
- [x] 1.3 Add `CREATE INDEX idx_snapshots_kind_captured ON operational_snapshots(kind, captured_at DESC)` in `migrateOperationalStore()`
- [x] 1.4 Implement `buildSearchClauses()` — dynamic WHERE for sellerId, kind[], itemId, capturedAfter/Before, and `json_extract` on status, categoryId, price range
- [x] 1.5 Implement `searchSnapshots()` — `db.prepare(sql).all(...params)`, post-query freshness filter, map to results
- [x] 1.6 Export new types from `packages/memory/src/index.ts`

## Phase 2: Structured Evidence Provider

- [x] 2.1 Add `getStructuredEvidenceForLane(laneId, sellerId)` in `operationalEvidenceProvider.ts` — resolve lane contract, call `searchSnapshots()` multi-kind, return typed arrays with data + metadata
- [x] 2.2 Verify `getEvidenceForLane()` backward-compatible — same signature, same string output

## Phase 3: Daemon Refactoring (line-reducing)

- [x] 3.1 `marketCatalogDaemon.ts` — replace `listSnapshots()` with `searchSnapshots({ kind: ["listing_snapshot"], limit: 1000 })`; drop client-side status loops
- [x] 3.2 `operationsManagerDaemon.ts` — replace listSnapshots for claim/question/order snapshots with searchSnapshots; push status + date-range to SQL
- [x] 3.3 `costSupplierDaemon.ts` — replace `listSnapshots` + `filter(status)` with `searchSnapshots({ status: "active" })`
- [x] 3.4 `creativeCommercialDaemon.ts` — replace `listSnapshots(status: "active")` with `searchSnapshots({ status: "active" })`

## Phase 4: Tests

- [x] 4.1 Unit: `buildSearchClauses()` SQL shape + param count for single/multi-kind, status, price range, date range, itemId, combined, no-filter (in `operationalReadModel.test.ts`)
- [x] 4.2 Integration: `searchSnapshots()` — seed SQLite; verify multi-kind+date, status+price, freshness exclusion, default limit=100, empty results
- [x] 4.3 Unit: `getStructuredEvidenceForLane()` — mock reader; verify structured output preserves data + metadata; unknown lane returns empty array
- [x] 4.4 Parity: all 4 daemons produce identical `DaemonFinding[]` (kind, severity, evidenceIds) with shared seed data

## Phase 5: Gate

- [x] 5.1 `npm run typecheck` — zero errors
- [x] 5.2 `npm run lint` — zero warnings on changed files
- [x] 5.3 `npm test` — all tests pass
- [x] 5.4 Manual spot-check: daemon findings parity on at least 1 seller with real data
