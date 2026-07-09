# Delta for agent-message-bus

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Schema Integrity

Migration MUST use `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`. Schema includes: `id`, `message_id`, `sender_agent_id`, `receiver_agent_id`, `message_type`, `payload_json`, `status`, `priority`, `attempts`, `dedupe_key`, `locked_at`, `resolved_at`, `created_at`, `updated_at`, plus all 9 outcome/correlation/learning columns above (22 total).
(Previously: 13 columns without outcome, correlation, seller, or learning fields.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Idempotent migration | Table exists with legacy data | Migration runs | No error; existing data preserved; new columns added |
| All columns present | Migration completed | Schema inspected | All 22 columns from spec exist |
| Legacy rows survive | Pre-migration data exists | ALTER TABLE runs | All rows intact; new columns NULL for legacy rows |
