# Tasks: Finalize Economic Run Consistency

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated lines | 1450–1850 |
| Risks | Migration/uniqueness; finalization/cursor; smoke gates |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No — user resolved auto-chain / stacked-to-main.
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
800-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Test | Harness | Rollback |
|---|---|---|---|---|---|
| 1 | Stores | 1 | `npx vitest run packages/memory/{src,tests}/*economic*` | In-memory SQLite | Stores |
| 2 | Pipeline | 2 | `npx vitest run packages/agent/src/economics/pipeline.test.ts` | Fixtures | Pipeline |
| 3 | Runtime | 3 | `npx vitest run packages/agent/src/{cli,workers}/*.test.ts` | Offline | Runtime |
| 4 | Proof | 4 | focused + changed-file checks | Gated smoke | Docs |

*E=acceptance; R=rollback. Work-unit commits planned; no commits/pushes/PRs, ML mutation, or Product Launch Intelligence.*

## Phase 1: Stores

- [x] 1.1 RED: add fresh/legacy-null/conflict/rerun/temp cases to `packages/memory/tests/economicDurabilityMigration.test.ts`. E: fail; R: tests.
- [x] 1.2 Create `createEconomicMigrationPlan()` in `packages/memory/src/migrationRegistry.ts`; apply once from `packages/agent/src/economics/factory.ts`, no DDL. E: 1.1 green; R: registry.
- [x] 1.3 RED: add seller/run isolation, index, and aggregate-unavailable store cases. E: fail; R: tests.
- [x] 1.4 Update `packages/memory/src/economicIngestionRunStore.ts`, `economicOutcomeStore.ts`, `economicEvidenceStore.ts`, component/snapshot stores for provenance, seller-first APIs, upserts, same-handle assertion, SQLite aggregates. E: 1.3 green; R: stores.

## Phase 2: Finalization

- [x] 2.1 RED: add injected ID, ≤3 collision-before-read, failure, identity-parity cases to `packages/agent/src/economics/pipeline.test.ts`; corrected with durable fetch/transaction failure reload parity and run-store final-update failure behavior. E: fail; R: tests.
- [x] 2.2 Implement pure `finalizeEconomicIngestionRun` in `packages/domain/src/economicIngestionRun.ts` and row parity in `packages/memory/src/economicIngestionRunStore.ts`; corrected so durable failures persist the complete sanitized final aggregate when possible. E: 2.1 green; R: aggregate.
- [x] 2.3 RED: cover non-PII keys, refund versions, repeat/concurrent canonical rows, and ignored counts. E: fail; R: tests.
- [x] 2.4 Update `packages/domain/src/economicCost.ts`, `economicCalculation.ts`, `economicOutcome.ts`, and pipeline for UUIDs, uniqueness, successor history, and run associations. E: 2.3 green; R: pipeline.
- [x] 2.5 RED: encode partial-missing, zero, mismatch/dispute/rollback, timestamp-tie, shuffled-input, and non-regression checkpoint cases. E: fail; R: tests. Slice 5 PASS recorded.
- [x] 2.6 In `EconomicReconciliationService.ts` and pipeline, compute eligibility before the shared transaction; write `(occurredAt, sourceRecordId)` last only when eligible. E: 2.5 green/all-or-none; R: transaction. Slice 5 PASS recorded.

## Phase 3: Runtime

- [x] 3.1 RED: extend `economicCli.test.ts` and `economicIngestionDaemon.test.ts` for seller `--run`, safe non-zero errors, and factory dependencies. E: fail; R: tests. Slice 6 PASS recorded.
  - Corrective rerun: selected-run status is run-only; `status`, `coverage`, `reconcile`, `missing`, and `inspect-evidence` reject unknown or foreign seller runs with sanitized non-zero JSON. Offline runtime tests cover `missing --run`, `reconcile --run`, and all applicable unknown/foreign-run paths.
  - Slice 3 dependency: the minimum real `economicCli` finalization-failure propagation test is included with 2.1–2.2 to prove R2 fail-closed non-zero exit behavior. This does not complete 3.1; seller `--run`, daemon, and remaining runtime RED coverage remain pending.
- [x] 3.2 Wire `economicCli.ts` and `economicIngestionDaemon.ts` to seller/run component, snapshot, evidence output, and unavailable cumulative metrics. E: 3.1 green; R: runtime. Slice 6 PASS recorded.
  - Corrective rerun: CLI and daemon share the canonical economic output/error sanitizer, including email, credential, raw-payload, and stack-path redaction.

## Phase 4: Proof Gates and Documentation

- [x] 4.1 Run focused tests/temp migration/changed-file format/lint; compare typecheck/tests/build/E2E to global baseline. E: deltas, not debt; R: no code. Corrective rerun passed offline; stale exact-repeat test expectations were aligned with approved canonical idempotency semantics.
- [ ] 4.2 After 4.1: dual dry-run, read-only one-page/five-order persistent and identical-repeat smoke; stop on gate/reconciliation failure. E: IDs/no duplicates/no regression; R: backup/audit.
- [ ] 4.3 Update `README.md`, `ROADMAP.md`, smoke docs, and `openspec/changes/finalize-economic-run-consistency/verify-report.md`; retain P0 Partial/archive prerequisites. E: checklist; R: docs.
- [ ] 4.4 Lifecycle: archive only after 4.2/4.3; request approval before commit/push/PR/archive. E: evidence trail; R: leave active.

