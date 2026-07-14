# Delta for economic-ingestion-durability

## ADDED Requirements

### Requirement: Global cancellation and recoverable Claims backlog

The system MUST emit `aborted` only for a global AbortSignal. It MUST cancel all work, advance no pending checkpoint, release matching leases, and return owned backlog work to `pending`. An attempt is consumed only when its provider request starts. Local Claims failure MUST complete partial with an eligible Orders checkpoint and unchanged Claims checkpoint.

#### Scenario: Abort timing
- GIVEN a leased backlog item
- WHEN global abort occurs before or after request start
- THEN it MUST return to pending, consuming an attempt only after start.

### Requirement: Deterministic durable backlog

The Claims backlog MUST use a non-null unique `backlog_identity_key` calculated from canonical seller, source, normalized range, normalized cursor, and purpose fields. It MUST exclude PII and raw/order-variant JSON. Its only states are `pending`, `leased`, `retrying`, `resolved`, `dead-letter`, and `administratively-cancelled`; expired leases recover pending, dead letters support audited replay, and administrative cancellation requires approval, audit, and one R4b-owned durable operational alert intent. The intent MUST use deterministic SHA-256 seller/type/backlog/version deduplication, exact cancellation fields, allowlisted bounded metadata, seller/backlog integrity, and only `pending|consumed`; it MUST not claim delivery. Seller leases SHALL use 60s TTL/20s renewal/15s recovery; backlog claims SHALL use 120s/40s/30s. Owner, token digest, and generation MUST be CAS predicates; zero rows SHALL be `stale-or-replaced`, never another owner deletion.

#### Scenario: Restart identity
- GIVEN equivalent normalized input after process restart
- WHEN backlog intent persists
- THEN one seller-scoped canonical row MUST exist.

### Requirement: Fenced finalization and operational failure durability

An open database fence generation/token MUST be validated at writer admission, lease acquire/renew, backlog mutation, migration, final transaction, and immediately before commit. Fence SHALL use 90s TTL/30s renewal/15s recovery. Any mismatch MUST block writes; fence coordination MUST NOT increment `write_epoch`. R2's future operational-failure migration MUST record a durable `run_failure_intent` before the main transaction; this requirement does not assign that schema to 1010. CAS missing or exhaustion MUST roll back final rows, then an independent same-run transaction MUST CAS-bind original admission fence generation/token digest, database generation, observed epoch, and lease owner while persisting CAS details, health, and alert. Startup recovery MUST be idempotent; stale zero-row updates MUST fail closed with a sanitized blocked signal.

#### Scenario: Post-CAS failure
- GIVEN the final transaction rolls back after CAS exhaustion
- WHEN independent operational persistence fails
- THEN completion MUST not be reported and readiness MUST be blocked.

### Requirement: Admitted economic writer capability

Every economic or operational SQLite mutation MUST be performed through an immutable admitted write session issued by `DatabaseWriteAdmissionService`. The receipt MUST bind seller, owner run, database generation, fence generation, lease generation, writer kind, expiry, and one-time consumption. The service MUST revalidate receipt/fence/deadline before commit, consume exactly once, and advance `write_epoch` exactly once in the same transaction. Coordination CAS operations remain epoch-neutral; DDL requires maintenance admission and bootstrap is allowed only before metadata/fence exist on a new database.

#### Scenario: Receipt reuse
- GIVEN an admitted session has committed one economic write
- WHEN it is reused
- THEN it MUST reject without another row or epoch increment.

### Requirement: Alert propagation

R7 (not R4b) MUST implement durable alert delivery: claim, dispatch, backoff, dead-letter, resolve, cooldown, transport readiness, inbox/idempotency, HTTP/Telegram transport, and paging. R4b's operational intent is not delivered merely by being created or consumed.
