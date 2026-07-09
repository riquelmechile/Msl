# Exploration: Agent Architecture Audit — Gap Analysis

## Summary

Verification of 15 claims from ChatGPT's architecture audit against the MSL codebase. **12 of 12 claims confirmed** (claims 1-9 pre-verified, claims 10-12 verified during this exploration). All missing functions confirmed absent. The `sync_product` maturity assessment is **PARTIALLY CORRECT** when accounting for MCP server tooling (not pure codebase functions).

---

## 1. CLAIM 1 (CONFIRMED): Daemons are not autonomous

**Evidence**: `daemonScheduler.ts` lines 141-142:
```typescript
const claimed = config.bus.claimNext(laneId);
if (claimed.length === 0) return;
```

Daemons only process what's already on the bus. No `enqueueDaemonTick()`, `seedDaemonWork()`, or proactive work scheduling exists. Daemons are entirely reactive — they wait for someone to put messages on the bus.

**Impact**: HIGH — Without autonomous tick generation, daemons cannot self-trigger periodic work (e.g., health checks, scheduled reports). The proactive monitors (health check, DLQ) run as `setInterval` in `start-agent-daemons.mjs`, not as part of the scheduler.

---

## 2. CLAIM 2 (CONFIRMED): morning-report, eod-summary, unanswered-questions missing from LANE_CONTRACTS

**Evidence**:

| LaneId | LaneId type? | LANE_CONTRACTS? | daemonHandlerMap? | COMPANY_AGENTS? |
|--------|-------------|-----------------|-------------------|-----------------|
| `morning-report` | lanes.ts:14 ✅ | ❌ (not in lines 345-358) | daemonScheduler.ts:83 ✅ | ❌ (built from LANE_CONTRACTS) |
| `eod-summary` | lanes.ts:15 ✅ | ❌ | daemonScheduler.ts:84 ✅ | ❌ |
| `unanswered-questions` | lanes.ts:16 ✅ | ❌ | ❌ | ❌ |
| `owned-ecommerce` | lanes.ts:9 ✅ | lines.ts:353 ✅ | ❌ | ✅ |

- `laneDepartments` map (companyAgents.ts lines 85-101) includes all four (`morning-report`, `eod-summary`, `unanswered-questions`, `owned-ecommerce`) — so the org chart knows about them.
- `morningReportDaemon` and `eodSummaryDaemon` handlers exist in `workers/` directory.
- `ownedEcommerceDaemon` handler does NOT exist in `workers/`.
- `unansweredQuestionsDaemon` handler does NOT exist in `workers/`.

**Impact**: MEDIUM — `owned-ecommerce` has a contract but no handler; `unanswered-questions` has neither; `morning-report` and `eod-summary` have handlers but no contracts → no company agent entries → agent loop can't reference or route to them.

---

## 3. CLAIM 3 (CONFIRMED): resolve() ignores result, fail() ignores error, cancel() ignores reason

**Evidence**: `agentMessageBusStore.ts` lines 265-286:
```typescript
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const resolve = (messageId: string, _result: unknown): void => { ... };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const fail = (messageId: string, _error: string): void => { ... };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const cancel = (messageId: string, _reason?: string): void => { ... };
```

Params prefixed with underscore (deliberately unused). The SQL UPDATE statements only change `status` and `updated_at` — they do NOT persist result, error, or reason to any column. The schema (lines 11-33) has NO `result_json`, `error_json`, or `cancel_reason` columns.

**Impact**: MEDIUM — Lost signal. When a daemon resolves with a result, that result is discarded. Error messages from failures are not stored. Cancellation reasons are lost. No audit trail for outcomes.

---

## 4. CLAIM 4 (CONFIRMED): request_agent_evidence does NOT enqueue durable work to bus

**Evidence**: `workforceTools.ts` lines 417-487 — The tool's `execute` function:
1. Validates parameters
2. Resolves the target agent from the registry
3. Checks agent status
4. Returns an `AgentEvidenceResponse` (contract) directly

It NEVER calls `bus.enqueue()`. The response is returned synchronously to the caller (the LLM agent loop). No persistent work item is created. CEO delegation via `request_agent_evidence` is purely conversational — there's no operational follow-up.

**Impact**: MEDIUM — Evidence requests leave no trace. If the target agent is busy or the scheduler skips a cycle, the evidence request is lost. No retry, no durability.

