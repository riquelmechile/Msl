# Apply Progress: Journaled and Fenced Economic Restore

## Historical Progress Preserved

R1–R6 work remains historical/archived progress. The prior Engram apply-progress
topic (`sdd/finalize-economic-run-consistency/apply-progress`, observations #2286
and #2292) records the most recent R1–R6 durability-evidence correction. This R7
artifact starts a separate Unit 1 ledger and does not alter or claim completion of
that historical work.

## R7 Work Unit 1: Migration 1013 Journal Schema

**Delivery mode**: Chained delivery, stacked-to-main

### Completed Tasks

- [x] 1.1 RED: Added behavior-first migration tests for 1013 ordering after 1011,
  idempotent rerun, atomic schema failure, immutable journal identity, integrity
  constraints, and preservation of 1007–1011 without 1012.
- [x] 1.2 GREEN: Added transactional, idempotent migration 1013 with the
  `economic_restore_journal` schema, lifecycle phases/outcomes, integrity checks,
  indexes, and an immutable-identity trigger.

### Work Unit Evidence

| Evidence | Command / scenario | Exact result |
|---|---|---|
| Focused test | `npm test -- packages/memory/src/migrationRegistry.test.ts packages/memory/tests/economicDurabilityMigration.test.ts` | Initial Unit 1 result: Exit 0; 2 test files passed, 30 tests passed. The RED run before implementation failed 5 tests for absent 1013 schema/ordering. Corrective rerun: the added `restore_id` mutation assertion failed before the trigger fix (Exit 1; 1 failed, 29 passed), then passed after the fix (Exit 0; 2 test files passed, 30 tests passed). |
| Runtime harness | Same focused command; file-backed temporary SQLite upgrade, rerun, close, and readonly reopen scenario in `economicDurabilityMigration.test.ts` | Exit 0; the file-backed scenario applied 12 migrations, reran with 12 skips, and confirmed `economic_restore_journal` after reopen. |
| Typecheck | `npm run typecheck --workspace @msl/memory` | Initial Unit 1 and corrective rerun: Exit 0. |
| Format / diff safety | `npx prettier --check packages/memory/src/migrationRegistry.ts packages/memory/src/migrationRegistry.test.ts packages/memory/tests/economicDurabilityMigration.test.ts openspec/changes/finalize-economic-run-consistency/apply-progress.md && git diff --check` | Initial Unit 1 and corrective rerun: Exit 0; all matched files formatted and no whitespace errors. |
| Rollback boundary | `packages/memory/src/migrationRegistry.ts`, `packages/memory/src/migrationRegistry.test.ts`, and `packages/memory/tests/economicDurabilityMigration.test.ts` | Revert the 1013 registration and its focused tests together. No restore runtime, lifecycle, daemon, external, or production behavior is included. |

### Corrective Rerun: Immutable Restore Identity

- Root cause: `trg_economic_restore_journal_immutable_identity` omitted
  `restore_id` from both its `BEFORE UPDATE OF` list and identity-change predicate,
  allowing the journal primary identity to change.
- Correction: Added `restore_id` to both trigger clauses and a focused assertion
  that updating it rejects with the immutable-identity error.
- Task accuracy: Tasks 1.1 and 1.2 remain complete; this is a corrective proof and
  contract completion within their existing Unit 1 boundary, not a new task or Unit 2 work.

### Scope and Boundary

- Start: canonical economic migration plan through 1011.
- End: migration 1013 journal schema and focused proof only.
- Excluded: migration 1012, restore runtime/lifecycle/daemon wiring, recovery,
  external operations, VCS/PR activity, and archive work.
- Review budget: 320 changed lines in this slice, below the 400-line target.

### Remaining R7 Tasks

- [ ] 2.1–2.4 Fenced restore protocol.
- [ ] 3.1–3.5 Runtime integration and deterministic recovery.
- [ ] 4.1–4.2 Offline verification.

## R7 Work Unit 1 CI Remediation: Migration-Plan Expectations

**Delivery mode**: Chained delivery, stacked-to-main. This is a minimal CI-only
remediation within the completed Unit 1 boundary; it does not begin Unit 2.

### Root Cause and Fix

- Root cause: migration 1013 expanded the canonical economic migration plan from
  11 to 12 steps. Three legacy tests still expected the previous skipped/applied
  totals, and the checkpoint upgrade list omitted version 1013.
- Fix: updated only those stale assertions in the three affected test files.
  The checkpoint test now expects the six registered upgrades after 1006 and
  explicitly lists 1013 after 1011. No production migration behavior or test
  strictness changed.

### Work Unit Evidence

| Evidence | Command / scenario | Exact result |
|---|---|---|
| Focused test | `npm test -- packages/memory/tests/economicDatabaseAdmissionReceipt.test.ts packages/memory/tests/economicSourceCheckpointStore.test.ts packages/memory/tests/economicSourceRetryBacklogStore.test.ts` | Exit 0; 3 test files passed, 22 tests passed. |
| Runtime harness | Same focused command; real file-backed SQLite migration, rerun, and reopen paths exercised by the three legacy stores | Exit 0; 3 test files passed, 22 tests passed. |
| Original Unit 1 migration tests | `npm test -- packages/memory/src/migrationRegistry.test.ts packages/memory/tests/economicDurabilityMigration.test.ts` | Exit 0; 2 test files passed, 31 tests passed. |
| Full suite | `npm test` | Exit 0; 198 test files passed, 2 skipped; 3,584 tests passed, 7 skipped. |
| Format / diff safety | `npx prettier --check packages/memory/tests/economicDatabaseAdmissionReceipt.test.ts packages/memory/tests/economicSourceCheckpointStore.test.ts packages/memory/tests/economicSourceRetryBacklogStore.test.ts openspec/changes/finalize-economic-run-consistency/apply-progress.md && git diff --check` | Exit 0; all four files formatted and no whitespace errors. |
| Rollback boundary | `packages/memory/tests/economicDatabaseAdmissionReceipt.test.ts`, `packages/memory/tests/economicSourceCheckpointStore.test.ts`, `packages/memory/tests/economicSourceRetryBacklogStore.test.ts`, and this apply-progress entry | Revert only stale expectations and this remediation record; migration 1013 and all production behavior remain intact. |

### Scope and Boundary

- Start: completed Unit 1 migration 1013 with stale legacy CI expectations.
- End: legacy assertions aligned with the 12-step migration plan and explicit
  checkpoint version 1013 coverage.
- Excluded: Unit 2+, migration implementation changes, external/production work,
  secrets, VCS/PR activity, and archive work.
- Review budget: 11 changed assertion/list lines plus this audit record.

## R7 Work Unit 2A: Lifecycle Coordinator

**Delivery mode**: Chained delivery, stacked-to-main. Explicit auto-chain sub-split;
this safe slice contains tasks 2.1–2.2 only.

### Completed Tasks

- [x] 2.1 RED: Added deterministic lifecycle behavior tests for distinct
  equivalent-path joins, epoch-bound permits and references, live-fence rejection,
  idempotent owner/registration release, released-handle operations, safe
  quiesced eviction, blocked-state retention, recreation, drain, and recovery.
- [x] 2.2 GREEN: Added a path-scoped lifecycle coordinator with participant,
  lease-owner, and in-flight accounting; exact live-fence validation before write
  and close boundaries; bounded quiescence; explicit quiesced/recover transitions;
  safe eviction; and blocked admission after failures.

### Work Unit Evidence

| Evidence | Command / scenario | Exact result |
|---|---|---|
| RED test | `npm test -- packages/memory/src/economicDatabaseLifecycle.test.ts` before implementation | Exit 1; 1 test suite failed during module load because `economicDatabaseLifecycle.js` did not exist. |
| Focused test | `npm test -- packages/memory/src/economicDatabaseLifecycle.test.ts` | Ordinary-review correction result: Exit 0; 1 test file passed, 19 tests passed. |
| Runtime harness | N/A — Unit 2A is an isolated in-process coordinator; file-backed promotion/runtime wiring begins in tasks 2.3+ and Unit 3, which are excluded. | N/A by isolated-unit boundary. |
| Typecheck | `npm run typecheck --workspace @msl/memory` | Exit 0. |
| Format / diff safety | `npx prettier --check packages/memory/src/economicDatabaseLifecycle.ts packages/memory/src/economicDatabaseLifecycle.test.ts openspec/changes/finalize-economic-run-consistency/tasks.md openspec/changes/finalize-economic-run-consistency/apply-progress.md && git diff --check` | Final result: Exit 0; all matched files formatted and no whitespace errors. |
| Rollback boundary | `packages/memory/src/economicDatabaseLifecycle.ts`, `packages/memory/src/economicDatabaseLifecycle.test.ts`, `.gitignore`, and this ledger entry | Revert the coordinator/proof together and remove the local CodeGraph ignore rule. No DatabaseManager promotion, runtime/daemon wiring, crash matrix, external, or production behavior is included. |

### Corrective Rerun: Live Fence and Shared Coordinator State

- Root cause: permits only retained a generation and were not revalidated against
  the live owner/token/database-generation/expiry at use time; separate factory
  calls resolved a path but constructed isolated state; and invalidation/renewal
  hooks were not timeout-bounded before destructive readiness.
- Correction: permits retain their admitted fence snapshot and reject changed or
  expired live fences before invoking the callback; canonical-path factories return
  one shared coordinator; every quiescence hook is bounded and failures block the
  path before close. The expanded 9-test suite proves those cases plus successful
  quiesced reopen and blocked recovery.
- Task accuracy: Tasks 2.1 and 2.2 remain complete because the focused lifecycle
  suite, memory typecheck, Prettier, and whitespace diff check all pass after the
  correction. Tasks 2.3+ remain untouched.

### Final Corrective Proof: Determinism and Test Cleanup

- Root cause: the prior proof used duplicate path strings, omitted idempotence and
  several released-handle operations, and left owners/registrations in the module
  registry after tests.
- Correction: a shared `afterEach` release stack tracks every test-created handle
  and registration. The final 15-test suite proves distinct lexical path joining,
  idempotent release, all released-handle operations, quiesced eviction with a new
  authority/open epoch, and blocked retention until explicit recovery. Tests recover
  every intentionally blocked lifecycle before cleanup; no test-only registry reset
  exists to conceal a leak.
- Repository hygiene: `.gitignore` now excludes `.codegraph/`; the index remains
  intact and `git status --short` no longer reports it.
- Task accuracy: these corrections complete only tasks 2.1–2.2. Tasks 2.3+ remain
  untouched.

### Third-Reopened Corrective Retry: Immutable Drain Fence

- Root cause: `enterDraining` retained the caller-owned fence across participant awaits,
  allowing a callback to alias and mutate the caller object as the live fence.
- Correction: synchronously snapshot every drain fence field before `assertFence` or any
  awaited hook; use that immutable value for the initial and pre-close checks.
- Proof: the late-mismatch callback aliases and mutates the original caller/live fence;
  drain rejects before `close`, blocks fail-closed, then recovers for registry cleanup.
- Task accuracy: focused lifecycle tests, memory typecheck, Prettier, and whitespace
  diff check pass; only Unit 2A tasks 2.1–2.2 are affected.

#### Ordinary-Review Correction `review-bcedc44c94caa35b`

- Root causes: timeout bounded only the caller while writes/hooks remained active;
  reopen trusted a one-time fence check across awaits; and concurrent open transitions
  had no single owner.
- Correction: recovery rejects until tracked writes and hooks settle, reopen snapshots
  and revalidates the fence after every hook and before commit, and one caller reserves
  the transition through its sole epoch increment.
- Proof: the focused 19-test suite covers late close side effects, write/hook settlement,
  replacement and expiry between reopen hooks, and concurrent reopen ownership.
- Size exception: maintainer-approved, bounded to the native 180-line correction forecast.

### Scope and Boundary

- Start: completed migration 1013 foundation and an open economic path.
- End: tested path-scoped lifecycle contract ready for later promotion wiring.
- Excluded: tasks 2.3+, `DatabaseManager` restore/promotion, daemon/direct runtime
  wiring, crash/recovery matrix, external/production operations, VCS/PR activity,
  and archive work.
- Review budget: 840 source-and-test lines plus this existing Unit 2A artifact boundary.
  The ordinary-review correction adds 136 net source/test lines plus this audit entry,
  within its approved 180 changed-line forecast. `.codegraph/` remains excluded and
  untouched.

## R7 Work Unit 2B: Fenced DatabaseManager Promotion

**Delivery mode**: Chained delivery, stacked-to-main. This slice completes tasks
2.3–2.4 only on top of the merged Unit 2A coordinator.

### Invalidated Completion Claim

- [ ] 2.3 RED: Added file-backed DatabaseManager cases covering successful
  zero-frame checkpoint promotion, absent WAL/SHM sidecars, busy/nonzero/failed
  checkpoint rejection, independent stage verification, retained prior, immutable
  manifest binding, and lifecycle fence revalidation before a destructive rename.
  The phase gate found this coverage incomplete.
- [ ] 2.4 GREEN: Added `restoreEconomicFrom`, which validates an active immutable
  economic fence, creates same-directory stage/prior/manifest artifacts, journals
  fencing/staging/promotion intent, atomically renames target then stage, verifies
  SQLite plus migration 1011, and writes `completed` only after that proof. The
  phase gate rejected this implementation as incomplete.

### Work Unit Evidence

| Evidence | Command / scenario | Exact result |
|---|---|---|
| RED test | `npm test -- packages/memory/src/databaseManager.test.ts` before implementation | Exit 1; 5 new cases failed because `restoreEconomicFrom` did not exist (the initial cleanup exposed authority-reuse failures that were fixed in test teardown before GREEN). |
| Focused test | `npm test -- packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts` | Exit 0; 2 test files passed, 36 tests passed. The existing scheduler mocks compile against the expanded manager contract. |
| Runtime harness | Same focused command; temporary file-backed SQLite target/backup, migration plan through 1013, acquired fence, close/reopen, readonly final integrity, and prior artifact scenario | Exit 0; successful promotion proves final `integrity_check = ok`, migration journal availability, retained prior, and sidecar-absent acceptance. |
| Typecheck | `npm run typecheck --workspace @msl/memory` | Exit 0. |
| Format / diff safety | `npx prettier --check packages/memory/src/databaseManager.ts packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts openspec/changes/finalize-economic-run-consistency/tasks.md openspec/changes/finalize-economic-run-consistency/apply-progress.md && git diff --check` | Exit 0; all five files formatted and no whitespace errors. |
| Rollback boundary | `packages/memory/src/databaseManager.ts`, `packages/memory/src/databaseManager.test.ts`, `packages/memory/src/backupScheduler.test.ts`, `tasks.md`, and this ledger entry | Revert the manager API/promotion behavior and its tests together. Unit 2A remains intact; no runtime/daemon registration or Unit 3+ recovery work is removed. |

### Scope and Boundary

- Start: merged lifecycle coordinator and migration 1013 journal schema.
- End: DatabaseManager-only fenced promotion seam with final SQLite and 1011 proof.
- Excluded: Unit 3 runtime/pool/daemon handle registration, Unit 4 exhaustive
  restart/crash matrix, external/production commands, VCS publication, and archive.
- Review budget: 551 authored additions plus deletions across source, tests, and SDD
  artifacts, below the hard 800-line slice cap.

### R7 Unit 2B Phase-Gate Reopening

- Status: tasks 2.3–2.4 are reopened; the prior completion claim is invalid.
- Reason: the phase gate rejected mutable-backup identity, durable journal/rename
  ordering, path and live-database fence checks, fail-closed checkpoint receipts,
  independent prior proof, reopen-before-completion, final relational proof,
  destructive-boundary evidence retention, disabled-manager handling, and the
  corresponding file-backed fault/race tests.
- Safety decision: no production correction was started. The current 551-line
  additions-plus-deletions delta leaves 249 lines under the hard 800-line Unit 2B cap,
  which cannot safely contain
  all required protocol and regression evidence without an unsafe partial change.
- Deterministic sub-split proposed: **2B-1 protocol hardening** (immutable
  stream/hash identity; canonical-path/live-fence validation; strict checkpoint;
  durable journal/manifest/rename ordering; cleanup/failure evidence), then
  **2B-2 promotion proof** (prior/final relational verification, reopen ordering,
  disabled-manager rejection, and the complete file-backed fault/race matrix).
   Both slices remain DatabaseManager-only and exclude Unit 3+.

## R7 Work Unit 2B-1: Protocol Hardening (Prepared, Not Promoted)

**Delivery mode**: Chained delivery, stacked-to-main. This is the authorized first
sub-slice of reopened Unit 2B. Parent tasks 2.3–2.4 remain unchecked for Unit 2B-2.

### Completed Sub-slice Behavior

- Snapshots the target path and fence identity, requires canonical lifecycle-path
  binding, validates live economic owner/token/generation/expiry after lifecycle
  awaits and checkpoint boundaries, and rejects alias/replacement mismatches.
- Hashes the backup before and after staging, independently verifies stage hash,
  page count, SQLite integrity, migration application, and closes every stage handle.
- Records durable `fence-acquired`, `draining`, `staged`, and `quiesced` journal/
  manifest evidence with file and parent-directory fsync seams. Missing, malformed,
  busy, nonzero, or throwing checkpoint receipts reject before any rename.
- Deliberately returns only `prepared`; `restoreEconomicFrom` never renames target
  or stage, never creates a prior artifact, and never writes `completed`. It reopens
  the lifecycle after verified preparation; preflight failure cleans only stage and
  retains manifest/journal evidence without masking the root error. Disabled managers
  reject economic restore.

### Work Unit Evidence

| Evidence | Command / scenario | Exact result |
|---|---|---|
| Focused test | `npm test -- packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts` | Exit 0; 2 test files passed, 38 tests passed. File-backed cases cover canonical lifecycle-path binding, prepared-only target preservation, stage verification, absent sidecars, stale lifecycle fence, busy/nonzero/malformed/throwing checkpoint rejection, cleanup, no-op rejection, and fsync seams. |
| Runtime harness | Same focused command; temporary file-backed SQLite target/backup with 1013 journal, lifecycle drain/reopen, readonly integrity check, and manifest inspection | Exit 0; prepared result retains stage, target remains the original database, no prior artifact exists, and no completed outcome is observable. |
| Typecheck | `npm run typecheck --workspace @msl/memory` | Exit 0. |
| Format / diff safety | `npx prettier --check packages/memory/src/databaseManager.ts packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts openspec/changes/finalize-economic-run-consistency/tasks.md openspec/changes/finalize-economic-run-consistency/apply-progress.md && git diff --check` | Exit 0; all matched files formatted and no whitespace errors. |
| Rollback boundary | `packages/memory/src/databaseManager.ts`, `packages/memory/src/databaseManager.test.ts`, `packages/memory/src/backupScheduler.test.ts`, `tasks.md`, and this ledger entry | Revert the prepared-only protocol and its proof together. It does not remove Unit 2A or Unit 2B-2 promotion work because no promotion is reachable. |

### Boundary

- Start: reopened unsafe DatabaseManager promotion delta.
- End: durable, independently verified preparation that safely reopens the original
  target; no target/stage rename, service admission, prior preservation, final
  verification, recovery, or `completed` terminal state.
- Follow-up: Unit 2B-2 alone may implement atomic promotion and its full fault/race
  proof, then mark parent tasks 2.3–2.4 complete.

## R7 Unit 2B-1 Corrective Retry: Blocked by Slice Budget

- Status: blocked before production or test edits; parent tasks 2.3–2.4 remain unchecked.
- Evidence: the current delta is 671 changed lines, leaving 129 of the hard
  800-line slice budget. The rejected protocol needs mutable-input and real-file
  identity binding, strict checkpoint parsing, durable atomic manifest ordering,
  lifecycle-safe journal reopen/recovery, the generic-daemon guard, and five
  file-backed fault cases. Those coupled changes cannot be proven safely in 147
  lines.
- Narrower split: **2B-1a prepared-input/durability proof** owns immutable
  canonical input/artifact identity, checkpoint parsing, manifest fsync ordering,
  and its file-backed tests. **2B-1b lifecycle/bypass proof** owns journal reopen
  recovery, draining failure recovery, the fail-closed daemon guard, and focused
  tests. Both remain prepared-only; 2B-2 retains promotion and final verification.
- Verification performed: `git diff --check` exited 0 on the unchanged
  implementation delta. Focused tests, typecheck, and Prettier were not rerun
  because this retry stopped before code changed.

## R7 Unit 2B-1b: Lifecycle / Journal Recovery and Generic Bypass Guard

**Delivery mode**: Chained delivery, stacked-to-main; maintainer-authorized bounded
size exception for this incremental reviewed sub-slice. Parent tasks 2.3–2.4 remain
unchecked and Unit 2B-2 promotion remains excluded.

### Completed Sub-slice Behavior

- [x] Releases the pre-drain journal handle after durable `staged` evidence. It
  reopens a journal by canonical target path only after quiescence, and releases it
  again around the target checkpoint so SQLite can truncate WAL before quiesced
  evidence is written.
- [x] On drain or post-drain failure, retains the original error, records failed
  journal/manifest evidence where available, cleans only the stage, and attempts
  lifecycle `reopen`/`recover` only through its safe transition gates.
- [x] Rejects daemon-level generic `restoreFrom` for its economic database before
  closing, staging, renaming, or calling the generic manager restore path.

### Work Unit Evidence

| Evidence | Command / scenario | Exact result |
|---|---|---|
| Focused memory test | `npm test -- packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts` | Exit 0; 2 test files passed, 41 tests passed. File-backed cases cover closed registered journal handle/path reopen, blocked drain recovery, post-drain root-error preservation with failed reopen, failure journal detail, and intact target/no prior or completed state. |
| Focused agent runtime test | `npm test -- packages/agent/src/runtime/agentDaemonPersistence.test.ts` | Exit 0; 1 test file passed, 1 test passed. A file-backed target and distinct backup prove generic daemon `restoreFrom` rejects before any rename: the original target marker remains. |
| Runtime harness | The two focused commands above exercise temporary file-backed SQLite databases, lifecycle drain/recover/reopen, journal readonly inspection, and daemon generic-restore rejection. | Exit 0; target remained intact; no prior artifact or completed outcome was created. |
| Typecheck | `npm run typecheck --workspace @msl/memory && npm run typecheck --workspace @msl/agent` | Exit 0 for both workspaces. |
| Rollback boundary | `packages/memory/src/databaseManager.ts`, `packages/memory/src/databaseManager.test.ts`, `packages/agent/src/runtime/agentDaemonPersistence.ts`, `packages/agent/src/runtime/agentDaemonPersistence.test.ts`, and this sub-slice ledger/task entry | Revert only lifecycle recovery and generic bypass guard behavior/proof. Prepared-only staging remains non-promoting; Unit 2A and future Unit 2B-2 promotion are unaffected. |

### Boundary

- Start: prepared-only 2B-1 protocol after durable staged evidence.
- End: safe lifecycle/journal failure handling and daemon generic-path rejection.
- Excluded: 2B-1a backup/path/stage identity and durability hardening, all target/stage
  rename or prior/completed promotion work, and Unit 3 runtime reconstruction.

### Corrective Retry: Phase-Gate Runtime Proof

- Corrected the daemon startup contract: generic `restoreFrom` for the owned
  economic database rejects fail-closed, while the message-bus and delegated
  backup capabilities remain usable without a close/rebind bypass.
- Replaced the misleading pre-closed journal test with a registered lifecycle
  participant. Its `close` hook observes the manager's pre-drain journal handle
  already closed, releases its own target-path handle, and the post-quiescence
  readonly reopen verifies the path-backed journal and manifest remain readable.
- The existing post-drain failure case continues to reopen the target readonly
  and assert durable `failed`/`failure_detail` evidence; this retry preserves
  that complementary failure-evidence proof.

| Evidence | Command / scenario | Exact result |
|---|---|---|
| Focused memory test | `npm test -- packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts` | Exit 0; 2 test files passed, 41 tests passed. Registered target-path participant proves the pre-drain journal release and prepared journal/manifest readability after quiescence. |
| Focused agent test | `npm test -- packages/agent/src/runtime/agentDaemonPersistence.test.ts` | Exit 0; 1 test file passed, 1 test passed. |
| Daemon startup contract | `npm test -- scripts/start-agent-daemons.test.mjs` | Exit 0; 1 test file passed, 2 tests passed. Generic restore rejects; bus and delegated backup remain usable. |
| Typecheck | `npm run typecheck --workspace @msl/memory && npm run typecheck --workspace @msl/agent` | Exit 0 for both workspaces. |
| Format / diff safety | `npx prettier --check scripts/start-agent-daemons.test.mjs packages/memory/src/databaseManager.test.ts packages/agent/src/runtime/agentDaemonPersistence.ts packages/agent/src/runtime/agentDaemonPersistence.test.ts openspec/changes/finalize-economic-run-consistency/tasks.md openspec/changes/finalize-economic-run-consistency/apply-progress.md && git diff --check` | Exit 0; all matched files formatted and no whitespace errors. |
| Rollback boundary | `scripts/start-agent-daemons.test.mjs`, `packages/memory/src/databaseManager.test.ts`, and this ledger entry | Revert the corrected assertions/proof only; do not alter generic restore production guard, prepared-only behavior, parent task state, or future promotion work. |

## R7 Unit 2B-1a: Input Identity and Durability Proof

**Delivery mode**: Chained delivery, stacked-to-main; maintainer-authorized bounded
size exception for this incremental reviewed sub-slice. Parent tasks 2.3–2.4 remain
unchecked; 2B-1b remains intact; Unit 2B-2 promotion is excluded.

### Completed Sub-slice Behavior

- [x] Snapshots restore ID, backup path, lifecycle path, fence, target filesystem
  object, and target economic identity before awaits. Restore IDs must be safe path
  components; target/backup/lifecycle aliases must be existing regular non-symlink
  files, and target replacement is rejected after drain.
- [x] Binds backup device/inode/size/hash before staging and proves it unchanged
  after the production copy. Stage bytes must exactly match source before migrations;
  after migrations, SQLite integrity and economic database ID/generation must match
  the immutable target metadata, and the durable stage hash is rechecked after fsync.
- [x] Strictly rejects missing, extra, non-number, NaN, negative, busy, or nonzero
  checkpoint callback receipts. Production SQLite parsing no longer defaults absent
  receipt fields to zero.
- [x] Writes each manifest using temp-write, file fsync, parent fsync, rename, then
  final file/parent fsync. Journal target evidence is durable before matching prepared
  manifest evidence; staged content is durable before the `staged` journal/manifest.

### Work Unit Evidence

| Evidence | Command / scenario | Exact result |
|---|---|---|
| Focused test | `npm test -- packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts` | Exit 0; 2 test files passed, 48 tests passed. File-backed cases cover source replacement during copy, post-migration stage mutation, symlink alias and unsafe ID rejection, malformed callback variants, exact target preservation/no prior or completed, and manifest fsync/rename fault cleanup. |
| Runtime harness | Same focused command; temporary file-backed SQLite target/backup with migration 1013, real lifecycle drain/reopen, readonly data checks, and durable-manifest seam ordering | Exit 0; all rejection paths retained the target data, removed stage/temp artifacts, and performed no economic rename, prior creation, or completion. |
| Typecheck | `npm run typecheck --workspace @msl/memory` | Exit 0. |
| Format / diff safety | `npx prettier --check packages/memory/src/databaseManager.ts packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts openspec/changes/finalize-economic-run-consistency/tasks.md openspec/changes/finalize-economic-run-consistency/apply-progress.md && git diff --check` | Exit 0; all matched files formatted and no whitespace errors. |
| Rollback boundary | `packages/memory/src/databaseManager.ts`, `packages/memory/src/databaseManager.test.ts`, `tasks.md`, and this ledger entry | Revert only immutable input/stage proof and atomic manifest evidence/proof. It leaves 2B-1b intact and cannot enable promotion, prior creation, or completion. |

### Boundary

- Start: corrected 2B-1b prepared-only lifecycle/bypass guard.
- End: durable, identity-bound prepared staging only.
- Excluded: all target/stage rename, prior/completed promotion, final relational
  verification, runtime/daemon edits, and Unit 2B-2.

### Corrective Retry: Descriptor-Bound Source Proof

- Revalidated the partially applied 2B-1a/2B-1b bytes before continuing. The
  prepared-only protocol already covered no-follow regular-file binding, strict
  checkpoint receipts, staged SQLite/identity proof, WAL-backed journal-before-
  manifest ordering, atomic manifest cleanup, lifecycle recovery, and the daemon
  generic-restore bypass guard.
- Closed the remaining identity gap: target and backup bindings now reject any
  hard link, the source SQLite verification opens the already-bound no-follow
  descriptor rather than a later path lookup, and the target identity is
  re-snapshotted after the protocol's own journal writes immediately before the
  lifecycle await. Device, inode, link count, size, mtime, and SHA-256 are then
  rechecked at the prepared boundary, so replacement or copy mutation fails
  without a rename.
- Journal insertion now durably syncs target/WAL/directory evidence before the
  first manifest. This preserves authoritative journal durability ordering for
  the `fence-acquired` transition as well as later phases.
- Added deterministic proof that a backup hard link is rejected. Existing
  file-backed coverage continues to prove symlink and target-alias rejection,
  deterministic pre-existing stage/manifest-temp rejection, source replacement,
  post-migration stage mutation, ID/generation mismatch, manifest write/fsync/
  rename/directory-fsync cleanup, journal ordering, and intact original target.

| Evidence | Command / scenario | Exact result |
|---|---|---|
| Focused memory/agent/daemon tests | `npm test -- packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts packages/agent/src/runtime/agentDaemonPersistence.test.ts scripts/start-agent-daemons.test.mjs` | Exit 0; 4 test files passed, 59 tests passed. |
| Typecheck | `npm run typecheck --workspace @msl/memory && npm run typecheck --workspace @msl/agent` | Exit 0 for both workspaces. |
| Runtime harness | The focused tests use file-backed SQLite target/backup databases, real lifecycle drain/reopen, readonly journal/manifest inspection, and daemon generic-restore rejection. | Exit 0; no economic target/stage rename, prior artifact, or completed outcome is reachable. |
| Format / diff safety | `npx prettier --check packages/memory/src/databaseManager.ts packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts packages/agent/src/runtime/agentDaemonPersistence.ts packages/agent/src/runtime/agentDaemonPersistence.test.ts scripts/start-agent-daemons.test.mjs openspec/changes/finalize-economic-run-consistency/tasks.md openspec/changes/finalize-economic-run-consistency/apply-progress.md && git diff --check` | Exit 0; all matched files formatted and no whitespace errors. |
| Rollback boundary | `packages/memory/src/databaseManager.ts`, `packages/memory/src/databaseManager.test.ts`, and this ledger entry | Revert descriptor-bound source verification, hard-link exclusion, and first-journal WAL durability together; prepared-only behavior, 2B-1b daemon guard, and future 2B-2 promotion remain independent. |

**Delivery**: maintainer-authorized `size:exception`; the current accumulated
2B-1 correction delta is 1,688 additions plus deletions. Parent tasks 2.3–2.4
remain intentionally unchecked.

### Frozen Gate Correction: 2B-1a Descriptor, Artifact, Callable, and WAL Evidence

- Eliminated the lstat-to-realpath binding window: restore inputs now bind the
  original `O_NOFOLLOW` descriptor, derive their canonical path from that
  descriptor, and continuously compare path device, inode, and link count before
  journal transitions, including failed-journal publication.
- Artifact preflight now uses `lstat`, therefore rejects dangling symlink, hard-link,
  and ordinary pre-existing stage and manifest-temporary artifacts deterministically.
- Snapshots migration, lifecycle, checkpoint, copy, and durability callables before
  asynchronous work. Target economic ID/generation is captured before caller-supplied
  migration logic receives the target handle.
- Staged migrations require an exact zero-frame `wal_checkpoint(TRUNCATE)` receipt;
  only after that authority is proven are the main file and directory fsynced and
  the durable main-byte hash rechecked. Failed-journal evidence follows the same
  checkpoint → fsync → manifest order.

| Evidence | Command / scenario | Exact result |
|---|---|---|
| Focused test | `npm test -- packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts packages/agent/src/runtime/agentDaemonPersistence.test.ts scripts/start-agent-daemons.test.mjs` | Exit 0; 4 test files passed, 65 tests passed. Includes deterministic dangling/hard-link artifact, mutable-callable, target-identity, staged busy/nonzero/fault WAL, and failed-journal ordering coverage. |
| Runtime harness | Same focused command; temporary file-backed SQLite target/backup through real lifecycle drain/reopen and readonly evidence inspection | Exit 0; preparation remains non-promoting: no target/stage rename, prior artifact, or `completed` outcome. |
| Typecheck | `npm run typecheck --workspace @msl/memory && npm run typecheck --workspace @msl/agent` | Exit 0 for both workspaces. |
| Rollback boundary | `packages/memory/src/databaseManager.ts`, `packages/memory/src/databaseManager.test.ts`, and this ledger entry | Revert only frozen-gate hardening and its proof. It preserves accepted 2B-1b and cannot enable Unit 2B-2 promotion. |

**Delivery**: maintainer-authorized `size:exception`. Sub-slice 2B-1a is passing
its focused evidence; parent tasks 2.3–2.4 remain intentionally unchecked, and
promotion/2B-2 remains out of scope.

### Corrective Retry: Atomic Backup and Stage Path Substitution

- Root cause: backup verification retained the original descriptor, but the final
  prepared check compared only descriptor bytes and never `lstat`-compared the
  caller's backup path to that descriptor. The stage was reopened by path after
  exclusive copy, so an atomic rename-away/replacement during a lifecycle close
  callback was treated as the verified stage.
- Correction: the backup path is now checked against its original descriptor's
  device, inode, and link count after every callback/await and immediately before
  prepared evidence/return. The exclusive stage descriptor remains open through
  the protocol; its path is checked against that descriptor after callbacks and
  lifecycle awaits, and its final descriptor hash/size is checked before staged
  and prepared evidence. Failure evidence compares identities without replacing
  the original identity error, then records `failed` and safely recovers lifecycle
  state. No target/stage promotion is introduced.
- Test hygiene: two existing basic manager tests destructured no `manager` from
  `setupTestDb`, producing `ReferenceError` in the required complete focused run.
  The fixture destructuring was corrected; no production behavior changed.

### Work Unit Evidence

| Evidence | Command / scenario | Exact result |
|---|---|---|
| Focused substitution proof | `npm test -- packages/memory/src/databaseManager.test.ts -t "rejects atomic backup-path replacement from drain and retains failed prepared evidence\|rejects stage-path replacement from participant close and retains failed prepared evidence"` | Exit 0; 1 test file passed; 2 targeted tests passed, 46 skipped. Both atomic rename-away/replacement probes reject before `prepared`. |
| Focused regression suite | `npm test -- packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts packages/agent/src/runtime/agentDaemonPersistence.test.ts scripts/start-agent-daemons.test.mjs` | Exit 0; 4 test files passed; 67 tests passed. File-backed target remains intact; failure journal has `failed` outcome/root identity detail; no prior, completed, or promotion state. |
| Runtime harness | The focused file-backed SQLite substitution fixtures invoke the copy/migration seams and registered lifecycle close/reopen callbacks. | Exit 0; atomic backup/stage path replacement rejected; lifecycle returned to `open`; replacement stage was not accepted as evidence. |
| Typecheck | `npm run typecheck --workspace @msl/memory && npm run typecheck --workspace @msl/agent` | Exit 0 for both workspaces. |
| Format / diff safety | `npx prettier --check packages/memory/src/databaseManager.ts packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts packages/agent/src/runtime/agentDaemonPersistence.ts packages/agent/src/runtime/agentDaemonPersistence.test.ts scripts/start-agent-daemons.test.mjs openspec/changes/finalize-economic-run-consistency/tasks.md openspec/changes/finalize-economic-run-consistency/apply-progress.md && git diff --check` | Exit 0; all matched files formatted and no whitespace errors. |
| Rollback boundary | `packages/memory/src/databaseManager.ts`, `packages/memory/src/databaseManager.test.ts`, and this ledger entry | Revert descriptor-bound substitution checks and their tests together. The prepared-only protocol remains non-promoting; Unit 2B-1b stays intact and Unit 2B-2 remains excluded. |

**Delivery**: maintainer-authorized `size:exception`. Parent tasks 2.3–2.4 remain
intentionally unchecked; no VCS publication, external operation, prior creation,
promotion, or completed outcome occurred.

### PR #146 CI Lint Remediation

- Replaced the forbidden async rejection proxy with `Promise.reject`, made the
  immutable fence binding `const`, separated journal failure-detail assertions,
  removed two redundant checkpoint casts, and deleted the unused path-identity helper.
- No runtime behavior or task completion changed.

| Evidence | Command / scenario | Exact result |
|---|---|---|
| Repository lint | `npm run lint` | Exit 0; no lint errors. |
| Focused regression suite | `npm test -- packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts packages/agent/src/runtime/agentDaemonPersistence.test.ts scripts/start-agent-daemons.test.mjs` | Exit 0; 4 test files passed, 71 tests passed. |
| Typecheck | `npm run typecheck --workspace @msl/memory && npm run typecheck --workspace @msl/agent` | Exit 0 for both workspaces. |
| Format / diff safety | `npx prettier --check packages/agent/src/runtime/agentDaemonPersistence.ts packages/memory/src/databaseManager.test.ts packages/memory/src/databaseManager.ts && git diff --check` | Exit 0; all matched files formatted and no whitespace errors. |
| Rollback boundary | `packages/agent/src/runtime/agentDaemonPersistence.ts`, `packages/memory/src/databaseManager.test.ts`, `packages/memory/src/databaseManager.ts`, and this evidence entry | Revert only the seven CI lint remediations and this record; economic restore behavior remains unchanged. |

### Final Gate Correction: Descriptor Cleanup and Final Manifest Durability

- Moved lifecycle-path canonicalization, artifact directory/path derivation, and
  artifact preflight into the descriptor-owned protocol boundary. Any failure after
  target/backup acquisition now closes each descriptor exactly once without
  replacing the lifecycle/preflight root error. Deterministic file-backed tests
  prove both descriptors can be renamed, reopened, and deleted after lifecycle-path
  mismatch and artifact-preflight rejection.
- `writeDurableJson` now invokes the production `syncArtifacts` seam after atomic
  rename, which fsyncs the final manifest file and then its parent directory. A
  final-file fsync failure retains the root error, removes the published manifest
  and temporary artifact, and preserves failed journal evidence where it exists.
- This remains prepared-only: no target/stage promotion, prior creation, completed
  outcome, Unit 2B-2 work, or parent task completion was introduced.

| Evidence | Command / scenario | Exact result |
|---|---|---|
| Focused regression suite | `npm test -- packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts packages/agent/src/runtime/agentDaemonPersistence.test.ts scripts/start-agent-daemons.test.mjs` | Exit 0; 4 test files passed; 71 tests passed. The existing 67 tests remain green; four new deterministic descriptor-cleanup and manifest-durability tests pass. |
| Runtime harness | File-backed SQLite lifecycle-path mismatch, artifact-preflight rejection, atomic manifest rename, final-file fsync failure, and readonly failed-journal inspection | Exit 0; descriptors were reusable after failure; the manifest sync order was rename → final file → parent directory; final-file failure removed published/temp manifest artifacts and retained failed journal evidence. |
| Typecheck | `npm run typecheck --workspace @msl/memory && npm run typecheck --workspace @msl/agent` | Exit 0 for both workspaces. |
| Format / diff safety | `npx prettier --check packages/memory/src/databaseManager.ts packages/memory/src/databaseManager.test.ts packages/memory/src/backupScheduler.test.ts packages/agent/src/runtime/agentDaemonPersistence.ts packages/agent/src/runtime/agentDaemonPersistence.test.ts scripts/start-agent-daemons.test.mjs openspec/changes/finalize-economic-run-consistency/tasks.md openspec/changes/finalize-economic-run-consistency/apply-progress.md && git diff --check` | Exit 0; all checked files formatted and no whitespace errors. |
| Rollback boundary | `packages/memory/src/databaseManager.ts`, `packages/memory/src/databaseManager.test.ts`, and this ledger entry | Revert descriptor-bound early-failure cleanup and final-manifest fsync proof together. It preserves accepted 2B-1b and cannot enable promotion, prior creation, or completion. |

**Delivery**: maintainer-authorized `size:exception`. Parent tasks 2.3–2.4 remain
intentionally unchecked; no VCS publication, external operation, prior creation,
promotion, or completed outcome occurred.
