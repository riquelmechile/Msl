# Apply Progress: Creative Budget Reservations and Generation Attempts

Mode: Standard. Delivery: auto-chain, stacked-to-main. Current slice: B / PR2, based on merged Slice A.

## Completed

- [x] A.1-A.3: branded micros and reservation/attempt/send-proof domain contracts.
- [x] A.4-A.5: standalone canonical creative v4 DDL, indexes, FK/CHECK predicates, and exact sqlite_master/table/FK/index PRAGMA ownership proof.
- [x] A.6: focused money and migration coverage.
- [x] B.1: SQLite reservation authority with `BEGIN IMMEDIATE`, 5-second busy timeout, and retryable busy conflicts.
- [x] B.2: atomic UTC-day/per-job admission from committed actual plus active held micros, with canonical duplicate rereads.
- [x] B.3: conditional commit, proof-gated release, exact fenced renewal, and attempt-protected expiry.
- [x] B.4: focused daily/job cap, UTC reset, same-job committed-plus-held, idempotency/divergence, exact-reserved/overage commit, trusted/untrusted release, expiry, genuine two-worker serialization, and crash coverage.

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused tests | `npx vitest run packages/domain/src/money.test.ts packages/creative-studio/src/__tests__/creativeDurabilityMigration.test.ts` -> 2 files, 23 tests passed |
| Planned slice command | `npx vitest run packages/domain/src/money.test.ts packages/creative-studio/src/__tests__/` -> 12 files, 162 tests passed |
| Migration harness | Focused migration suite above -> 3 tests passed: fresh/legacy/idempotent, ownership +/-, FK and state CHECKs |
| Static/format/diff | `npm run typecheck`, `npm run lint`, targeted `npx prettier --check ...`, and `git diff --check` -> exit 0 |
| Rollback boundary | Revert `package-lock.json`, `packages/creative-studio/package.json`, `packages/creative-studio/tsconfig.json`, `packages/creative-studio/src/index.ts`, `packages/domain/src/{index.ts,money.ts,money.test.ts}`, and new `packages/creative-studio/src/{domain/budgetReservation.ts,domain/generationAttempt.ts,infrastructure/storage/creativeDurabilityMigration.ts,__tests__/creativeDurabilityMigration.test.ts}`; remove creative v4 types/schema while preserving bus v1-v3 and existing database tables/history. |

### Slice B / PR2

| Evidence | Exact result |
|---|---|
| Focused tests | `npx vitest run packages/creative-studio/src/__tests__/reservation-store*` -> 1 file, 2 tests passed; explicitly proves daily-cap rejection/non-insert, UTC-midnight reset, same-job committed-plus-held job-cap rejection/non-insert, exact-reserved commit with zero released, overage-preserves-hold, untrusted-proof rejection/non-mutation, barrier-released two-Worker SQLite serialization with no busy result (one admitted, one job-cap rejected, canonical total 6,000), fenced renewal, attempt-protected expiry, and crash rollback. |
| Corrected cumulative tests | `npx vitest run packages/domain/src/money.test.ts packages/creative-studio/src/__tests__/` -> 13 files, 164 tests passed |
| Runtime harness | Focused command above -> two Node Workers open independent connections to one file, synchronize on a shared barrier, and call the real store concurrently; both complete without `busy`, yielding one admitted 6,000-micro hold, one `job-cap-exceeded`, and canonical count/sum `1/6000`. |
| Static gates | `npm run typecheck`, `npm run lint`, targeted `npx prettier --check packages/creative-studio/src/{infrastructure/storage/reservationStore.ts,__tests__/reservation-store.test.ts,index.ts}`, and `git diff --check` -> exit 0 |
| Rollback boundary | Revert `packages/creative-studio/src/index.ts` and remove `packages/creative-studio/src/infrastructure/storage/reservationStore.ts` plus `packages/creative-studio/src/__tests__/reservation-store.test.ts`; Slice A domain contracts and v4 schema remain intact. |
| Review workload | Executable churn: 367 additions, 0 deletions across implementation, focused tests, and export. Progress-only docs are reported separately. No `size:exception`. |

## Remaining

C.1-C.5, D.1-D.3, E.1-E.5, F.1-F.4, G.1-G.6 remain pending (23/33); 10/33 are complete. No attempt store, provider seam, daemon/polling, bus integration, startup registration/recovery, or later-slice runtime wiring was implemented.