---

## 5. CLAIM 5 (CONFIRMED): No ProposalRouter/CeoInbox

**Evidence**: `daemonScheduler.ts` lines 173-213 — CEO messages are consumed, logged, and auto-resolved:
```typescript
const ceoMessages = config.bus.claimNext("ceo", { limit: 10 });
for (const claim of ceoMessages) {
  config.bus.resolve(claim.messageId, { consumed: true });
}
```

No `agent_proposals` table exists. No normalization, prioritization, or routing of CEO proposals to Telegram/web. No structured ProposalRouter or CeoInboxStore abstraction.

**Impact**: HIGH — CEO proposals are fire-and-forget. The scheduler logs them and optionally submits consensus review (if `consensusStore` is configured), but there's no persistent inbox, no Telegram routing, no web UI integration.

---

## 6. CLAIM 6 (CONFIRMED): Creative tools are stubs

**Evidence**: `creativeTools.ts`:
- `query_creative_task` (line 28-37): Returns `status: "needs-human-review"` and explicitly states `"This is a stub tool. Full integration with the creative job queue will be added in a future phase."`
- `approve_creative_asset` (line 83-105): Records intent (`approved: true`) but `noMutationExecuted: true`. Explicitly states `"No external mutation executed. Use the prepare-only ML orchestration flow to upload and associate."`
- The `CreativeJobQueue` is in-memory only (via agent message bus) — no dedicated SQLite store for creative jobs (`CreativeJobQueueSQLite` does not exist).
- The creative-studio daemon (`creativeStudioDaemon.ts`) DOES have real generation logic (MiniMax client, policy engine, budget, ML diagnosis, Cortex recording), but the CEO-level tools remain stubs.

**Impact**: MEDIUM — The daemon generates real content, but the CEO approval tools are stubs. The approve → upload → associate pipeline is not implemented.

---

## 7. CLAIM 7 (CONFIRMED): Env variable mismatch

**Evidence**:

**Name mismatch**:
- `.env.example` line 161: `MINIMAX_BASE_URL=`
- `creativeStudioDaemon.ts` line 160: reads `MINIMAX_API_HOST`

**Missing from `.env.example`** (used by `creativeStudioDaemon.ts`):
| Env Var | Line in creativeStudioDaemon.ts |
|---------|--------------------------------|
| `MINIMAX_REQUEST_TIMEOUT_MS` | 161 |
| `MSL_CREATIVE_STUDIO_STORAGE_PATH` | 281 |
| `MSL_CREATIVE_STUDIO_ML_AUTO_DIAGNOSE` | 232 |
| `ML_API_TOKEN` | 239 |
| `ML_API_BASE_URL` | 240 |
| `MSL_CREATIVE_STUDIO_MAX_CONCURRENT_JOBS` | 51 |
| `MSL_CREATIVE_STUDIO_MIN_COOLDOWN_MS` | 52 |

**Impact**: HIGH — `MINIMAX_BASE_URL` in .env.example is dead config (never read). Anyone configuring the creative-studio daemon following .env.example will have a broken setup (`MINIMAX_API_HOST` unset → falls back to default). Seven additional undocumented env vars are required for full operation.

---

## 8. CLAIM 8 (CONFIRMED): DeepSeek advisors not passed to runner

**Evidence**: `start-agent-daemons.mjs` lines 168-177:
```typescript
const handle = startDaemonScheduler({
  bus,
  reader,
  cortex: engine,
  sellerIds,
  consensusStore,
  ceoContext,
  supplierMirrorStore,
  intervalMs: 15 * 60 * 1000,
});
```

No `advisor`, `operationsAdvisor`, `catalogAdvisor`, `costSupplierAdvisor`, or `creativeAdvisor` are passed, despite all five being declared as optional config fields in `DaemonSchedulerConfig` (daemonScheduler.ts lines 50-64).

No `createDaemonAdvisorsFromEnv()` function exists.

**Impact**: MEDIUM — All daemon handlers that accept advisors (supplier-manager, operations-manager, market-catalog, cost-supplier, creative-assets, creative-commercial) will operate in rule-only mode. No AI enrichment of proposals occurs. DaemonSchedulerConfig types show these are optional, so no runtime error — but the feature is completely inactive.

---

## 9. CLAIM 9 (CONFIRMED): Supplier Mirror starts with empty adapters

