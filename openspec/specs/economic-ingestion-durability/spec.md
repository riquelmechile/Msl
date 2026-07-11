# economic-ingestion-durability Specification

## Purpose

Hardened ingestion pipeline: UUID run IDs, fail-closed persistence, atomic commits, run-scoped metrics, idempotent re-ingestion.

## Requirements

### R1: UUID RunIdFactory
The system MUST generate run IDs via `crypto.randomUUID()` through an injectable `RunIdFactory`. Format: `economic-ingestion-{uuid}`. Tests SHALL inject a deterministic factory.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 1 | Survival | Two processes sharing DB | Both generate IDs | All unique, no collision across restarts |
| 2 | Test determinism | Sequential test factory | Pipeline runs | IDs match injected values |

### R2: Fail-closed persistence + exit codes
The system MUST NOT silently catch DB errors. `createRun` failure SHALL abort before ML calls. Final persist failure SHALL mark run `failed`. CLI MUST exit non-zero on any persistence failure.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 1 | createRun fails | `runStore.createRun()` throws | Persist phase starts | Pipeline aborts before ML/API calls |
| 2 | Final persist fails | Atomic commit throws | Error reaches handler | Run status `failed`, error surfaced, CLI exit ≠ 0 |

### R3: Atomic transaction + checkpoint
The system MUST wrap final writes (evidence, components, snapshots, run, checkpoint) in `db.transaction()`. Checkpoint SHALL advance only after commit succeeds.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 1 | All-or-nothing | Evidence, components, snapshots produced | Atomic commit executes | All written or none visible |
| 2 | Checkpoint guarded | Successful commit at page 5 | Checkpoint updates | `checkpoint_after` = 5; rollback leaves unchanged |

### R4: Run-scoped vs cumulative metrics
The system MUST split metrics into `runMetrics` (current invocation) and `cumulativeMetrics` (DB aggregate). "transactions" SHALL rename to "normalizedLines". Track `duplicatesIgnored` per-run.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 1 | runMetrics reset | 3 prior runs: 150 total | New run processes 50 | `runMetrics` = 50, `cumulative` = 200 |
| 2 | duplicatesIgnored | Re-ingesting processed range | Duplicates detected | `duplicatesIgnored` equals skip count |

### R5: Provenance + indexes
The system SHALL add `ingestion_run_id TEXT NOT NULL` to `economic_cost_components` and `unit_economics_snapshots`. Indexes on `economic_ingestion_runs`: `(seller_id,created_at)`, `(seller_id,status)`, `(seller_id,id)`.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 1 | Run provenance query | R1, R2 each produce components | Query `ingestion_run_id = 'R1'` | Only R1 components returned |
| 2 | Index usage | 1000 runs, 10 sellers | Query `seller_id + status` | Uses composite index |

### R6: Multi-dimensional reconciliation
The system MUST reconcile revenue, cost, and coverage independently. Zero-both-sides (0 revenue AND 0 cost) SHALL produce `incomplete`, NOT `balanced`.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 1 | Partial mismatch | Revenue delta zero, cost non-zero | Reconciliation evaluates | Revenue: balanced, cost: mismatched |
| 2 | Zero-both-sides | 0 revenue, 0 cost | Reconciliation runs | Overall status: `incomplete` |

### R7: Ingestion idempotency
The system SHALL assign a new `runId` for every ingestion (same range included). Re-ingestion MUST produce zero duplicate rows. Evidence upsert uses composite key `(sellerId, sourceSystem, sourceEntityType, sourceRecordId, sourceVersion, checksum)`.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 1 | Re-ingest same range | R1 already ingested Jan 1-31 | R2 ingests same range | New runId, zero duplicates |
| 2 | Evidence idempotency | Composite key already exists | Re-ingestion runs | No duplicate row, `duplicatesIgnored` increments |

### R8: Run ID collision detection
The system SHALL detect collisions before `createRun`, retry with new UUID up to 3 attempts.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 1 | Collision retry | Generated UUID matches existing ID | `createRun` attempted | Retries with new UUID, succeeds within 3 |
