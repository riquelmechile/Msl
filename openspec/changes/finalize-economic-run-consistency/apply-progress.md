# Apply Progress: Finalize Economic Run Consistency

## Remediation R5 — PASS (2026-07-13)

- **Status:** **R5: PASS.** An independent read-only acceptance matrix accepted R5. R6 and later work remain unchecked and out of scope.
- **Public boundary:** `@msl/memory` exports only `["."]`; `packages/memory/src/internal.ts` is absent; private Memory imports fell from 19 to 0; pipeline write-admission bypasses are 0; and the productive pipeline has exactly one awaited commit.
- **Ownership:** Memory owns receipt, database-fence, seller-lease, renewal, epoch, and rollback behavior behind the narrow admitted write-session boundary. Productive maintenance writes use `MaintenanceWriteAdmission`.
- **Runtime:** Request attempts use derived abort signals, and request, delay, pagination, fanout, and shutdown work is clipped to the remaining deadline.

### Read-Only Acceptance Matrix

| Check | Result |
|---|---|
| Focused R5 verification | **PASS** — 8 files, 116/116 tests. |
| Typecheck | **PASS**. |
| Build | **PASS** — 12 routes. |
| Global test baseline | 199 files: 197 passed, 2 skipped; 3564 tests: 3557 passed, 7 skipped. |
| E2E | Effective 6/6 **PASS** using the temporary Linux Node runtime because the Termux validator cannot load the Linux `better-sqlite3` addon directly. |
| Targeted R5 lint and format | **PASS** — 76 files. |
| Diff integrity | `git diff --check` **PASS**. |
| Global baseline debt | Unchanged: lint has 109 errors across 25 unchanged files; format has 96 unchanged files. |
| Validator snapshot | Immutable throughout the read-only acceptance matrix. |

No smoke, MercadoLibre operation, commit, push, or R6 work was performed.

## Remediation R5 Surgery Attempt — Incomplete (2026-07-13)

- **Status:** R5 remains unchecked. This batch tightened the productive fetch path only; it did not claim or complete the required architectural surgery.
- **Implemented:** Every transport attempt now receives a fresh derived signal. The derived signal follows global cancellation, is actively aborted on the request deadline, and Claims/Product Ads retain the fanout-derived signal during retry and Retry-After waiting. The pipeline now passes its single absolute deadline to the data fetcher, which clips individual request and delay windows before starting work.
- **Blocking architectural findings:** `packages/memory/package.json` still exports `./internal`; `packages/memory/src/internal.ts` remains a facade; 20 Agent-package source/test imports still cross into `memory/src/internal`; and `EconomicIngestionPipeline.ts` still owns direct SQLite/fence/receipt/session mutation. The required boundary, factory, maintenance-admission, scanner, and full writer-classification changes remain unfinished. No R6–R8, smoke/live MercadoLibre activity, commit, or PR work occurred.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| R5 deadline propagation and fanout transport cancellation | `npx vitest run packages/agent/src/economics/dataFetcher.test.ts packages/agent/src/economics/boundedFanout.test.ts --silent` — exit 0; 2 files, 28 passed. `npm run typecheck` — exit 0. | Offline fake transport verifies Orders receives a derived signal, global abort reaches it, and optional Claims/Ads Retry-After waits receive the fanout-derived signal. No external transport, smoke, live call, or mutation was run. | Revert this batch's changes in `packages/agent/src/economics/dataFetcher.ts`, `packages/agent/src/economics/dataFetcher.test.ts`, and `packages/agent/src/economics/EconomicIngestionPipeline.ts`; this does not revert existing R1–R5 working-tree work. |

## Remediation R5 — Implemented Awaiting Parent Final Gate (2026-07-13)

- **Status:** R5 remains unchecked by instruction. The implementation is ready for the parent's one final gate; R6–R8, smoke/live MercadoLibre access, commits, and pushes remain out of scope.
- **Boundary:** Added executable inventory (`r5-economic-sqlite-writer-inventory.md` and `economicWriterInventory.test.ts`) for outcome, component, snapshot, evidence, run, checkpoint, backlog, source-health, and alert-intent writers. The public `@msl/memory` barrel no longer exports raw SQLite handles, economic store factories, migration helpers, or synchronous in-transaction helpers; factory/migration-only seams are internal.
- **Admission/runtime:** `DatabaseWriteAdmissionService` issues immutable one-use sessions backed by 1011 receipt bindings and atomically consumes receipt plus epoch increment. The pipeline now renews database fences through a cancellable owner/token/generation loop, stops both renewal loops before releases, and uses bounded fanout for independent Claims/Ads only after Orders succeeds. Execution-budget primitives retain deadline clipping.
- **Final correction:** The public memory barrel now exposes only economic read projections; economic store writers, raw fence/receipt operations, admission capabilities, and SQLite factory/migration seams are internal-only. `boundedFanout` now passes a derived cancellation signal to every active child so both global abort and its own timeout terminate active work as well as queued starts. Dedicated fake-clock fence-renewal coverage proves multiple renewal, loss-abort, and zero pending timers.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| R5 admission, fence renewal, public boundary, and bounded fanout | `npx vitest run packages/memory/tests/{databaseWriteAdmission,publicEconomicBoundary,economicWriterInventory,economicDatabaseAdmissionReceipt,economicSellerLeaseStore,economicSourceCheckpointStore,economicSourceRetryBacklogStore,economicRunProvenanceStore}.test.ts packages/agent/src/economics/{boundedFanout,leaseRenewalScheduler,runtimeDeadline,dataFetcher,pipeline}.test.ts --silent` — exit 0; 13 files, 140 passed. `npm run typecheck` — exit 0. | File-backed SQLite receipt/fence barrier and reopen/FK/quick-check coverage pass in the focused suite; pipeline fixtures exercise receipt consumption, rollback, lease/fence lifecycle, and optional concurrent Claims/Ads without external calls. No smoke/live boundary was run. | Revert the R5 admission service, fence renewal scheduler, bounded fanout wiring, internal-only export split, inventory/architecture tests, and this R5 record. |

## Remediation R5 — Admission Foundation (incomplete, 2026-07-13)

- **Scope:** R5 only. Migration 1011 now owns digest-only database write-admission receipts; 1012/1013 remain reserved for future R7 delivery/restore. Added typed database-fence acquire/renew/release lifecycle and a validated deadline configuration, pure clipping helper, and bounded fanout primitive.
- **Status:** **Not accepted.** Temporary-file SQLite migration/reopen/quick-check/FK-check and fence/receipt unit coverage pass, but receipt enforcement has not yet been applied to every current public economic writer or the pipeline final transaction. `R5` remains `[ ]`; R6 and R7 were not changed.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| R5 scheduler hang correction | `npx vitest run packages/agent/src/economics/leaseRenewalScheduler.test.ts packages/agent/src/economics/dataFetcher.test.ts packages/agent/src/economics/pipeline.test.ts --silent` — no exit receipt; runner timed out at 120s. `npx tsc -b packages/agent --pretty false` — no exit receipt; runner timed out at 120s. Targeted Prettier/ESLint also did not complete before their limits. | New fake-clock unit harness contains no real timers and asserts stop clears its only pending delay plus renewal loss aborts the global signal. It is not an accepted execution receipt because Vitest did not exit. The required real SQLite scheduler/fence matrix remains pending. | Revert `packages/agent/src/economics/leaseRenewalScheduler.ts`, its test, and R5 changes in `EconomicIngestionPipeline.ts`, `dataFetcher.ts`, and `factory.ts`. |


## Remediation R4b — Minimal Durable Operational Alert Intent (2026-07-13)

- **Scope:** Resolve only the R4b cancellation-alert ownership boundary. Migration 1010 contains `economic_operational_alert_intents` only; no R5/R7 dispatcher, transport, HTTP, Telegram, inbox, delivery, smoke, live call, commit, or PR work is included.
- **Implemented:** Administrative Claims cancellation now runs in one SQLite immediate transaction: seller/backlog/state read, cancellation update, logical idempotent audit insert, deterministic SHA-256 operational intent insert, health update, and commit. The intent has fixed cancellation type/severity/reason/source/related fields, safe bounded metadata, `pending|consumed`, seller/backlog FK-plus-trigger integrity, seller-scoped create/get/list/count/consume APIs, and typed `already-consumed`, `not-found`, and `wrong-seller` outcomes. Repeat cancellation keeps one audit and one intent; fault injection after backlog/audit/intent/before-commit rolls every write back.
- **Boundary:** R4b/R4 remain unchecked pending the fresh gate. R7 remains unchecked; an intent is neither dispatched nor delivered.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| R4b minimal operational alert intent | `npx vitest run packages/memory/tests/economicSourceRetryBacklogStore.test.ts packages/memory/tests/economicSourceCheckpointStore.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/agent/src/economics/pipeline.test.ts --silent` — exit 0; 4 files, 108 passed. `npx tsc -b packages/memory packages/agent --pretty false` — exit 0. Targeted Prettier, ESLint, and `git diff --check` — exit 0. | Real file SQLite deterministic harness covers cancellation idempotency, seller-isolated list/consume, fault rollback boundaries, hostile seller/backlog integrity, close/reopen, `quick_check`, `foreign_key_check`, and orphan join. No dispatcher/runtime boundary exists; no HTTP, Telegram, smoke, or live call. | Revert migration 1010, operational-intent APIs/cancellation transaction, intent tests, and these ownership records. |

## Remediation R4b Correction — Seller-Bound Administrative Backlog Mutation (2026-07-12)

- **Scope:** R4b correction only. No R5 scheduler/daemon/CLI propagation, alert dispatcher, smoke, live call, commit, or PR work.
- **Implemented:** `cancelClaimsBacklog` and `replayClaimsBacklog` now require seller ID plus actor, approver, and reason; their updates require both `backlog_identity_key` and `seller_id` and return one typed result (`administratively-cancelled`/`replayed` or `stale-or-replaced`). Audit records persist `seller_id`. The remaining backlog mutation paths were checked: due claim and retry updates now include seller predicates, and bounded expiry recovery is explicitly seller-bound.
- **Evidence:** The real on-disk SQLite hostile test creates Plasticov and Maustian rows, attempts both admin operations as Maustian against Plasticov's known key, receives `stale-or-replaced`, observes no foreign state change or audit, then verifies Plasticov's approved cancel/replay and seller-scoped audit rows.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| R4b seller-bound admin backlog correction | `npx vitest run packages/memory/tests/economicSourceRetryBacklogStore.test.ts packages/memory/tests/economicSourceCheckpointStore.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/agent/src/economics/pipeline.test.ts` — exit 0; 4 files, 101 passed. `npx tsc -b packages/memory packages/agent --pretty false` — exit 0. Targeted Prettier, ESLint, and `git diff --check` — exit 0. | Real on-disk SQLite, deterministic clock: hostile Maustian cancel/replay of Plasticov identity is rejected without mutation/audit; approved Plasticov cancel/replay writes only Plasticov audit rows. No runtime boundary beyond the SQLite store exists; no sleeps, smoke, live call, or external mutation. | Revert the R4b correction in `packages/memory/src/economicIngestionRunStore.ts`, `packages/memory/src/migrationRegistry.ts`, `packages/memory/tests/economicSourceRetryBacklogStore.test.ts`, and the corresponding task/progress entries. |

## Remediation R4b — Durable Claims Retry Backlog and Source Health (2026-07-12)

- **Scope:** R4b only: registry migration 1009, SQLite backlog/health store lifecycle, and the R2 Claims-gap final-transaction contract. No R5 scheduler daemon, deadline controller, CLI propagation, alerts table, smoke, live call, commit, or R5+ work.
- **Implemented:** Migration 1009 adds non-null canonical `backlog_identity_key`, seller/source/range/cursor/purpose and six constrained states, owner/token-digest/generation/expiry claim fields, due/expiry indexes, and audited cancellation/replay records. The SQLite store enforces seller-scoped idempotent upsert, atomic due claims, request-start-only attempt consumption, retry backoff, max-attempt dead letters, expiry recovery, stale-worker rejection, abort release to pending, and audited admin cancel/replay. `economic_source_health` is the durable readiness projection with bounded counters/reason/retry/backlog fields and monotonic request timestamps; no raw payload is stored.
- **Pipeline:** A Claims non-success creates/updates the canonical backlog row and writes Orders/Claims/Product Ads health inside the existing fenced final `BEGIN IMMEDIATE` transaction. Claims remains missing coverage; no refund zero or Claims checkpoint is fabricated.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| R4b durable Claims retry backlog and health | `npx vitest run packages/memory/tests/economicSourceRetryBacklogStore.test.ts packages/memory/tests/economicSourceCheckpointStore.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/agent/src/economics/pipeline.test.ts` — exit 0; 4 files, 100 passed. `npx tsc -b packages/memory packages/agent --pretty false` — exit 0. Targeted Prettier, ESLint, and `git diff --check` — exit 0. | Real on-disk SQLite with a deterministic clock proves restart idempotency, null-cursor identity, seller isolation, due claim lifecycle, pre/post-start crash behavior, replacement-worker rejection, expiry recovery, max/dead-letter/replay/admin cancellation, and monotonic health. Pipeline harness proves Claims gap backlog + health commit atomically without refund zero. No sleeps, smoke, live call, or external mutation. | Revert the R4b portions of `migrationRegistry.ts`, `economicIngestionRunStore.ts`, memory exports, `EconomicIngestionPipeline.ts`, and the R4b migration/store/pipeline test assertions. This removes only 1009 backlog/health behavior. |

