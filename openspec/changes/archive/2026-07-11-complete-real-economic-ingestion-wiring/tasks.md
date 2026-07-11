# Tasks: Complete Real Economic Ingestion Wiring

## Overview
10 phases, 28 tasks. All code changes are wiring/connection — core pipeline, adapters, and store are already production-ready.

---

## Phase 1: EconomicIngestionRunStore

- [x] **T1.1** Create `packages/memory/src/economicIngestionRunStore.ts` — SQLite store for runs and checkpoints. Methods: `createRun`, `updateRun`, `getRun`, `getLastRunBySeller`, `listRunsBySeller`, `getActiveRun`, `recoverAbandonedRun`, `getCheckpoint`, `updateCheckpoint`. Use existing migration framework.
- [x] **T1.2** Add migration for `economic_ingestion_runs` and `economic_ingestion_checkpoints` tables. Seller isolation. Timestamps. Sanitized errors.
- [x] **T1.3** Tests for EconomicIngestionRunStore — CRUD, seller isolation, idempotency, checkpoint advancement, abandoned run recovery.

## Phase 2: Shared Factory

- [x] **T2.1** Create `packages/agent/src/economics/factory.ts` with `createEconomicIngestionRuntime(seller, overrides?)`. Constructs: env loader, account registry, OAuth, DataFetcher, EconomicOutcomeStore, EconomicIngestionRunStore, pipeline, reconciliation, logger, metrics.
- [ ] **T2.2** Factory tests — verify correct construction per seller, override injection, error on unknown seller.

## Phase 3: Production DataFetcher

- [x] **T3.1** Create `packages/agent/src/economics/dataFetcher.ts` — Production `DataFetcher` implementation using existing ML API client. Read-only. Pagination, rate limiting, abort signal, retry. PII sanitization via existing normalization layer.
- [ ] **T3.2** DataFetcher tests — fake ML responses, pagination, rate limit, abort, unavailable endpoint handling.

## Phase 4: CLI Rewrite

- [x] **T4.1** Rewrite `packages/agent/src/cli/economicCli.ts` — Replace all 5 stub handlers with real implementations using the factory.
  - `handleIngest` → `runtime.pipeline.run()`
  - `handleStatus` → `runtime.runStore.getLastRunBySeller()`
  - `handleCoverage` → `runtime.outcomeStore.getCoverage()`
  - `handleReconcile` → `runtime.reconciliation.reconcile()`
  - `handleMissing` → `runtime.outcomeStore.listMissingInputs()`
- [x] **T4.2** Add CLI flags: `--seller`, `--seller-id`, `--json`, `--dry-run`, `--no-persist`, `--limit`, `--max-pages`, `--from`, `--to`, `--max-time`, `--resume`, `--strict`.
- [x] **T4.3** Rewrite CLI tests — inject fake factory, verify real pipeline calls, verify exit codes, JSON output, partial vs complete, no PII.

## Phase 5: Daemon Wiring

- [x] **T5.1** Update `scripts/start-agent-daemons.mjs` — Import `createEconomicIngestionDaemon`, construct with factory, register with daemon scheduler.
- [ ] **T5.2** Update `packages/agent/src/workers/economicIngestionDaemon.ts` — Accept factory injection, use shared factory instead of inline construction.
- [ ] **T5.3** Daemon tests — factory injection, feature gate, graceful shutdown, sequential execution.

## Phase 6: CEO Tools Fix

- [x] **T6.1** Fix `inspect_evidence_references` in `packages/agent/src/conversation/tools/economicTools.ts` — Query real evidence references from store. Maintain `noExternalMutationExecuted: true`.
- [ ] **T6.2** Verify all 8 CEO tools use real stores, bounded output, zero PII, zero secrets.

## Phase 7: Readiness & Health

- [ ] **T7.1** Update `ProductionReadinessService` — `real-economic-ingestion` capability evaluates: feature flag, account registry, ML readiness, economic DB, migrations, store, DataFetcher wiring, factory, last run, checkpoint, coverage.
- [ ] **T7.2** Update `RuntimeHealth` — Show last run, last successful run, lag, fetched, snapshots, partial, disputed, last error, checkpoint, seller.

## Phase 8: Real Smoke Test (READ-ONLY)

- [ ] **T8.1** Plasticov dry-run — max 1 page, 5 orders, no persist. Verify real ML calls, normalization, adapters, snapshots, no PII.
- [ ] **T8.2** Maustian dry-run — same limits.
- [ ] **T8.3** Plasticov controlled persist — max 5 orders, verify persistence, status, coverage, missing, reconcile.
- [ ] **T8.4** Maustian controlled persist — same.
- [ ] **T8.5** Re-ingestion — verify idempotency (zero duplicates, same components, stable checkpoint).

## Phase 9: Documentation

- [ ] **T9.1** Update ROADMAP.md — Mark P0 PR 4/4 as Complete, P0 global as Complete (with honest partials note).
- [ ] **T9.2** Update README.md — Economic ingestion commands, real smoke evidence.
- [ ] **T9.3** Update ARCHITECTURE.md — Factory pattern, wiring diagram.
- [ ] **T9.4** Update docs/operations/real-ingestion-economic-adapters.md — Correct stub claims.
- [ ] **T9.5** Update docs/architecture/financial-truth-foundation.md
- [ ] **T9.6** Update .env.example — Economic ingestion env vars.
- [ ] **T9.7** Update ecosystem.config.cjs — Verify daemon config.
- [ ] **T9.8** Add correction note to previous archive report.

## Phase 10: Archive

- [ ] **T10.1** Create verify-report.md — All tests pass, smoke real, no stubs remaining.
- [ ] **T10.2** Create archive-report.md — Summary, evidence, final SHA.
- [ ] **T10.3** Move change to archive: `openspec/changes/archive/2026-07-11-complete-real-economic-ingestion-wiring/`.
- [ ] **T10.4** Update specs delta.

---

## Review Workload Forecast

| Phase | Estimated Lines Changed |
|-------|------------------------|
| Phase 1 (RunStore) | ~350 |
| Phase 2 (Factory) | ~200 |
| Phase 3 (DataFetcher) | ~250 |
| Phase 4 (CLI) | ~300 |
| Phase 5 (Daemon) | ~50 |
| Phase 6 (Tools) | ~30 |
| Phase 7 (Readiness) | ~80 |
| Phase 8 (Smoke) | 0 (runtime only) |
| Phase 9 (Docs) | ~150 |
| Phase 10 (Archive) | ~100 |
| **TOTAL** | **~1,510** |

**Chained PRs recommended: Yes**
**400-line budget risk: High**
**Decision: Auto-forecast → use stacked-to-main chain strategy**

### PR Slice Plan
1. **PR 1/3** — RunStore + Factory + DataFetcher (~800 lines)
2. **PR 2/3** — CLI rewrite + Daemon wiring + Tools fix (~380 lines)
3. **PR 3/3** — Readiness + Docs + Archive (~330 lines)
