# Tasks: Finalize Economic Ingestion Durability

## Review Workload Forecast

Estimated changed lines: 1400–1850. Five work units. Each PR under 450 lines.

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

| Unit | Goal | PR | Depends |
|------|------|-----|---------|
| 1 | UUID RunIdFactory | PR 1 | — |
| 2 | Fail-closed + atomic tx | PR 2 | PR 1 |
| 3 | Evidence store + provenance | PR 3 | PR 2 |
| 4 | Full verification suite | PR 4 | PR 3 |
| 5 | Docs + archive | PR 5 | — |

## Phase 1: RunIdFactory (PR 1)

- [x] 1.1 Create `RunIdFactory` interface + `CryptoRunIdFactory` in `packages/domain/src/runIdFactory.ts`
- [x] 1.2 Create `DeterministicRunIdFactory` for test injection
- [x] 1.3 Replace `runCounter` with injected factory in `createEconomicIngestionRun`
- [x] 1.4 Wire `RunIdFactory` into `EconomicIngestionPipeline` and `factory.ts`
- [x] 1.5 Switch evidence IDs from `evidenceCounter` to UUID
- [x] 1.6 Tests: uniqueness, determinism, collision retry, 10k IDs no collision

## Phase 2: Fail-Closed + Atomic (PR 2)

- [x] 2.1 Replace silent `catch{}` on `createRun`: abort before ML calls, throw
- [x] 2.2 Replace silent `catch{}` on final persist: run→`failed`, log, throw
- [x] 2.3 `persisting`→`completed` always after commit (not gated on reconciliation)
- [x] 2.4 Wrap writes in `db.transaction()`; checkpoint after commit only
- [x] 2.5 CLI exit code 1 on persistence failure
- [x] 2.6 6 fault injection tests + transaction rollback: no partial data

## Phase 3: Evidence Store + Provenance (PR 3)

- [x] 3.1 Create `EconomicEvidenceStore` interface + SQLite impl in `packages/memory/src/`
- [x] 3.2 `economic_evidence_references` table: 15 cols, composite unique, 3 scan indexes
- [x] 3.3 Migration v3/v4: `ALTER TABLE` add `ingestion_run_id` to cost_components, snapshots
- [x] 3.4 Migration v5: evidence table; v2: run indexes; MigrationRegistry registration
- [x] 3.5 Wire store into factory; upsert evidence during adapt; persist in atomic tx
- [x] 3.6 CLI `inspect_evidence_references`: `--seller`, `--run`, `--source`, `--limit`
- [x] 3.7 runMetrics vs cumulativeMetrics split; rename transactions→normalizedLines
- [x] 3.8 Multi-dimensional reconciliation; zero-both-sides→incomplete; duplicatesIgnored
- [x] 3.9 Idempotency: re-ingest same range→new runId, zero duplicates

## Phase 4: Verification Suite (PR 4)

- [x] 4.1 Evidence store unit: CRUD, idempotency, superseding, cross-seller, no PII
- [x] 4.2 Pipeline integration: 6 fault injection points, dual-seller isolation
- [x] 4.3 Re-ingestion: same range twice→new runId, zero duplicates
- [x] 4.4 Migration: v1→v5 upgrade, idempotent re-run, no data loss
- [x] 4.5 CLI inspect: store absent, no data, filters, limit, cross-seller rejected
- [x] 4.6 Eligibility: all 10 block reasons, first-failure-wins
- [x] 4.7 Transaction rollback: throw mid-transaction→no partial rows

## Phase 5: Docs + Archive (PR 5)

- [ ] 5.1 Update `README.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `docs/` pages
- [ ] 5.2 OpenSpec specs delta files for all 4 capability specs
- [ ] 5.3 Archive SDD change
