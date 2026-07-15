# Tasks: Journaled and Fenced Economic Restore

Scope: R7 restore and 1013 only; preserve R1–R6. Exclude 1012 alerts, R8, external/production, and VCS/PR work.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated authored changed lines | 1,200–1,550 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Units 1 → 2 → 3 → 4 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No — resolved to chained delivery
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | 1013 journal schema | PR 1 | `npm test -- packages/memory/src/migrationRegistry.test.ts packages/memory/tests/economicDurabilityMigration.test.ts` | File-backed upgrade/rerun | `migrationRegistry.ts` and migration tests |
| 2 | Fenced promotion | PR 2 | `npm test -- packages/memory/src/databaseManager.test.ts packages/memory/src/economicDatabaseLifecycle.test.ts` | File-backed restore faults | lifecycle/manager files and tests |
| 3 | Runtime wiring | PR 3 | `npm test -- packages/memory/src/economicWriteSession.test.ts packages/agent/src/runtime/agentDaemonPersistence.test.ts` | Dual-handle restart fixture | wiring files and tests |
| 4 | Recovery proof | PR 4 | `npm test -- packages/memory/src/*restore*.test.ts` | Crash-restart fixture | restore test files only |

## Phase 1: Journal Contract

- [x] 1.1 RED: Extend `packages/memory/src/migrationRegistry.test.ts` and `packages/memory/tests/economicDurabilityMigration.test.ts` for 1013-after-1011, rerun, atomic failure, immutable trigger, and preserved 1007–1011.
- [x] 1.2 GREEN: Add transactional, idempotent 1013 `economic_restore_journal` schema, integrity constraints, phases/outcomes, and immutable-field trigger in `packages/memory/src/migrationRegistry.ts`; do not add 1012.

## Phase 2: Fenced Restore Protocol

- [x] 2.1 RED: Create `packages/memory/src/economicDatabaseLifecycle.test.ts` for epochs, stale permits, mismatched fences, draining, renewal cancellation, authority-compatible path sharing, and release/eviction without mutation.
- [x] 2.2 GREEN: Create `packages/memory/src/economicDatabaseLifecycle.ts`; register epoch-bound participants, drain writes, validate fence identity before destructive boundaries, own/release path leases safely, and block admission on failure.
- [ ] 2.3 RED: Add `packages/memory/src/databaseManager.test.ts` cases for checkpoint zero frames, absent sidecars accepted, busy/nonzero WAL rejected, independent staging verification, atomic promotion, and retained verified prior. Reopened after R7 Unit 2B phase-gate rejection.
- [ ] 2.4 GREEN: Add `restoreEconomicFrom` in `packages/memory/src/databaseManager.ts` with same-filesystem stage/prior/manifest, durable transitions, quiescence, atomic rename, and post-1011 verification. Reopened after R7 Unit 2B phase-gate rejection.

### Unit 2B-1 Protocol-Hardening Sub-slice (parent tasks remain pending)

- Prepared, but did not promote, immutable backup/stage identity, canonical lifecycle-path binding, strict checkpoint receipts, durable manifest/journal phase evidence, and fail-closed cleanup/reopen behavior.
- [x] 2B-1a: Snapshot and bind filesystem/economic input identities; strictly parse checkpoint receipts; independently prove post-migration stage integrity/identity; atomically fsync manifest evidence and prove race/fault cleanup. Revalidated after frozen gate corrections; parent tasks remain pending.
- [x] 2B-1b: Release the pre-drain journal handle; reopen it by canonical path only after quiescence, retain root failure evidence while lifecycle recovery is safe, and reject generic daemon restore without any economic rename.
- Parent tasks 2.3–2.4 intentionally remain unchecked until Unit 2B-2 implements and proves atomic promotion, final relational verification, and terminal completion.

## Phase 3: Runtime Integration and Recovery

- [ ] 3.1 RED: Add direct-runtime/pool tests in `packages/memory/src/economicWriteSession.test.ts` and `packages/memory/src/connectionPool.test.ts` proving rebuilt handles never expose closed references.
- [ ] 3.2 GREEN: Register/reopen direct runtime and shared handle in `packages/memory/src/economicWriteSession.ts` and `packages/memory/src/connectionPool.ts`; export lifecycle APIs from `packages/memory/src/index.ts`.
- [ ] 3.3 RED: Create `packages/agent/src/runtime/agentDaemonPersistence.test.ts` for both same-path handles, proxy routing, timeout, and atomic rebuild of bus/consensus/read-model/learning proxies.
- [ ] 3.4 GREEN: Route daemon `restoreFrom` through the coordinator in `packages/agent/src/runtime/agentDaemonPersistence.ts`; rebuild resources or retain blocked failed/rolled-back state.
- [ ] 3.5 RED/GREEN: Add deterministic fault-injection restart tests for every nonterminal phase, including post-rename and pre-prior; assert one `completed|rolled-back|failed` outcome, no duplicate destructive work, and ambiguity fails closed.

## Phase 4: Verification

- [ ] 4.1 Run Unit 1–4 commands, then `npm test`, `npm run typecheck`, and `npm run build`; separate R1–R6 regressions from new failures.
- [ ] 4.2 Verify only offline file-backed fixtures: final SQLite integrity, 1011 constraints, admission after `completed` only, and prior recovery after every fault; no E2E, external, or production command.