## Remediation Work Unit: Fetch Semantics, Cancellation, Resume and Seller-Safe Provenance

**Authoritative current state:** This unit is required by the two frozen 4R lineages. Historical `[x]` entries prove only their prior scope; they do not accept the gaps below. R1–R5 are accepted only with their receipts below; R6–R8 remain deliberately unchecked. No smoke, live call, commit, or Product Launch Intelligence work belongs here.

- [x] R1 RED + implement bounded fetch results and canonical backlog identity. E: restart and two-seller tests prove identical normalized seller/source/range/cursor/purpose inputs produce one non-null SHA-256 key, JSON/order variants and PII never participate, and results remain bounded. R: fetcher/backlog tests.
- [x] R2 RED + implement abort and operational failure semantics. E: full offline source matrix proves bounded statuses, retry budget, Retry-After, request-signal propagation, and abort timing; unique on-disk SQLite pipeline cases prove Orders fail closed, confirmed empty, Claims/Ads partial behavior, and no fabricated zero. R4+ durable backlog/checkpoint/fence/CAS work remains explicitly deferred. R: fetcher/pipeline.
- [x] R3 RED + implement 1007 metadata/fence. E: independent connections prove immutable identity/manifest equality, Plasticov/Maustian/install mismatch block, three-attempt CAS classifications, no false advance, and every fenced writer rejection. R: run store/1007.
- [x] R4 RED + implement 1008 leases/checkpoints and 1009 backlog/health. E: deterministic-clock real SQLite proves 60s/20s/15s lease and 120s/40s/30s backlog cadence, owner/token-digest/generation CAS, zero-row classification, bounded recovery, six-state transitions, dead-letter/replay, admin cancellation/alert, and seller isolation. R: lease/backlog store. R4 PASS recorded after the R4b operational-intent gate.
   - [x] R4a seller-scoped lease and fence ownership slice: 1008 durable leases, secure token digest, owner/token/generation/database-generation CAS, exact-expiry recovery, typed hostile-release results, and final `BEGIN IMMEDIATE` precommit validation.
   - [x] R4a gate correction: deterministic real on-disk SQLite coverage proves database-generation and fence loss classification across acquire/renew/release, hostile cross-seller release isolation, and final-precommit lease loss rolls back evidence/components/snapshots/run/checkpoint while preserving a replacement lease and returning `lease-lost`.
     - [x] R4b durable Claims retry backlog and source health: registry-only 1009 schema; seller-scoped idempotent intent upsert; due claim/CAS lifecycle, request-start attempt accounting, expiry recovery, dead-letter, audited admin cancellation/replay, and monotonic health. Pipeline Claims gaps persist backlog and all source health in the final transaction without a refund zero. No R5 scheduler daemon/CLI propagation. R4b PASS recorded.
     - [x] R4b correction: administrative cancel/replay, expiry recovery, and all Claims backlog mutation SQL are seller-bound; cancellation/replay require seller, actor, approver, and reason, return one typed result, and persist seller-scoped audit rows. R4b owns only the durable pending/consumed cancellation intent in migration 1010; R7 retains all dispatcher, transport, inbox, HTTP, Telegram, retry, and delivery work. Real on-disk Plasticov/Maustian hostile tests prove a foreign seller cannot mutate a known identity key. R4b correction PASS recorded.
- [x] R5 RED + implement deadline scheduler and every fence admission. **PASS recorded 2026-07-13.** E: fake clock/AbortSignal tests cover request-start accounting and fence checks at admission, lease acquire/renew, backlog mutation, migrations, final transaction, and precommit; fence coordination never changes epoch. R: scheduler/registry.
  - Historical corrective progress before the final gate (2026-07-13): pipeline then acquired/released the database fence, issued one finalization receipt after seller-lease acquisition, revalidated it with fence/lease/deadline immediately before commit, consumed it atomically with the business transaction, incremented the epoch once, and durably rejected the receipt after a rolled-back final transaction. A real file-backed two-worker barrier proved a replaced fence rejected the issued receipt without partial rows or epoch movement. At that point this was deliberately **not accepted**: direct public writer admission contexts, database-fence renewal/recovery wiring, clipping coverage at every requested boundary, and the complete per-writer matrix remained outstanding. The independent read-only final acceptance matrix later resolved these blockers and recorded R5 PASS.
- [ ] R6 RED + retain seller-safe supersession and exact duplicate metrics. E: isolation/security matrix proves no cross-seller mutation and stable canonical identity behavior. R: evidence/outcome stores.
- [ ] R7 RED + implement reserved 1012 delivery state and 1013 restore-journal state, final constraints, and journaled restore. E: deterministic-clock real SQLite hostile alert claims (invalid/empty token, wrong owner/generation/seller, replacement, expiry/recovery, old process, duplicate, zero rows); 10s poll, 60s/20s claim, 10s timeout, four attempts/120s budget, inbox/crash-after-send, acknowledgement/resolution, dead-letter/pager/SLO; WAL/SHM close/checkpoint/stage/identity/manifest/rename/reopen/rollback journal matrix passes offline. R: runtime/ops.
- [ ] R8 Gate: topological 1007→1010 fresh/recorded-1006-upgrade/checksum/rerun/temporary/rollback tests; R1–R7 focused receipts; and truthful native v4 review evidence. E: four lenses are consolidated with labels; v4's one genuine native refuter batch satisfies its historical positive counter, never a mandatory-empty-batch rule. No manual mirror authority, smoke, or live call. R: no production data.