## Remediation R4a — Seller-Scoped Leases and Fence Ownership (2026-07-12)

- **Scope:** R4 seller leases only. No 1009 backlog/health, R5 deadline scheduler/global AbortController wiring, supersession, alert, smoke, live call, or commit work.
- **Implemented:** Migration 1008 now creates `economic_seller_leases` with seller primary key, owner run, SHA-256 token digest, lease/database/fence generations, and expiry index. The SQLite run store provides short `BEGIN IMMEDIATE` acquire/renew/release operations with CSPRNG tokens, concrete validated 60s/20s/15s timing, row-count/readback checks, and typed fence/owner/replacement/expiry outcomes. Expired leases recover only after grace through generation CAS; stale processes cannot renew or release a recovered lease.
- **Finalization:** The pipeline acquires a durable lease after fence admission, validates exact unexpired ownership both at final transaction entry and immediately before epoch update/commit, and releases only its exact handle. The shared outcome transaction now uses `BEGIN IMMEDIATE`. Lease loss raises `EconomicLeaseOwnershipLostError` and surfaces the typed `lease-lost` reason; R5 owns AbortController fan-out.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| R4a seller leases and fence ownership | `npx vitest run packages/memory/tests/economicSellerLeaseStore.test.ts packages/memory/tests/economicSourceCheckpointStore.test.ts packages/agent/src/economics/pipeline.test.ts` — exit 0; 3 files, 84 passed. `npx tsc -b packages/memory packages/agent --pretty false` — exit 0. Targeted Prettier, ESLint, and `git diff --check` — exit 0. | Real on-disk SQLite with deterministic clock verifies same-seller contention, Plasticov/Maustian isolation, exact expiry, recovery after grace, stale owner rejection, hostile release matrix, fence rejection, and final-write rollback when lease ownership is lost. No sleep, smoke, live call, or external mutation. | Revert R4a changes in `migrationRegistry.ts`, `economicIngestionRunStore.ts`, `economicOutcomeStore.ts`, `EconomicIngestionPipeline.ts`, exports, and `economicSellerLeaseStore.test.ts`. |

## Remediation R3 — Complete (2026-07-12)

- **Scope:** R3 only. Added canonical migrations 1007 metadata/fence and 1008 source checkpoints; no R4 lease, deadline, supersession, alert, commit, smoke, or live work.
- **Implemented:** Seller/source `(orders|claims|product-ads)` checkpoint rows use a compound cursor, version, run ID, constraints, and indexes. The SQLite store exposes typed CAS outcomes with bounded cancellation-aware retry; the pipeline forwards the Orders cursor to fetch, strictly filters/sorts after it, and writes the Orders source checkpoint inside the final transaction after fence validation. Claims and Ads do not advance a checkpoint.
- **Corrective completion:** The historical refund-revision assertion was stale: its order has the same `(occurredAt, sourceRecordId)` as the durable Orders cursor and strict-after resume therefore excludes it. The test now proves no duplicate/supersession occurs. Real SQLite tests now cover fresh/recorded-1006/rerun migration, tied cursors, two-run strict resume, independent-connection CAS, stale/already-applied/insert-race/retry-exhausted classifications, seller/source isolation, Claims and Ads unavailability with only eligible Orders advancement, and a changed fence generation/state rolling back final rows.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| R3 source checkpoints and CAS | `npx vitest run packages/memory/tests/economicSourceCheckpointStore.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/agent/src/economics/pipeline.test.ts` — exit 0; 3 files, 93 passed. `npx tsc -b packages/memory packages/agent --pretty false` — exit 0. Targeted Prettier, ESLint, and `git diff --check` — exit 0. | Temporary on-disk SQLite harness proves upgrade/rerun, source cursor CAS classifications and races across connections, seller/source isolation, partial-source checkpoint isolation, and fenced final-transaction rollback. No live call, smoke, or external mutation. | Revert R3 portions of `migrationRegistry.ts`, `economicIngestionRunStore.ts`, `EconomicIngestionPipeline.ts`, exports, and R3 tests. |

## R2 Targeted Gate Correction — Orders Terminal Short-Circuit (2026-07-12)

- **Scope:** R2 only; R3+ remain unchecked. No migration, checkpoint, lease, backlog durability, smoke, live MercadoLibre access, commit, or suppression was added.
- **Correction:** `createProductionDataFetcher` now immediately returns after any non-success Orders outcome. Claims and Product Ads are not invoked; when the pipeline signal remains active they receive typed zero-attempt `unavailable` / `source-unavailable` outcomes, and when the global signal is aborted they receive typed zero-attempt `aborted` / `global-abort` outcomes. Neither skipped source can appear as `success-empty`.
- **Timeout proof:** Fake-client, fixed-clock tests cover an un-aborted local `AbortError` for Orders, Claims, and Ads as `source-timeout`; paired global-signal cases prove each remains `aborted`. No sleep is used.
- **Terminal Orders proof:** Call-count tests cover unauthorized failure, malformed response, rate-limit retry exhaustion, and global abort. Each proves Claims and Ads were called zero times; the pipeline therefore fails/aborts before enrichment requests.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| R2 Orders terminal fetch gate correction | `npx vitest run packages/agent/src/economics/dataFetcher.test.ts packages/agent/src/economics/pipeline.test.ts` — exit 0; 2 files, 98 passed. `npx tsc -b packages/domain packages/agent --pretty false` — exit 0. Targeted ESLint, Prettier check, and `git diff --check` — exit 0. | Offline fake `EconomicReadClient` and fixed clock cover local timeout/global abort identity plus terminal Orders call counts; the focused pipeline suite exercises the existing temporary SQLite Orders fail-closed path. No sleep, live call, or external mutation. | Revert the terminal branch in `packages/agent/src/economics/dataFetcher.ts` and the matching cases in `packages/agent/src/economics/dataFetcher.test.ts`. |

## Remediation R1 — Bounded Source Fetch Contract (2026-07-12)

## Remediation R2 — Complete (2026-07-12)

- **Status:** Complete; R2 is `[x]` in `tasks.md`. R3+ remain deliberately unchecked.
- **Implemented boundary:** The production fetcher returns payload-free per-source outcomes for Orders, Claims, and Product Ads; it records safe bounded status/reason/attempt metadata, treats global abort distinctly, removes fetcher-invented enrichment zeroes, and reports optional source unavailability. The pipeline rejects non-success Orders outcomes, exposes Claims gap/backlog intent without durable backlog state, and only accepts Ads observed-zero after a confirmed `success-empty` source outcome.
- **Cancellation boundary:** `EconomicReadClient` is an R2 typed adapter seam. Fake clients receive the exact pipeline `AbortSignal`; the shared `MlcApiClient` currently has no signal-taking signatures, so `factory.ts` adapts it explicitly without claiming in-flight cancellation. Global abort before a request consumes zero attempts; abort during a started request or retry backoff consumes one. R5 global deadline scheduling is not implemented.

### Partial Evidence

| Command | Exit | Exact result |
|---|---:|---|
| `npx vitest run packages/agent/src/economics/dataFetcher.test.ts packages/agent/src/economics/pipeline.test.ts` | 0 | 2 files, 91 passed. Offline fake transport/clock and unique temporary on-disk SQLite pipeline cases; no real sleep, live ML, smoke, or external call. |
| `npx tsc -b packages/domain packages/agent --pretty false` | 0 | Domain and agent builds passed. |
| Targeted Prettier | 0 | Canonical Prettier applied only to R2 fetcher/factory/pipeline source and test files; check passed. |
| Targeted ESLint | 0 | No errors in exact R2 files. |
| `git diff --check` | 0 | No whitespace errors. |

### R2 Acceptance Matrix

- Every Orders/Claims/Ads source has offline fake-client success-data, success-empty, 401, 403, 429 Retry-After/retry/exhaustion, 500, network, malformed, abort-before, abort-during-request, and abort-during-backoff coverage.
- Unique on-disk production migration/store/pipeline cases prove Orders source failure preserves the same failed run ID with zero final rows and an intact checkpoint; confirmed Orders empty completes; Claims unavailable keeps refund coverage missing with a non-durable backlog intent; Ads unavailable keeps advertising missing with no zero component while Orders remain eligible.
- Claims checkpoint persistence is deliberately deferred to R4; this R2 result records intent only.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| R2 abort and operational fetch semantics | `npx vitest run packages/agent/src/economics/dataFetcher.test.ts packages/agent/src/economics/pipeline.test.ts` — exit 0; 2 files, 91 passed. | Fake transport/clock verifies request signal identity and all abort timings; unique temporary on-disk SQLite production migration/store/pipeline harness verifies source-result persistence effects. No live request, sleep, smoke, or external mutation. | Revert R2 portions of `dataFetcher.ts`, `dataFetcher.test.ts`, `factory.ts`, `sourceFetch.ts`, `EconomicIngestionPipeline.ts`, and `pipeline.test.ts`. |

- **Status:** Complete. R1 is `[x]`; R2–R8 remain deliberately unchecked.
- **Delivery:** `auto-chain`, `stacked-to-main`; this slice introduces only the reusable contract and exports. It does not alter `dataFetcher`, production fetch catch/flow behavior, run state, backlog persistence, migrations, CLI, daemon, smoke, live MercadoLibre access, or review lifecycle state.
- **Implementation:** `@msl/domain` now owns a discriminated, payload-free `SourceFetchResult` for `orders`, `claims`, `items`, and `product-ads`. Its bounded statuses are `success-with-data`, `success-empty`, `unavailable`, `unauthorized`, `forbidden`, `rate-limited`, `source-timeout`, `transient-failure`, `malformed-response`, and `aborted`. Only `success-empty` represents an empty success. The constructor/guard permit only bounded counters, timestamps, retry values, explicit cursor null markers, and safe reason codes; result guards reject extra raw payload/header fields.
- **Backlog identity:** `createClaimsBacklogIdentity` returns a non-null SHA-256 over a length-prefixed seller, fixed `claims` source, normalized range/cursor null markers, and fixed `claims-recovery` purpose. It accepts no raw JSON/payload/header fields, so object key ordering and those non-contract fields cannot affect the persisted key.
- **Compatibility:** The agent package root exports the dedicated contract module. No temporary marker removal is attributed to R1: `HEAD` already has no marker in `dataFetcher.ts`, and R1's final diff leaves that legacy production module unchanged. The contract explicitly distinguishes `success-empty` from every unsuccessful or aborted outcome; production fetch catches remain deferred to R2.

### Behavior-First Evidence

| Step | Command | Exit | Exact result |
|---|---|---:|---|
| RED | `npx vitest run packages/domain/src/sourceFetch.test.ts -t "rejects unbounded counters"` | 1 | New explicit-null-cursor test failed because `{}` was normalized to null markers. |
| GREEN | Same command | 0 | 1 passed, 13 skipped after requiring explicit cursor fields. |
| Full focused | `npx vitest run packages/domain/src/sourceFetch.test.ts packages/agent/src/economics/sourceFetchContract.test.ts` | 0 | 2 files, 15 passed. |

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| R1 bounded source-fetch contract | `npx vitest run packages/domain/src/sourceFetch.test.ts packages/agent/src/economics/sourceFetchContract.test.ts` — exit 0; 2 files, 15 passed. Covers all statuses, successful-empty semantics, abort accounting, bounded JSON-safe fields, raw payload rejection, and canonical identity isolation. | N/A — this is a pure domain/agent contract with no production fetch-flow wiring; R2 owns the runtime abort/catch path. | Revert `packages/domain/src/sourceFetch.ts`, its test/export, and the agent contract/export/test. This restores the prior fetch behavior without touching existing pipeline/runtime work. |

### Quality Evidence

| Command | Result |
|---|---|
| `npx tsc -b packages/domain packages/agent --pretty false` | exit 0 |
| Targeted Prettier across exact R1 contract/test/export files and OpenSpec records | exit 0; corrective gate rerun confirmed all matched |
| Targeted ESLint across exact R1 contract/test/export files | exit 0; corrective gate rerun reported no errors |
| `git diff --check` | exit 0 |

