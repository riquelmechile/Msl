# Exploration: Add Deferred Message Bus Lifecycle

## Current State

### Schema and Statuses

The `agent_message_bus` SQLite table has 23 columns. The `status` column is a TEXT union of five values:

```
'pending' | 'processing' | 'resolved' | 'failed' | 'cancelled'
```

No `deferred` or equivalent waiting/held status exists. A message occupying a row has exactly one terminal path (`resolved`, `failed` at maxAttempts, or `cancelled`) and two nonterminal paths (`pending` → `processing` → retry-loop → terminal or `pending` → `cancelled`).

The schema is defined at `packages/agent/src/conversation/agentMessageBusStore.ts` (`SCHEMA_SQL`, lines 35–58) and migration v2 (`migrateBusSchema`, lines 12–31) adds the 9 outcome/correlation columns via `ALTER TABLE ADD COLUMN`.

### Lifecycle Transitions (current)

```
enqueue ──→ pending ──→ claimNext ──→ processing
                                         │
                          ┌──────────────┼──────────────┐
                          ▼              ▼              ▼
                       resolve()     fail()          cancel()
                          │         (attempts++)        │
                          ▼              │              ▼
                      resolved      attempts < maxAttempts=3?    cancelled
                                        │
                                   ┌────┴────┐
                                   YES       NO
                                    │         │
                                    ▼         ▼
                                pending    failed
                              (retryable)  (terminal)
```

### `fail()` Semantics — Confirmed

`fail()` (lines 399–411) is a **retryable operation** gated on `MAX_ATTEMPTS = 3` (line 7):

```sql
UPDATE agent_message_bus
SET
  attempts = attempts + 1,
  status = CASE WHEN attempts + 1 >= @maxAttempts THEN 'failed' ELSE 'pending' END,
  locked_at = CASE WHEN attempts + 1 >= @maxAttempts THEN locked_at ELSE NULL END,
  updated_at = datetime('now'),
  error_json = @error
WHERE message_id = @messageId AND status = 'processing'
```

Key behavior:
- **attempts < maxAttempts**: transitions back to `pending`, clears `locked_at`, message becomes claimable again on the next cycle.
- **attempts >= maxAttempts**: transitions to terminal `failed`, retains `locked_at`, message is never claimable again.
- **Requires `status = 'processing'`**: fails with an error if the message is not in processing.
- **There is NO way to declare a terminal failure on a single call at attempts < maxAttempts.** The caller that needs "fail exactly once" currently cannot achieve this without manipulating the `attempts` column externally or calling `fail()` in a loop (which would re-enter the scheduler claim loop between calls).

Daemon scheduler usage (lines 380-386 of `daemonScheduler.ts`):
```typescript
config.bus.resolve(claim.messageId, result);  // success path
// ...
config.bus.fail(claim.messageId, errorMessage); // exception path
```

This means handler exceptions go through retryable `fail()`, not terminal failure. After 3 handler crashes, the message reaches terminal `failed`.

### Stuck-Processing Recovery

`getProcessingStuck(timeoutMinutes?)` (lines 297–302, default 10 minutes) queries messages where `status = 'processing' AND locked_at < datetime('now', -10 minutes)`. `claimNext()` already reclaims stale processing messages (line 237). There is no automated recovery — the caller must periodically call `getProcessingStuck` and decide what to do.

### Seller Isolation (Current)

Messages carry `seller_id` column (TEXT, nullable). Isolation is enforced at the application layer by callers filtering on `sellerId` in the `claim` payload. The bus itself does not enforce cross-seller access rules in SQL WHERE clauses — it treats `seller_id` as an opaque correlation field.

### Migrations

Two migration versions:
- **v1** (`agent_message_bus_base`): CREATE TABLE with 14 base columns.
- **v2** (`agent_message_bus_extensions`): ALTER TABLE ADD COLUMN for 9 outcome/correlation/learning columns.

The factory supports both `MSL_MIGRATION_ENABLED` path (registry-based) and legacy path (direct exec). Migrations are idempotent — checked against `table_info` pragma before adding columns.

### Startup/Reopen Behavior

The store is created once per database handle (`createAgentMessageBusStore(db)`). On process restart, SQLite recovers from the WAL, open messages in `processing` become reclaimable after `CLAIM_TIMEOUT_MINUTES` (5 minutes). There is no explicit recovery scan — the bus assumes the consumer (daemon scheduler) polls `claimNext` and handles stale claims organically.

### Tests

690 lines of tests in `agentMessageBusStore.test.ts`, covering: enqueue/dedup, claimNext (priority, stale reclamation, double-claim guard), lifecycle (resolve, cancel), fail/retry (attempts, maxAttempts, error_json, terminal `failed`), schema integrity (idempotent migration, column count, legacy data preservation), correlation queries, learning history, and outcome recording. **No tests cover deferred state because it does not exist.**

## Affected Areas

