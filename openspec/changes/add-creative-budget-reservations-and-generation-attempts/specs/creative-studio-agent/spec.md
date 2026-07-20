# Delta for creative-studio-agent

## MODIFIED Requirements

### Requirement: Agent Message Bus Integration

`creativeStudioDaemon` SHALL poll pending `creative-studio` messages at a configurable interval (default 30s); empty polls sleep. It SHALL claim, reserve, create an attempt, execute, and respond. Rejection defers via `bus.defer()` with SellerScope, monotonic generation, and reason; capacity restoration uses exact-token `bus.resumeDeferred()`. Every ordinary terminal success/failure and >24h timeout MUST call idempotent `bus.settle()` with stable `settlementId` and durable evidence. Exact repeats return the settlement; divergent reuse conflicts. Success returns `CreativeExecutionResult`; failure returns reason and no partial output. Attempts use durable dispatch boundaries; ambiguous work remains held/unsettled for evidenced same-attempt reconciliation, never blind retry.
(Previously: Claims lacked defer, attempts, or idempotent approval.)

#### Scenario: Job within budget

- GIVEN pending bus message, reservation admitted
- WHEN daemon polls
- THEN attempt prepared/dispatched; provider called; result settled with stable ID/evidence

#### Scenario: No pending messages

- GIVEN no pending creative-studio messages
- WHEN configured poll cycle runs
- THEN no message/provider mutation occurs; daemon sleeps until next interval

#### Scenario: Budget exhausted defers

- GIVEN message M claimed, reservation rejected
- WHEN admission rejects
- THEN M deferred with SellerScope, monotonic generation; no provider call

#### Scenario: Deferred resumes via exact token

- GIVEN M deferred generation=1 for seller S
- WHEN resumeDeferred called with exact token next UTC day
- THEN M resumes same job/attempt/reservation identities; fresh admission

#### Scenario: 24h timeout settles

- GIVEN M deferred >24h
- WHEN daemon inspects M
- THEN M settled with stable timeout ID/evidence; held reservation released

#### Scenario: Processing succeeds

- GIVEN claimed message, attempt `prepared`
- WHEN generation succeeds
- THEN reservation reconciled; attempt completed; `CreativeExecutionResult` settled with stable ID/evidence

#### Scenario: Processing fails

- GIVEN claimed message, attempt `submitted`
- WHEN provider returns permanent error
- THEN reservation released; attempt failed; reason/no partial output settled with stable ID/evidence

#### Scenario: Ambiguous after POST crash

- GIVEN attempt `dispatching`, POST may be sent, connection drops
- WHEN system recovers
- THEN attempt `ambiguous`; reservation held; message NOT settled; operator alerted

### Requirement: Budget Enforcement

Agent SHALL reserve before every provider call using configured `MSL_CREATIVE_STUDIO_MAX_JOB_USD` and `MSL_CREATIVE_STUDIO_MAX_DAILY_USD`, converted to micros. Admission aggregates committed, active non-expired held, and requested micros for both applicable caps. Rejection SHALL state which cap failed and defer with SellerScope. Success commits actual cost and releases excess; failure releases; ambiguity holds. The store is sole authority; duplicate approval MUST NOT double-charge.
(Previously: In-memory `canAfford()`/`recordSpend()` lacked durability, defer, and idempotent approval.)

#### Scenario: Within budget

- GIVEN seller committed 1M, held 0, cap 5M, per-job 500K
- WHEN 15K-micros job arrives
- THEN reservation admitted; generation proceeds

#### Scenario: Active held blocks admission

- GIVEN committed 2M, held 2.99M, cap 5M
- WHEN 20K-micros job arrives
- THEN aggregate 4.99M+20K > 5M; rejected; deferred

#### Scenario: Per-job cap exceeded

- GIVEN per-job cap 500K
- WHEN 750K-micros job arrives
- THEN rejected; deferred

#### Scenario: Success commits with reconciliation

- GIVEN R `held` 10,000 micros
- WHEN generation costs 7,000
- THEN R committed at 7,000; 3,000 excess released

#### Scenario: Duplicate approval idempotent

- GIVEN R already `committed`
- WHEN duplicate approval for same job/attempt
- THEN no new charge; R stays `committed`

### Requirement: Cost and Provenance Ledger

Assets SHALL record provider, model, estimated and actual cost in micros, prompt/reference hashes, requester, channel, job, `attempt_id`, and `reservation_id`.
(Previously: USD cost; no attempt_id, reservation_id.)

#### Scenario: Image completes

- GIVEN MiniMax returns URLs for attempt A, reservation R
- WHEN asset persisted
- THEN ledger records all fields including estimated/actual micros, attempt_id=A, reservation_id=R

#### Scenario: Video completes

- GIVEN MiniMax returns file_id after polling for attempt A
- WHEN asset persisted
- THEN ledger: async cost micros, duration, attempt_id=A, reservation_id=R

#### Scenario: Job rejected (budget)

- GIVEN reservation admission fails for attempt A
- WHEN rejection before generation
- THEN no cost recorded; rejection logged with job, attempt_id=A