### R1 Corrective Gate Rerun (2026-07-12)

- **Scope:** R1 only. No R2 production behavior, abort-flow wiring, smoke/live MercadoLibre action, commit, or lifecycle action was performed.
- **Pipeline provenance:** `git blame` and the `6a8ed245` base snapshot prove `PipelineConfig.abortSignal`, `checkAborted`, and the initial `checkAborted(config.abortSignal)` predate R1. The current uncommitted pipeline diff contains prior Slices 1–6 work, but R1 neither introduced nor claims its abort behavior.
- **Legacy fetcher boundary:** R1's previous type-only re-exports were removed from `dataFetcher.ts`. Agent consumers use `economics/sourceFetchContract.ts` through the package root instead, so targeted lint does not include the untouched legacy fetcher and its existing unsafe boundaries. No cast, suppression, catch, or control-flow change was made.
- **Temporary marker provenance:** `HEAD` `dataFetcher.ts` contains no temporary marker, and the final R1 diff contains no `dataFetcher.ts` change. The dedicated contract is an R1 addition, not evidence that R1 removed a marker; the proposal's R7-only marker-removal constraint remains authoritative for any future marker work.

| Command | Exit | Exact result |
|---|---:|---|
| `npx vitest run packages/domain/src/sourceFetch.test.ts packages/agent/src/economics/sourceFetchContract.test.ts` | 0 | 2 files, 15 passed. |
| `npx tsc -b packages/domain packages/agent --pretty false` | 0 | Domain and agent project builds passed with no diagnostics. |
| `npx prettier --check` on the exact R1 domain/agent contract, test, and export files plus R1 OpenSpec records | 0 | All matched files use Prettier code style. `dataFetcher.ts` was excluded because it is no longer R1-touched; `packages/agent/src/index.ts` was canonically formatted as an R1 export file. |
| `npx eslint` on the exact R1 domain/agent contract, test, and export files | 0 | No lint errors; no `any`, casts, or suppressions added to remediate the legacy fetcher. |
| `git diff --check` | 0 | No whitespace errors. |

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| R1 corrective gate rerun | `npx vitest run packages/domain/src/sourceFetch.test.ts packages/agent/src/economics/sourceFetchContract.test.ts` — exit 0; 2 files, 15 passed. | N/A — R1 is a pure domain/agent contract. Production fetch and abort runtime behavior remains R2-only. | Revert `packages/domain/src/sourceFetch.ts`, its test/export, and the agent contract/export/test. This leaves the existing pipeline, `dataFetcher`, and Slices 1–6 work intact. |

## Canonical Current State — V3 Remediation Planned, Not Applied (2026-07-12)

Historical planning state before R1: the failed v2 remediation-design gate was addressed in documentation only. R1 is now complete under the contract above; R2–R8 remain unchecked. R1 adds documented typed semantics through the dedicated contract module; it does not claim to remove or replace a `dataFetcher.ts` marker, and functional propagation remains deferred to R2.

No remediation production code or tests were implemented, executed, or accepted in this planning update. Persistent smoke remains blocked. Every section below this heading is **historical audit evidence**; any conflicting abort/deadline/lease/CAS/migration/restore language is superseded by the V3 canonical policy documents and is not acceptance for R1–R8.

## V4 Documentary Correction — Not Applied (2026-07-12)

Historical V4 documentary correction before R1: R1–R8 were unchecked. The current design resolves the v3 audit findings: global abort releases backlog to pending; attempts start only with requests; the non-null canonical backlog key is restart/seller safe; the exclusive generation/token fence protects every writer without incrementing epoch; CAS rollback uses an independent same-run operational transaction; R4b has only a durable cancellation intent while dispatch and restore remain future R7 work; migration source baseline is verified as 1006 with new 1007–1010; and restore closes/checkpoints WAL/SHM before sidecar-free staged swap/reopen. R1 code/tests now exist; the remaining functional work remains deferred.

The v3 incident remains a final native zero-findings state and cannot provide PASS evidence. A future v4 gate must use a consolidated, lens-labelled native ledger. It may require one refuter batch only if genuine pending inferential severe candidates exist; otherwise a demanded positive counter is documented as incompatible, never manufactured.

### V4 Complete Fixing Correction (2026-07-12)

Historical V4-complete documentary correction: this content did not complete, validate, or otherwise mutate the native transaction. Before R1, all remediation tasks were unchecked. The verified 1006 baseline leads to 1007 metadata/fence, 1008 leases/checkpoints, 1009 backlog/health, and implemented 1010 R4b cancellation intents only. The current reservation corrects R5 to 1011 receipts and R7 to 1012 delivery / 1013 restore; R2 retains its later run-failure migration.

#### Authoritative Correction Evidence — 12-ID Matrix, Schemas, Defaults, and Planned Tests

This is the authoritative documentary correction content for the active change. It is not a transaction mirror, event, test receipt, native operation, or completion claim. R1 is now checked with its independent receipt above; R2–R8 remain unchecked.

##### Frozen Finding Matrix

| ID | Design | Migration | Policy | Specs | Tasks | Test plan / acceptance criterion |
|---|---|---|---|---|---|---|
| RISK-001 | Fence-first writer boundary | 1007→1008→1009→1010 | all dependent writers validate fence | migration framework | R3/R4/R7/R8 | fresh + recorded-1006 + rerun prove no future dependency |
| RISK-002 | journaled recovery | future R7 1013 journal | restore rollback sequence | migration framework | R7 | fault each handle/WAL/rename/reopen/health point |
| RISK-003 | immutable swap equality | 1007 metadata; future R7 1013 journal | identity/manifest gate | migration framework | R3/R7 | Plasticov/Maustian/install/manifest mismatch blocks |
| RISK-004 | same-run failure binding | future R2 run-failure migration | post-rollback CAS binding | durability | R2 | stale writer, changed token/generation/owner rejected |
| RESILIENCE-001 | bounded coordination | 1008/1009/1010 expiry indexes | cadence/CAS/reclaim | durability | R4/R7 | deterministic clock expiry/recovery matrix |
| RESILIENCE-002 | intent before final work | future R2 run-failure migration | idempotent lifecycle/restart | durability | R2 | crash before/after main transaction preserves one run ID |
| RESILIENCE-003 | durable rename phases | future R7 1013 restore journal | startup recovery | migration framework | R7 | recover every nonterminal journal state |
| RESILIENCE-004 | durable inbox and paging | future R7 1012 delivery | deadline/retry/fallback | durability | R7 | crash-after-send idempotency, budget, queue-age page |
| READABILITY-001 | conditional refuter contract | N/A | incident canonical rule | migration framework | R8 | one genuine v4 batch satisfies historical counter |
| READABILITY-002 | explicit defaults | 1008–1012 planned fields/indexes | cadence matrix | durability | R4/R7 | deterministic-clock acceptance matrix |
| RELIABILITY-001 | owner-safe release | 1008/1007 CAS fields | zero-row classification | durability | R4/R5 | hostile lease/fence release matrix; never delete other lease |
| RELIABILITY-002 | durable claim recovery | 1009 Claims; future R7 1012 alert claims | Claims and alert recovery | durability | R4/R7 | deterministic clock plus real SQLite hostile/recovery tests |

##### Final Migration Order and Schemas

Verified source baseline is **1001–1006**, not an applied-production claim.

1. **1007 — metadata + fence:** `economic_database_metadata(database_id, tenant_id, deployment_id, generation, write_epoch, updated_at)` and `economic_database_fence(state, generation, fence_token_digest, owner_run_id, expires_at, updated_at)` singleton.
2. **1008 — seller leases + checkpoints:** `seller_id, source, owner_run_id, lease_token_digest, generation, expires_at` and source checkpoints.
3. **1009 — backlog + health:** non-null unique Claims `backlog_identity_key`, six-state lifecycle, `claim_owner, claim_token_digest, claim_generation, claim_expires_at`, and `economic_source_health`.
4. **1010 — R4b cancellation intents only:** `economic_operational_alert_intents` with deterministic intent/dedup IDs, seller/backlog integrity, allowlisted cancellation metadata, and `pending|consumed`; no inbox, delivery, run-failure, or restore-journal schema. **R5 1011** adds digest-only admission receipts; **future R7 1012** adds delivery/dispatcher/transport state and **future R7 1013** adds `restore_operation_journal`; **future R2** adds `run_failure_intent` later.

`restore_operation_journal` states: `quiescing`, `live-renamed`, `staging-promoted`, `reopening`, `rollback-live-renamed`, `rollback-restored`, `manual-reconcile`, `completed`. CAS persistence is required before each irreversible rename.

##### Defaults and Acceptance Matrices

| Boundary | TTL | Renew | Sweep/recovery | Bound / CAS acceptance |
|---|---:|---:|---:|---|
| Seller lease | 60s | 20s | 15s | owner + token digest + generation; zero rows = stale/replaced |
| Claims backlog claim | 120s | 40s | 30s | max 100 expired rows/sweep; three reclaim failures then defer |
| Database fence | 90s | 30s | 15s | identity + generation + token digest mismatch blocks writer |
| Alert claim | 60s | 20s | poll 10s; reclaim 30s | max 100 rows/sweep; owner/token/generation CAS |
| Alert delivery | 10s send timeout | — | delays 10s/30s/90s | four attempts, 120s retry budget, dead-letter then independent page at age >5m |

| Hostile case | Seller lease/fence expected result | Claims/alert expected result |
|---|---|---|
| invalid or empty token | zero rows; retain current owner | zero rows; retain current claim |
| wrong owner, generation, or seller | zero rows; never delete other lease | zero rows; no foreign claim mutation |
| replaced token / old process | `stale-or-replaced` | `stale-or-replaced` |
| expired then recovered | bounded reclaim; old holder rejected | bounded reclaim; old dispatcher rejected |
| duplicate operation | idempotent current state | inbox/idempotency key prevents duplicate observable send |

##### Restore and Failure Criteria

Automatic swap requires equality of immutable database ID, tenant/deployment identity, generation, and manifest hash. Plasticov/Maustian or installation mismatch blocks and enters `manual-reconcile`. On post-swap failure, the system closes new handles, checkpoints/removes generation sidecars, journals rollback renames, restores the prior candidate, reopens and validates schema/fence/epoch/health. Handle, WAL/SHM, rename, reopen, or health failure stays blocked.

`run_failure_intent` is durable before the main transaction. Its post-rollback CAS binds original admission fence generation/token digest, database generation, observed epoch, and lease owner; startup recovery is idempotent for the same run ID.

##### Remaining Risks

- The contracts are unimplemented and untested; no planned test is a result.
- Persistent smoke remains blocked until R1–R8 and all offline matrices pass.
- This correction content cannot alter native review authority or mark the correction complete.

## Task 4.2 — Reserved Safety Preflight (BLOCKED, 2026-07-12)

- **Scope:** Safety preflight only. No dry-run, persistent smoke, MercadoLibre command, migration, daemon start/stop, commit, push, reset, rebase, merge, or Product Launch Intelligence action was executed.
- **Hard stop:** The approved `real-smoke-plan.md` requires a **clean tree** before any persistent smoke. The repository has intended but uncommitted Slices 1–6/SDD changes, so this condition is **not met**. The plan contains no exception or waiver; task **4.2 remains `[ ]`**.
- **Safe verified facts:** `.env.local` is ignored and untracked; the checked `origin/main` ref equals `HEAD` (no fetch performed); no economic daemon/process was found by the bounded process-name check. The economic runtime uses `MSL_CORTEX_SQLITE_PATH`, while the OAuth status CLI uses `MSL_MERCADOLIBRE_OAUTH_DB_PATH`; their resolved locations, backup freshness/integrity, account read-readiness, and production readiness were deliberately not inspected after the clean-tree hard stop because the request prohibits ML commands or migrations once any condition fails or is unprovable.
- **Canonical-tooling finding:** The project backup primitive is SQLite online backup through `DatabaseManager.backup()` / `backupDatabase()`, with `DatabaseManager.verifyBackup()` executing `PRAGMA integrity_check`; no approved standalone economic backup command was found. No backup was created or inspected after the hard stop, and no database/log artifact was created in the repository.

### Sanitized Preflight Matrix