| File | Why |
|------|-----|
| `packages/agent/src/conversation/agentMessageBusStore.ts` | Primary target: add `deferred` status, 9 deferral/settlement metadata columns, new methods (`defer`, `resumeDeferred`, `settle`, `getExpiredDeferrals`), row mapper update, migration v3, explicit scope-enforced SQL WHERE clauses, generation-based CAS idempotency, settlement digest validation |
| `packages/agent/tests/conversation/agentMessageBusStore.test.ts` | New test scenarios for defer (CAS generation, scope union), resume (CAS generation, idempotent same-cycle), settle (processing→terminal, deferred→terminal, idempotent with matching digest, conflicting digest/status rejection), expired deferrals (scope, pagination, deterministic order), migration v3 backward compatibility, and existing test regression guard |
| `packages/agent/src/workers/daemonScheduler.ts` | No required changes — `deferred` messages are invisible to `claimNext`; the scheduler MAY optionally call `getExpiredDeferrals` on startup but this is a consumer choice, not a bus contract |
| `openspec/specs/agent-message-bus/spec.md` | New requirements for deferred lifecycle (ADDED delta in downstream sdd-spec phase) |

No other files are affected. The bus is consumed by 55+ `enqueue` callers, 110+ `resolve` callers, and 5 `fail` callers — **none of these callers change their current behavior**. The `deferred` status is a new orthogonal path that existing operations never touch.

## Approaches

### Approach A: Add `deferred` Status to Existing Row (Recommended)

Add `'deferred'` to the status union. New methods operate on the same row with generation-based CAS tokens for idempotency and explicit scope union for isolation. Deferral and settlement metadata stored in new columns via migration v3.

**Methods added:**
- `defer(messageId, opts)`: `processing → deferred`. Requires unique `deferralId` and monotonically increasing `deferralGeneration`. Stores metadata, clears `locked_at`. Scope-enforced. Idempotent only when same deferralId AND same generation; rejects stale tokens from prior cycles.
- `resumeDeferred(messageId, opts)`: `deferred → pending`. Requires `deferralId` AND `deferralGeneration` matching stored values. Re-queues same row for normal claiming. Scope-enforced. Idempotent only if row is already `pending`/`processing` from the SAME cycle (matching deferralId + generation). Never re-queues a second time.
- `settle(messageId, outcome, opts)`: `processing | deferred → resolved | failed | cancelled`. Unified terminal settlement — one call regardless of `attempts`. Requires `settlementId` and `settlementDigest` (canonical outcome hash). Scope-enforced. Idempotent only when status, settlementId, AND digest ALL match. Same terminal status with different digest is a CONFLICT and rejected. Different terminal status is rejected.
- `getExpiredDeferrals(opts)`: query messages where `status = 'deferred' AND deferred_until IS NOT NULL AND deferred_until <= datetime('now')`. Scope-enforced, sorted deterministically (`deferred_until ASC, created_at ASC`), paginated with `limit`/`offset`. Returns candidates only — bus never applies domain expiry policy.

**Migration v3 columns (9):** `deferral_id` (TEXT), `deferral_generation` (INTEGER DEFAULT 0), `deferred_until` (TEXT), `deferred_at` (TEXT), `defer_reason` (TEXT), `defer_reason_detail` (TEXT), `defer_evidence_ref` (TEXT), `settlement_id` (TEXT), `settlement_digest` (TEXT).

**Safety analysis — confirmed that existing operations ignore `deferred`:**

| Operation | Gate | Deferred Safety |
|-----------|------|----------------|
| `claimNext` | `status = 'pending' OR (status = 'processing' AND locked_at < stale)` | ✅ Deferred never matches |
| `resolve` | `WHERE status = 'processing'` | ✅ Deferred never matches |
| `fail` | `WHERE status = 'processing'` | ✅ Deferred never matches |
| `cancel` | `WHERE status IN ('pending', 'processing')` | ✅ Deferred never matches |
| `getProcessingStuck` | `WHERE status = 'processing'` | ✅ Deferred never matches |
| `getFailedMessages` | `WHERE status = 'failed'` | ✅ Deferred never matches |
| `getUnscoredMessages` | `WHERE status IN ('resolved', 'failed', 'cancelled')` | ✅ Deferred never matches |

| Pros | Cons | Complexity |
|------|------|------------|
| Same row — satisfies downstream "same message retained" contract directly | Status union grows from 5 to 6 members | Medium |
| No new tables, no joins, no FK complexity | Existing row gets 9 more columns (harmless NULL for non-deferred messages) | |
| `claimNext`/`resolve`/`fail`/`cancel` need ZERO changes | Generation CAS + settlement digest + scope union add implementation surface (~570-620 lines) | |
| All existing callers completely unaffected | | |
| `settle()` provides terminal resolution from BOTH `processing` and `deferred` — strictly more capable than `failTerminal(processing-only)` | | |
| Explicit scope union (seller|system) — no optional/omitted filter, no silent broad access | | |
| Generation CAS prevents stale token replay across deferral cycles | | |
| Settlement digest prevents silently ignoring divergent outcome data | | |
| Migration is pure `ALTER TABLE ADD COLUMN` | | |

### Approach B: Separate Deferral Table

Create `agent_message_deferrals(message_id TEXT REFERENCES agent_message_bus, reason TEXT, deferred_until TEXT, ...)`. Bus status remains `processing` → `resolved`/`failed`/`cancelled`. Deferral is tracked in a separate table with a join.

