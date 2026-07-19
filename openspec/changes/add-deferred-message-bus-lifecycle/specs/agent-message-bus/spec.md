# Delta for agent-message-bus

## MODIFIED Requirements

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
