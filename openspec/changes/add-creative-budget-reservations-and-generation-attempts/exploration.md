# Exploration: Creative Budget Reservations and Generation Attempts

This prerequisite should make budget admission and provider invocation durable without implementing the broader Creative Studio runtime contract. It replaces the current process-local `CostLedger` check/record pair and introduces a durable attempt boundary that later runtime work can safely compose with.

## Current State

- `CostLedger` keeps daily spend in process memory. `canAfford()` and `recordSpend()` are separate operations, so concurrent daemons, retries, and restarts can overspend or forget spend.
- `creative_jobs` is already a SQLite-backed job record with seller, estimated/actual cost, payload/result/error, and a status machine, but it has no reservation identity, attempt identity, recovery lease, or provider evidence fields.
- `creativeStudioDaemon` constructs a fresh ledger per cycle, checks affordability, calls a provider, then records actual spend. Provider calls occur without a durable pre-call record. Video submission and polling are mixed inside the provider adapter; polling currently has no durable paid-task ownership boundary.
- MiniMax adapters return a `CreativeExecutionResult`, but the contract has no idempotency key, request/response evidence reference, or durable attempt identifier. A crash between provider POST and response persistence is therefore indistinguishable from “not submitted.”
- The merged message bus provides the required runtime boundary: `claimNext()` atomically moves a message to `processing`; `defer()` keeps the same message in `deferred`; `resumeDeferred()` performs token-CAS back to `pending`; `settle()` atomically records a terminal outcome. Deferred operations require a seller/system scope and are already audited for system mutations.
- SQLite migration patterns are additive and idempotent: inspect `PRAGMA table_info`, conditionally `ALTER TABLE`, and use transactional `MigrationRegistry` steps where a registered database is available. Existing creative job and bus stores still have local schema initialization paths.
- The active `complete-creative-studio-runtime-contracts` proposal already defines the intended two-phase budget behavior and attempt state machine, but it is intentionally blocked until this prerequisite exists. Its provider ownership, dispatcher, consent, video-task, hashing, and Cortex changes are out of scope here.

## Affected Areas

- `packages/creative-studio/src/domain/cost-ledger.ts` — reduce to a compatibility-facing port or replace callers with a durable reservation interface; do not retain `canAfford()` as the admission authority.
- `packages/creative-studio/src/domain/` — add domain contracts for reservation lifecycle and generation-attempt lifecycle, independent of SQLite.
- `packages/creative-studio/src/infrastructure/storage/` — add SQLite adapters for reservations and generation attempts, including indexes, state guards, and recovery queries.
- `packages/agent/src/conversation/creativeJobQueueStore.ts` — add only the minimum job linkage needed to identify the seller/job and reservation/attempt; preserve existing job transitions.
- `packages/agent/src/workers/creativeStudioDaemon.ts` — reserve atomically before a provider call; defer the claimed message on insufficient budget; resume/settle through the existing bus APIs; create and close attempts around provider submission.
- `packages/creative-studio/src/contracts/creative-requests.ts` — extend the internal provider invocation boundary with a stable attempt/idempotency context and structured evidence references, without changing provider ownership or adding new providers.
- `packages/creative-studio/src/infrastructure/providers/minimax/*` — accept the attempt context and preserve provider request/task identifiers in evidence; video polling must reuse the existing attempt/task rather than create a new charge.
- `packages/agent/src/conversation/agentMessageBusStore.ts` — integration consumer only. The prerequisite should not alter the already-merged defer/resume/settle schema or digest contracts.
- `packages/memory/src/migrationRegistry.ts` and store migration tests — reuse the established transactional/idempotent migration conventions where the target database is registered.
- `openspec/specs/creative-studio-agent/spec.md`, `openspec/specs/creative-studio-minimax/spec.md`, and the active change specs — read-only compatibility constraints; no existing spec edits belong in this exploration.

## Recommended Smallest Coherent Design

### Durable budget reservation model

Use a seller-scoped `creative_budget_reservations` table with one stable idempotency key per `(seller_id, job_id, generation_attempt_id)` and an explicit lifecycle:

`held → committed | released | expired`

Store `reservation_id`, seller/job/attempt IDs, currency, `reserved_amount_micros`, `committed_amount_micros`, `status`, `expires_at`, timestamps, and an immutable reason/evidence reference. A unique key makes retries and duplicate approvals return the existing reservation. Amounts should be integer micros, not floating-point USD.

