# Proposal: Agent Message Bus

## Intent

MSL agents operate as "CEO → tool" only — synchronous tool calls with no way for
agents to leave persistent work for each other. This blocks all future multi-agent
collaboration: specialist daemons, consensus reviews, and deep evidence chains.
The system needs an internal message queue so agents and daemons can communicate
asynchronously.

## Scope

### In Scope
- SQLite `agent_message_bus` table in `@msl/agent` following existing store patterns
- Schema: message_id, sender_agent_id, receiver_agent_id, message_type,
  payload_json, status, priority, attempts, dedupe_key, locked_at, resolved_at,
  created_at, updated_at
- API: `enqueue()`, `claimNext()`, `resolve()`, `fail()`, `cancel()`
- Row-level locking (`locked_at`) to prevent double processing
- Deduplication via `dedupe_key`
- Retry limits with max attempts guard

### Out of Scope
- AgentDaemonScheduler (PR 2)
- Specialist daemons, deep evidence providers (PRs 2–3)
- Quality/relist integration, consensus reviews (PRs 4–5)
- Cross-process transport — in-process SQLite only

## Capabilities

### New Capabilities
- `agent-message-bus`: Persistent, deduplicated message queue enabling
  agent-to-agent and agent-to-daemon async communication with claim/resolve lifecycle

### Modified Capabilities
- None

## Approach

Create `agentMessageBusStore.ts` in `packages/agent/src/conversation/`:

1. **Migration**: `CREATE TABLE IF NOT EXISTS agent_message_bus (...)` inside the
   factory, following `companyAgentStore.ts` pattern
2. **Factory**: `createAgentMessageBusStore(db: Database.Database): AgentMessageBusStore`
   using `getSharedDb()` from `@msl/memory`
3. **Claiming**: `claimNext(receiverAgentId)` — `UPDATE ... SET status='processing',
   locked_at=... WHERE status='pending' ORDER BY priority, created_at LIMIT 1`,
   returning the row with `SELECT` in a transaction
4. **Resolution**: `resolve(messageId)` — sets `resolved_at`, status to `'resolved'`
5. **Failure**: `fail(messageId)` — increments attempts; re-queues or sets `'failed'`
   if max attempts exceeded
6. **Cancellation**: `cancel(messageId)` — sets status to `'cancelled'`
7. **Deduplication**: `enqueue()` checks `dedupe_key` → `INSERT OR IGNORE` pattern

Export from `packages/agent/src/index.ts`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/agentMessageBusStore.ts` | New | Store + migrations + prepared statements |
| `packages/agent/src/index.ts` | Modified | Export new store types and factory |
| `packages/agent/package.json` | Unchanged | No new dependencies |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Lock contention under high message volume | Low | Single-process SQLite; WAL mode handles concurrent reads |
| Message loss on crash | Low | `locked_at` timeout; stalled messages re-queued by claim query filtering `WHERE locked_at < now() - timeout` |
| Schema evolution conflicts with future PRs | Low | Use `IF NOT EXISTS`; additive only |

## Rollback Plan

Drop the `agent_message_bus` table. Remove the store file and revert the export line
in `index.ts`. No data migration needed — no other systems depend on this table yet.

## Dependencies

- `@msl/memory` connection pool (`getSharedDb`)
- `better-sqlite3` (already present)

## Success Criteria

- [ ] `enqueue()` persists a message and rejects duplicates by `dedupe_key`
- [ ] `claimNext()` atomically locks and returns the next pending message
- [ ] `resolve()`, `fail()`, `cancel()` transition status correctly
- [ ] Concurrent claims from same receiver return different messages
- [ ] Messages exceeding max attempts end in `failed` status
