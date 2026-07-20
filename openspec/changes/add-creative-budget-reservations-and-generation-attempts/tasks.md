# Tasks: Creative Budget Reservations and Generation Attempts

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

~2250 lines. 7 stacked PRs A→G, all <400. Auto-chain.

Evidence(test|harness|rollback):
A `npx vitest run packages/domain/src/money.test.ts packages/creative-studio/src/__tests__/` | N/A types | `packages/domain/src/money.ts`,`packages/creative-studio/src/domain/budgetReservation.ts`,`packages/creative-studio/src/domain/generationAttempt.ts`→remove-types/v4;keep-v1-v3
B `npx vitest run packages/creative-studio/src/__tests__/reservation-store*` | N/A storage | `packages/creative-studio/src/infrastructure/storage/reservationStore.ts`→remove-reservation-authority
C `npx vitest run packages/creative-studio/src/__tests__/attempt-store*` | N/A storage | `packages/creative-studio/src/infrastructure/storage/generationAttemptStore.ts`→remove-attempt/lease-authority
D `npx vitest run packages/creative-studio/src/__tests__/minimax-transport*` | N/A HTTP | `packages/creative-studio/src/infrastructure/providers/minimax/minimaxTransport.ts`→remove-send-proof-behavior
E `npx vitest run packages/creative-studio/src/__tests__/minimax*` | N/A adapters | `packages/agent/src/workers/minimaxRetryPolicy.ts`,`packages/creative-studio/src/infrastructure/storage/creative-asset-store.ts`,`packages/creative-studio/src/infrastructure/providers/minimax/minimax-image-provider.ts`,`packages/creative-studio/src/infrastructure/providers/minimax/minimax-video-provider.ts`→remove-retry/provenance
F `npx vitest run packages/agent/tests/workers/creativeStudioDaemon.test.ts` | `npm run start:bot` | `packages/agent/src/workers/daemonTypes.ts`,`packages/agent/src/workers/daemonScheduler.ts`,`packages/agent/src/workers/creativeStudioDaemon.ts`,`packages/agent/tests/workers/creativeStudioDaemon.test.ts`→remove-durable-polling/bus-adapter
G `npx vitest run packages/agent/tests/workers/daemonScheduler.test.ts packages/agent/tests/workers/daemonIntegration.test.ts` | `npm run production:readiness`; gate `npm run typecheck && npm run lint && npm run format:check && npm run build && npm run test` | `packages/agent/src/conversation/agentMessageBusStore.ts`,`packages/agent/src/runtime/agentDaemonPersistence.ts`,`packages/agent/src/workers/creativeDurabilityRecoveryWorker.ts`,`packages/agent/src/index.ts`→remove-startup/recovery/rollback;keep-v1-v3

## A (280) Domain/Migration

- [x] A.1 `packages/domain/src/money.ts` — Micros branded, usdToMicros, integer check
- [x] A.2 `packages/creative-studio/src/domain/budgetReservation.ts` — Key,Reservation,Conflict,Result,ReservationStore
- [x] A.3 `packages/creative-studio/src/domain/generationAttempt.ts` — Attempt,Evidence,LeaseGrant,NoSubmissionProof,AttemptStore
- [x] A.4 v4 DDL migration: `up` (both tables,CHECKs,indexes,FKs,predicates); no bus dep
- [x] A.5 `isApplied`: sqlite_master+PRAGMAs vs canonical
- [x] A.6 Test: micros rounding,integer reject,fresh/legacy/idempotent migration,FK,isApplied±

## B (330) Reservation-Store

- [ ] B.1 Reservation store — createReservationStore,BEGIN IMMEDIATE
- [ ] B.2 reserve: daily+job caps aggregate committed+held+requested; held; idempotent dup; UTC day
- [ ] B.3 commit(actual≤reserved/releases excess)/release(proof-gated)/renewHold/expireDue(skips leased)
- [ ] B.4 Test: caps,UTC reset,dup idempotent/divergent,commit overage,mismatch,release,expiry,concurrent,crash