| Pros | Cons | Complexity |
|------|------|------------|
| Schema separation — status union unchanged | **Violates same-row requirement**: downstream needs the SAME message row in `deferred` → `pending`, not a different row | Medium |
| No migration to the bus table itself | `claimNext` must JOIN to skip deferred messages — complex and slower | |
| | Risk of split-brain: deferral row deleted but bus status still `processing` | |
| | Two-table transaction required for every defer/resume/settle | |
| | CAS tokens, generation, settlement digest, and scope isolation require cross-table enforcement | |
| | Harder to reason about at crash recovery — two rows must stay consistent | |

### Approach C: Resolve Old Message + Enqueue Successor

When the caller wants to defer, resolve the current message as some "deferred-resolution" result, then enqueue a new message with a correlation link. Approval enqueues yet another message.

| Pros | Cons | Complexity |
|------|------|------------|
| No schema changes at all | **Explicitly violates same-message requirement** — downstream spec states "same message deferred → pending, never enqueue another" | Low (to implement) but High (for correctness) |
| Could be done entirely in application code | The downstream "NEVER enqueues" invariant is broken | |
| | Duplicate message risk: if the resume message gets sent twice | |
| | Correlation complexity: join chain grows with each deferral | |
| | Loses the atomic identity guarantee the downstream depends on | |

### Recommendation

**Approach A — Add `deferred` status to existing row.**

This is the ONLY approach that satisfies the same-message-row contract. The safety analysis confirms that no existing operation touches a `deferred` message, so the change is truly additive. The `settle()` API resolves the `failTerminal(processing-only)` defect by supporting terminal outcomes from both `processing` and `deferred`. Generation CAS prevents stale approval replay across deferral cycles. Settlement digest prevents silently ignoring divergent outcome data. Explicit scope union eliminates the optional broad-access escape hatch. The migration is a standard `ALTER TABLE ADD COLUMN` following the existing v2 pattern. The implementation is ~570–620 authored lines, fitting under the 800-line budget in a single PR.

## Deferral and Settlement Metadata Contract (Generic)

To remain generic infrastructure and not leak Creative Studio domain concepts, all metadata uses abstract, reusable fields:

### Deferral Columns

| Column | Type | Purpose |
|--------|------|---------|
| `deferral_id` | TEXT | Consumer-provided stable token for this deferral cycle. Required for `defer()` and `resumeDeferred()`. |
| `deferral_generation` | INTEGER (DEFAULT 0) | Monotonically increasing cycle counter managed by the bus. Auto-incremented on each new `defer()` call. Prevents stale-token replay: `resumeDeferred` requires an exact match on BOTH deferral_id and generation. |
| `deferred_until` | TEXT (ISO timestamp, nullable) | When the deferral expires. NULL = indefinite wait. Compared against `datetime('now')` in `getExpiredDeferrals`. |
| `deferred_at` | TEXT (ISO timestamp) | When this deferral was created. Set on `defer()`. Preserved after resume as audit trail. |
| `defer_reason` | TEXT (nullable) | Stable reason code (e.g., `"awaiting_approval"`, `"rate_limited"`, `"external_dependency"`). Consumer domain chooses the code — not enumerated by the bus. |
| `defer_reason_detail` | TEXT (nullable, bounded) | Structured detail string. Application layer enforces max length (recommend ≤1000 chars). Must NOT contain raw sensitive payloads (tokens, PII) — use `defer_evidence_ref` for external references. |
| `defer_evidence_ref` | TEXT (nullable) | Optional reference to external evidence (approval ID, audit log URL, external system correlation key). Validated as a non-empty string; format is consumer-defined. |

### Settlement Columns

| Column | Type | Purpose |
|--------|------|---------|
| `settlement_id` | TEXT | Consumer-provided stable identifier for the terminal settlement. Required for `settle()`. Stored on terminal rows for idempotency verification. |
| `settlement_digest` | TEXT | Consumer-provided canonical digest of the outcome data (result/error/evidence). Required for `settle()`. Stored on terminal rows. Repeated settlement is idempotent ONLY when status, settlement_id, AND digest all match. Same terminal status with divergent digest is rejected — no silent data loss. |

**Audit scope**: Deferral columns record the **latest (current) deferral only**. If a message is deferred, resumed, then deferred again, the second deferral overwrites `deferral_id`, `deferral_generation`, `deferred_at`, `deferred_until`, `defer_reason`, `defer_reason_detail`, and `defer_evidence_ref` — first deferral metadata is lost. This is explicitly NOT a full deferral history. Consumers that need a complete audit trail of every deferral cycle must record it in their own domain store. Settlement columns remain populated on the terminal row and are never overwritten (terminal states are immutable once set).

**No Creative-specific fields** (no `job_id`, no `phase`, no `provider`, no `consent_token`). The `defer_reason` code is an open namespace — any consumer can define their own codes. The bus only enforces that a reason is a string or null.

### Scope Isolation Contract

All new mutation and query APIs accept a **required explicit scope discriminator** — no optional/omitted parameter. The union type is:

