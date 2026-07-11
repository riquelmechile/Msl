# Proposal: Finalize Economic Ingestion Durability

**Status**: Proposed

## Intent

P0 PR 4/4 works but has durability gaps blocking production: colliding run IDs, silent persistence failures, no provenance on components/snapshots, ephemeral evidence. Harden the ingestion pipeline.

## Scope

**In**: UUID RunIdFactory (`economic-ingestion-<uuid>`, injectable), fail-closed persistence (abort on fail, no silent catch), atomic commit (evidence+components+snapshots+run+checkpoint), new `economic_evidence_references` table (idempotent composite-key upsert), `ingestion_run_id` on cost_components and snapshots, MigrationRegistry for all economic tables, run-scoped vs cumulative metrics ("transactions"→"normalizedLines"), checkpoint-after-commit only, fault injection tests, docs updates (README, ARCHITECTURE, ROADMAP, docs/, specs).

**Out**: Product Launch Intelligence, ML mutations, distributed locks, PII changes.

## Capabilities

**New**: `economic-ingestion-durability` (UUID IDs, fail-closed, atomic, run metrics, checkpoint-after-commit), `economic-evidence-store` (persistent refs, provenance, audit queries).

**Modified**: `economic-learning` (add `ingestion_run_id`, zero-revenue not "balanced"), `migration-framework` (economic tables use MigrationRegistry).

## Approach

| Step | Detail |
|------|--------|
| Run ID | `crypto.randomUUID()`, factory-injected |
| Persistence | No catch{} in critical path; createRun fail→abort |
| Atomic | `db.transaction()` wraps final writes |
| Evidence | Key: `(sellerId, sourceSystem, sourceEntityType, sourceRecordId, sourceVersion, checksum)` |
| Schema | `ALTER TABLE ADD COLUMN`; indexes `(seller_id,created_at)`, `(seller_id,status)`, `(seller_id,id)` |
| Metrics | `runMetrics` (current) vs `cumulativeMetrics` (DB); `duplicatesIgnored` |
| Idempotency | Re-ingest same range→new runId, 0 duplicates |

## Affected

| Area | Change |
|------|--------|
| `domain/.../economicIngestionRun.ts` | UUID factory replaces counter |
| `agent/.../EconomicIngestionPipeline.ts` | Fail-closed, atomic, metrics |
| `memory/.../economicIngestionRunStore.ts` | MigrationRegistry |
| `memory/.../economicOutcomeStore.ts` | `ingestion_run_id` column |
| `memory/.../economicEvidenceStore.ts` | **New** table + CRUD |
| `agent/.../factory.ts` | Wire RunIdFactory, EvidenceStore |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Migration corrupts data | Medium | Additive DDL; DB backup before smoke |
| Atomic span too wide | Low | Validate single-connection |
| Metric rename breaks CLI | Low | Backward-compat shim |

## Rollback

Revert code (schema additive, no destructive DDL); feature flag `MSL_ECONOMIC_INGESTION_DURABILITY`; restore pre-migration backup.

## Dependencies
P0 PR 4/4 baseline, migration-framework spec, SQLite WAL (existing).

## Success Criteria
- [ ] UUID IDs survive restart (2 pipelines, same DB)
- [ ] createRun fail→non-zero exit, no ML calls
- [ ] Final persist fail→run failed, items logged
- [ ] Evidence queryable by run, seller, source record
- [ ] `ingestion_run_id` on all components/snapshots
- [ ] Re-ingest same range→new runId, 0 duplicates
- [ ] Run-scoped/cumulative metrics split
- [ ] Fault injection all 5 failure stages
- [ ] "Balanced" rejects zero-both-sides
- [ ] All docs+specs updated
