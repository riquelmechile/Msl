# Design: Journaled and Fenced Economic Restore

## Technical Approach

R7 adds `restoreEconomicFrom` beside unchanged generic `restoreFrom`. It uses migration 1013, same-filesystem artifacts, and one path-scoped lifecycle coordinator to fence, drain, promote, rebuild, and then admit each economic path. Scope excludes 1012, alerts, R8, and non-economic restore.

## Architecture Decisions

| Decision | Options / trade-off | Choice and rationale |
|---|---|---|
| Lifecycle ownership | Caller-owned close; central coordinator | `EconomicDatabaseLifecycle` serializes each canonical path. Registration covers direct handles and captured stores. |
| Journal survivability | Target-only row; 1013 row plus durable manifest | 1013 owns journal constraints; a checksum-bound adjacent manifest and row copies survive replacement. |
| WAL evidence | Require sidecars; inspect checkpoint result | A successful truncate checkpoint with zero remaining frames, then closed handles, is required. Absent `-wal`/`-shm` afterward is normal SQLite behavior; busy/checkpoint error/nonzero frames fails closed. |
| Pre-prior recovery | Retry or fail | Without verified `prior`, recovery never retries/promotes: it records `failed`, reopening only a bound original target. |

## Data Flow

```text
request -> coordinator.enterDraining(path) -> invalidate sessions / stop renewals
        -> await in-flight writes -> checkpoint(0 frames) -> close every handle
        -> journal + manifest -> verify stage -> rename target->prior -> stage->target
        -> rebuild all resources -> integrity + 1011 checks -> terminal/admit
```

## Interfaces / Contracts

`EconomicDatabaseLifecycle`, keyed by canonical persistent path, exposes `register(participant)`, `withWritePermit`, and `restore(input)`. Participants provide `invalidate`, `drain(timeout)`, `close`, and `reopen`; registration returns an epoch-bound capability. Permits reject during drain/stale epochs. Store/reader/session proxies resolve the current epoch; captured stores/sessions reject `ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED`, never a closed handle.

`createEconomicMemoryRuntime` registers its direct `better-sqlite3` handle, tracks open sessions/renewals, aborts renewals, invalidates receipts, waits for writes/releases through the timeout, then closes. Reopen creates its handle and stores/readers anew. `connectionPool` registers its shared handle identically.

`createAgentDaemonPersistenceRuntime` registers **both** same-path handles (`db`, `economicRuntime`). Its `restoreFrom` proxy routes `restoreEconomicFrom` through this coordinator, never a `close/open` bypass. Reopen rebuilds `db`, economic runtime, bus, consensus, read model, learning store, and delegated proxies together. Timeout, lifecycle error, stale fence, or post-close failure blocks the path and yields `failed` (or verified-prior `rolled-back`); no writer is admitted.

Migration 1013 follows 1011 transactionally/idempotently. `economic_restore_journal` binds restore/backup hashes/pages, database identity/generations, owner/token digest, write epoch, phase/outcome/failure. An update trigger protects immutable fields; phases are `fence-acquired`, `draining`, `quiesced`, `prior-preserved`, `staged`, `promotion-intent`, `promoted`, `verifying`, and terminal `completed|rolled-back|failed`.

## Deterministic Recovery

Recovery first validates the manifest and every candidate journal identity; ambiguity is terminal `failed` and the coordinator remains blocked. It reacquires a valid recovery fence before any action.

| Evidence | Restart action and terminal result |
|---|---|
| Before `prior-preserved`, no verified `prior` | Remove matching stage; record `failed`; rebuild only a bound original target, else block. |
| Verified `prior`, no target | Verify/promote stage then `completed`; otherwise restore/verify prior, `rolled-back`. |
| Target and verified `prior` | Complete only on bound staged identity plus final checks; otherwise restore/verify prior, `rolled-back`. |
| `promotion-intent`/`promoted`, only verified stage | Promote/verify/rebuild, `completed`; otherwise `rolled-back` with prior, else `failed`. |
| Mismatch, busy/checkpoint error/nonzero frames, invalid prior, or rebuild/final failure | Restore/verify prior and `rolled-back`, else `failed`; retain evidence and block admission. |

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/memory/src/economicDatabaseLifecycle.ts` | Create | Path-scoped registration, epochs, drain, restore, recovery, and reopen orchestration. |
| `packages/memory/src/databaseManager.ts` | Modify | Expose fenced economic restore, same-filesystem artifacts, manifest/journal recovery, and strict checkpoint evidence. |
| `packages/memory/src/connectionPool.ts` | Modify | Register/invalidate/rebuild the shared path handle. |
| `packages/memory/src/economicWriteSession.ts` | Modify | Register direct runtime, session/renewal drain, and epoch-safe store proxies. |
| `packages/memory/src/migrationRegistry.ts` | Modify | Add only transactional, rerunnable migration 1013 journal constraints. |
| `packages/agent/src/runtime/agentDaemonPersistence.ts` | Modify | Route both same-path handles through lifecycle restore and atomic resource reconstruction. |
| `packages/memory/src/*restore*.test.ts`, agent persistence tests | Create/Modify | Lifecycle, fault, daemon, WAL, recovery, and migration coverage. |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | 1013 ordering/immutability; epochs; stale references; renewal cancellation | Vitest with controlled clock, hooks, and handle spies. |
| Integration | Every journal evidence case; rename crash; timeout; daemon/direct runtime; busy/checkpoint/frames; absent sidecars | File-backed `better-sqlite3`, fault seams/restart; assert one terminal outcome and admission state. |
| E2E | None | No UI or external workflow changes. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

1013 is additive, transactional, and reserved exclusively for the economic restore journal. No migration, feature flag, or rollout outside R7 is required.

## Open Questions

None.