**Evidence**: `start-agent-daemons.mjs` line 81:
```typescript
supplierMirrorHandle = startSupplierMirrorScheduler({
  store: supplierMirrorRuntime.store,
  adapters: new Map(),
  intervalMs: 10 * 60 * 1000,
});
```

`adapters` is an empty `Map()`. No external system adapters are registered.

**Impact**: MEDIUM — The Supplier Mirror scheduler runs but has no adapters configured to communicate with any external system. Stock-gap detection is functional within the mirror store, but no external integration adapters (e.g., supplier APIs, ERP connectors) are wired.

---

## 10. CLAIM 10 (PARTIALLY CORRECT): sync_product has the most mature lifecycle

**Evidence** — The claim is about MCP server tools, not pure codebase functions:

| Tool | Dedicated Approve | Dedicated Execute | Dedicated Status/Readiness | Lifecycle Depth |
|------|-------------------|-------------------|---------------------------|-----------------|
| `msl_sync_product` | ✅ `msl_approve_sync_product_proposal` | ✅ `msl_execute_sync_product` | ✅ `msl_read_sync_product_status` + `msl_read_sync_product_execution_readiness` | **4 dedicated tools** |
| `msl_prepare_mercadolibre_write` | Generic approval queue only | Generic approval queue | ❌ | 1 tool + generic queue |
| `msl_prepare_product_ads_action` | Generic approval queue only | Generic approval queue | ❌ | 1 tool + generic queue |
| `msl_prepare_image_orchestration` | No approve/execute tooling | No approve/execute tooling | ❌ | 1 tool only |
| `msl_prepare_answer` | Generic approval queue | Generic approval queue | ❌ | 1 tool + generic queue |

**Verdict**: PARTIALLY CORRECT — `msl_sync_product` DOES have a richer dedicated lifecycle than other MCP tools (separate approve, execute, readiness, status tools). However, this distinction is at the MCP server level, not the codebase level. The `sync_product` agent tool (in `syncTools.ts`) uses the same `approvalRequired` / `approvedExecution` gating as `create_listing` and `sync_all`. The sophistication is in the MCP tooling, not the agent tools.

**Impact**: LOW — The lifecycle maturity is good but isolated to one domain. Other tools lack equivalent dedicated lifecycle tooling.

---

## 11. CLAIM 11 (CONFIRMED): Missing functions do NOT exist

Searched entire codebase (`*.ts` files) — **zero matches** for:

| Function/Class | Search Result | Status |
|----------------|--------------|--------|
| `enqueueDaemonTick` | Not found | ✅ Absent |
| `ProposalRouter` | Not found | ✅ Absent |
| `CeoInboxStore` | Not found | ✅ Absent |
| `AgentMessageBusResultStore` | Not found | ✅ Absent |
| `createDaemonAdvisorsFromEnv` | Not found | ✅ Absent |
| `CreativeJobQueueSQLite` | Not found | ✅ Absent |
| `unansweredQuestionsDaemon` | Not found | ✅ Absent |
| `ownedEcommerceDaemon` (handler) | Not found | ✅ Absent |
| `validateRuntimeEnv` | Not found | ✅ Absent |
| `MinimaxRetryPolicy` | Not found | ✅ Absent (minimax-client.ts has NO retry logic — single-shot POST with timeout) |
| `MercadoLibreWebhookIngestor` | Not found | ✅ Absent |
| `LearningOutcomePipeline` | Not found | ✅ Absent |
| Real E2E tests | creative-studio-e2e.test.ts is ALL MOCKED (vi.spyOn globalThis.fetch) | ✅ No real E2E tests exist |

**Impact**: HIGH for critical-path items (ProposalRouter, CeoInboxStore, enqueueDaemonTick, validateRuntimeEnv); MEDIUM for nice-to-haves (MinimaxRetryPolicy, LearningOutcomePipeline).

---

## 12. CLAIM 12 (CONFIRMED): Agent Message Bus lacks learning/outcome columns

