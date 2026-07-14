## Exploration: finalize-economic-run-consistency

> **Historical, superseded for remediation policy:** The canonical Claims, source-state, lease, deadline, and migration decisions are in `fetch-data-quality-policy.md`, `migration-plan.md`, and `design.md`.

### Current State
The P0 economic ingestion path is implemented, but the durable database state and the returned run object can disagree. The audit used source inspection only: CodeGraph was unavailable because this repository has no `.codegraph/` index, so the investigation safely fell back to targeted reads. No environment files, credentials, raw ML payloads, live migrations, or smoke commands were inspected or run.

Confirmed root causes:

- **Run identity and finalization diverge.** `runEconomicIngestion` creates and persists an initial run, then creates `finalRun` without passing `runId`; the returned run therefore receives a second UUID. The persisted result also uses `normalizedLines/components/snapshots`, while `runFromRow` reads `recordsNormalized/componentsCreated/snapshotsCreated`, so historical runs reconstruct with zero counts. No collision retry exists before `createRun`.
- **Provenance is schema-only, not data-path complete.** Durability code can add nullable `ingestion_run_id` columns, but `CostComponentInsertInput`, `insertCostCompStmt`, snapshot DDL/insert, and list APIs neither accept nor persist/filter it. Components and snapshots cannot be reliably queried or counted by run.
- **Idempotency and historical metrics are incomplete.** Component IDs use process-local counters; snapshot IDs use time/random; pipeline inserts components rather than its existing upsert path; cumulative metrics are hard-coded to the current invocation. Existing re-ingestion tests explicitly accept duplicate components.
- **Final transaction has the right intent but the wrong completion contract.** The runtime factory supplies one shared DB handle, and `store.transaction` wraps evidence/components/snapshots/run/checkpoint. However, reconciliation is calculated after the commit, the persisted result stores an empty reconciliation string, checkpoint selection trusts input order rather than a deterministic high-water mark, and the returned run never receives `checkpointAfter`.
- **MigrationRegistry is not a single economic schema plan.** The run and outcome stores always execute inline DDL. With the flag enabled, evidence registers only v5; durability registers v2-v4 separately. Applying v5 first advances the shared `schema_version`, causing v2-v4 to be skipped. This violates the migration-framework requirement and creates unsafe fresh/upgrade ordering.
- **Evidence and CLI are mostly functional but need consistency tightening.** Evidence has a durable composite key and seller-scoped lists, and `inspect-evidence --run` filters by seller and run. `countByRun` is not seller-scoped, and re-ingestion keeps evidence attached to the original run by design; the CLI does not expose run-scoped component/snapshot inspection.

The user-provided clean-baseline quality debt is accepted as a prerequisite constraint: at `a2cd0f9`, `format:check` reports 138 files and lint reports 171 errors, while typecheck, tests, build, and E2E pass. This exploration did not rerun those broad commands.

### Affected Areas
- `packages/agent/src/economics/EconomicIngestionPipeline.ts` — preserve the one run ID; compute reconciliation before durable finalization; atomically persist a complete result and deterministic checkpoint; attach run IDs; use idempotent writes and DB aggregates.
- `packages/domain/src/economicIngestionRun.ts` and `packages/domain/src/runIdFactory.ts` — retain injectable UUID generation and add collision-aware creation semantics without generating a second ID.
- `packages/domain/src/economicCost.ts`, `packages/domain/src/unitEconomics.ts`, `packages/domain/src/economicCalculation.ts` — define stable, deterministic component/snapshot identities and carry ingestion provenance where appropriate.
- `packages/memory/src/economicIngestionRunStore.ts` — durable result shape, collision detection/query, seller-scoped run listing/counting, checkpoint high-water contract, and reconstruction parity.
- `packages/memory/src/economicOutcomeStore.ts` — `ingestion_run_id` DDL, insert/read/list/count-by-run APIs, run-aware idempotency, and SQL cumulative aggregates on the shared handle.
- `packages/memory/src/economicEvidenceStore.ts` — make `countByRun` seller-scoped and consolidate its migration registration with the other economic tables.
- `packages/memory/src/migrationRegistry.ts` and `packages/memory/src/index.ts` — expose one ordered, transactional economic migration plan rather than independently registered version ranges.
- `packages/agent/src/economics/factory.ts` — initialize the unified migration plan once against the shared DB, then construct all three stores on that same handle.
- `packages/agent/src/cli/economicCli.ts` — retain `--run` evidence filtering and add/align run-scoped output only if acceptance criteria require component/snapshot inspection; preserve seller scoping and PII sanitization.
- `packages/agent/src/economics/pipeline.test.ts` — replace tests that accept duplicate rows or final-ID divergence; add finalization, rollback, deterministic checkpoint, and historical-metric coverage.
- `packages/memory/src/economicOutcomeStore.test.ts`, `packages/memory/src/economicEvidenceStore.test.ts`, `packages/memory/tests/economicIngestionRunStore.test.ts`, `packages/memory/tests/economicDurabilityMigration.test.ts`, `packages/memory/src/migrationRegistry.test.ts`, `packages/agent/src/cli/economicCli.test.ts` — add seller/run-scoped persistence, migration ordering/upgrades, CLI filtering, and deterministic identity coverage.
- `packages/agent/src/workers/economicIngestionDaemon.ts` and `.test.ts` — inject the run/evidence stores or use the runtime factory so daemon runs cannot bypass durable finalization; current direct pipeline call supplies only outcome store and fetcher.
- `README.md`, `ROADMAP.md`, and relevant P0 operational/smoke documentation — correct the current “hardened” claim, state the baseline lint/format debt, and document offline-only verification prerequisites. Persistent real-data smoke and real migrations remain out of scope.

