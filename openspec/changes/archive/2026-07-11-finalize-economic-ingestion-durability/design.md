# Design: Finalize Economic Ingestion Durability

## 1. Architecture Overview

```
RunIdFactory ──→ Pipeline ──→ EvidenceStore (new)
                     │
          ┌──────────┼──────────┐
          │          │          │
     OutcomeStore  RunStore  EvidenceStore
          │          │          │
          └──────────┼──────────┘
                     │
              db.transaction()
              (atomic boundary)
```

All stores share one `better-sqlite3` connection (`getSharedDb()`). Final writes are wrapped in `db.transaction(() => { ... })` for atomicity.

## 2. RunIdFactory & Evidence IDs

**Decision: UUID-based for both run and evidence IDs**

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Sequential counter | Collision on restart; untestable | Reject |
| UUID (`crypto.randomUUID()`) | Slight entropy cost | **Accept** |

```typescript
// packages/domain/src/runIdFactory.ts
interface RunIdFactory {
  createRunId(): string;   // "economic-ingestion-{uuid}"
}
class CryptoRunIdFactory implements RunIdFactory { ... }
class DeterministicRunIdFactory implements RunIdFactory { ... }
```

**Evidence IDs also switch to UUID**: `evidenceCounter` in `economicEvidenceReference.ts` is replaced with `crypto.randomUUID()`-based IDs (`evidence-{uuid}`). This eliminates PK collision risk if the module is reloaded or the counter resets. The composite unique key `(seller_id, source_system, source_entity_type, source_record_id, source_version, checksum)` remains the true idempotency guard — evidence_id is now purely a synthetic row identifier.

Run ID collision retry (spec R8): pipeline detects PK conflict on `createRun`, retries with new UUID up to 3 attempts before failing.

## 3. Pipeline Redesign

**Decision: Fail-closed with atomic final commit**

```
1. Validate seller, acquire lock
2. CREATE RUN (RunIdFactory) → persist initial row → FAIL? ABORT pipeline
3. Fetch → Normalize → Adapt → Compute (unchanged phases)
4. PERSIST (atomic): db.transaction(() => {
     evidenceStore.upsertEvidence(e)       for each ref
     store.insertCostComponent(c)          for each component
     store.insertUnitEconomicsSnapshot(s)  for each snapshot
     runStore.updateRun(runId, {...})
     runStore.updateCheckpoint(sellerId, {...})  // only if completed
   })
5. Reconcile → decide status
```

`persisting` always transitions to `completed` after transaction succeeds; reconciliation quality does not determine run completion. On transaction failure → run marked `failed`, error surfaced, CLI exit ≠ 0.

## 4. Evidence Store Design

### 4.1 Full Column Specification

| Column | Type | Constraint |
|--------|------|------------|
| evidence_id | TEXT PK | NOT NULL |
| seller_id | TEXT NOT NULL | composite unique |
| source_system | TEXT NOT NULL | composite unique |
| source_entity_type | TEXT NOT NULL | composite unique |
| source_record_id | TEXT NOT NULL | composite unique + index |
| source_field | TEXT | nullable |
| observed_at | INTEGER NOT NULL | |
| occurred_at | INTEGER | nullable |
| source_version | TEXT | composite unique |
| checksum | TEXT NOT NULL | composite unique |
| verification | TEXT | nullable |
| confidence | REAL | nullable |
| superseded_by | TEXT | nullable |
| ingestion_run_id | TEXT NOT NULL | index |
| created_at | INTEGER NOT NULL | |

**Composite unique**: `(seller_id, source_system, source_entity_type, source_record_id, source_version, checksum)`
**Scan indexes**: `(ingestion_run_id)`, `(seller_id)`, `(source_record_id)`

### 4.2 CRUD Methods (all 8)

| Method | Signature | Behavior |
|--------|-----------|----------|
| insertEvidence | `(ref) => void` | INSERT, fails on composite conflict |
| upsertEvidence | `(ref) => ExistingRef?` | `INSERT ON CONFLICT DO NOTHING`, returns existing if conflict |
| getEvidence | `(evidenceId, sellerId) => Ref?` | Single-row lookup scoped to seller |
| listBySeller | `(sellerId, opts?) => Ref[]` | opts: `{ ingestionRunId?, verification?, limit? }` (default limit: 20) |
| listByRun | `(ingestionRunId, sellerId) => Ref[]` | All refs for a run, scoped to seller |
| listBySourceRecord | `(sourceRecordId, sellerId) => Ref[]` | All refs for a source record |
| markSuperseded | `(evidenceId, supersededBy) => void` | Sets `superseded_by`, preserves old row |
| countByRun | `(ingestionRunId) => number` | COUNT(*) for a run |