```typescript
type MutationScope =
  | { kind: "seller"; sellerId: string }
  | { kind: "system"; reason: string; evidenceRef: string };
```

The bus enforces isolation in the SQL WHERE clause:

```sql
AND (
  (@scopeKind = 'seller' AND seller_id = @scopeSellerId)
  OR (@scopeKind = 'system')
)
```

Behavior:

| Message `seller_id` | Scope | Result |
|---------------------|-------|--------|
| `"seller-42"` | `{ kind: "seller", sellerId: "seller-42" }` | ✅ Row matches — operation proceeds |
| `"seller-42"` | `{ kind: "seller", sellerId: "seller-99" }` | ❌ Row excluded — 0 changes, error thrown |
| `"seller-42"` | `{ kind: "system", reason: "recovery", evidenceRef: "..." }` | ✅ Row matches — system scope bypasses seller filter |
| `NULL` (unscoped/system) | `{ kind: "seller", sellerId: "seller-42" }` | ❌ Row excluded — `seller_id = "seller-42"` is false for NULL |
| `NULL` (unscoped/system) | `{ kind: "system", reason: "recovery", evidenceRef: "..." }` | ✅ Row matches — system scope accesses unscoped messages |

There is no "omitted" scope. Every caller MUST explicitly declare seller or system intent. System scope is auditable via the `reason` and `evidenceRef` parameters — they are logged at the application layer and visible in call-site code review. The bus does NOT provide an authorization layer; scope enforcement is a data-integrity scoping filter. The application layer remains responsible for determining which scope a caller is entitled to use.

## API Signatures (Corrected v3)

### `defer`

```
defer(messageId: string, opts: {
  deferralId: string;                // REQUIRED — unique per cycle
  deferralGeneration: number;        // REQUIRED — must be > stored generation
  scope: MutationScope;              // REQUIRED — explicit seller or system
  reason?: string;                   // Reason code
  reasonDetail?: string;             // Bounded detail (≤1000 chars)
  deferredUntil?: string;            // ISO expiry (NULL = indefinite)
  evidenceRef?: string;              // External reference
}): AgentMessage
```

SQL CAS gate:
```sql
WHERE message_id = @messageId
  AND status = 'processing'
  AND (deferral_generation IS NULL OR @generation > deferral_generation)
  AND scope_check(@scopeKind, @scopeSellerId)
```

Transitions `processing → deferred`. Stores all deferral metadata. Clears `locked_at`. Sets `deferral_generation = @generation` (consumer provides the next generation). Idempotent: repeated call with same `deferralId` AND same `deferralGeneration` returns the existing deferred row without error. Rejects: different `deferralId` or different/lower generation if row is already deferred (stale token). Rejects if message is not in `processing`. Throws if scope mismatch.

### `resumeDeferred`

```
resumeDeferred(messageId: string, opts: {
  deferralId: string;                // REQUIRED — must match stored
  deferralGeneration: number;        // REQUIRED — must match stored
  scope: MutationScope;              // REQUIRED — explicit seller or system
}): AgentMessage
```

SQL CAS gate:
```sql
WHERE message_id = @messageId
  AND status = 'deferred'
  AND deferral_id = @deferralId
  AND deferral_generation = @generation
  AND scope_check(@scopeKind, @scopeSellerId)
```

Transitions `deferred → pending`. Requires BOTH `deferralId` and `deferralGeneration` to match stored values — a token from a prior cycle (same deferralId, lower generation) fails closed. Idempotent: if row is already `pending` or `processing` WITH the same `deferral_id` and `deferral_generation`, returns success — already resumed from this cycle, never re-queues again. Rejects if row is in any other state, token mismatches, or scope fails.

### `settle`

```
settle(messageId: string, outcome: 'resolved' | 'failed' | 'cancelled', opts: {
  settlementId: string;              // REQUIRED — stable settlement identifier
  settlementDigest: string;          // REQUIRED — canonical digest of outcome data
  scope: MutationScope;              // REQUIRED — explicit seller or system
  result?: unknown;                  // For 'resolved' — stored as result_json
  error?: string;                    // For 'failed' — stored as error_json
  reason?: string;                   // For 'cancelled' — stored as cancel_reason
}): void
```

SQL gate:
```sql
WHERE message_id = @messageId
  AND status IN ('processing', 'deferred')
  AND scope_check(@scopeKind, @scopeSellerId)
```

Performs terminal settlement from `processing` OR `deferred`. One call, no retry loop. Sets outcome columns, `settlement_id`, and `settlement_digest`. Idempotency check after 0 changes:

| Row state | Call | Result |
|-----------|------|--------|
| Already `failed` with settlement_id=A, digest=H1 | `settle('failed', { settlementId: A, digest: H1 })` | ✅ Idempotent — exact match |
| Already `failed` with settlement_id=A, digest=H1 | `settle('failed', { settlementId: A, digest: H2 })` | ❌ Error: "already settled with different outcome data" |
| Already `failed` | `settle('resolved', ...)` | ❌ Error: "already in terminal state 'failed'" |
| Already `resolved` | `settle('resolved', { settlementId: B, digest: H3 })` | ❌ Error: "already settled with different settlement identity" |