| Check | Command / method | Exit | Status |
|---|---|---:|---|
| `.env.local` ignored and untracked | `git check-ignore -q .env.local`; `git ls-files --error-unmatch .env.local` | `0`; `1` | PASS |
| Working tree clean | `git status --short` | `0` (reported modified/untracked Slices 1–6/SDD files) | **FAIL — hard blocker** |
| Economic daemon/process inactive | `pgrep -af 'economic|EconomicIngestion|economic-ingestion'` (excluding the inspection shell) | `1` / no matching daemon | PASS |
| `origin/main` relationship, no fetch | `git rev-parse --verify origin/main`; both `git merge-base --is-ancestor` directions | `0`; `0`; `0` | PASS — same commit |
| OAuth DB outside repo / resolved path | Not run after hard stop; no environment values read or printed | N/A | UNPROVEN |
| Economic DB outside repo / resolved path | Not run after hard stop; no environment values read or printed | N/A | UNPROVEN |
| Timestamped verified backup / integrity | Not run or created after hard stop | N/A | UNPROVEN |
| Plasticov source read-ready | Not run after hard stop; status CLI avoided | N/A | UNPROVEN |
| Maustian target read-ready | Not run after hard stop; status CLI avoided | N/A | UNPROVEN |
| Production readiness | Not run after hard stop | N/A | UNPROVEN |
| External operations read-only; one-page/five-order flags | Static review only: smoke plan requires externally read-only and `economicCli` supports `--dry-run`, `--no-persist`, `--max-pages`, and `--limit`; no command executed | N/A | PARTIAL / not runtime-proven |
| No real DB/log output in repo | No smoke, migration, or daemon command ran; no new real DB/log artifact created by this preflight | N/A | PASS for this preflight |

`noExternalMutationExecuted: true`

## Slice 7 — Task 4.1 Offline Proof Gate PASS (Corrective Rerun)

- **Scope:** Phase 4 task **4.1 only**. No smoke/live MercadoLibre activity, commit, push, reset, rebase, merge, or task 4.2 work was performed.
- **Diagnosis:** The component-store failure was a stale assertion: exact `(seller, source, sourceRecordId, economicMeaning, sourceVersion, currency, amount)` repeats must retain the canonical technical ID and create no history row. The existing changed-source-version test confirms a true successor retains its v1 history and makes v2 active. The tools failure also had stale random-ID expectations: two identical snapshot inputs intentionally generate one deterministic snapshot. The regression now proves identical input deduplicates while distinct order/item/sourceVersion/checksum identities persist separately.
- **Gate outcome:** **PASS — task 4.1 is `[x]` in `tasks.md`.** Offline proofs pass; global formatting/lint remain known non-worsening debt (121 format files, 136 lint errors versus initial 138/171). No mass cleanup was performed.

### Corrective Exact Receipts (2026-07-12)

| Command | Exit | Result / warnings |
|---|---:|---|
| `npx vitest run packages/memory/tests/economicCostComponentStore.test.ts packages/agent/src/conversation/tools/economicTools.test.ts` | 0 | 2 files, 58 passed. |
| Focused economics + temporary migration six-file suite | 0 | 6 files, 181 passed; expected injected persistence/aggregate-unavailable logs only. |
| `npm test` | 0 | 183 passed files, 2 skipped; 3465 passed tests, 7 skipped. |
| `npm run typecheck` | 0 | Root and web TypeScript checks passed. |
| `npm run build` | 0 | Build passed; pre-existing Next `instrumentationHook` warning only. |
| `npm run test:e2e` | 0 | 1 file, 6 passed. |
| Changed-file Prettier | 0 | All changed TypeScript and Markdown files match. |
| Changed-file ESLint | 1 | 12 pre-existing errors in `economicCli.test.ts`, unchanged from the prior proof receipt; no errors in this corrective pair. |
| `npm run format:check` | 1 | 121 formatting-warning files, improved by 17 from the 138-file baseline. |
| `npm run lint` | 1 | 136 errors, unchanged from the current improved baseline and improved by 35 from the initial 171-error baseline. |
| `git diff --check` | 0 | No whitespace errors. |

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 7: task 4.1 corrective offline proof | The two failing suites pass (58 tests); focused economic/temp-migration suite passes 181 tests; full suite passes 3465 tests. | In-memory and temporary SQLite production migration/store/pipeline harnesses pass; no external MercadoLibre call, smoke, or mutation. | Revert the two stale-test corrections in `economicCostComponentStore.test.ts` and `economicTools.test.ts`, plus this task/progress evidence. |

## Slice 6 — PASS Recorded / Slice 7 (Task 4.1) Offline Proof Gate

- **Slice 6 reviewer outcome:** **PASS**. Tasks **3.1** and **3.2** are now marked `[x]` in `tasks.md`. This records the accepted seller/run isolation, fail-closed JSON error, sanitizer, factory runtime, and daemon evidence already captured below.
- **Scope:** Phase 4 task **4.1 only**. No smoke or live MercadoLibre activity, commit, push, reset, rebase, merge, or task 4.2 work was performed.
- **Gate outcome:** **BLOCKED — task 4.1 remains `[ ]`** because `npm test` exited `1` with two unrelated failing tests. Global formatter/linter remain red baseline debt and are not reported green. Changed files are Prettier-clean and have no introduced lint worsening.

### Exact Offline Receipts (2026-07-12)

| Command | Exit | Duration | Result / warnings |
|---|---:|---:|---|
| `npx vitest run packages/agent/src/cli/economicCli.test.ts packages/agent/src/workers/economicIngestionDaemon.test.ts packages/agent/src/economics/pipeline.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/memory/tests/economicRunProvenanceStore.test.ts packages/memory/src/economicEvidenceStore.test.ts` | 0 | real 6.16s | 6 files, 176 passed. Includes the offline temporary-migration suite (13 passed) and production SQLite migration/pipeline harnesses. Expected fail-closed/aggregate-unavailable test logs were emitted. |
| `npx prettier --check $(git diff --name-only HEAD -- '*.ts' '*.md')` | 0 | real 2.63s | All changed TypeScript and OpenSpec Markdown files match Prettier. |
| `npx eslint $(git diff --name-only HEAD -- '*.ts')` | 1 | real 14.60s | 12 errors, all in pre-existing `packages/agent/src/cli/economicCli.test.ts` locations; previous Slice 6 receipt was 17 errors, delta **-5**. No changed production-source lint error. |
| `git diff --check` | 0 | real 0.21s | No whitespace errors. |
| `npm run typecheck` | 0 | real 3.90s | Root and web TypeScript checks passed. |
| `npm test` | 1 | real 65.19s | 2 failed, 3463 passed, 7 skipped. Failures: `economicCostComponentStore.test.ts` expects a successor ID but receives the same ID; `economicTools.test.ts` expects 2 snapshots but receives 1. These are outside this proof-only task's edits and block smoke eligibility. Test-run warnings include expected insecure-development encryption-key, mocked daemon/LLM/API failures, and economic aggregate-unavailable fixtures. |
| `npm run build` | 0 | real 42.42s | Build passed. Warning: Next.js reports unsupported `instrumentationHook` in `next.config.ts`. `.env.local` was detected by Next.js but was not read. |
| `npm run test:e2e` | 0 | real 9.45s | 1 file, 6 passed; Vitest duration 6.25s. |
| `npm run format:check` | 1 | real 32.35s | **Not green**: 122 formatting-warning files. This observed baseline is lower than the supplied 138-file baseline (delta -16); no mass formatting was performed. |
| `npm run lint` | 1 | real 60.09s | **Not green**: 136 errors, 0 warnings. This observed baseline is lower than the supplied 171-error baseline (delta -35); no mass lint cleanup was performed. |

### Required Safety Scans

- Active SDD change confirmed at `openspec/changes/finalize-economic-run-consistency/`; tasks 3.1–3.2 are checked and 4.1–4.4 remain pending.
- Filename-only tracked/untracked artifact scan found only tracked `.env.example`; no SQLite/`-wal`/`-shm`/backup/log/real-data/secret artifact was tracked or untracked. `git status --ignored --short -- .env.local` returned `!! .env.local`, confirming it is ignored without reading it.
- Direct changed-economic-file review classified productive counters (`componentsCreated`, `snapshotsCreated`, `evidenceCreated`, `duplicatesIgnored`) as persistence-result counters incremented only after their corresponding store outcome; no introduced productive `Math.random`, empty reconciliation, or fake cumulative aggregate was found. Existing casts/suppressions and sensitive-word matches outside this slice were not introduced; the Slice 6 sanitizer intentionally contains redaction vocabulary and its focused tests passed.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 7: task 4.1 offline proof gate | Focused six-file economic suite above — exit 0; 176 passed; includes temporary migration. Changed-file Prettier exit 0, changed-file ESLint exit 1 only for 12 pre-existing test-file errors (delta -5), `git diff --check` exit 0. | Offline only: production migration plan plus in-memory/on-disk temporary SQLite test harnesses; no external MercadoLibre call, smoke command, or mutation. Global suite has two unrelated failures, therefore the gate is blocked. | Revert only this `tasks.md` acceptance record and this proof receipt; no production code changed by task 4.1. |

## Slice 6 — Corrective Security Boundary (awaiting reviewer gate)

- **Targeted corrective rerun (2026-07-12):** Tasks **3.1–3.2 remain intentionally unchecked** pending the reviewer gate. No later task, smoke, commit, push, or external MercadoLibre action was run.
- The `maxOutputCharacters = 10,000` sanitizer limit is now an exact global serialized JSON boundary: after bounded descriptor-safe traversal, the sanitizer checks the actual `JSON.stringify` length, including keys, punctuation, structural overhead, finite numbers, booleans, nulls, and sentinels. Oversize output becomes the JSON-safe `{ "truncated": "[output-budget-exhausted]" }` sentinel. A 1,000-node traversal cap prevents nested array/object expansion before that final check.
- `--json` parse, invalid-command/seller, injected runtime-factory, handler/store, and finalization failures now return a sanitized parseable error envelope with `result.noExternalMutationExecuted = true` and exit `1`; only the outer executable main performs its final process exit. Human-mode default-seller warning remains on stderr only outside JSON mode.
- The finalization-failure test is deterministic: its in-memory SQLite trigger/runtime is closed by the guarded `finally` cleanup, avoiding retained handles. It passed five consecutive focused runs (1 passed, 44 skipped each; exits 0).

### Corrective Rerun Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 6 security boundary rerun | `npx vitest run packages/agent/src/cli/economicCli.test.ts` — exit 0; 1 file, 46 passed. Includes adversarial nested numeric/sentinel/wide/huge serialization-budget proof plus invalid-command/seller, handler-store, and factory-error JSON tests. `npx vitest run packages/agent/src/workers/economicIngestionDaemon.test.ts` — exit 0; 1 file, 7 passed. | `npx vitest run packages/agent/src/cli/economicCli.test.ts packages/agent/src/workers/economicIngestionDaemon.test.ts packages/agent/src/economics/pipeline.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/memory/tests/economicRunProvenanceStore.test.ts packages/memory/src/economicEvidenceStore.test.ts` — exit 0; 6 files, 176 passed. Offline injected SQLite finalization, handler-store, and factory failure paths validate valid JSON, redaction, non-zero behavior, and no external mutation. | Revert `packages/agent/src/economics/economicSanitizer.ts` and this corrective batch's `economicCli.ts` / `economicCli.test.ts` changes. |

| Quality command | Exact result |
|---|---|
| `npm run typecheck` | exit 0 |
| Targeted Prettier (sanitizer, CLI, CLI tests, daemon, daemon tests) | exit 0; all matched canonical Prettier style |
| `npx eslint packages/agent/src/economics/economicSanitizer.ts` | exit 0; `EconomicSanitizedRecord` uses the repository type-alias convention; no suppression, cast, or `any` added |
| Targeted ESLint baseline comparison for `economicCli.test.ts` | HEAD baseline: 17 pre-existing errors; current: 12 errors; delta **-5**. New sanitizer/CLI/daemon production sources have no new lint errors. |
| `git diff --check` | exit 0 |
| Forbidden search | No `eslint-disable`, `@ts-ignore`, or `as any` in corrected sanitizer/CLI/test additions. `process.exit` occurs only in outer `main`; `process.stderr.write` occurs only for the human-mode default-seller warning. |