Admission, duplicate lookup, expiry cleanup, and state transition must run in one `BEGIN IMMEDIATE` transaction. The admission predicate is:

`committed spend for seller/day + non-expired held reservations for seller/day + requested amount <= daily cap`

The transaction must also enforce the per-job cap. Commit changes the held row to committed and records actual cost; release/expiry removes it from reserved capacity. A retry of commit/release/expiry with the same reservation and expected state is idempotent; a different amount, seller, job, attempt, or terminal outcome is a conflict. This prevents overspend under concurrent workers, retries, crashes, and duplicate approvals.

The reservation API should expose `reserve`, `commit`, `release`, `expireDue`, and `get`; it should not expose a read-then-write `canAfford` operation as an authoritative mutation boundary. Approval is a caller-owned authorization decision: the reservation service only provides an idempotent transition and never raises the global cap.

### Durable generation attempt model

Use a `creative_generation_attempts` table with a unique stable idempotency key and states:

`prepared → submitted → completed | failed | ambiguous`

Persist seller/job/attempt IDs, bus message ID, provider/model, estimated and actual cost micros, request hash, reference hash set/reference evidence refs, provider idempotency key, provider task/request ID, request evidence ref, response evidence ref, error category, and timestamps. `prepared` must commit before the external POST. `submitted` is recorded with provider identity as soon as a submission response is durably known. A confirmed provider response closes the attempt exactly once.

If a process crashes after POST but before a durable response, recovery marks the leased `submitted` attempt `ambiguous`; it must not blindly create another attempt or charge another reservation. Reconciliation may complete or fail the same attempt when provider evidence proves the outcome. If the provider supports an official idempotency key, send the stored key; otherwise ambiguity requires human/operational reconciliation. Polling an existing video task reads and updates the same attempt and never reserves or charges again.

### Exact deferred message-bus boundary

The daemon remains the owner of the integration sequence:

1. Claim one creative message (`processing`).
2. Create/reuse the job and generation-attempt identity.
3. Atomically reserve budget before any provider call. If unavailable, do **not** call a provider: transition the job to the runtime budget-wait state and call `bus.defer(messageId, ...)` with a new monotonic deferral token, preserving the message and its seller scope.
4. On valid approval, the approval flow calls `bus.resumeDeferred(messageId, exact token)` and re-enters the same job/attempt/reservation identity. It does not enqueue a new message or create a new attempt. The reservation operation must be idempotent so duplicate approvals cannot consume additional capacity.
5. Prepare the attempt, commit it, then invoke the provider with its stable idempotency context. Close the attempt and commit/release the reservation according to confirmed provider outcome.
6. For terminal outcomes, call `bus.settle()` once with the existing message, settlement ID, and evidence. Provider crash ambiguity is not a bus failure or automatic retry; it remains durable for recovery/review.

This change should add only a narrow runtime adapter/service seam. It must not implement `CreativeJobDispatcher`, CEO request tooling, provider-consent fallback, provider ownership migration, unified partial-output policy, video-task store, Cortex changes, or the full Creative Studio runtime state machine.

## Approaches

1. **SQLite reservation and attempt stores with transactional services (recommended)** — Keep domain ports free of `better-sqlite3`; implement one atomic SQLite transaction per admission/transition and use the existing bus row as the runtime wait/message identity.
   - Pros: smallest durable boundary; directly addresses concurrency and crash windows; compatible with existing bus CAS semantics; easy to test with in-memory SQLite; later dispatcher/runtime work can reuse the ports.
   - Cons: requires careful coordination when a transaction must update job, reservation, and bus rows; provider POST can never be part of the SQLite transaction, so ambiguity recovery remains explicit.
   - Effort: Medium

2. **Single expanded `creative_jobs` table** — Add reservation and attempt columns directly to the job row and use job status as the source of truth.
   - Pros: fewer tables and simple reads for one-attempt jobs.
   - Cons: cannot represent multiple attempts, durable evidence history, or reservation audit cleanly; weakens uniqueness and recovery guarantees; makes later video polling and retries ambiguous.
   - Effort: Medium initially, High total

3. **External ledger/provider workflow service** — Move reservations and attempts to a separate service or queue.
   - Pros: stronger isolation and independent scaling.
   - Cons: introduces distributed transactions and new operational dependencies before Creative Studio runtime contracts exist; duplicate approval and crash recovery become harder, not easier.
   - Effort: High