### 4.3 Cross-Seller Isolation

Every query method scopes to `sellerId`. `listByRun` and `listBySourceRecord` require `sellerId` as second parameter. No method returns evidence from a different seller. `insertEvidence`/`upsertEvidence` embed `sellerId` in the row and in the composite key.

### 4.4 No PII

Evidence references store only metadata: type, checksum, version, verification. No raw payloads, buyer data, emails, addresses, document IDs, tokens, `Authorization` headers, or signed URLs are written.

## 5. Schema Migration Plan

**Decision: Additive DDL, MigrationRegistry-managed**

Two independent feature flags:

| Flag | Controls | Default |
|------|----------|---------|
| `MSL_ECONOMIC_INGESTION_DURABILITY` | New pipeline path (RunIdFactory, evidence store, atomic commit) | enabled |
| `MSL_MIGRATION_ENABLED` | MigrationRegistry vs legacy `CREATE TABLE IF NOT EXISTS` | disabled |

They are independent: MigrationRegistry can be enabled without the new pipeline, and vice versa. However, durability requires `economic_evidence_references` — if `MSL_ECONOMIC_INGESTION_DURABILITY=true` and `MSL_MIGRATION_ENABLED=false`, the store falls back to `CREATE TABLE IF NOT EXISTS` for the evidence table while still using the legacy path for existing tables.

**MigrationRegistry idempotency**: `MigrationRegistry` tracks applied versions in a `schema_version` table. Each migration step is wrapped in a per-step `db.transaction()`. Before executing a step, the registry double-checks `schema_version` — if the version is already recorded, it skips. Calling `apply()` on an already-migrated DB returns `{ applied: 0, skipped: N }`.

Migrations (sequential):
1. **v1**: Base tables (existing: economic_ingestion_runs, economic_cost_components, unit_economics_snapshots, economic_ingestion_checkpoints)
2. **v2**: Indexes on economic_ingestion_runs: `(seller_id, created_at)`, `(seller_id, status)`, `(seller_id, id)`
3. **v3**: `ALTER TABLE economic_cost_components ADD COLUMN ingestion_run_id TEXT`
4. **v4**: `ALTER TABLE unit_economics_snapshots ADD COLUMN ingestion_run_id TEXT`
5. **v5**: `CREATE TABLE economic_evidence_references (...)` with composite unique + scan indexes

Upgrade test: start from v1 schema (old DDL), run all migrations, verify new columns exist, verify existing data preserved. All DDL uses `IF NOT EXISTS` guards.

## 6. Factory Wiring

`createEconomicIngestionRuntime` gains:
- `RunIdFactory`: `CryptoRunIdFactory` (production) or `DeterministicRunIdFactory` (tests via `RuntimeOverrides`)
- `EconomicEvidenceStore`: `createSqliteEconomicEvidenceStore(db)`
- Feature gate: `MSL_ECONOMIC_INGESTION_DURABILITY` (default: enabled)
- Health check: `evidenceStoreReady`

Pipeline signature changes: adds `RunIdFactory` and `EconomicEvidenceStore` parameters.

## 7. Transaction Strategy

**What's atomic**: evidence inserts, component inserts, snapshot inserts, run update, checkpoint update → all inside one `db.transaction()`.

**What's NOT atomic**: ML API calls (fetch), normalization, adaptation, computation. These are pure computation — if they fail, the transaction never starts.

**Fault injection behavior**: If any write inside `db.transaction()` throws, SQLite automatically rolls back all pending writes. No partial data is committed. The error propagates to the pipeline's error handler, which marks the run `failed` and emits an error log. Checkpoint is NOT advanced — `updateCheckpoint` is the last statement inside the transaction.

**Why single-connection works**: `getSharedDb()` returns the same `Database` instance. `db.transaction()` serializes all writes through SQLite's WAL.