**Why digest-based idempotency is mandatory**: The prior design treated any same-status row as idempotent, silently accepting divergent `result_json`/`error_json`. This is unsafe — a retry with different evidence must surface as a conflict so the caller can reconcile. The `settlementDigest` is a canonical consumer-computed hash of the substantive outcome data. The bus compares it byte-for-byte.

### `getExpiredDeferrals`

```
getExpiredDeferrals(opts: {
  scope: MutationScope;              // REQUIRED — explicit seller or system
  limit?: number;                    // Max results (default 50, bounded)
  offset?: number;                   // Pagination offset (default 0)
}): AgentMessage[]
```

Query: `WHERE status = 'deferred' AND deferred_until IS NOT NULL AND deferred_until <= datetime('now')`. Scope-enforced via the same SQL pattern. Deterministic ordering: `deferred_until ASC, created_at ASC`. Paginated with `LIMIT`/`OFFSET`. Returns candidates only — the bus never applies domain expiry policy. Indefinite deferrals (`deferred_until IS NULL`) are NEVER returned.

## Corrected Lifecycle

```
enqueue ──→ pending ──→ claimNext ──→ processing
                                         │
              ┌──────────────────────────┼──────────────────────┐
              │                          │                      │
              ▼                          ▼                      ▼
           defer()                  settle('resolved')     settle('failed')
      (id + generation)            settle('cancelled')    (retryable via
              │                  (id + digest required)    existing fail())
              ▼                          │                      │
           deferred ─────────────────────┼──────────────────────┘
              │                          │
              │ resumeDeferred           │
              │ (id + generation)        │
              ▼                          │
           pending ──→ (normal) ─────────┘
              │
              │ settle('resolved'|'failed'|'cancelled')
              │ (atomically from deferred with id + digest)
              └──────────────────────────────────────────┘
```

## Idempotency and CAS Behavior (Detailed v3)

### `defer` — Generation Gated

| Scenario | Behavior |
|----------|----------|
| First defer: `defer(msgId, { deferralId: "d1", generation: 1 })` with `status = 'processing'` | Row → `deferred`, `deferral_id = "d1"`, `generation = 1` |
| Repeat: same deferralId "d1", same generation 1 | Returns existing row — idempotent, 0 changes |
| Same deferralId "d1", same generation 1, row already resumed to `pending` | Error: "message not in processing" — token was consumed |
| New cycle: `defer(msgId, { deferralId: "d2", generation: 2 })` after resume+claim | Row → `deferred`, `deferral_id = "d2"`, `generation = 2` — accepted (new unique id, higher generation) |
| Stale replay: `defer(msgId, { deferralId: "d1", generation: 1 })` on a row with `generation = 2` | Error: "generation 1 is not greater than stored 2" |
| Same deferralId "d1" with generation 2 (when stored is 1, but row is deferred) | Error: "deferral mismatch" — deferralId already in use for current cycle |

**Key rule**: Each new deferral cycle requires a unique `deferralId` AND `deferralGeneration > stored`. Reusing a completed/resumed prior token for a new cycle is rejected by the generation gate.

### `resumeDeferred` — Exact Match Gated

| Scenario | Behavior |
|----------|----------|
| First resume: `resumeDeferred(msgId, { deferralId: "d1", generation: 1 })` with `status = 'deferred'` | Row → `pending`, `locked_at` cleared. `deferral_id` and `generation` preserved on row. |
| Repeat: same deferralId "d1", same generation 1, row now `pending` | Returns existing row — idempotent (same cycle, already resumed), 0 changes, no re-queue |
| Repeat: same deferralId "d1", same generation 1, row now `processing` (claimed after resume) | Returns existing row — idempotent (same cycle, already in flight), 0 changes |
| Stale token: `deferralId: "d1"`, `generation: 1`, but row is `deferred` with `deferral_id = "d1"`, `generation = 2` | Error: "deferral mismatch" — generation doesn't match |
| Wrong token: `deferralId: "d2"`, `generation: 1`, row deferred with `deferral_id = "d1"` | Error: "deferral mismatch" |
| Already settled: row `resolved` | Error: "message not in deferred state" |

**Key rule**: `resumeDeferred` requires exact match on both deferralId AND generation. A token from a prior cycle (same deferralId, lower generation) is rejected. Repeated observations of a resumed row (already `pending`/`processing` from the SAME cycle) are idempotent — they never re-queue.

### `settle` — Digest Gated

| Scenario | Behavior |
|----------|----------|
| First settle: `settle(msgId, 'failed', { settlementId: "s1", digest: "sha256:abc", error: "timeout" })` with `status = 'deferred'` | Row → `failed`, `settlement_id = "s1"`, `settlement_digest = "sha256:abc"` |
| Repeat exact: same outcome, same settlementId "s1", same digest "sha256:abc" | ✅ Idempotent — 0 changes, no error |
| Same status, same settlementId, different digest: `settle(msgId, 'failed', { settlementId: "s1", digest: "sha256:xyz" })` | ❌ Error: "already settled 'failed' with settlementId 's1' but digest differs — outcome data conflict" |
| Same status, different settlementId: `settle(msgId, 'failed', { settlementId: "s2", digest: "sha256:abc" })` | ❌ Error: "already settled 'failed' with different settlement identity 's1'" |
| Different status: `settle(msgId, 'resolved', { settlementId: "s3", digest: "sha256:def" })`, row already `failed` | ❌ Error: "already in terminal state 'failed', cannot settle as 'resolved'" |
| From `processing`: `settle(msgId, 'failed', { settlementId: "s4", digest: "sha256:ghi", error: "fatal" })` | Row → `failed` in one call, bypassing retry loop |
| From `pending`: `settle(msgId, 'resolved', { ... })` | ❌ Error: "message not in a settlable state" |

