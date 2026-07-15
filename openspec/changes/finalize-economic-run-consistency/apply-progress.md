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