- Tasks **3.1–3.2 are intentionally unchecked** in `tasks.md`; this corrective batch is implemented but not accepted.
- Replaced the permissive boundary sanitizer with `sanitizeEconomicDetails(value: unknown): EconomicSanitizedValue` and record helper. It returns JSON-safe finite primitives, bounded arrays/plain descriptor-read objects, and safe fallbacks; it never reads getters or Error stacks.
- Historical limit note superseded by the targeted corrective rerun above: depth `6`, object keys `50`, array items `50`, input/output string `300` characters, and an exact serialized JSON cap of `10,000` characters. Cycles, dates/binary/non-plain objects, functions, symbols, bigints, non-finite numbers, getters, and inaccessible values receive explicit safe markers.
- Redacted key classes: tokens, credentials, authorization/cookies, secret/password/API/encryption keys, OAuth state, headers/raw/payload/request/response/body, and buyer/contact/document fields. Strings redact bearer/JWT, email, credential URLs, sensitive query/assignment values, absolute paths, stack lines, and secret-like long values.
- CLI failed-ingest output now includes sanitized reconciliation status/reason codes and preserves `status: failed`, exit `1`, and `noExternalMutationExecuted: true`; no raw reconciliation details are emitted. Existing CLI command results and daemon failures pass the same boundary.
- The two parameterized CLI JSON-validity callbacks now use explicit `(): void` callbacks, eliminating their new `no-unsafe-return` behavior without casts or suppressions.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 6 corrective security boundary | `npx vitest run packages/agent/src/cli/economicCli.test.ts -t "sanitizeEconomicDetails"` — exit 0 before the final raw-payload assignment expansion; 1 passed, 41 skipped. Subsequent CLI/sanitizer, daemon, ESLint, typecheck, and full-suite commands were attempted but the command runner timed out without output/exit receipt; reviewer rerun is required. | Offline injected failed-ingest test covers email/raw payload/path/stack redaction, reason code, valid JSON, exit 1, and no-mutation; sanitizer test covers Error/cycle/large/deep/Date/binary/function/symbol/bigint/getter and safe economic fields. Receipt pending due runner timeout. No external call or mutation. | Revert `packages/agent/src/economics/economicSanitizer.ts` and the corrective `economicCli.ts`/`economicCli.test.ts` changes only. |

### Corrective Quality Evidence

| Command | Result |
|---|---|
| `npx prettier --write packages/agent/src/economics/economicSanitizer.ts packages/agent/src/cli/economicCli.test.ts` then targeted `--check` | exit 0; all three targeted files matched. |
| Focused/full CLI, daemon, Slice 6 economic suite, typecheck, targeted ESLint, diff check | Not accepted: retry required because the runner timed out before an exit receipt after the final changes. |
| ESLint baseline | Prior baseline was 17 errors; the two parameterized `no-unsafe-return` sites were corrected. Current exact count requires the timed-out targeted rerun. |

## Slice 6 — Corrective Runtime Rerun

- Delivery mode: `auto-chain`, `stacked-to-main`; Runtime work unit only. No proof/global/smoke, commit, push, or live MercadoLibre activity was run.
- `status --run` now emits only a selected `run` summary; it no longer reads or emits seller-wide `totalRuns`. Run historical metrics are the durable metrics captured on that run or explicitly `unavailable`.
- A selected unknown or foreign-seller run now fails closed with sanitized non-zero JSON for `status`, `coverage`, `reconcile`, `missing`, and `inspect-evidence`. The error contains neither the requested ID nor foreign seller data.
- Added the shared `economicSanitizer` boundary used by the CLI and daemon. It redacts emails, document-like numbers, credential/token/secret/API-key and raw/payload values, and stack paths.
- Corrected the three new `unbound-method` assertions by retaining local Vitest mock references; no ESLint suppression was added.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 6 corrective runtime rerun | `npx vitest run packages/agent/src/cli/economicCli.test.ts packages/agent/src/workers/economicIngestionDaemon.test.ts packages/agent/src/economics/pipeline.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/memory/tests/economicRunProvenanceStore.test.ts packages/memory/src/economicEvidenceStore.test.ts` — exit 0; 6 files, 170 tests passed. | Offline injected CLI runtime proves selected-run `missing` and `reconcile` use seller-plus-run snapshots; `status`, coverage, reconciliation, missing, and evidence reject unknown and foreign runs with parseable non-leaking JSON and exit 1. Daemon factory-failure harness proves email, credential, raw-payload, and stack-path redaction. No external call or mutation. | Revert `packages/agent/src/economics/economicSanitizer.ts` and this batch's CLI/daemon source and test changes. Pipeline, stores, migrations, and prior runtime wiring remain intact. |

### Corrective Quality Evidence

| Command | Result |
|---|---|
| Targeted Prettier | Output: `All matched files use Prettier code style!`; command runner did not return before its timeout after that output. |
| Targeted ESLint | The resulting report contains 17 pre-existing `economicCli.test.ts` violations; the three selected-run `unbound-method` violations are absent. Command runner did not return before its timeout. |
| `npm run typecheck` | Both root and web `tsc` phases printed successful completion with no diagnostics, but the command runner did not return before its timeout. |
| `git diff --check` | exit 0. |

The focused runtime test evidence is complete. The timeout-affected quality commands must be re-executed by the next verification runner for an exit-code receipt; no task checkbox was changed solely to claim those receipts.

## Slice 6 — Runtime CLI and Daemon

- Delivery mode: `auto-chain`, `stacked-to-main`; runtime work unit only, under the 800-line budget.
- Boundary: tasks 3.1–3.2. No smoke, live MercadoLibre command/account, commit, push, reset, rebase, merge, or branch operation.
- CLI `--run` now resolves a seller-owned durable run for status and applies seller-plus-run store APIs to coverage, reconciliation, missing inputs, and evidence. A foreign or absent run returns safe non-zero JSON without exposing another seller. Ingest output preserves the persisted `runId` and includes seller, coverage, reconciliation, checkpoint, and `noExternalMutationExecuted`.
- Run-scoped component, snapshot, and evidence views always predicate seller plus run. Historical totals are returned only from durable run metrics; otherwise cumulative metrics are explicitly `unavailable`, never inferred from a display list.
- The daemon now creates a productive `EconomicIngestionRuntime` (or an injected test equivalent) and calls its already-wired pipeline, so it cannot bypass the factory's shared DB run/evidence dependencies or durable finalization. Its bounded finding reports run evidence and no-external-mutation status; errors are sanitized.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 6: CLI and daemon runtime | `npx vitest run packages/agent/src/cli/economicCli.test.ts packages/agent/src/workers/economicIngestionDaemon.test.ts packages/agent/src/economics/pipeline.test.ts` — exit 0; 3 files, 104 tests passed. | Offline injected durable runtime proves daemon uses the factory runtime for `source`, invokes its durable pipeline with persistence enabled, reports run/checkpoint/no-external-mutation state, and closes it. CLI tests prove same-seller run selection, foreign-seller rejection, run-scoped component/snapshot APIs, valid JSON, and sanitized non-zero failure output. No external call or mutation. | Revert Slice 6 changes in `packages/agent/src/cli/economicCli.ts`, `packages/agent/src/workers/economicIngestionDaemon.ts`, and their focused tests. This leaves pipeline/store finalization and prior slices intact. |

### Quality Evidence

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx prettier --check` on Slice 6 sources/tests and OpenSpec artifacts | exit 0 |
| `npx eslint packages/agent/src/cli/economicCli.ts packages/agent/src/workers/economicIngestionDaemon.ts packages/agent/src/workers/economicIngestionDaemon.test.ts` | exit 0 |
| `npx eslint packages/agent/src/cli/economicCli.test.ts` | exit 1: 20 pre-existing test-file violations; no new source lint violation remains. |
| `git diff --check` | exit 0 |

## Slice 5 — PASS

- Reviewer gate: **PASS**. Tasks **2.5** and **2.6** are complete and are marked `[x]` in `tasks.md`.
- Acceptance evidence: the final reviewer gate accepted the real migrated SQLite reopen matrix, including the 25-order cardinality/cursor case, five repeated focused runs, and the targeted format/typecheck/lint/diff checks.
- Scope remains closed: no runtime/CLI work, smoke, live MercadoLibre activity, commit, push, reset, rebase, or merge was performed for Slice 5.

## Slice 5 — Reviewer-Gate Correction

- Delivery mode: `auto-chain`, `stacked-to-main`.
- Boundary: tasks 2.5–2.6 only. No runtime/CLI expansion, smoke, live ML, reset, rebase, merge, commit, push, or branch operation.
- Reviewer state: implemented, but **2.5–2.6 remain unchecked pending reviewer gate**.
- Formatting blocker corrected: `npx prettier --write packages/agent/src/economics/pipeline.test.ts` followed by `npx prettier --check packages/agent/src/economics/pipeline.test.ts` — exit 0. Prettier's prior nonconformant ranges were `160–180`, `2115–2237`, and `2382–2412`; it was applied only to this file.
- Formatting diff classification: outside the new 25-order reopen proof, the canonical Prettier diff is formatting-only (wrapping, indentation, commas, parentheses, and spaces). No existing test scenario, fixture data, assertion, or expectation was changed by formatting.

### 25-Order Reopen Evidence

- Real reopen: **Yes**. The cardinality test closes the initial migrated `better-sqlite3` connection, opens a **new** connection to the same temporary file, recreates production SQLite run/outcome/evidence stores, and closes that new connection in `finally`; the helper then removes the temporary SQLite directory (including possible WAL/SHM artifacts).
- Initial connection evidence: 25 fetched orders, 50 normalized lines, 25 evidence rows, 0 components, 50 snapshots, correct initial checkpoint `(2026-02-01T00:00:00Z, order-025)`, `quick_check = ok`, `foreign_key_check = []`, and no orphan joins.
- Reopened connection evidence: the same run is `plasticov`/`completed` with 25 fetched orders; 25 run-scoped evidence rows, 0 components, and 50 snapshots; snapshots `<=` 50 normalized lines; all 25 evidence rows have the same run ID and seller, zero cross-seller rows, 25 distinct source order IDs (no truncation or duplicates), and final cursor `(2026-02-01T00:00:00Z, order-025)` with the current run ID. `quick_check = ok`, `foreign_key_check = []`, and all evidence/component/snapshot run-orphan joins are zero.
- Five repetitions: `npx vitest run packages/agent/src/economics/pipeline.test.ts -t "persists 25 tied-timestamp multi-item orders and advances the compound cursor"` — exit 0 on each of five runs; 1 passed, 68 skipped per run. Each emitted 25 fetched orders, 50 normalized lines, 25 evidence, 0 components, and 50 snapshots.

### Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 5 reviewer-gate correction | Eight Slice 5 group commands (contradictory claim, zero/missing, tolerance, both seller mismatches, normalization A–F, six rollback boundaries, cumulative/reopen, and cardinality) — exit 0; 1 matching test each except rollback with 6 passed. `npx vitest run packages/agent/src/economics/pipeline.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/memory/tests/economicRunProvenanceStore.test.ts packages/memory/src/economicEvidenceStore.test.ts` — exit 0; 4 files, 123 passed. | Production migration plan plus unique on-disk SQLite files and production stores/pipeline. The 25-order scenario closes its initial connection and validates a new connection against the same file as detailed above; all runtime evidence is offline with no ML, smoke, or external mutation. | Revert the 25-order reopen assertions and canonical formatting in `packages/agent/src/economics/pipeline.test.ts`, plus this reviewer-gate evidence. No production source, runtime/CLI, migration, smoke, or live-data behavior belongs to this correction. |

### Corrective Quality Evidence

| Command | Result |
|---|---|
| `npx prettier --check packages/agent/src/economics/pipeline.test.ts` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npx eslint packages/agent/src/economics/pipeline.test.ts` | exit 0 |
| `git diff --check` | exit 0 |

### Current Slice 5 Task State

- [ ] 2.5 Reconciliation/checkpoint RED acceptance coverage — implemented; awaiting reviewer gate.
- [ ] 2.6 Pre-transaction eligibility and atomic compound checkpoint persistence — implemented; awaiting reviewer gate.

## Slice 1 — Canonical Migration Foundation

- Delivery mode: `auto-chain`, `stacked-to-main`.
- Boundary: canonical SQLite migration plan and runtime initialization only.
- Completed tasks: 1.1, 1.2 (corrective rerun accepted).
- Deferred: seller/run store APIs, provenance writes, idempotency behavior, pipeline finalization, runtime wiring, and documentation.

## Completed Work

- Added `createEconomicMigrationPlan()` as the only migration-mode plan for economic tables, provenance columns, durable checkpoint/result fields, duplicate-conflict reporting, business-key enforcement, and seller/run indexes.
- Kept factory-only canonical application before store construction. Migration-mode evidence constructors now prepare statements only and cannot re-apply the plan.
- Made `schema_version` ownership-aware: economic stages are selected by their recorded versions rather than an unrelated global maximum, so a version above 1004 cannot silently skip the plan.
- Added row-preserving legacy snapshot compatibility: legacy `id` is copied to nullable `snapshot_id`; missing store-read/write columns are added without deleting or rewriting legacy rows.
- Added `checkpoint_advanced` durability plus compound checkpoint cursor storage/API compatibility for `(occurred_at, source_record_id)` while retaining legacy `last_order_*` columns.
- Reported legacy component-key conflicts, exempted only those pre-existing conflict rows from the partial unique index, and enforced the business key for new/non-conflicting components without destructive deduplication.
- Kept legacy initialization active when migration mode is disabled; legacy provenance remains nullable.
- Added offline fresh-schema, legacy-null, constructor-preparation, legacy-store read/write, global-version ownership, duplicate-conflict/enforcement, re-run, and temporary-database coverage.

## Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 1: canonical migration foundation corrective rerun | `npx vitest run packages/memory/tests/economicDurabilityMigration.test.ts packages/memory/src/economicOutcomeStore.test.ts packages/memory/src/economicEvidenceStore.test.ts` — exit 0; 3 files, 80 tests passed | Same command covers in-memory SQLite and isolated temporary SQLite: factory-owned migration preparation, legacy snapshot upgrade then actual outcome/run/evidence store initialization/read/write, durable `(occurredAt, sourceRecordId)` checkpoint, conflict reporting/enforcement, ownership above global version 1004, and idempotent re-run — exit 0 | Revert Slice 1 changes in `migrationRegistry.ts`, store migration guards/compatibility, and `economicDurabilityMigration.test.ts` together; no pipeline, CLI, daemon, live DB, or external behavior is included. |

## Quality Evidence

| Command | Result |
|---|---|
| `npx prettier --check packages/memory/src/migrationRegistry.ts packages/memory/src/economicEvidenceStore.ts packages/memory/src/economicOutcomeStore.ts packages/memory/src/economicIngestionRunStore.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/agent/src/economics/factory.ts packages/memory/src/index.ts` | exit 0 |
| `npx eslint packages/memory/src/migrationRegistry.ts packages/memory/src/economicEvidenceStore.ts packages/memory/src/economicOutcomeStore.ts packages/memory/src/economicIngestionRunStore.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/agent/src/economics/factory.ts packages/memory/src/index.ts` | exit 0 |
| `npx tsc -b packages/memory packages/agent --pretty false` | exit 0 |
| `git diff --check` | exit 0 |

## Slice 5 — Targeted Corrective Rerun

- Delivery mode: `auto-chain`, `stacked-to-main`.
- Boundary: tasks 2.5–2.6 only; no runtime/CLI expansion, smoke, live ML, commit, push, or branch operation.
- This supersedes the rejected Slice 5 acceptance claims above. Every corrected group now creates its own temporary on-disk SQLite database, applies `createEconomicMigrationPlan()`, uses production SQLite outcome/run/evidence stores plus `runEconomicIngestion`, closes the original connection, opens a new connection/store set, and checks `quick_check`, `foreign_key_check`, and evidence/component/snapshot run-orphan joins.

### Corrected Durable Evidence

| Group | Exact durable/reopen evidence |
|---|---|
| Contradictory claim | Durable `plasticov` failed run with `disputed` / `critical-dispute`, `checkpoint_advanced=0`, prior `(100, prior, prior-run)` cursor, and zero run-scoped evidence/components/snapshots before and after reopen. |
| Observed zero vs missing | Reopened run results preserve `observed-zero` versus `missing` for marketplace fee, shipping, ads, and product cost. Explicit zero persists 1 evidence/1 seller-discount component/1 partial snapshot; missing persists 1 evidence/0 components/1 partial snapshot; neither writes a zero-valued target cost component. |
| Tolerance | Exact and one-minor-unit cases reopen as completed with 1 evidence/3 components/1 partial snapshot, product/landed `missing` coverage, and advanced `order-1` cursor. One-over reopens failed/mismatched with zero final rows and the prior cursor. |
| Seller mismatch | Both `plasticov → maustian` and `maustian → plasticov` reopen as seller-scoped failed `seller-mismatch` runs, preserve their prior cursor, have zero evidence/components/snapshots, and have zero run rows for the incorrect seller. |
| Normalization A–F | Drop line, wrong seller, invalid timestamp, empty order ID, empty source version, and extra line each reopen as failed `normalization-mismatch` runs with zero final rows and the prior cursor. |

## Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 5 targeted corrective rerun | Five individual group commands (`-t` contradictory, zero/missing, tolerance, seller mismatch, normalization) — exit 0; 1 matching test each. `npx vitest run packages/agent/src/economics/pipeline.test.ts` — exit 0; 1 file, 69 tests passed. | Unique migrated on-disk SQLite file per scenario; production migrations/stores/pipeline; close/reopen with new stores; row counts, durable run/reconciliation/coverage/checkpoint/cursor/seller-run associations, `quick_check=ok`, `foreign_key_check=[]`, and zero orphan joins — all passed. No live ML, smoke, or external mutation. | Revert only the corrected Slice 5 assertions and helpers in `packages/agent/src/economics/pipeline.test.ts`; no production behavior, runtime/CLI, migration, smoke, or live data changes are part of this corrective batch. |