**Key rule**: Settlement idempotency requires the triple `(status, settlementId, digest)` to match exactly. Same terminal status with divergent outcome data (different digest) is a CONFLICT and MUST be rejected — the bus never silently accepts different evidence for the same settlement.

### Concurrent Resume

SQLite serializes writes. The `WHERE status = 'deferred' AND deferral_id = @deferralId AND deferral_generation = @generation` clause ensures exactly one transition to `pending` succeeds. A second concurrent caller sees 0 changes and follows idempotency: if row is now `pending`/`processing` with matching deferral_id and generation → returns success (same cycle, already active). If row transitioned to a terminal state or has different token → throws.

## Cancellation and Rollback

### Cancellation from Deferred

`settle(messageId, 'cancelled', { settlementId, settlementDigest, reason: 'obsolete', scope })` from `deferred` is fully supported — it is one of the three `settle` outcomes. No separate API needed. The existing `cancel()` method remains unchanged and still operates only from `pending | processing`.

**Safe procedure for cancelling without `settle`:** `resumeDeferred → pending → cancel()`. The two-step path is valid but non-atomic (a concurrent `claimNext` could snatch the message between resume and cancel). Consumers that need atomic cancellation from deferred MUST use `settle('cancelled')`.

### Rollback

If the deferred feature must be rolled back entirely:

```sql
-- Transition any leftover deferred messages to a safe terminal state.
-- Choose ONE based on rollback policy:
UPDATE agent_message_bus
SET status = 'failed',
    settlement_id = 'rollback-v3',
    settlement_digest = 'rollback',
    updated_at = datetime('now')
WHERE status = 'deferred';

-- OR re-queue them for normal processing:
UPDATE agent_message_bus
SET status = 'pending', attempts = 0, locked_at = NULL, updated_at = datetime('now')
WHERE status = 'deferred';
```

The migration columns (`deferral_id`, `deferral_generation`, `deferred_until`, etc.) remain in the schema — they are harmless NULL columns for non-deferred rows and do not affect any existing query. No manual SQL corruption risk. The application code that calls `defer`/`resumeDeferred`/`settle` would be removed or gated during rollback.

## Failure / Restart Behavior

| Scenario | Behavior |
|----------|----------|
| Crash while deferred | Row persists in SQLite with `status = 'deferred'`. On restart, deferred rows survive unchanged. |
| Crash before `defer()` completes | Message remains in `processing`; stale-lock reclamation via `claimNext` recovers it. |
| `deferred_until` passes while process is down | Row stays `deferred`. Consumer calls `getExpiredDeferrals()` on startup to find and settle expired waits. |
| Concurrent resume of same deferred message | SQLite serialization: one `WHERE status = 'deferred' AND deferral_id = <id> AND deferral_generation = <g>` wins. Second caller sees 0 changes → idempotent if row now `pending` from same cycle. |
| `settle` with matching digest on already-settled row | Idempotent — 0 changes, no error. |
| `settle` with different digest on already-settled row | Error — conflict surfaced to caller. |
| Resume then immediate claim by another consumer | Atomic — `claimNext` transaction locks the row before transition. Standard double-claim guard applies. |
| Scope mismatch (seller vs row) | 0 changes → error thrown with clear message. No silent cross-seller access. |
| System scope sweep of all expired deferrals | System scope bypasses seller filter; `getExpiredDeferrals({ scope: { kind: "system", reason: "recovery", evidenceRef: "..." } })` returns all expired rows across sellers. |

## Backward Compatibility

- **Existing callers**: ZERO changes required. `deferred` status is invisible to `claimNext`, `resolve`, `fail`, `cancel`, and all read methods.
- **Existing data**: Migration v3 adds 9 columns as NULL. Legacy rows with NULL defer/settlement columns are valid — they were never deferred or settled via the new API.
- **Rollback**: SQL transition script above moves `deferred` rows to a safe terminal state. New columns are harmless NULL.
- **Serialized `AgentMessage`**: New fields (`deferralId`, `deferralGeneration`, `deferredUntil`, `deferredAt`, `deferReason`, `deferReasonDetail`, `deferEvidenceRef`, `settlementId`, `settlementDigest`) appear as `null`/`0` for non-deferred/non-settled messages. Consumers that destructure or serialize the type must handle the new nullable/numeric fields gracefully.
- **Status union growth**: `'deferred'` added — tools that match on status strings (dashboards, monitoring queries) see a new category. No parsing breakage; TEXT column is open-ended.

## Implementation Slices Forecast