### Approaches
1. **Unify finalization around a durable run aggregate** — Build reconciliation, run metrics, checkpoint high-water mark, and final status before one shared-DB transaction; persist and return the same immutable run identity.
   - Pros: Fixes identity, result, provenance, checkpoint, metrics, and atomicity as one coherent contract; directly supports acceptance tests.
   - Cons: Cross-package API and migration changes; requires careful legacy-row handling.
   - Effort: High

2. **Patch each symptom in place** — Add missing columns/filters, patch the final ID, and add aggregate queries while preserving the current split migration and finalization flow.
   - Pros: Smaller individual diffs.
   - Cons: Leaves ordering and ownership ambiguous; likely exceeds the review budget through follow-up fixes and risks another inconsistent state boundary.
   - Effort: High

### Recommendation
Use the unified durable-run aggregate approach, delivered as auto-forecast review slices within the 800 authored-line budget. First establish the migration/schema and store contracts, then finalization/idempotency pipeline behavior, then CLI/daemon/docs and focused tests. Reconciliation is a pre-commit eligibility gate: completion and checkpoint advancement require a valid seller, consistent currency, revenue balanced or balanced-with-tolerance, and successful full atomic persistence with the checkpoint written in that transaction. Known missing product/landed cost or unavailable fees, shipping, or ads yield partial coverage without treating missing values as zero and may still complete with `checkpointAdvanced: true`; revenue mismatch, seller/currency mismatch, critical contradictory evidence, inconsistent normalization, a final-write error, or rollback is failed/disputed with `checkpointAdvanced: false`, the prior checkpoint intact, and coherent CLI status/exit. The cursor is exactly `(occurredAt, sourceRecordId)`: order and persist both fields, then resume strictly after the tuple—never timestamp-only or order-ID-only—so ties do not skip or duplicate records.

### Risks
- A shared `schema_version` table already used by Cortex makes independent economic version ranges unsafe; migration versions must be globally coordinated and tested from both fresh and legacy schemas.
- Changing stable identities or uniqueness can expose existing duplicate historical rows; upgrades must preserve rows and define whether legacy provenance remains NULL/backfilled.
- The 800-line review budget is likely at risk once migrations and focused test coverage are included; tasks should forecast chained PRs before apply.
- Repository-wide format/lint failures are baseline debt, not acceptance evidence for this change; changed-file checks and passing typecheck/tests/build/E2E must be reported separately.
- Do not advance to Product Launch Intelligence, run real migrations, persistent smoke, or MercadoLibre mutations until this consistency change is implemented and independently verified.

### Ready for Proposal
Yes — propose `finalize-economic-run-consistency` as P0 PR 4/4 consistency remediation only. The proposal should make durable run identity, final result, seller-scoped run provenance, deterministic idempotency, ordered reconciliation/checkpoint finalization, unified migration registration, and offline test/documentation prerequisites explicit; it must exclude Product Launch Intelligence and live operations.
