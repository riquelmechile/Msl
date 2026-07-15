# Proposal: Journaled and Fenced Economic Restore

## Intent

Make economic restoration recoverable and unambiguous. The current generic restore stages and renames a verified backup but has no durable operation record, writer fence, immutable identity, or interruption recovery decision.

## Scope

### In Scope
- Reserve migration **1013** exclusively for the economic restore journal and its integrity constraints; preserve 1007–1011 and do not claim 1012 or later R2 run-failure ownership.
- Implement a fenced restore protocol: acquire and validate the economic database fence, close/checkpoint WAL and SHM, stage a verified backup, atomically promote it, reopen, and verify it.
- Persist a journal with immutable restore/backup identity, generations, phase, outcome, and failure detail; on restart, complete or restore the preserved prior database.
- Prove fault handling, stale/concurrent-writer rejection, rerun/recovery, identity mismatch rejection, WAL/SHM handling, and final integrity verification offline.

### Out of Scope
- R7 alert delivery and migration 1012, R8 finalization, production smoke, external APIs, credentials, and archive work.
- Changing normal ingestion semantics, backup scheduling, or restoring non-economic databases.

## Capabilities

### New Capabilities
- `economic-restore-recovery`: Fenced, journaled, recoverable restoration of the economic SQLite database.

### Modified Capabilities
- `sqlite-durability`: Economic restoration gains journal, fencing, recovery, and verification requirements.
- `migration-framework`: Registers migration 1013 in canonical order and preserves transactional/idempotent upgrade behavior.

## Approach

Extend the canonical economic migration plan with 1013. Bind each restore to immutable database/backup identity and a live fence generation. Journal each durable phase before its destructive boundary. On restart, inspect journal and filesystem identity: finish verified promotion or restore the preserved prior database; otherwise fail closed. No writer proceeds without a matching fence.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/memory/src/migrationRegistry.ts` | Modified | 1013 schema and plan ordering |
| `packages/memory/src/databaseManager.ts` | Modified | Fenced journaled restore/recovery |
| `packages/memory/src/*restore*.test.ts` | Modified/New | Fault/concurrency matrix |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Crash after rename | Med | Journal, preserved prior copy, deterministic recovery |
| Stale writer resumes | Med | Generation/token fence checks at every boundary |
| Invalid backup promoted | Low | Verify before and after promotion; fail closed |

## Rollback Plan

If restore verification fails, stop writes, retain journal/staging/prior copy, recover the recorded prior database, verify integrity, and release only after a terminal outcome. Do not remove 1013 from upgraded databases.

## Dependencies

- Existing economic fence (1007), source/lease model (1008), and admission receipts (1011).

## Success Criteria

- [ ] Every restore reaches a verified terminal journal state or recovered prior state.
- [ ] Concurrent, expired, or generation-mismatched writers cannot write during restore.
- [ ] Migration upgrades/reruns preserve ordering through 1013 without ambiguity.
