# agent-message-bus Specification

## Purpose

Persistent, deduplicated, in-process message queue enabling agent-to-agent and agent-to-daemon asynchronous communication with priority-based claiming and a claim-resolve-fail-cancel lifecycle backed by SQLite.

## Requirements

### Requirement: Message Enqueue with Deduplication

`enqueue(senderAgentId, receiverAgentId, messageType, payloadJson, opts)` MUST persist a message row. When `opts.dedupeKey` matches an existing row, the system MUST NOT create a duplicate.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| First enqueue | No row with dedupeKey "abc" | enqueue with dedupeKey "abc" | Row inserted, status pending |
| Duplicate dedupe | Row with dedupeKey "abc" exists | enqueue with dedupeKey "abc" | No new row; existing returned |
| No dedupeKey | dedupeKey omitted | enqueue twice | Two distinct rows inserted |

### Requirement: Atomic Message Claiming

`claimNext(receiverAgentId)` MUST atomically lock the next pending message in a transaction, returning it with `status = 'processing'` and `locked_at` set. Sorting MUST be by `priority ASC` (lower = higher priority), then `created_at ASC`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Claim pending | Message pending for receiver | claimNext(receiverId) | Row returned, status=processing, locked_at set |
| Priority order | Pending: priority 5, priority 1 | claimNext(receiverId) | Priority 1 returned first |
| No pending | Zero pending for receiver | claimNext(receiverId) | null returned |
| Stale lock | locked_at > timeout ago, status=processing | claimNext(receiverId) | Stale message reclaimed |
| Concurrent claims | Two callers, same receiver | Both call claimNext() | Each gets different message |

### Requirement: Message Lifecycle Transitions

Messages MUST transition through states: `pending → processing → resolved|failed|cancelled`. A message locked longer than the claim timeout MUST become reclaimable. Operations: `resolve(messageId)`, `fail(messageId)`, `cancel(messageId)`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Resolve | status=processing | resolve(messageId) | status=resolved, resolved_at set |
| Cancel pending | status=pending | cancel(messageId) | status=cancelled |
| Cancelled not claimable | status=cancelled | claimNext(receiverId) | Message not returned |
| Expired lock reclaim | locked_at > timeout, processing | claimNext(receiverId) | Stale message returned for reclaim |

### Requirement: Outcome Persistence Columns

Schema MUST add: `result_json`, `error_json`, `cancel_reason`, `correlation_id`, `parent_message_id`, `seller_id`, `outcome_score`, `learned_at`, `action_id` (all TEXT except `outcome_score` REAL). Migration MUST use `ALTER TABLE ADD COLUMN IF NOT EXISTS` and MUST NOT break existing data.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Migration on existing table | Legacy table with data | Migration runs | New columns added; legacy rows have NULL defaults |
| Idempotent migration | Columns already exist | Migration reruns | No error; schema unchanged |
| New message stores outcome | resolve() called with result object | Resolution executes | result_json populated with JSON |

### Requirement: Resolve with Outcome

`resolve(messageId, result?)` MUST persist optional `result` as JSON in `result_json`. Status transition and `resolved_at` timestamp unchanged when result omitted.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Resolve with result | status=processing, result={findings:3} | resolve(id, {findings:3}) | result_json='{"findings":3}' |
| Resolve without result | status=processing | resolve(id) | result_json=NULL; backward compatible |

### Requirement: Fail with Error Detail

`fail(messageId, error?)` MUST persist optional `error` to `error_json`. Existing retry logic (attempts++, pending/failed transition) unchanged.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Fail with error | attempts=0 | fail(id, "timeout") | attempts=1, error_json="timeout" |
| Permanent fail with error | attempts=2 | fail(id, "exhausted") | attempts=3, status=failed, error_json="exhausted" |
| Fail without error | attempts=0 | fail(id) | error_json=NULL |

### Requirement: Cancel with Reason

`cancel(messageId, reason?)` MUST persist optional `reason` to `cancel_reason`. Status transition to `cancelled` unchanged.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Cancel with reason | status=pending | cancel(id, "obsolete") | cancel_reason="obsolete" |
| Cancel without reason | status=pending | cancel(id) | cancel_reason=NULL |

### Requirement: Correlation and Seller Scoping