### Corrective Quality Evidence

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx eslint packages/agent/src/economics/pipeline.test.ts` | exit 0 |
| `git diff --check` | exit 0 |
| `npx prettier --check packages/agent/src/economics/pipeline.test.ts openspec/changes/finalize-economic-run-consistency/tasks.md openspec/changes/finalize-economic-run-consistency/apply-progress.md` | exit 1: `pipeline.test.ts` remains nonconformant. No broad formatting rewrite was applied to the pre-existing 1,900+ line active-file diff. |

## Corrective Task Status

- [x] 2.5 Reconciliation/checkpoint RED acceptance coverage.
- [x] 2.6 Pre-transaction eligibility and atomic compound checkpoint persistence.
- [ ] 3.1–3.2 Runtime wiring remains out of scope.
- [ ] 4.1–4.4 Proof gates, documentation, and lifecycle approval remain out of scope.

## Slice 3 — Run Identity and Finalization Aggregate

- Delivery mode: `auto-chain`, `stacked-to-main`.
- Boundary: tasks 2.1–2.2 only — generated run identity through initial persistence, pure terminal aggregate construction, and durable row round-trip parity. Reconciliation and checkpoint eligibility policy remain deferred to 2.3–2.6.
- RED evidence: `npx vitest run packages/agent/src/economics/pipeline.test.ts` initially failed with collision retries attempted once and `finalizeEconomicIngestionRun is not a function` (exit 1; 2 failing tests).

## Completed Work

- Added behavior-first identity tests for injected run IDs, primary-key collision exhaustion before the fetcher, fetch/persistence failures retaining the original ID, persisted/returned aggregate equality, and pure finalization identity preservation.
- Retries only SQLite primary-key/unique run-ID collisions, using up to three `RunIdFactory` candidates before all external reads; collision exhaustion returns the last attempted ID rather than allocating a synthetic failure ID.
- Retained the created run in the outer failure path so fetch and transaction failures never create a second UUID or `failed-run` fallback.
- Added pure `finalizeEconomicIngestionRun(existingRun, result)`, which returns a new terminal immutable aggregate while preserving run, seller, process mode, sources, start time, and the no-mutation invariant.
- Persisted the exact finalized aggregate inside the transaction and expanded row reconstruction to preserve serialized errors and checkpoint fields. Initial persistence now stores source kinds for truthful row parity.

## Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 3: run identity and finalization aggregate | `npx vitest run packages/agent/src/economics/pipeline.test.ts` — exit 0; 1 file, 42 tests passed | Same in-memory SQLite pipeline harness exercises injected initial ID → run row → returned finalized aggregate equality, three collision attempts before the mocked fetcher, and fetch/transaction failures retaining the candidate ID — exit 0 | Revert `EconomicIngestionPipeline.ts`, `economicIngestionRun.ts`, `economicIngestionRunStore.ts`, and the Slice 3 additions in `pipeline.test.ts` together. This does not include idempotent entity work (2.3–2.4), reconciliation/checkpoint policy (2.5–2.6), CLI/daemon, smoke, or external calls. |

## Slice 3 Quality Evidence

| Command | Result |
|---|---|
| `npx tsc -b packages/domain packages/memory packages/agent --pretty false` | exit 0 |
| `npx prettier --check packages/domain/src/economicIngestionRun.ts packages/memory/src/economicIngestionRunStore.ts packages/agent/src/economics/EconomicIngestionPipeline.ts packages/agent/src/economics/pipeline.test.ts` | exit 0 |
| `npx eslint packages/domain/src/economicIngestionRun.ts packages/memory/src/economicIngestionRunStore.ts packages/agent/src/economics/EconomicIngestionPipeline.ts` | exit 0 |
| `git diff --check` | exit 0 |

`npx eslint packages/agent/src/economics/pipeline.test.ts` exits 1 only for six pre-existing violations (`beforeAll` unused and five `no-unused-expressions`); the authored collision assertion's `unbound-method` violation was corrected without suppressions.

## Remaining Tasks

- [x] 1.1–1.4 Migration and store provenance foundation.
- [x] 2.1–2.2 Run identity and finalization aggregate.
- [ ] 2.3–2.6 Entity identities, reconciliation, and checkpoint transaction.
- [ ] 3.1–3.2 CLI and daemon wiring.
- [ ] 4.1–4.4 Proof gates, documentation, and lifecycle approval.

## Slice 3 — Third Corrective Rerun: Post-Create Boundaries and CLI Propagation

- Delivery mode: `auto-chain`, `stacked-to-main`.
- Boundary: tasks 2.1–2.2, plus the minimum transversal CLI failure-propagation proof required by durability R2. Task 3.1 remains unchecked: seller `--run`, daemon, and remaining runtime coverage are not implemented.
- Prior gate cause: the second Slice 3 gate had no real pipeline coverage for controlled normalization/adaptation failures after durable `createRun`, no real final Run Store update failure after prepared writes, and no real CLI handler proof that this failure produces a safe non-zero result.
- Canonical contract audit conclusion: proposal, design, durability R2/R3, run-identity invariant, and rollback/checkpoint policy agree. A post-create error retains the one durable ID, leaves `checkpoint_advanced = 0` and the prior checkpoint intact, rolls back final economic rows, returns/persists a sanitized failed aggregate when possible, and must become a non-zero CLI result. No spec or design contradiction was found.

## Completed Work

- Added explicit, production-defaulted pipeline execution seams only for controlled boundary-failure proof. The tests call the real normalizer/marketplace-fee adapter from the pipeline route before raising their controlled failure; no test bypasses the pipeline.
- Added real temporary SQLite tests covering post-create normalization failure (`...0124`) and adapter failure (`...0125`): valid fetched data, one initial/persisted/failed ID, durable failed row parity, sanitized error, zero evidence/components/snapshots, unchanged or absent checkpoint, `checkpoint_advanced = 0`, absent `checkpointAfter`, and `noExternalMutationExecuted: true`.
- Added real SQLite `BEFORE UPDATE` finalization triggers after successful fetch/normalization/adapters and prepared writes. `...0126` rejects only `completed`, proving transaction rollback and best-effort failed aggregate persistence; `...0128` rejects both terminal statuses, proving sanitized failed return/no success when failed marking is unavailable.
- Extended the real `runCli` handler proof (`...0127`) using an injected runtime factory backed by real SQLite stores and the same finalization trigger. The handler emits valid JSON with failed status, the unchanged run ID, `noExternalMutationExecuted: true`, sanitized error, and exit code 1.

## Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 3 third corrective rerun | `npx vitest run packages/agent/src/economics/pipeline.test.ts -t "durably finalizes the original run after controlled post-create normalization failure" && npx vitest run packages/agent/src/economics/pipeline.test.ts -t "durably finalizes the original run when an invoked adapter fails" && npx vitest run packages/agent/src/economics/pipeline.test.ts -t "rolls back prepared rows and best-effort marks the original run failed when finalization fails"` — exit 0; 3 commands, 1 passed test each. `npx vitest run packages/agent/src/economics/pipeline.test.ts -t "returns a sanitized failed result when finalization and failed marking both fail"` — exit 0; 1 passed test. `npx vitest run packages/agent/src/cli/economicCli.test.ts -t "propagates a real finalization failure as sanitized non-zero JSON with the original run ID"` — exit 0; 1 passed test. | Real in-memory SQLite stores and tables: post-create normalizer and actual marketplace-fee adapter route failures; `completed`-only and terminal-status Run Store triggers verify rollback, best-effort failed marking, and unavailable-marking failure; real `runCli` handler verifies JSON/non-zero propagation. All use `noExternalMutationExecuted: true`; no ML call or external mutation occurs. | Revert `PipelineExecutionOverrides` and the five focused tests in `EconomicIngestionPipeline.ts` / `pipeline.test.ts`, plus the failed-ingest JSON result addition and its test in `economicCli.ts` / `economicCli.test.ts`. This does not affect 2.3–2.6, seller `--run`, daemon wiring, smoke, or external behavior. |

## Third Corrective Quality Evidence

| Command | Result |
|---|---|
| `npx vitest run packages/agent/src/economics/pipeline.test.ts packages/memory/tests/economicIngestionRunStore.test.ts packages/agent/src/cli/economicCli.test.ts` | exit 0; 3 files, 95 tests passed |
| `npm run typecheck` | exit 0 |
| `npx prettier --check packages/agent/src/economics/EconomicIngestionPipeline.ts packages/agent/src/economics/pipeline.test.ts packages/agent/src/cli/economicCli.ts packages/agent/src/cli/economicCli.test.ts openspec/changes/finalize-economic-run-consistency/tasks.md openspec/changes/finalize-economic-run-consistency/apply-progress.md` | exit 0 |
| `npx eslint packages/agent/src/economics/EconomicIngestionPipeline.ts packages/agent/src/economics/pipeline.test.ts packages/agent/src/cli/economicCli.ts packages/agent/src/cli/economicCli.test.ts` | exit 1; 24 pre-existing errors in `economicCli.ts` / `economicCli.test.ts`, none in the changed pipeline source/test lines; no disables or ignores added |
| `git diff --check` | exit 0 |

## Files and Line Boundaries

- `packages/agent/src/economics/EconomicIngestionPipeline.ts:129-136, 304-308, 350-356` — default production route plus controlled normalizer/adapter seams.
- `packages/agent/src/economics/pipeline.test.ts:584-816` — real SQLite normalization, adapter, final Run Store update rollback, and failed-marking-unavailable cases.
- `packages/agent/src/cli/economicCli.ts:235-254` — failed ingest output retains the non-PII durable run ID and no-mutation flag.
- `packages/agent/src/cli/economicCli.test.ts:304-382` — real handler/runtime-factory failure propagation case.
- `openspec/changes/finalize-economic-run-consistency/tasks.md` — records the limited transversal CLI dependency without completing 3.1.

Global formatter and linter baseline checks were intentionally not rerun: the approved baseline is already dirty and this slice did not mass-format unrelated files.

## Remaining Tasks

- [x] 1.3–1.4 Seller/run store provenance, indexes, and idempotent store APIs.
- [x] 2.1–2.4 Aggregate finalization and entity identities.
- [ ] 2.5–2.6 Reconciliation and checkpoint transaction.
- [ ] 3.1–3.2 CLI and daemon wiring.
- [ ] 4.1–4.4 Proof gates, documentation, and lifecycle approval.

## Slice 2 — Seller/Run Store Provenance

- Delivery mode: `auto-chain`, `stacked-to-main`.
- Boundary: durable store/domain contracts, canonical migration identity indexes, and isolated in-memory SQLite proof only. Pipeline/CLI runtime production wiring remains deferred.
- Task checkboxes 1.3–1.4 remain `[x]` as previously recorded; Slice 2 acceptance remains pending reviewer recheck of the corrected concurrency proof.
- RED evidence: `packages/memory/tests/economicRunProvenanceStore.test.ts` initially failed with `outcomes.listComponentsByRun is not a function` (exit 1, 2 failures) before the APIs were implemented.

## Completed Work

- Added nullable legacy-compatible `ingestionRunId` mapping for components and snapshots, explicit provenance columns on snapshot writes, and seller-first run list/count APIs for components, snapshots, and evidence.
- Added seller aggregate component/snapshot counts backed by SQLite; callers receive database counts, never invocation counts.
- Added migration 1006 for the component business key `(seller, source, sourceRecordId, economicMeaning, sourceVersion, currency, amountMinor)` and the stable snapshot key `(seller, orderId, itemId, currency, sourceVersion, economicAlgorithmVersion, economicChecksum)`.
- Replaced destructive snapshot replacement with `INSERT ... ON CONFLICT DO NOTHING` plus canonical-row lookup. Component writes use UUID technical IDs and conflict-safe canonical lookup; exact repeats retain the original producing run, while changed source/refund versions remain auditable successors.
- Changed evidence `listByRun` and `countByRun` to require `(sellerId, ingestionRunId)`; every run read predicates both dimensions.
- Corrected `createRun` to bind the truthful NOT NULL initial `checkpoint_advanced = 0`; the migrated production pipeline path now proves it rather than relying on a default.
- Passed `ingestionRunId: run.runId` explicitly into every component and snapshot production write, with migrated-pipeline assertions for all persisted rows.
- Made migration 1006 detect and report legacy duplicate snapshot business identities, retain every row in a conflict quarantine (`identity_enforced = 0`), and apply a partial unique index only to enforced identities.
- Replaced the invalid same-connection `Promise.all` concurrency claim with a deterministic real SQLite writer-contention proof; details and evidence are recorded below.
- Preserved legacy evidence rows with unavailable `occurredAt`/`sourceVersion` as absent optional fields; the mapper no longer fabricates `0` or an empty version.

## Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 2: seller/run store provenance corrective rerun | `npx vitest run packages/memory/tests/economicRunProvenanceStore.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/memory/src/economicEvidenceStore.test.ts packages/agent/src/economics/pipeline.test.ts` — exit 0; 4 files, 92 tests passed | In-memory SQLite executes migration 1006 duplicate snapshot upgrade/re-run, actual concurrent store contenders, migrated pipeline create/persist path (`checkpoint_advanced = 0`), and explicit component/snapshot run provenance — exit 0 | Revert this corrective boundary in `economicIngestionRunStore.ts`, `EconomicIngestionPipeline.ts`, `economicEvidenceReference.ts`, `economicEvidenceStore.ts`, `migrationRegistry.ts`, and their focused tests. It does not implement finalization, CLI, daemon, smoke, or external behavior. |

## Quality Evidence

| Command | Result |
|---|---|
| `npx prettier --check packages/domain/src/economicCost.ts packages/domain/src/unitEconomics.ts packages/memory/src/economicEvidenceStore.ts packages/memory/src/economicOutcomeStore.ts packages/memory/src/migrationRegistry.ts packages/memory/src/economicEvidenceStore.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/memory/tests/economicRunProvenanceStore.test.ts packages/agent/src/economics/pipeline.test.ts` | exit 0 |
| `npx eslint packages/domain/src/economicCost.ts packages/domain/src/unitEconomics.ts packages/memory/src/economicEvidenceStore.ts packages/memory/src/economicOutcomeStore.ts packages/memory/src/migrationRegistry.ts packages/memory/src/economicEvidenceStore.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/memory/tests/economicRunProvenanceStore.test.ts` | exit 0 |
| `npx tsc -b packages/domain packages/memory packages/agent --pretty false` | exit 0 |
| `git diff --check` | exit 0 |

## Slice 4 — Idempotent Economic Entity Identities

- Delivery mode: `auto-chain`, `stacked-to-main`.
- Boundary: tasks 2.3–2.4 only — deterministic non-PII entity identities, exact-repeat accounting, successor retention, and pipeline-level controlled same-seller serialization. Checkpoint/reconciliation behavior remains deferred to 2.5–2.6.
- RED evidence: `npx vitest run packages/domain/src/economicIdentity.test.ts packages/agent/src/economics/pipeline.test.ts -t "economic entity identities|canonical entity identities"` initially exited 1 because repeat ingestion reported `componentsCreated: 3` instead of `0`.

## Completed Work

- Replaced productive cost-component counters with UUID technical IDs and preserved the domain UUID through store writes; legacy store-only callers retain a UUID fallback.
- Added deterministic `snapshot-{sha256}` keys from seller/order/item-or-variation/source version/currency/algorithm version and a checksum of canonical economic values only. Buyer details, raw payloads, credentials, and presentation fields are not inputs.
- Carried source version, economic meaning, and producing run identity through concrete adapters without creating components for missing adapter data.
- Made pipeline writes use the existing idempotent component insert contract and snapshot conflict lookup, count only rows owned by the current run as created, and increment `duplicatesIgnored` for canonical evidence/components/snapshots retained from prior runs.
- Preserved version/refund history: changed source versions insert successor component/snapshot/evidence rows while superseding prior active component rows rather than overwriting or deleting them.
- Replaced reject-on-overlap same-seller locking with a keyed FIFO in-process queue. Concurrent invocations each receive a distinct run ID, then serialize persistence over the already-proven SQLite unique store contracts.
- Clarified emitted run metrics with `ordersFetched`, `normalizedLines`, `componentsCreated`, and `snapshotsCreated`.

## Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 4: idempotent economic entity identities | `npx vitest run packages/domain/src/economicIdentity.test.ts packages/domain/src/economicCost.test.ts packages/domain/src/economicCalculation.test.ts packages/agent/src/economics/pipeline.test.ts packages/memory/tests/economicRunProvenanceStore.test.ts` — exit 0; 5 files, 101 tests passed | Same command uses real in-memory SQLite pipeline stores for restart/new-run/zero-duplicate/refund-successor/two-seller outcomes and the existing real file-backed worker SQLite contention harness for controlled writer conflict/retry. No ML call, smoke, or external mutation occurred. | Revert Slice 4 changes in `economicCost.ts`, `unitEconomics.ts`, `economicCalculation.ts`, idempotent adapter fields, `economicOutcomeStore.ts`, `EconomicIngestionPipeline.ts`, and the Slice 4 tests together. This does not revert migrations/provenance (1.x), terminal aggregate work (2.1–2.2), or deferred checkpoint/reconciliation (2.5–2.6). |

## Slice 4 Quality Evidence

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx prettier --check packages/domain/src/economicCost.ts packages/domain/src/unitEconomics.ts packages/domain/src/economicCalculation.ts packages/domain/src/economicIdentity.test.ts packages/memory/src/economicOutcomeStore.ts packages/agent/src/economics/EconomicIngestionPipeline.ts packages/agent/src/economics/pipeline.test.ts packages/agent/src/economics/adapters/{marketplaceFee,shippingCost,sellerDiscount,refundReturn,advertisingCost}.ts` | exit 0 |
| `npx eslint` on the same Slice 4 source/tests | exit 0 |
| `git diff --check` | exit 0 |

## Slice 4 Remaining Tasks

- [x] 1.1–1.4 Migration and store provenance foundation.
- [x] 2.1–2.4 Finalization aggregate and entity identities.
- [ ] 2.5–2.6 Reconciliation and checkpoint transaction.
- [ ] 3.1–3.2 CLI and daemon wiring.
- [ ] 4.1–4.4 Proof gates, documentation, and lifecycle approval.

## Slice 5 — Reconciliation and Checkpoint Transaction (in progress)

- Delivery mode: `auto-chain`, `stacked-to-main`.
- Boundary: tasks 2.5–2.6 only; no runtime/CLI task 3 expansion, smoke, external ML calls, commits, or branch operations.
- Implemented pre-transaction reconciliation reason codes, explicit revenue/currency/dispute/normalization eligibility, same-handle assertions, compound `(occurredAt, sourceRecordId)` high-water selection, non-regressing checkpoint decisions, all-or-none final persistence, and SQLite-only cumulative metrics with an explicit unavailable state.
- Added focused SQLite coverage for known missing-cost partial completion, timestamp ties, shuffled/equal/lower cursor non-regression, mixed-currency failure, existing evidence/component/snapshot/run/checkpoint rollback cases, and updated the former mismatch-completion assertion to fail closed.

## Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 5: reconciliation and checkpoint transaction | `npx vitest run packages/agent/src/economics/pipeline.test.ts` — exit 0; 1 file, 52 tests passed | Real in-memory SQLite pipeline harness covers partial missing costs, cursor tie/non-regression, mixed currency fail-closed behavior, and persistence rollback boundaries; no ML call or external mutation. | Revert the Slice 5 changes in `EconomicIngestionPipeline.ts`, `EconomicReconciliationService.ts`, store handle accessors, and Slice 5 test additions together. |

## Quality Evidence

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx prettier --check` on Slice 5 files | exit 1; formatting remains required before tasks 2.5–2.6 can be checked complete |

## Remaining Tasks

- [ ] 2.5–2.6 Reconciliation/checkpoint RED and implementation remain unchecked pending formatting and the remaining requested cumulative/rollback coverage expansion.

## Slice 5 — Corrective Rerun (blocked)

- Fixed Prettier in the three Slice 5 files and added durable reconciliation/cumulative result persistence, shared-handle rejection, seller aggregate APIs, sanitized aggregate-unavailable observability, and real SQLite tests.
- The focused suite now passes (`55` tests), as do typecheck, touched-file Prettier, targeted ESLint, and `git diff --check`.
- Tasks 2.5–2.6 remain unchecked: the required acceptance suite is still incomplete. Missing real SQLite acceptance cases are the balanced-with-tolerance verdict, seller-mismatch and critical-dispute/inconsistent-normalization pipeline paths, zero-versus-missing distinction, each individual evidence/component/snapshot/run-update/checkpoint rollback injection with prior checkpoint and all row counts, two-run cumulative proof, and the >20 evidence cardinality bound.

## Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 5 corrective rerun | `npx vitest run packages/agent/src/economics/pipeline.test.ts` — exit 0; 1 file, 55 tests passed | Real in-memory SQLite proves persisted rich reconciliation/cumulative result, SQLite aggregate failure returns unavailable without failing ingestion, and a distinct evidence DB handle prevents final rows from committing — exit 0 | Revert the Slice 5 changes in pipeline, reconciliation/domain result contracts, economic SQLite aggregate helpers, and Slice 5 pipeline tests together. |

## Quality Evidence

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx prettier --check` on the seven Slice 5 touched files | exit 0 |
| `npx eslint` on Slice 5 production sources | exit 0 |
| `git diff --check` | exit 0 |