## C (350) Attempt-Store/Leases

- [ ] C.1 Attempt store — `createAttemptStore`
- [ ] C.2 Lease: random 32B token,SHA-256,gen++,90s; acquireDue replaces owner+token+gen after expiry
- [ ] C.3 prepare/renewLease/transitions(prepared→dispatching→submitted/ambiguous→terminal); ambiguous→completed|failed evidence-gated; renew during acquireDue
- [ ] C.4 Terminal: BEGIN IMMEDIATE atomic commit/fail+evidence; idempotent repeat,divergent conflict; NoSubmissionProof needed
- [ ] C.5 Test: prepared-before-POST,fence,takeover/renew/expiry,happy/error/ambiguous,immutable terminal,idempotent/divergent,no blind retry

## D (310) Transport/NoSubmissionProof

- [ ] D.1 Transport — pre-send bodyBytesOffered=0; NoSubmissionProof on failure
- [ ] D.2 Rejection: providerRequestId,NoSubmissionProof(accepted:false,charged:false); timeout→ambiguous
- [ ] D.3 Test: body-offered proof,rejection proof,timeout

## E (310) Providers/Provenance

- [ ] E.1 GenerationAttemptContext(attempt_id,reservation_id,idempotency_key); provider never owns
- [ ] E.2 MiniMax adapters: context→IDs in responses/evidence; poll reuses attempt+reservation
- [ ] E.3 MinimaxRetryPolicy: retry pre-send/429-proof; 1s×2 cap3; 401/400/content/balance→no; possibly-sent→ambiguous; 5-min bounded(60),local persist
- [ ] E.4 Asset: attempt_id,reservation_id,micros,provider,model,hashes,requester,channel,jobId
- [ ] E.5 Test: context,task ID,poll reuse,retry bounds,error map,provenance,poll exhaustion

## F (350) Daemon Durability

- [ ] F.1 `daemonTypes.ts`,`creativeStudioDaemon.ts`: own mockable bus interface+adapter implementing defer(SellerScope,gen)/resumeDeferred(token)/settle(id,evidence)
- [ ] F.2 `creativeStudioDaemon.ts` — claim→reserve→prepare+lease→dispatch→reconcile→settle; drop CostLedger; renew lease/hold; alert ambiguous; 24h timeout
- [ ] F.3 30s Creative polling(MSL_CREATIVE_STUDIO_POLL_INTERVAL_MS) independent of 15-min scheduler; readiness gate blocks claims+dispatch
- [ ] F.4 Test: within-budget,empty poll,defer/resume,timeout,success/fail/ambiguous,dup,readiness gate

## G (320) Startup/Recovery/Rollback

- [ ] G.1 agentMessageBusStore: registerMigrations(v1-v3+v4 from A.4); runLegacy(v1-v3); default unchanged
- [ ] G.2 agentDaemonPersistence: open/pragmas,register bus→v4,prove,readiness=ready; disabled:legacy+prove v1-v3 then v4
- [ ] G.3 creativeDurabilityRecoveryWorker: acquireDue+renew during query,reconcile,release proven-unsent; drain before DB close
- [ ] G.4 index.ts: ownership→validation→stores/readiness→workers order; blocks until clean
- [ ] G.5 runCreativeDurabilityRollback: quiesce,stop,release proven-unsent; refuse ambiguous/leased; emit alerts busy>1%/5m,recovery≥3cycles,ambiguity>15m,hold>30m; nonzero drift alerts owned by Finance/Creative Ops
- [ ] G.6 Test: v1-v3 before v4,default,disabled,recovery+renew,rollback blocks ambiguous,9 injections(crashAfterReserve,crashAfterPrepare,crashAfterDispatchFence,loseResponseAfterProviderAccept,crashBeforeAtomicCommit,leaseExpiresDuringQuery,foreignV4Ownership,foreignKeyCheckFailure,rollbackBlockedByAmbiguousHold),possibly-sent non-release,readiness gate