Single PR — one work unit. The change is purely additive with no call-site modifications.

| Component | Est. Lines | Details |
|-----------|------------|---------|
| Migration v3 | 35 | `migrateBusSchema` adds 9 columns (deferral_id, deferral_generation, deferred_until, deferred_at, defer_reason, defer_reason_detail, defer_evidence_ref, settlement_id, settlement_digest) via ALTER TABLE; third migration registration in factory |
| Row type + mapper | 25 | `status` union + `'deferred'`, 9 new fields in `AgentMessageBusRow` and `rowToAgentMessage` |
| Public types | 60 | `MutationScope` discriminated union, `DeferOptions`, `ResumeOptions`, `SettleOptions`, `SettleOutcome`, `ExpiredDeferralsOptions`; updated `AgentMessage` type; updated `AgentMessageBusStore` interface with 4 new methods |
| Prepared statements | 50 | `deferStmt` (generation-gated + scope), `resumeDeferredStmt` (exact-match + scope), `settleStmt` (dual-state + scope), `getExpiredDeferralsStmt` (scope + sort + pagination) |
| Method implementations | 170 | `defer()` with generation CAS + idempotency + scope (~45 lines), `resumeDeferred()` with exact-match CAS + same-cycle idempotency + scope (~40 lines), `settle()` with dual-state gate + outcome routing + digest idempotency + scope (~70 lines), `getExpiredDeferrals()` with scope + sort + pagination (~15 lines) |
| Tests | 260-290 | Defer generation CAS (first, repeat same, repeat different gen, stale replay), defer scope (seller match, seller mismatch, system), resume exact-match CAS (match, stale gen, stale deferralId), resume same-cycle idempotent (already pending, already processing), resume scope, settle from processing (3 outcomes), settle from deferred (3 outcomes), settle digest idempotency (exact match, different digest, different settlementId, different status), settle scope, expired deferrals (scope, deterministic order, pagination, indefinite excluded), migration v3 backward compatibility, legacy row NULL handling, existing test regression (all 690 lines pass unchanged) |
| **Total** | **600–630** | **Single PR, under 800-line budget** |

**Decision needed before apply: No**
**Chained PRs recommended: No**
**400-line budget risk: Medium** (single work unit; ~600-630 lines is above 400 but under 800; implementation surface is additive with zero call-site changes; reviewer can validate generation CAS, settlement digest, and scope union independently from existing lifecycle paths; test coverage is extensive but self-contained in one file)

One work unit is preferred. The change is additive, has zero blast radius on existing callers, and the generation CAS + settlement digest + scope union logic is self-contained within the new methods. Splitting into two PRs would force an inter-PR dependency (settle needs the deferral columns from the first PR) and add sequencing overhead without meaningful review simplification.

## Downstream Contract Provided to Creative Studio (and All Consumers)

The generic infrastructure exposes these new operations:

| Operation | Signature | Contract |
|-----------|-----------|----------|
| `defer` | `(messageId, opts: { deferralId, deferralGeneration, scope, reason?, reasonDetail?, deferredUntil?, evidenceRef? }) => AgentMessage` | Generation CAS prevents stale replay. Repeated identical call idempotent. Different/lower generation rejected. Scope-enforced. |
| `resumeDeferred` | `(messageId, opts: { deferralId, deferralGeneration, scope }) => AgentMessage` | Both deferralId AND generation must match stored values. Re-queues same row as pending — no duplicate. Idempotent only if same cycle (matching token+generation on already-pending row). Scope-enforced. |
| `settle` | `(messageId, outcome, opts: { settlementId, settlementDigest, scope, result?, error?, reason? }) => void` | Terminal settlement from processing OR deferred. Three outcomes. Idempotent only when status + settlementId + digest all match. Divergent data under same status rejected. Scope-enforced. |
| `getExpiredDeferrals` | `(opts: { scope, limit?, offset? }) => AgentMessage[]` | Returns only rows where deferred_until <= now. Deterministic sort. Paginated. Scope-enforced. Bus never applies policy — consumer decides. |

Creative Studio and any other consumer can implement these workflows:

1. **Runtime budget wait**: `defer(claim.messageId, { deferralId: reqId, deferralGeneration: 1, scope: { kind: "seller", sellerId }, reason: "awaiting_budget", deferredUntil: "+24h" })`. On CEO approval: `resumeDeferred(messageId, { deferralId: reqId, deferralGeneration: 1, scope: { kind: "seller", sellerId } })` → same row re-enters `pending`. Zero new messages.

2. **Provider consent wait**: `defer(claim.messageId, { deferralId: consentId, deferralGeneration: 1, scope: { kind: "seller", sellerId }, reason: "awaiting_consent", deferredUntil: "+24h" })`. On consent granted: `resumeDeferred(messageId, { deferralId: consentId, deferralGeneration: 1, scope: { kind: "seller", sellerId } })`. On refusal: `settle(messageId, 'failed', { settlementId: consentId, settlementDigest: "sha256:...", scope: { kind: "seller", sellerId }, error: "consent denied" })` — terminal, one call.