## Migration, Rollback, and Observability

- Add additive tables and indexes in a dedicated migration version. Fresh databases receive complete DDL; existing databases preserve all rows. If using the shared registry, register an owned high version and provide an `isApplied` schema proof; otherwise follow the bus store's idempotent `PRAGMA table_info` pattern. Never use unsupported `ADD COLUMN IF NOT EXISTS`.
- Keep legacy `CostLedger` readable during rollout, but gate provider dispatch on the new reservation service. A feature flag may select the old path only before activation; once reservations are enabled, fail closed if their schema or transaction cannot be verified.
- Rollback is source/config rollback plus a quiesce-and-drain procedure, not destructive schema rollback: stop new creative claims, resolve/release or expire held reservations, settle/defer recovery rows deterministically, verify zero active holds, then disable the new dispatch path. Preserve attempt rows and evidence for audit. Do not drop tables or delete history.
- Emit structured events for `reservation_held`, `reservation_reused`, `reservation_committed`, `reservation_released`, `reservation_expired`, `attempt_prepared`, `attempt_submitted`, `attempt_completed`, `attempt_failed`, and `attempt_ambiguous`. Every event includes seller/job/attempt/message IDs, idempotency key, estimated/actual micros, provider/model where applicable, and an evidence reference; never log prompts, credentials, or raw reference data.
- Add metrics for held/expired reservations, rejected admissions, duplicate/idempotent operations, active ambiguous attempts, recovery age, provider submissions, and committed spend by seller/day. Alert on expired holds, ambiguous attempts, and reservation-capacity drift.

## Test Strategy and Review-Sized Delivery Slices

### Slice A — schema and domain primitives

- Add reservation/attempt types, SQLite migrations, indexes, state constraints, and store unit tests.
- Test fresh/legacy/idempotent migration, seller isolation, micros arithmetic, daily UTC boundaries, per-job cap, concurrent reservations, duplicate keys, commit/release/expiry idempotency, and rollback on failed transactions.
- Test attempt identity, allowed transitions, prepared-before-POST contract, evidence persistence, duplicate completion, and invalid transition rejection.

### Slice B — provider invocation seam

- Add the stable attempt/idempotency context to the existing provider boundary and MiniMax adapters without changing provider selection.
- Test request key propagation, durable provider/task identifiers, confirmed success/failure, crash-to-ambiguous recovery, no blind retry, and video polling with no new attempt or reservation.

### Slice C — daemon and deferred-bus integration

- Replace the daemon's authoritative `canAfford`/`recordSpend` path with reserve/commit/release; defer the same claimed message on runtime budget exhaustion and resume/settle it through existing CAS APIs.
- Test no provider call while deferred, exact message cardinality, duplicate approval, restart recovery, terminal settlement exactly once, seller scope, and 24-hour expiry behavior. Leave pre-dispatch dispatcher approval and the remaining Creative Studio runtime contracts to the blocked follow-up change.

## Risks

- **Provider-side ambiguity remains irreducible:** no local transaction can undo a POST. The attempt must therefore fail closed as `ambiguous`, with reconciliation rather than blind retry.
- **Cross-store atomicity:** SQLite transactions cannot atomically include a remote provider call. Keep the durable ordering explicit and use idempotency keys plus recovery leases.
- **Existing floating-point ledger semantics:** migrating historical USD values to micros requires a defined rounding rule and an audit-compatible backfill; do not silently mix old and new totals.
- **Bus compatibility drift:** changing the merged defer/settle contract would reopen the prerequisite. Integrate through the current exact-token APIs instead.
- **Scope creep into the blocked runtime change:** provider ownership, CEO tooling, consent, full job-state choreography, and Cortex/provenance are deliberately excluded.

## Recommendation

Proceed with Slice A, then B, then C. The smallest coherent prerequisite is the two durable stores plus the provider/daemon seams needed to make reservation-before-call and attempt-before-POST true. Use the existing deferred message bus as the sole runtime pause/resume boundary, preserve the existing message identity, and leave the broader Creative Studio contracts blocked until this change is implemented and verified.

## Ready for Proposal

Yes. The proposal should state that this change is an additive SQLite durability prerequisite, bounded to reservations, attempts, provider invocation evidence, and runtime deferred-message integration; the full Creative Studio runtime contract change remains a separate follow-up.
