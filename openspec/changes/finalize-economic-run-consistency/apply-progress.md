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