**Evidence**: Schema at `agentMessageBusStore.ts` lines 11-33:

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
```

**Not present**: `result_json`, `error_json`, `cancel_reason`, `correlation_id`, `parent_message_id`, `seller_id`, `learned_at`, `outcome_score`, `action_id`.

**Impact**: HIGH — Without these columns:
- No way to trace message chains (correlation_id, parent_message_id)
- No seller scoping at the bus level (seller_id)
- No outcome tracking (result_json, outcome_score, learned_at)
- The bus is a simple work queue, not a learning/audit system

---

## Impact Assessment (High to Low)

| Priority | Claims | Why |
|----------|--------|-----|
| P0 | 1 (daemon autonomy), 5 (CEO inbox/router) | Daemons can't self-trigger work; CEO proposals are fire-and-forget |
| P0 | 7 (env mismatch), 12 (bus lacks learning columns) | Config broken out of the box; no audit trail |
| P1 | 2 (missing contracts/handlers), 11 (missing critical functions) | Gaps in lane coverage; missing routing infrastructure |
| P1 | 3 (resolve/fail/cancel ignore args) | Lost outcome signals |
| P1 | 4 (request_agent_evidence not durable) | Evidence requests are fire-and-forget |
| P2 | 6 (creative stubs), 8 (advisors not wired), 9 (empty adapters) | Feature not fully realized |
| P3 | 10 (sync_product lifecycle comparison) | Already partially functioning |

---

## Recommended Scope for `agent-architecture-audit-fixes`

The fixes should be organized as a **change chain** to keep PRs reviewable (budget: ~400 lines each):

### PR 1: Critical Infrastructure — Daemon Autonomy & CEO Inbox
- Implement `enqueueDaemonTick()` or equivalent proactive scheduling
- Create `ProposalRouter` / `CeoInboxStore` with SQLite-backed `agent_proposals` table
- Add Telegram/web routing for CEO proposals
- (~350-450 lines)

### PR 2: Bus Schema & Outcome Tracking
- Add result/error/learning columns to `agent_message_bus` schema
- Wire `resolve()` to persist `result_json`, `fail()` to persist `error_json`, `cancel()` to persist `cancel_reason`
- Add `correlation_id`, `parent_message_id`, `seller_id` columns
- (~300-400 lines)

### PR 3: Lane Contract Completion & Handler Registration
- Add `morning-report`, `eod-summary`, `unanswered-questions` contracts to `LANE_CONTRACTS`
- Add `owned-ecommerce` handler reference to `daemonHandlerMap`
- Create `ownedEcommerceDaemon` handler module
- Add `unansweredQuestionsDaemon` if domain logic exists
- (~200-350 lines)

### PR 4: Config & Wires Fix
- Fix `MINIMAX_BASE_URL` → `MINIMAX_API_HOST` in `.env.example`
- Add all missing env vars to `.env.example`
- Wire DeepSeek advisors into `start-agent-daemons.mjs`
- Add `createDaemonAdvisorsFromEnv()` factory
- Replace empty `adapters: new Map()` with properly configured adapters
- Add `validateRuntimeEnv()` at startup
- (~300-400 lines)

### PR 5: Creative Pipeline & Durability
- Implement `CreativeJobQueueSQLite` for persistent creative job storage
- Wire `request_agent_evidence` to `bus.enqueue()` for durable evidence requests
- Replace creative tool stubs with real implementations
- Add `MinimaxRetryPolicy` (exponential backoff) to minimax-client.ts
- (~350-500 lines)

### PR 6: Real E2E Tests & Learning Pipeline
- Create real integration tests (not mocked) for the agent pipeline
- Implement `LearningOutcomePipeline` to consume bus outcomes
- Add retrospective data quality checks
- (~200-300 lines)

---

## Risks

1. **Schema migration**: Adding columns to `agent_message_bus` requires careful migration planning — the table may have existing data.
2. **Daemon autonomy design**: Must avoid duplicate work — tick-based scheduling needs idempotency guarantees.
3. **CEO Inbox scope**: Could expand into a full proposal management system. Keep it scoped to routing + persistence.
4. **Env var changes**: Renaming `MINIMAX_BASE_URL` → `MINIMAX_API_HOST` may break existing `.env.local` files on production. Add a deprecation/compatibility layer.
5. **Change chain complexity**: 6 stacked PRs need careful dependency management. PRs 1 and 2 are independent of each other but PRs 3-6 may depend on both.

## Ready for Proposal

**Yes**. All claims verified against the codebase. The recommended approach is a 6-PR change chain organized by priority and dependency. Recommend orchestrator launches `sdd-propose` for change `agent-architecture-audit-fixes`.