Enqueue `opts` MUST accept `correlationId`, `parentMessageId`, `sellerId`, `actionId`. Fields SHALL be written at INSERT and preserved through lifecycle. No relational integrity enforced.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Enqueue with correlation | opts.sellerId="123" | enqueue(...) | seller_id="123" persisted |
| Child message | opts.parentMessageId="msg-1" | enqueue(...) | parent_message_id="msg-1" persisted |
| No correlation provided | opts omitted | enqueue(...) | All correlation fields NULL |

### Requirement: Outcome Learning Columns

`outcome_score` (REAL) and `learned_at` (TEXT) support retrospective learning. `resolve()` MAY set score via `opts.score`. `learned_at` SHALL be set by `LearningOutcomePipeline` during batch analysis.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Resolve with score | resolve(id, {rec:"buy"}, {score:0.85}) | Resolution executes | outcome_score=0.85 |
| Pipeline updates | Resolved message without score | LearningOutcomePipeline runs | outcome_score and learned_at populated |

### Requirement: Retry with Max Attempts Guard

`fail(messageId)` MUST increment `attempts`. If `attempts < maxAttempts` (default 3), the message MUST re-enter `pending` for retry. At `attempts >= maxAttempts`, the message MUST transition to permanent `failed` and MUST NOT be claimable.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| First failure | attempts=0 | fail(messageId) | attempts=1, status=pending |
| Max reached | attempts=2 | fail(messageId) | attempts=3, status=failed |
| Failed not claimable | status=failed | claimNext(receiverId) | Message not returned |

### Requirement: Error Safety

The system MUST prevent double claims in concurrent scenarios. `resolve()`, `fail()`, and `cancel()` on a non-existent `messageId` MUST throw a clear error.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Missing resolve | No row with messageId | resolve("nonexistent") | Error thrown |
| Missing cancel | No row with messageId | cancel("nonexistent") | Error thrown |
| Double claim | One pending, two concurrent callers | Both call claimNext() | One succeeds; other gets null |

### Requirement: Schema Integrity

The migration MUST use `CREATE TABLE IF NOT EXISTS agent_message_bus` and MUST NOT break existing tables. The schema MUST include: `id` (INTEGER PK), `message_id` (TEXT UNIQUE), `sender_agent_id`, `receiver_agent_id`, `message_type`, `payload_json`, `status`, `priority`, `attempts`, `dedupe_key`, `locked_at`, `resolved_at`, `created_at`, `updated_at`, plus all 9 outcome/correlation/learning columns above (22 total).
(Previously: 13 columns without outcome, correlation, seller, or learning fields.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Idempotent migration | Table exists with legacy data | Migration runs | No error; existing data preserved; new columns added |
| All columns present | Migration completed | Inspect schema | All 22 columns from spec exist |
| Legacy rows survive | Pre-migration data exists | ALTER TABLE runs | All rows intact; new columns NULL for legacy rows |

### Requirement: Daemon Proposal Enqueue Contract

Daemons that enqueue CEO proposals via `enqueue()` MUST set `senderAgentId` to the daemon's lane identifier and `receiverAgentId` to `"ceo"`. The `payloadJson` MUST be valid JSON containing at minimum `{ type: "proposal", summary, findings, recommendedAction }`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Valid proposal enqueued | Daemon has findings | enqueue with senderAgentId="market-catalog", receiverAgentId="ceo" | Message persisted with correct sender/receiver |
| Missing required fields | payloadJson lacks "type" or "summary" | enqueue called | Message still persisted (bus enforces no schema) |
| Dedupe prevents duplicates | Daemon enqueues same dedupeKey | enqueue called second time | First message returned, no duplicate |

### Requirement: Daemon Polling Receptor

The message bus SHALL accept `claimNext(receiverAgentId)` calls from the daemon scheduler where `receiverAgentId` matches an agent's lane ID. Messages enqueued with `receiverAgentId` matching `cost-supplier`, `market-catalog`, `creative-commercial`, `ceo`, or other valid lane IDs MUST be claimable.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Daemon claims its messages | Pending message for "market-catalog" | claimNext("market-catalog") | Message returned in processing state |
| CEO lane messages not claimable by daemon | Pending message for "ceo" | claimNext("market-catalog") | No message returned (wrong receiver) |
| Priority order preserved | Messages at priority 1 and 5 for same agent | claimNext(agentId) | Priority 1 returned first |