3. **Timeout with ≥1 valid asset**: `settle(messageId, 'resolved', { settlementId: timeoutId, settlementDigest: canonicalHash(partialResult), scope: { kind: "seller", sellerId }, result: { partial: true, assets: [...] } })` — atomically from `deferred`.

4. **Timeout with 0 valid assets**: `settle(messageId, 'failed', { settlementId: timeoutId, settlementDigest: canonicalHash({ error: "zero valid" }), scope: { kind: "seller", sellerId }, error: "timeout: zero valid assets" })` — atomically from `deferred`, terminal, one call.

5. **Startup recovery (system sweep)**: `getExpiredDeferrals({ scope: { kind: "system", reason: "startup-recovery", evidenceRef: "scheduler-cycle" }, limit: 50 })` → iterate, apply unified timeout outcome table → `settle(...)` each.

6. **Concurrent safety**: Two CEO approval workers call `resumeDeferred` with same `deferralId` and `deferralGeneration` → one wins, other gets idempotent "already pending from same cycle" — no duplicate, never re-queues.

**This contract satisfies every Creative Studio requirement** (verified against `complete-creative-studio-runtime-contracts/specs/`):
- Runtime budget wait: `defer()` → `resumeDeferred()` — same row, zero new messages.
- Provider consent wait: `defer()` → `resumeDeferred()` — same row, consent retained via deferral metadata.
- Terminal failure (0 assets): `settle('failed')` from `deferred` — one call, digest-validated terminal.
- Partial outcome (≥1 asset): `settle('resolved')` from `deferred` — one call, digest-validated reviewable.
- Timeout expiry: `getExpiredDeferrals()` with system scope → `settle()` per expired row.
- All operations keep the same `messageId`, `sellerId`, `correlationId`, and `dedupeKey`.
- No downstream example calls a `processing`-only API while the message is `deferred` — `settle` and `resumeDeferred` are the only APIs needed from the deferred state.
- Stale approval replay is impossible: a prior cycle's `deferralId`+generation is rejected by the generation gate.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Deferred message leak — row stuck `deferred` forever | Low | `getExpiredDeferrals()` + `deferred_until` + scoped pagination provide expiry detection. Consumer responsible for handling expired rows. Bus never auto-expires. |
| `deferralId` collision across messages | Low | `deferralId` is scoped to a single message row. Two consumers cannot collide on the same message because only one holds the `processing` lock. Different messages with the same deferralId are independent. |
| `deferred` status not understood by monitoring/observability | Low | `deferred` appears in `status` column like any other value. Existing queries automatically gain a new category. No parsing breakage. |
| `settlementDigest` collision or weak hash | Low | Consumer is responsible for producing a strong canonical digest (SHA-256 recommended). Bus does not validate digest strength — it only compares byte-for-byte. Document consumer guidance. |
| Consumer provides wrong `deferralGeneration` (e.g., skips a number) | Low | Consumer is responsible for maintaining monotonic sequence. Bus only enforces `@generation > stored` — gaps are accepted (they don't weaken the CAS guarantee). |
| Scope bypass via `{ kind: "system" }` misuse | Low | System scope is explicit and auditable via `reason`/`evidenceRef` params visible in call-site code. No silent broad access. Application layer gates which callers may use system scope. |
| Migration v3 on a very large table takes time | Low | `ALTER TABLE ADD COLUMN` is O(1) in SQLite — it only updates the schema, not rows. No table scan. |

## Ready for Proposal

**Yes.** The orchestrator should launch `sdd-propose` for `add-deferred-message-bus-lifecycle` with:

- **Artifact store**: openspec
- **Delivery strategy**: `auto-forecast`, single PR (forecast ~600–630 authored lines; budget 800)
- **Scope**: Add `deferred` status. 9 metadata columns: `deferral_id`, `deferral_generation`, `deferred_until`, `deferred_at`, `defer_reason`, `defer_reason_detail`, `defer_evidence_ref`, `settlement_id`, `settlement_digest`. Four new methods: `defer()` (generation-gated CAS), `resumeDeferred()` (exact-match CAS, same-cycle idempotent), `settle()` (digest-gated terminal settlement from processing|deferred), `getExpiredDeferrals()` (scope-enforced, paginated). Explicit scope union (`{ kind: "seller" | "system" }`) — no omitted/optional scope. Migration v3. Tests. Zero call-site changes.
- **Replaced from prior iterations**: `failTerminal(processing-only)` → `settle()` from both states. Optional `expectedSellerId` → required `MutationScope` union. Same-token reuse across cycles → generation gate rejects. Same-status silent idempotency → digest-based conflict detection.
- **Out of scope**: Expiry auto-processing. Creative Studio integration. Consumer domain logic. Full deferral history/audit log (row stores latest deferral only). Automated recovery sweep (consumer calls `getExpiredDeferrals` on startup). `cancel()` of deferred messages via existing `cancel()` API (use `settle('cancelled')` for atomic cancellation from deferred).

The bus architecture **does support same-row deferral safely** — no fundamental constraint prevents it. The status-based gating on all existing operations ensures `deferred` is invisible to current code paths. Generation CAS prevents stale approval replay. Settlement digest prevents silently accepting divergent outcome data. Explicit scope union closes the optional broad-access escape hatch.
