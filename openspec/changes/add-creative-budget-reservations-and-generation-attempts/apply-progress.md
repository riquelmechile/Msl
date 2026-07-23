# Apply Progress: Creative Budget Reservations and Generation Attempts

Mode: Standard. Delivery: auto-chain, stacked-to-main. Current slice: F / PR7A1A-I (F.1 + SQLite busy store errors complete, F.2-F.4 pending). Previous slices A-E merged.

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

### Slice E / PR5

Focused: `npx vitest run packages/creative-studio/src/__tests__/minimax* packages/agent/tests/workers/minimaxRetryPolicy.test.ts` -> 8 files, 131 tests passed. Cumulative creative/domain: 15 files, 176 tests passed. Runtime: `npx vitest run packages/agent/tests/workers/creativeStudioDaemon.test.ts` -> 26 tests passed; proves mandatory daemon-owned context, proof-only retry, ambiguous non-retry, polling/task evidence, persisted provenance, and exact error translation. Typecheck, lint, format, and diff checks passed. Rollback: revert the MiniMax attempt transport plus daemon wiring/tests while retaining Slices A-D.

F.2-F.4 and G.1-G.6 remain pending (9/33); 24/33 are complete (F.1 done). Daemon/bus polling, startup registration, migration recovery, and rollback remain deferred.

### Slice F / PR6 — Bus Lifecycle Boundary (F.1 only)

| Evidence | Exact result |
|---|---|
| Focused tests | `npx vitest run packages/agent/tests/workers/creativeStudioDaemon.test.ts -t "RealBusAdapter"` -> 3 tests passed; proves defer delegation with SellerScope+generation, resumeDeferred delegation with exact token, settle delegation with settlement ID+evidence |
| Cumulative daemon suite | `npx vitest run packages/agent/tests/workers/creativeStudioDaemon.test.ts` -> 29 tests passed (26 existing + 3 new) |
| Static gates | `npm run typecheck`, `npm run lint`, `npm run format:check`, and `git diff --check` -> exit 0 |
| Runtime harness | N/A — PR6 introduces an adapter seam only; no runtime boundary changes |
| Rollback boundary | Revert `packages/agent/src/workers/daemonTypes.ts` (remove CreativeBusAdapter contract and 5 import additions), `packages/agent/src/workers/creativeStudioDaemon.ts` (remove RealBusAdapter class and adapter imports), and revert the RealBusAdapter tests from `packages/agent/tests/workers/creativeStudioDaemon.test.ts`; all existing daemon behavior and remaining F.2-F.4/G tasks are unaffected |
| Review workload | 179 additions, 5 deletions, 184 changed lines. The Slice F PR6 candidate remains below the 400-line review budget. No `size:exception`. |

### Slice F / PR7A1A-Ia — SQLite Busy Store Errors

| Evidence | Exact result |
|---|---|
| Focused test | `npx vitest run packages/creative-studio/src/__tests__/reservation-store.test.ts -t "busy conflict"` -> 1 test passed; proves deterministic two-connection SQLite busy contention on a unique on-disk DB: dbLock holds `BEGIN IMMEDIATE`, storeTry connection with 100ms busy_timeout calls `reserve()`, transaction wrapper catches `SQLITE_BUSY` and returns exact `{ ok: false, conflict: { kind: "busy", retryable: true } }` (asserted via `toEqual` deep equality); complete `creative_budget_reservations` snapshot before and after contention matches exactly via `toEqual` |
| Cumulative store tests | `npx vitest run packages/creative-studio/src/__tests__/reservation-store.test.ts` -> 3 tests passed (2 pre-existing tests + 1 busy contention test introduced by PR7A1A-Ia) |
| Full domain+creative suite | `npx vitest run packages/domain/src/money.test.ts packages/creative-studio/src/__tests__/` -> 15 files, 177 tests passed |
| Full daemon suite | `npx vitest run packages/agent/tests/workers/creativeStudioDaemon.test.ts` -> 29 tests passed; complete daemon behavior preserved |
| Combined verification | `npx vitest run packages/agent/tests/workers/creativeStudioDaemon.test.ts packages/creative-studio/src/__tests__/ packages/domain/src/money.test.ts` -> 16 files, 206 tests passed |
| Static gates | `npm run typecheck`, `npm run lint`, `npm run format:check`, and `git diff --check` -> exit 0 |
| Runtime harness | N/A — SQLite busy contention is a storage-layer boundary proved through real two-connection on-disk DB isolation; no runtime daemon wiring change |
| Rollback boundary | Revert the new test case from `packages/creative-studio/src/__tests__/reservation-store.test.ts` (lines 104-137), then remove the literal `### Slice F / PR7A1A-Ia — SQLite Busy Store Errors` header and its complete evidence table from `openspec/changes/add-creative-budget-reservations-and-generation-attempts/apply-progress.md`; the 205 tests that pre-date PR7A1A-Ia and all daemon behavior remain intact |
| Review workload | Test: 35 additions, 0 deletions. Apply-progress: 15 additions, 1 deletion. Combined numstat: 50 additions, 1 deletion (51 changed lines). Target <=100 met. No `size:exception`. |
