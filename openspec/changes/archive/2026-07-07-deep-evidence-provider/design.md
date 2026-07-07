# Design: Deep Evidence Provider

## Technical Approach

Add `searchSnapshots()` to `OperationalReadModelReader` with composable SQL-level filters — dynamic WHERE clause building with parameterized values for table columns and `json_extract` for JSON-path filters. `OperationalEvidenceProvider` gains `getStructuredEvidenceForLane()` returning typed data arrays grouped by signal kind. Four daemons replace `listSnapshots()` + client-side filtering with `searchSnapshots()`.

## Architecture Decisions

### Decision: Dynamic SQL with parameterized values

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Static prepared statements per filter combo | Explosion of N! statement variants | ❌ Rejected |
| Dynamic `db.prepare(sql).all(...params)` | One statement per query shape; SQLite recompiles | ✅ Chosen |
| ORM/query builder | New dependency, breaks existing pattern | ❌ Rejected |

**Rationale**: SQLite handles dynamic SQL well. Each `db.prepare()` call is fast. No new deps. Follows existing `better-sqlite3` pattern already in this file.

### Decision: JSON extraction at SQL level

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `json_extract(data_json, '$.status')` in WHERE | SQL-level filtering, less data transferred | ✅ Chosen |
| Application-level post-filter | Simple but transfers all rows | ❌ Rejected |

**Rationale**: `json_extract` is natively supported by SQLite. Moving `status`, `categoryId`, `priceMin`/`priceMax` filters to SQL reduces data transfer — critical when daemons query 1000+ rows. Freshness remains post-query (same as existing `matchesFreshnessFilter`).

### Decision: `kind` accepts `string | string[]`

**Rationale**: Daemons query one kind (`'listing_snapshot'`). The evidence provider needs multi-kind (`['listing', 'order']`). Both clean via union type with internal normalization to array for `IN (?, ?...)` clause. Single-kind callers pass a plain string.

### Decision: Freshness stays post-query

**Rationale**: Freshness depends on three columns (`freshness`, `completeness`, `confidence`) — already a compound condition in `matchesFreshnessFilter()`. Pushing to SQL would duplicate logic. Reuse the existing helper.

## Data Flow

```
Daemon/Provider ──→ searchSnapshots(filter)
                        │
                        ▼
              buildSearchClauses(filter)
              ┌─────────────────────────┐
              │ WHERE seller_id = ?     │  ← param
              │   AND kind IN (?, ?)    │  ← params (multi)
              │   AND json_extract(...) │  ← params (JSON path)
              │   AND captured_at >= ?  │  ← param
              │ ORDER BY captured_at DESC
              │ LIMIT ?                 │  ← param
              └─────────────────────────┘
                        │
                        ▼
              db.prepare(sql).all(...params)
                        │
                        ▼
              postQueryFreshnessFilter(rows, freshness)
                        │
                        ▼
              map → SnapshotSearchResult<TData>[]
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/memory/src/operationalReadModel.ts` | Modify | Add `SearchSnapshotsFilter`, `SnapshotSearchResult` types; `searchSnapshots()` implementation; `idx_snapshots_captured_at` in migration; export new types from `index.ts` |
| `packages/agent/src/conversation/operationalEvidenceProvider.ts` | Modify | Add `getStructuredEvidenceForLane()` using `searchSnapshots()` |
| `packages/agent/src/workers/marketCatalogDaemon.ts` | Modify | Replace `listSnapshots()` with `searchSnapshots()`; drop client-side status filtering |
| `packages/agent/src/workers/operationsManagerDaemon.ts` | Modify | Replace `listSnapshots()` with `searchSnapshots()` |
| `packages/agent/src/workers/costSupplierDaemon.ts` | Modify | Replace `listSnapshots()` with `searchSnapshots()` |
| `packages/agent/src/workers/creativeCommercialDaemon.ts` | Modify | Replace `listSnapshots()` with `searchSnapshots()` |

## Interfaces / Contracts

```ts
// New types in operationalReadModel.ts
interface SearchSnapshotsFilter {
  sellerId: string;
  kind: string | string[];
  status?: string;
  categoryId?: string;
  itemId?: string;
  priceMin?: number;
  priceMax?: number;
  capturedAfter?: string;
  capturedBefore?: string;
  freshness?: 'fresh' | 'allow-stale';
  limit?: number; // default 100
}

interface SnapshotSearchResult<TData> {
  itemId: string;
  data: TData;
  capturedAt: string;
  freshness: string;
  evidenceId: string;
}

// New method on OperationalReadModelReader
searchSnapshots<TData>(filter: SearchSnapshotsFilter): Promise<SnapshotSearchResult<TData>[]>;
```

## Indexing Strategy

Add composite index in `migrateOperationalStore()`:

```sql
CREATE INDEX IF NOT EXISTS idx_snapshots_kind_captured
  ON operational_snapshots(kind, captured_at DESC);
```

Covers the dominant query pattern: filter by kind + order by recency + date range. Existing `idx_snapshots_kind` becomes redundant and can be dropped in a follow-up (not in scope).

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `buildSearchClauses()` SQL generation | Inline test passing filter → verify SQL string shape + param count |
| Integration | `searchSnapshots()` against in-memory SQLite | Seed snapshots with varied status/price/captured_at; assert filtered results |
| Integration | Daemon findings parity | Existing daemon tests; refactored daemon MUST produce same `DaemonFinding[]` as before |
| Integration | `getStructuredEvidenceForLane()` | Seed reader mock; verify grouped output shape |

## Migration / Rollout

No data migration. Index creation runs on next startup via `migrateOperationalStore()`. Rollback: revert daemons and reader — `listSnapshots()` and `getEvidenceForLane()` remain untouched.

## Open Questions

- [ ] `kind: string | string[]` vs `kind: string[]` — spec says `string[]`, daemon examples show `string`. Resolved: union type per decision above.
