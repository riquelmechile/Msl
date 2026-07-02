# Design: Operational Read Model Ingestion

## Technical Approach

Add a SQLite-backed operational read model inside `@msl/memory` reusing `better-sqlite3` + `getSharedDb()`. First slice: **listings only** — dual-write from background ingestion into both the operational store (canonical catalog facts) and Cortex (distilled signals). The factory `createSqliteOperationalReadModel(db)` implements the existing `OperationalReadModelReader`/`Writer` interfaces. Reads are local-first: fresh+complete+confident snapshots bypass ML API calls. Stale/partial evidence surfaces `refresh-required` instead of claiming truth.

## Architecture Decisions

| Choice | Alternatives | Rationale |
|--------|-------------|-----------|
| Store in `@msl/memory` as single table `operational_snapshots` | New `@msl/operational-store` package | Reuses existing `OperationalEvidence`/`ReadSnapshot` types, `getSharedDb` singleton, same Vitest infra — lowest PR size (~500-700 lines) |
| Dual-write: operational store first, Cortex second in `processSellerListings` | Migrate Cortex nodes to new store | Non-destructive; existing alert/trend/seasonal logic still reads Cortex. No migration risk |
| `evidence_id` = `orm:{kind}:{sellerId}:{itemId}:{capturedAt}` | UUID / hash | Deterministic, human-auditable, no collision risk across seller+item+time dimensions |
| Injected `Database.Database` handle via factory | Separate DB file per store | Matches singleton pool pattern — single WAL, single file descriptor |
| Checkpoint table `ingestion_checkpoints(seller_id, kind, last_captured_at)` | Inline query on `max(captured_at)` per kind | Explicit checkpoint avoids full-table scan; enables partial resume per seller/kind |

## Data Flow

```
backgroundIngestion.run()
  └─ processSellerListings(sellerId)
       ├─ mlcClient.getListings(sellerId) ──→ listings[]
       ├─ FOR each listing:
       │    ├─ store.upsertSnapshot(listing)  ← NEW: operational store
       │    └─ engine.getOrCreateNode(…)      ← existing: Cortex node
       └─ store.upsertCheckpoint(sellerId, "listing", now)

Lane reads (Plasticov/Maustian):
  store.findEvidence({sellerId, kind:"listing"}) → fresh? return local : refresh-required

CEO aggregate:
  store.queryBySeller([plasticovId, maustianId]) → per-lane freshness signals + evidence IDs
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/memory/src/operationalReadModel.ts` | Modify | Add `createSqliteOperationalReadModel(db)`, migration, and `SnapshotRow` type |
| `packages/memory/src/index.ts` | Modify | Export factory function |
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modify | Inject `OperationalReadModelWriter` in config; add dual-write calls to `processSellerListings` |
| `packages/memory/tests/operationalReadModel.test.ts` | Create | Store contract tests (upsert, read, freshness, lane isolation, checkpoint) |
| `packages/agent/tests/conversation/backgroundIngestion.test.ts` | Modify | Add listing dual-write assertions |

## Interfaces / Contracts (new)

```typescript
// Factory — injected into background ingestion config
export function createSqliteOperationalReadModel(
  db: Database.Database,
): OperationalReadModel;

// Internal row shape
type SnapshotRow = {
  seller_id: string; item_id: string; kind: string;
  data_json: string; source: string; captured_at: string;
  freshness: string; completeness: string; confidence: string;
  evidence_id: string;
};

// Checkpoint row
type CheckpointRow = {
  seller_id: string; kind: string;
  last_captured_at: string;
};

// BackgroundIngestionConfig extension
type BackgroundIngestionConfig = {
  // …existing fields…
  operationalStore?: OperationalReadModelWriter; // new, optional
};
```

## Schema (migration)

```sql
CREATE TABLE IF NOT EXISTS operational_snapshots (
  seller_id TEXT NOT NULL, item_id TEXT NOT NULL, kind TEXT NOT NULL,
  data_json TEXT NOT NULL, source TEXT NOT NULL, captured_at TEXT NOT NULL,
  freshness TEXT NOT NULL, completeness TEXT NOT NULL, confidence TEXT NOT NULL,
  evidence_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (seller_id, item_id, kind)
);

CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
  seller_id TEXT NOT NULL, kind TEXT NOT NULL,
  last_captured_at TEXT NOT NULL,
  PRIMARY KEY (seller_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_kind ON operational_snapshots(kind);
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (Vitest) | `createSqliteOperationalReadModel` — upsert/read/evidence-id/freshness/find by seller+kind | In-memory `better-sqlite3`, same pattern as `engine.test.ts` |
| Unit (Vitest) | Lane isolation: Plasticov read must not return Maustian data | Query scoped by `seller_id`, verify empty result cross-lane |
| Unit (Vitest) | Checkpoint resume: partial ingestion updates `last_captured_at` and next read starts after it | Insert checkpoint, upsert snapshots, verify time ordering |
| Integration (Vitest) | Dual-write via `processSellerListings`: operational store receives full listing, Cortex receives node | Mock `mlcClient`, inject `operationalStore`, assert both writes |
| Integration (Vitest) | Refresh-needed path: stale snapshot returns `refresh-required` decision | Insert expired snapshot, call `decideReadSnapshotFreshness` |

## First Slice Boundary (explicit)

**IN**: `operational_snapshots` table, listing-kind upsert in `processSellerListings`, checkpoint table, `createSqliteOperationalReadModel` factory, lane isolation tests, freshness decision integration.

**OUT**: orders, visits, quality, relist, seasonal, messages, claims, payments, SII, publishing, ML mutations, CEO aggregate summary generation, DeepSeek prefix shaping.

## Migration / Rollout

Additive migration — new tables only. Feature is inert until `operationalStore` is wired in `startBackgroundIngestion` config. Rollback: remove config wiring; tables can be dropped later. No existing data migration needed (Cortex remains untouched as dual-write).

## Open Questions

- [ ] Should CEO aggregate reads cache lane summaries in the store (e.g., `kind: "aggregate"` rows), or compute them on-demand from per-lane snapshots?
- [ ] Checkpoint granularity — per (seller, kind) or per (seller, kind, status)? The spec says "and filter status"; start with (seller, kind) to match first slice scope.