## 8. CLI Commands

### 8.1 `economic:inspect-evidence` (new)

```
economic:inspect-evidence --seller <id> [--run <id>] [--source <id>] [--verification <v>] [--limit <n>]
```

Queries `EconomicEvidenceStore` directly (not reconstructed from components):
- `--seller <id>`: required, scopes all queries to one seller
- `--run <id>`: filters by `ingestion_run_id`
- `--source <id>`: filters by `source_record_id`
- `--verification <v>`: filters by verification status
- `--limit <n>`: max results (default: 20)

**Output fields** (per row, human-readable or `--json`):
`evidenceId`, `sourceSystem`, `sourceEntityType`, `sourceRecordId`, `sourceVersion`, `checksum` (truncated first 12 chars), `verification`, `confidence`, `ingestionRunId`, `observedAt`, `occurredAt`, `createdAt`

**Security**: `noExternalMutationExecuted: true`. No PII, no amounts, no raw payloads.

**Tests**: store absent → error message, no data → empty list, by seller, by run, by source, limit enforced, cross-seller rejected (seller X cannot see seller Y's evidence), no PII leakage in output.

## 9. Learning Eligibility Gating

**Decision: Pure deterministic function — in scope**

The `economic-learning` delta spec defines `evaluateEconomicLearningEligibility` with 10 block reasons. This is a **pure function with no I/O, no AI, and no heuristics** — it is NOT an "ML mutation" (which the proposal excludes). It already exists in `packages/domain/src/economicLearningEligibility.ts`. The change ensures it gates on verified outcomes only, with `outcome-not-verified` as blocking reason for non-verified statuses.

All 10 block reasons: `outcome-not-verified`, `incomplete-economic-data`, `disputed-evidence`, `invalidated-outcome`, `missing-observed-impact`, `currency-conflict`, `missing-attribution-target`, `stale-evidence`, `already-processed`, `seller-scope-mismatch`.

First failure wins — evaluation short-circuits. No database access, no API calls, no side effects.

## 10. Metrics Model

| Field | Scope | Source |
|-------|-------|--------|
| `runMetrics.normalizedLines` | This run only | `transactions.length` → renamed |
| `runMetrics.componentsCreated` | This run | `allComponents.length` |
| `runMetrics.snapshotsCreated` | This run | `snapshots.length` |
| `runMetrics.duplicatesIgnored` | This run | detected during evidence upsert |
| `cumulativeMetrics.totalSnapshots` | All runs | `SELECT COUNT(*) FROM unit_economics_snapshots WHERE seller_id = ?` |
| `cumulativeMetrics.totalComponents` | All runs | `SELECT COUNT(...)` |

## 11. Reconciliation Model

Multi-dimensional: `revenueReconciliation`, `costReconciliation`, `coverage` each produce independent status. `overallStatus`: `"balanced" | "partial" | "mismatched" | "incomplete" | "disputed"`. Zero-both-sides (0 revenue AND 0 cost) → `"incomplete"`.

## 12. Test Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit: RunIdFactory | UUID generation, deterministic sequence | Inject `DeterministicRunIdFactory` |
| Unit: Evidence store | CRUD, idempotency, superseding, cross-seller reject | In-memory SQLite per test |
| Unit: Eligibility | 10 block reasons, first-failure-wins | Pure function, no DB |
| Integration: Pipeline | 5 fault injection points | `RuntimeOverrides` with throwing mocks |
| Integration: Dual seller | Same DB, two sellers | Verify cross-seller isolation |
| Integration: Re-ingestion | Same range twice | Verify new runId, zero duplicates |
| Integration: Transaction | Throw mid-transaction | Verify rollback — no partial data committed |
| CLI: inspect-evidence | Store absent, no data, by seller/run/source, limit, PII check | `--json`, verify exit code & output |
| Migration: Upgrade | v1 schema → v5 | Create v1 DB, apply migrations, verify columns |

## 13. Rollback Strategy

- `MSL_ECONOMIC_INGESTION_DURABILITY=false` restores legacy path
- All DDL is additive — revert code only
- `backupDatabase()` before first migration
- Evidence store is a new table — no impact on existing data

## Open Questions

- [ ] `MSL_MIGRATION_ENABLED` default: currently `false`. Should it be `true` in production once smoke-tested?
