# Design: Agent Message Bus

## Technical Approach

A SQLite-backed persistent message queue in `packages/agent/src/conversation/agentMessageBusStore.ts`, following the existing factory pattern (`createCompanyAgentStore`, `createStrategyStore`). Single-table schema with atomic row-level locking via `better-sqlite3` transactions. WAL mode (already enabled in the connection pool) provides concurrent read safety.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Locking mechanism | SELECT + UPDATE inside `db.transaction()` | Atomic at the SQLite level; WAL mode ensures readers aren't blocked. No external lock manager needed. |
| Stale lock reclaim | `WHERE locked_at < datetime('now', '-5 min')` in claim query | Recovers crashed claimers without a separate sweeper daemon. Timeout is a constant, not configurable — keeps the API simple. |
| Deduplication | Application-level SELECT by `dedupe_key` before INSERT | `dedupe_key` is nullable (not UNIQUE-able). SELECT-then-INSERT is safe because better-sqlite3 is synchronous single-threaded. |
| Retry on fail | Increment `attempts`; reset to `pending` if `< 3`; final `failed` at `>= 3` | Bounded retry prevents infinite loops. No exponential backoff — in-process queue doesn't need it. |
| message_id generation | `crypto.randomUUID()` | Guaranteed uniqueness without sequence coordination. UNIQUE constraint is a safety net. |
| Factory signature | `createAgentMessageBusStore(db: Database.Database)` | Matches every existing store in `packages/agent/src/conversation/`. Caller passes `getSharedDb()`. |

## Data Flow

### Enqueue
```
caller → enqueue(input)
  ├─ dedupe_key? → SELECT by dedupe_key → found? return existing
  └─ generate message_id → INSERT → return new row
```

### Claim (atomic transaction)
```
caller → claimNext(receiverAgentId)
  BEGIN TRANSACTION
  ├─ SELECT id WHERE receiver=? AND status='pending'
  │   AND (locked_at IS NULL OR locked_at < datetime('now','-5 min'))
  │   ORDER BY priority ASC, created_at ASC LIMIT 1
  ├─ no row? → COMMIT, return null
  ├─ UPDATE SET status='processing', locked_at=now(), attempts=attempts+1 WHERE id=?
  ├─ SELECT * WHERE message_id=?
  └─ COMMIT, return row
```

### Resolve / Fail / Cancel
```
resolve(msgId) → UPDATE SET status='resolved', resolved_at=now()
fail(msgId)    → UPDATE SET attempts++ ; 
                 < 3? status='pending', locked_at=NULL 
                 ≥ 3? status='failed'
cancel(msgId)  → UPDATE SET status='cancelled' (valid from any non-terminal state)
```

## Schema

```sql
CREATE TABLE IF NOT EXISTS agent_message_bus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  sender_agent_id TEXT NOT NULL,
  receiver_agent_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 5,
  attempts INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,
  locked_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_amb_status_priority
  ON agent_message_bus(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_amb_receiver_status
  ON agent_message_bus(receiver_agent_id, status, created_at);
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/agentMessageBusStore.ts` | Create | Factory + schema + prepared statements + exported types |
| `packages/agent/src/index.ts` | Modify | Export `AgentMessageBusStore`, `AgentMessage`, `EnqueueAgentMessageInput`, `createAgentMessageBusStore` |
| `packages/agent/tests/conversation/agentMessageBusStore.test.ts` | Create | Unit tests per spec scenarios |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Each API method (enqueue, claimNext, resolve, fail, cancel) | Fresh `:memory:` DB per test via `beforeEach`. Follows `strategyStore.test.ts` pattern. |
| Integration | Concurrent claim safety, retry guard, stale lock reclaim, dedup | Vitest in same file. Sequential calls prove atomicity since better-sqlite3 is synchronous. |
| E2E | N/A | In-process queue; no cross-process transport in scope. |

Coverage target: all spec scenarios (7 requirements × 3-4 scenarios each).

## Open Questions

- [ ] Should `cancel()` accept a `reason` parameter? Spec mentions it but interface in proposal omits it. Settle during implementation.
