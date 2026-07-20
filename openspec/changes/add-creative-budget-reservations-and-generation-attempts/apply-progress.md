# Apply Progress: Creative Budget Reservations and Generation Attempts

Mode: Standard. Delivery: auto-chain, stacked-to-main. Current slice: D / PR4, based on merged Slices A-C.

## Completed

- [x] A.1-A.3: branded micros and reservation/attempt/send-proof domain contracts.
- [x] A.4-A.5: standalone canonical creative v4 DDL, indexes, FK/CHECK predicates, and exact sqlite_master/table/FK/index PRAGMA ownership proof.
- [x] A.6: focused money and migration coverage.
- [x] B.1: SQLite reservation authority with `BEGIN IMMEDIATE`, 5-second busy timeout, and retryable busy conflicts.
- [x] B.2: atomic UTC-day/per-job admission from committed actual plus active held micros, with canonical duplicate rereads.
- [x] B.3: conditional commit, proof-gated release, exact fenced renewal, and attempt-protected expiry.
- [x] B.4: focused daily/job cap, UTC reset, same-job committed-plus-held, idempotency/divergence, exact-reserved/overage commit, trusted/untrusted release, expiry, genuine two-worker serialization, and crash coverage.
- [x] C.1: SQLite attempt authority with `BEGIN IMMEDIATE`, 5-second busy timeout, prepared-before-dispatch persistence, and canonical retrieval.
- [x] C.2: random 32-byte lease tokens with SHA-256-at-rest, exact 90-second grants, deterministic due ordering, generation increments, and atomic takeover.
- [x] C.3: fenced renewal and prepared, dispatching, submitted, ambiguous, completed, and failed transitions with state-specific evidence validation.
- [x] C.4: atomic attempt/reservation completion or proof-gated failure, exact terminal replay idempotency, divergent closure rejection, and rollback on injected commit failure.
- [x] C.5: focused prepared-before-POST, exact prepare retry, two-worker acquisition, ordering, takeover, renewal, stale-fence, happy/error/ambiguous, immutable terminal, no-blind-retry, and crash coverage.
- [x] D.1: evidence-aware MiniMax paid-submission seam with canonical `Idempotency-Key`, accepted response/request identity, and trusted zero-byte pre-send proof.
- [x] D.2: explicit provider rejection proof requires request identity plus `accepted:false` and `charged:false`; all unproven rejection, timeout, network loss, and lost-response outcomes remain ambiguous without release proof.
- [x] D.3: focused mock/failure-injection coverage for acceptance ordering, forged rejection evidence, exact proof semantics, timeout ambiguity, and `loseResponseAfterProviderAccept`.

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

### Slice C / PR3

| Evidence | Exact result |
|---|---|
| Focused tests | `npx vitest run packages/creative-studio/src/__tests__/attempt-store*` -> 1 file, 3 tests passed; proves active duplicate prepare preserves generation/digest, expired exact retry takes over canonically, SHA-256 token-at-rest, invalid lease duration, deterministic due ordering, two-worker acquisition, stale fencing, submitted completion/failure, ambiguous completion with no redispatch, exact completed/failed replay after lease expiry, divergent same-outcome evidence conflicts, invalid evidence/proof rejection, and atomic crash rollback. |
| Corrected cumulative tests | `npx vitest run packages/domain/src/money.test.ts packages/creative-studio/src/__tests__/` -> 14 files, 167 tests passed. |
| Runtime harness | Focused command above -> two Node Workers open independent SQLite connections, synchronize on a shared barrier, and race `acquireDue`; `BEGIN IMMEDIATE` grants each expired attempt once across the workers with no duplicate claim. |
| Failure-injection evidence | `crashBeforeAtomicCommit` leaves attempt `dispatching` and reservation `held`. Active duplicate prepare leaves generation/digest unchanged; only expiry replaces the token and increments generation. Exact terminal replay succeeds after lease expiry, divergent same-outcome evidence conflicts, and stale different outcomes remain fenced. Ambiguous work cannot return to dispatch and closes only through same-attempt evidence. |
| Static gates | `npm run typecheck`, `npm run lint`, targeted `npx prettier --check packages/creative-studio/src/infrastructure/storage/generationAttemptStore.ts packages/creative-studio/src/__tests__/attempt-store.test.ts packages/creative-studio/src/index.ts`, and `git diff --check` -> exit 0. |
| Rollback boundary | Revert `packages/creative-studio/src/index.ts` and remove `packages/creative-studio/src/infrastructure/storage/generationAttemptStore.ts` plus `packages/creative-studio/src/__tests__/attempt-store.test.ts`; Slices A+B domain/schema/reservation authority remain intact. |
| Review workload | Executable churn: 247 additions, 0 deletions across implementation, focused tests, and export. Complete Slice C apply numstat including OpenSpec progress: 271 additions, 7 deletions (278 changed lines). No `size:exception`. |

### Slice D / PR4

| Evidence | Exact result |
|---|---|
| Required RED injection | Initial run: 1 file, 6 tests failed because `submit` did not exist. Focused correction run: `npx vitest run packages/creative-studio/src/__tests__/minimax-transport*` -> 9 tests run, 1 failed because malformed provider status incorrectly produced `rejected`. |
| Focused tests | `npx vitest run packages/creative-studio/src/__tests__/minimax-transport*` -> 1 file, 9 tests passed; proves canonical key propagation, accepted submission evidence, zero-byte pre-send proof, explicit unaccepted/uncharged rejection proof, forged flag/identity/status rejection, timeout ambiguity, and ordered `loseResponseAfterProviderAccept` non-release. |
| Client/transport regression | `npx vitest run packages/creative-studio/src/__tests__/minimax-client.test.ts packages/creative-studio/src/__tests__/minimaxTransport.test.ts` -> 2 files, 31 tests passed. |
| Corrected cumulative tests | `npx vitest run packages/domain/src/money.test.ts packages/creative-studio/src/__tests__/` -> 15 files, 176 tests passed. |
| Runtime harness | N/A: Slice D introduces an HTTP seam, not a live provider runtime boundary; focused tests execute the real client/transport through mocked `fetch`, including response loss after simulated provider acceptance. |
| Failure-injection evidence | The fake provider records authoritative acceptance of the exact `Idempotency-Key` before rejecting the response, after which the seam returns `ambiguous` without proof. Wrong acceptance/charge flags, missing request identity, and malformed provider status also remain ambiguous; only serialization failure before `fetch` returns `transport-before-send`. |
| Static gates | `npm run typecheck`, `npm run lint`, `npm run format:check`, and `git diff --check` -> exit 0. |
| Rollback boundary | Revert `packages/creative-studio/src/index.ts`, `packages/creative-studio/src/infrastructure/providers/minimax/{minimax-client.ts,minimaxTransport.ts}`, and remove `packages/creative-studio/src/__tests__/minimax-transport-send-proof.test.ts`; Slices A-C domain/schema/reservation/attempt authorities remain intact. |
| Review workload | Complete Slice D apply numstat including OpenSpec progress: 378 additions, 20 deletions (398 changed lines). No `size:exception`. |

## Remaining

E.1-E.5, F.1-F.4, and G.1-G.6 remain pending (15/33); 18/33 are complete. No provider adapter wiring, daemon/polling, reservation workflow orchestration, bus integration, startup registration/recovery, or later-slice runtime wiring was implemented.
