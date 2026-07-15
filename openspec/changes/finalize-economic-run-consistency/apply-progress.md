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
