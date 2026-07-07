# Tasks: Agent Message Bus

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~554 (store: 252, index: 5, tests: 297) |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Store + core tests (enqueue, claimNext, lifecycle, retry) ~380 lines → PR 2: Edge/schema tests ~175 lines |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | PR | Notes |
|------|------|-----|-------|
| 1 | Store + core spec tests (enqueue, claimNext, resolve, fail, cancel, retry, stale reclaim) | PR 1 | ~380 lines, self-contained store |
| 2 | Edge + schema tests (dedup edge, error safety, double claim, migration idempotency) | PR 2 | ~175 lines, stacked on PR 1 |

## Phase 1: Store Foundation

- [x] 1.1 Create `packages/agent/src/conversation/agentMessageBusStore.ts` with types (`AgentMessageBusRow`, `AgentMessage`, `EnqueueAgentMessageInput`), `CREATE TABLE IF NOT EXISTS` migration, and two indexes (`idx_amb_status_priority`, `idx_amb_receiver_status`)
- [x] 1.2 Implement `createAgentMessageBusStore(db: Database.Database)` factory: apply schema, prepare all statements, return API object

## Phase 2: Core Implementation

- [x] 2.1 Implement `enqueue()`: SELECT by `dedupe_key` → return existing; else `crypto.randomUUID()` + `INSERT OR IGNORE` → return new `AgentMessage`
- [x] 2.2 Implement `claimNext()`: `db.transaction()` — SELECT pending/stale `ORDER BY priority ASC, created_at ASC LIMIT 1` → UPDATE status='processing', locked_at=now() → SELECT return. Null if no row
- [x] 2.3 Implement `resolve()`: UPDATE status='resolved', resolved_at=now(). Throw on 0 changes
- [x] 2.4 Implement `fail()` + `cancel()`: fail increments attempts → pending (<3) or failed (≥3). Cancel from pending/processing. Both throw on missing

## Phase 3: Wiring

- [x] 3.1 Export `AgentMessageBusStore`, `AgentMessage`, `EnqueueAgentMessageInput`, `createAgentMessageBusStore` from `packages/agent/src/index.ts`

## Phase 4: Testing — PR 1 Core Coverage

- [x] 4.1 Create `packages/agent/tests/conversation/agentMessageBusStore.test.ts`: `beforeEach` with `new Database(":memory:")` + factory, message fixture helpers
- [x] 4.2 Enqueue (3 scenarios): first enqueue, duplicate dedupe, no dedupeKey creates two rows
- [x] 4.3 claimNext (5 scenarios): claim pending, priority order, no pending→null, stale lock reclaim, concurrent claims return different messages
- [x] 4.4 Lifecycle (4 scenarios): resolve, cancel pending, cancelled not claimable, expired lock reclaim
- [x] 4.5 Retry (3 scenarios): first failure attempts=1 pending, max reached attempts=3 failed, failed not claimable
- [x] 4.6 Run `npm test` — verify 15 core scenarios pass

## Phase 5: Testing — PR 2 Edge & Schema

- [x] 5.1 Error safety (3 scenarios): resolve missing throws, cancel missing throws, double claim (first gets it, second null)
- [x] 5.2 Schema integrity (3 scenarios): migration idempotent, all 14 columns present, existing tables unchanged
- [x] 5.3 Run `npm test` — verify all 21 scenarios pass, no regressions
