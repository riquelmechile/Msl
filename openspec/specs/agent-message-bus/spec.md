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

Messages MUST transition through states. Valid transitions: `pending -> processing`, `pending -> cancelled`, `processing -> pending` (retry), `processing -> resolved|failed|cancelled|deferred`, `deferred -> pending|resolved|failed|cancelled`. `deferred` is nonterminal and MUST NOT be claimable. `settle(messageId,outcome,options)` SHALL atomically bypass retry from `processing|deferred`. Operations: `resolve()`, `fail()`, `cancel()`, `settle()`.
(Previously: five-state lifecycle without `deferred` or `settle`; `pending->cancelled` and retry preserved.)

Settlement MUST preserve `attempts`, set terminal `status`, `settlement_id`, `settlement_digest`, `resolved_at`, and `updated_at`, and clear `locked_at`. Resolved writes `result` to `result_json`; failed writes `error` to `error_json`; cancelled writes `reason` to `cancel_reason`. Selected null/undefined writes SQL NULL; otherwise result/error use JSON text and reason is verbatim. The other two outcome columns MUST be SQL NULL. An exact status/ID/digest retry returns the persisted row with identical mapping and no rewrite.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Resolve | status=processing | resolve(messageId) | status=resolved, resolved_at set |
| Cancel pending | status=pending | cancel(messageId) | status=cancelled |
| Cancelled not claimable | status=cancelled | claimNext(receiverId) | Message not returned |
| Expired lock reclaim | locked_at > timeout, processing | claimNext(receiverId) | Stale message returned for reclaim |
| Deferred not claimable | status=deferred | claimNext(receiverId) | Message not returned |
| Settle processing->failed | processing, attempts=0 | settle failed with error | failed; error_json set; attempts=0; other outcomes NULL |
| Settle deferred->resolved | status=deferred | settle resolved with result | resolved atomically; timestamps/lock exact |

### Requirement: Outcome Persistence Columns

Schema MUST add `result_json`, `error_json`, `cancel_reason`, `correlation_id`, `parent_message_id`, `seller_id`, `outcome_score`, `learned_at`, `action_id` (TEXT except `outcome_score` REAL). Migration MUST inspect `PRAGMA table_info` and conditionally issue transactional plain `ALTER TABLE ADD COLUMN`; it MUST be idempotent, preserve data, and MUST NOT use `ADD COLUMN IF NOT EXISTS`.
(Previously: used unsupported `ALTER TABLE ADD COLUMN IF NOT EXISTS`.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Migration on existing table | Legacy table with data | Migration runs | New columns added; legacy values NULL |
| Idempotent migration | Columns already exist | Migration reruns | No error; schema unchanged |
| New message stores outcome | resolve() with result object | Resolution executes | result_json contains JSON |

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

Migration MUST create the bus if absent and preserve existing tables. Each token below is exact ordered `name:type/notnull/pk/dflt_value`; `-` means SQL NULL. The 33-column contract is:

```text
id:INTEGER/0/1/- message_id:TEXT/1/0/- sender_agent_id:TEXT/1/0/-
receiver_agent_id:TEXT/1/0/- message_type:TEXT/1/0/- payload_json:TEXT/1/0/-
status:TEXT/1/0/'pending' priority:INTEGER/1/0/5 attempts:INTEGER/1/0/0
dedupe_key:TEXT/0/0/- locked_at:TEXT/0/0/- resolved_at:TEXT/0/0/-
created_at:TEXT/1/0/datetime('now') updated_at:TEXT/1/0/datetime('now')
result_json:TEXT/0/0/- error_json:TEXT/0/0/- cancel_reason:TEXT/0/0/-
correlation_id:TEXT/0/0/- parent_message_id:TEXT/0/0/- seller_id:TEXT/0/0/-
learned_at:TEXT/0/0/- outcome_score:REAL/0/0/- action_id:TEXT/0/0/-
deferral_id:TEXT/0/0/- deferral_generation:INTEGER/0/0/- deferred_until:TEXT/0/0/-
deferred_at:TEXT/0/0/- defer_reason:TEXT/0/0/- defer_reason_detail:TEXT/0/0/-
defer_evidence_ref:TEXT/0/0/- settlement_id:TEXT/0/0/- settlement_digest:TEXT/0/0/-
deferral_digest:TEXT/0/0/-
```

V3 MUST create exact ordered audit tuples:

```text
operationId:TEXT/1/1/- operation:TEXT/1/0/- scopeJson:TEXT/1/0/-
reason:TEXT/1/0/- evidenceRef:TEXT/1/0/- messageId:TEXT/0/0/-
queryAsOf:TEXT/0/0/- queryCursorJson:TEXT/0/0/- queryLimit:INTEGER/0/0/-
resultMessageIdsJson:TEXT/0/0/- nextCursorJson:TEXT/0/0/- createdAt:TEXT/1/0/-
```

V3 SHALL register after unchanged v2 with `isApplied` ownership proof requiring all ten exact added bus tuples and the exact 12-column audit schema. An unrelated recorded version 3 MUST NOT suppress V3.
(Previously: 23 columns and no audit table.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Idempotent migration | Legacy table with data | Migration runs | Data preserved; missing columns added |
| V3 adds deferral+audit | V2 complete | V3 runs | 10 bus columns and audit table created |
| All columns present | Migration completed | Inspect full PRAGMAs | Exact 33 and 12 tuples match |
| Legacy rows survive | Pre-migration data | ALTER TABLE runs | Rows intact; new columns NULL |
| Legacy NULL generation | Row never deferred | Read generation | NULL |
| Audit table created | V3 runs | Inspect audit PRAGMA | Exact 12 tuples match |
| Foreign version 3 | Unrelated version=3 row, V3 schema absent | Registry applies | Owned V3 schema is created |

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