## Slice 2 Corrective Quality Evidence

| Command | Result |
|---|---|
| `npx prettier --check packages/agent/src/economics/EconomicIngestionPipeline.ts packages/agent/src/economics/pipeline.test.ts packages/domain/src/economicEvidenceReference.ts packages/memory/src/economicIngestionRunStore.ts packages/memory/src/economicEvidenceStore.ts packages/memory/src/migrationRegistry.ts packages/memory/src/economicEvidenceStore.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/memory/tests/economicRunProvenanceStore.test.ts` | exit 0 |
| `npx eslint packages/agent/src/economics/EconomicIngestionPipeline.ts packages/domain/src/economicEvidenceReference.ts packages/memory/src/economicIngestionRunStore.ts packages/memory/src/economicEvidenceStore.ts packages/memory/src/migrationRegistry.ts packages/memory/src/economicEvidenceStore.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/memory/tests/economicRunProvenanceStore.test.ts` | exit 0 |
| `npx tsc -b packages/domain packages/memory packages/agent --pretty false` | exit 0 |
| `git diff --check` | exit 0 |

`npx eslint packages/agent/src/economics/pipeline.test.ts` still exits 1 with the same six pre-existing errors (`beforeAll` unused; five `no-unused-expressions`). They were not suppressed or altered.

`packages/agent/src/economics/pipeline.test.ts` needed one argument-order adaptation for the seller-first evidence API. Its full-file ESLint invocation still reports six pre-existing unrelated errors (`beforeAll` unused and five no-unused-expressions); the scoped lint command above passes for this slice's authored files.

## Slice 5 — SQLite Acceptance Claim (rejected; superseded below)

- Delivery mode: `auto-chain`, `stacked-to-main`.
- Boundary: tasks 2.5–2.6 only. No runtime/CLI task 3 work, smoke, external ML calls, commits, or branch operations.
- Production correction: reconciliation now fail-closes known contradictory claim evidence and malformed normalization before persistence. Coverage distinguishes explicitly observed zero values from unavailable values without fabricating a cost component.

### SQLite Acceptance Matrix

| Group | Real on-disk SQLite proof | Result |
|---|---|---|
| 1. Tolerance | Used a migrated file, but did not assert all durable run/reconciliation/coverage/checkpoint/reopen state. | Rejected by fresh-context gate. |
| 2. Seller mismatch | Used a migrated file, but did not assert all durable seller/run/evidence/snapshot/checkpoint/reopen state. | Rejected by fresh-context gate. |
| 3. Contradictory evidence | Used `:memory:` rather than the required unique on-disk SQLite database. | Rejected by fresh-context gate. |
| 4. Normalization A–F | Used a migrated file, but asserted components only rather than full failed-run/final-row/checkpoint/reopen state. | Rejected by fresh-context gate. |
| 5. Zero vs missing | Used `:memory:` rather than the required unique on-disk SQLite database and reopen queries. | Rejected by fresh-context gate. |
| 6. Boundary rollback | SQLite triggers inject evidence/component/snapshot/run/checkpoint failures; a transaction wrapper injects the pre-commit failure. Each retains prior checkpoint and leaves zero final evidence/components/snapshots. | Passed: 6/6; `quick_check=ok`, `foreign_key_check=[]`, no orphan evidence joins. |
| 7. Cumulative/reopen | Two distinct `plasticov` runs return SQLite totals `components=6`, `snapshots=2`, `evidence=2`, `runs=2`; a `maustian` run remains isolated and the file reopens cleanly. | Passed. |
| 8. Cardinality/cursor | 25 two-item orders at one timestamp persist 25 evidence and 50 snapshots; checkpoint is `(2026-02-01T00:00:00Z, order-025)`. | Passed: index present, `quick_check=ok`, `foreign_key_check=[]`, no orphan snapshot joins. |

## Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 5: reconciliation/checkpoint SQLite acceptance | `npx vitest run packages/agent/src/economics/pipeline.test.ts` — exit 0; 1 file, 69 tests passed. Focused acceptance groups: zero/missing — exit 0, 1 test; six boundary faults — exit 0, 6 tests; cumulative/reopen plus 25-order cursor — exit 0, 2 tests. | Unique temporary on-disk SQLite file per acceptance scenario; `createEconomicMigrationPlan()` plus production stores/pipeline, deterministic IDs, reopen/query, `quick_check`, `foreign_key_check`, index, seller/run count, and orphan-join checks — all passed. No external calls or mutation. | Revert Slice 5 additions in `EconomicIngestionPipeline.ts`, `EconomicReconciliationService.ts`, `economicIngestionRun.ts`, and `pipeline.test.ts` together. This leaves earlier migration/identity work intact and does not touch runtime, CLI, smoke, or live data. |

## Quality Evidence

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx prettier --check packages/agent/src/economics/EconomicIngestionPipeline.ts packages/agent/src/economics/EconomicReconciliationService.ts packages/agent/src/economics/pipeline.test.ts packages/domain/src/economicIngestionRun.ts` | exit 0 |
| `npx eslint packages/agent/src/economics/EconomicIngestionPipeline.ts packages/agent/src/economics/EconomicReconciliationService.ts packages/domain/src/economicIngestionRun.ts` | exit 0 |
| `git diff --check` | exit 0 |

## Task Status

- [ ] 2.5 Reconciliation/checkpoint RED acceptance coverage — historical rejected status; superseded by the corrective rerun status above.
- [ ] 2.6 Pre-transaction eligibility and atomic compound checkpoint persistence — historical rejected status; superseded by the corrective rerun status above.
- [ ] 3.1–3.2 Runtime wiring remains out of scope.
- [ ] 4.1–4.4 Proof gates, documentation, and lifecycle approval remain out of scope.

## Slice 3 — Failure-Parity Corrective Rerun

- Delivery mode: `auto-chain`, `stacked-to-main`.
- Boundary: tasks 2.1–2.2 only. No 2.3+ identity, reconciliation, checkpoint, CLI, daemon, smoke, or external behavior was advanced.
- Semantics: after `createRun` durably creates the initial row, every later fetch, normalization, adaptation, transaction, or finalization failure returns the same run ID and best-effort updates that row with the complete sanitized failed final aggregate as `result`, plus matching status, completion time, and error. If that final run-store update itself fails, the returned aggregate remains failed with the original ID and a sanitized parity-loss error; the existing durable row can remain non-terminal because parity cannot be guaranteed, and the pipeline logs a sanitized best-effort failure.

## Completed Work

- Finalized post-create failures through the existing pure `finalizeEconomicIngestionRun` transition rather than recreating a run or using a synthetic ID.
- Persisted the exact failed aggregate through `updateRun(..., { result: run })` after rollback, never status/error alone; row reconstruction round-trips the returned aggregate.
- Sanitized token, secret, API-key, password, authorization, credential-URL, and stack-path failure details before they enter returned errors, rows, or structured logs.
- Made SQLite run-store create/update write failures reject through their declared Promise API, so callers can truthfully handle final-update parity loss.
- Added runtime SQLite reload tests for fetch failure, transaction rollback, and final run-store update failure without creating another run ID.

## Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 3 failure-parity corrective rerun | `npx vitest run packages/agent/src/economics/pipeline.test.ts packages/memory/tests/economicIngestionRunStore.test.ts` — exit 0; 2 files, 65 tests passed | Same command uses real in-memory SQLite: reloads the durable failed row after injected fetch and transaction failures and compares it to the returned aggregate; simulates run-store final update rejection to prove same-ID failed return, sanitized parity-loss reporting, one durable initial row, and no duplicate ID — exit 0 | Revert this corrective boundary in `EconomicIngestionPipeline.ts`, `economicIngestionRunStore.ts`, and the associated `pipeline.test.ts` tests together. No later Slice 3 tasks, CLI/daemon, migrations, smoke, or external behavior is included. |

## Corrective Quality Evidence

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx prettier --check packages/agent/src/economics/EconomicIngestionPipeline.ts packages/agent/src/economics/pipeline.test.ts packages/memory/src/economicIngestionRunStore.ts` | exit 0 |
| `npx eslint packages/agent/src/economics/EconomicIngestionPipeline.ts packages/agent/src/economics/pipeline.test.ts packages/memory/src/economicIngestionRunStore.ts` | exit 0 |
| `git diff --check -- packages/agent/src/economics/EconomicIngestionPipeline.ts packages/agent/src/economics/pipeline.test.ts packages/memory/src/economicIngestionRunStore.ts` | exit 0 |

## Slice 2 — Corrected SQLite Concurrency Proof (review pending)

- The prior test was invalid: `Promise.all` scheduled microtasks, but synchronous `better-sqlite3` calls executed serially on one in-memory connection. It did not create concurrent SQLite writers or file-level lock contention.
- The corrected test creates a unique temporary directory and on-disk SQLite file, applies the real `createEconomicMigrationPlan()` before opening workers, then closes the initializer connection.
- Two independent `node:worker_threads` workers each open their own `better-sqlite3` connection to that file and set `journal_mode = WAL`, bounded `busy_timeout = 150`, and `foreign_keys = ON`.
- A ready/start/release/retry message barrier coordinates the proof without sleeps. The holder enters `BEGIN IMMEDIATE`, writes its run and canonical evidence, and holds the writer lock. The contender attempts its own `BEGIN IMMEDIATE` and deterministically returns `SQLITE_BUSY`; only then does the parent release the holder and instruct the contender to retry.
- Both workers persist distinct run IDs and sellers. The contender then writes its seller-B evidence and retries the holder's seller-A evidence composite key using the productive `EconomicEvidenceStore` `INSERT ... ON CONFLICT DO NOTHING` SQL: holder outcome `inserted`, contender outcome `conflict`, with exactly one seller-A canonical row. The explicit JavaScript worker helper is necessary because the worker cannot import Vitest-transformed TypeScript without adding a production-only loader; it runs only against the real schema initialized by production migrations.
- A third independent verification connection proves `PRAGMA quick_check = ok`, both run/seller pairs, seller-isolated evidence ownership, the active `idx_evidence_composite_unique` index, one canonical conflict-key row, and no open transaction. A close/reopen repeats `quick_check` and confirms no open transaction.
- Every wait has a five-second test/worker-message bound. Worker connections close in `finally`, workers terminate in the parent `finally`, and recursive temporary-directory cleanup removes the `.sqlite`, `-wal`, and `-shm` artifacts; the test asserts the directory no longer exists.

## Corrected Work Unit Evidence

| Work unit | Focused test command and exact result | Runtime harness command/scenario and exact result | Rollback boundary |
|---|---|---|---|
| Slice 2 concurrency proof correction | `npx vitest run packages/memory/tests/economicRunProvenanceStore.test.ts` run 5 times — exit 0 each run; 1 file, 3 tests passed per run | Real on-disk SQLite with 3 independent connections (initializer, two worker writers, then a third verifier after worker close): WAL/foreign-key/busy-timeout configuration; deterministic `BEGIN IMMEDIATE` lock and `SQLITE_BUSY`; controlled retry; distinct seller/run persistence; one canonical evidence row; `quick_check = ok`; close/reopen succeeds; no open transaction — exit 0 | Revert only the worker-based test in `packages/memory/tests/economicRunProvenanceStore.test.ts` and this evidence section. Production schema/store code, pipeline, CLI, daemon, live DB, and external behavior are untouched. |

## Corrected Quality Evidence

| Command | Result |
|---|---|
| `npx vitest run packages/memory/tests/economicRunProvenanceStore.test.ts` | exit 0; 1 file, 3 tests passed (plus four prior deterministic repetitions: five total) |
| `npx vitest run packages/memory/tests/economicRunProvenanceStore.test.ts packages/memory/tests/economicDurabilityMigration.test.ts packages/memory/src/economicEvidenceStore.test.ts packages/agent/src/economics/pipeline.test.ts` | exit 0; 4 files, 92 tests passed |
| `npx tsc -b packages/domain packages/memory packages/agent --pretty false` | exit 0 |
| `npx prettier --check packages/memory/tests/economicRunProvenanceStore.test.ts openspec/changes/finalize-economic-run-consistency/apply-progress.md` | exit 0 |
| `npx eslint packages/memory/tests/economicRunProvenanceStore.test.ts` | exit 0 |
| `git diff --check` | exit 0 |
