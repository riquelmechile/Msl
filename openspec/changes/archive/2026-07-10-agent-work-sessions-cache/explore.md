## Exploration: agent-work-sessions-cache

### Executive Summary

The MSL agent runtime already has scheduling infrastructure (daemonScheduler with 14 daemon handlers dispatched per laneId × sellerId), cost/cache tracking (WorkforceCostCacheLedgerStore with token counts and cache hit/miss tracking), and persistent messaging (AgentMessageBusStore). However, **agents run as ephemeral one-shot handlers** — there is no concept of session persistence, wake/sleep lifecycle, or per-seller experience recording across daemon cycles.

This exploration maps the existing architecture to identify what exists vs. what must be built for the 15-section spec of Agent Work Sessions + DeepSeek cache.

### Key Finding

**The core scheduling infrastructure (daemon tick per laneId × sellerId) already exists and is seller-scoped.** The gap is entirely about adding **stateful session lifecycles** on top of the current stateless daemon handlers. No existing code needs to be ripped out — all new work is additive (new stores, new types, daemon enhancements).

---

## 1. Existing Agent Architecture

### 1.1 LaneId Definitions

**File**: `packages/agent/src/conversation/lanes.ts` (line 1)

```typescript
export type LaneId =
  | "ceo"
  | "cost-supplier"
  | "market-catalog"
  | "creative-assets"
  | "creative-commercial"
  | "creative-studio"
  | "operations-manager"
  | "owned-ecommerce"
  | "product-ads-monitor"
  | "product-ads-ceo-profitability"
  | "product-ads-profitability"
  | "supplier-manager"
  | "morning-report"
  | "eod-summary"
  | "unanswered-questions";
```

**15 LaneId values total.** The `"ceo"` lane is meta-orchestration, `"morning-report"` / `"eod-summary"` / `"unanswered-questions"` are time-triggered. All others are department-specialist daemons.

`LANE_CONTRACTS` array contains 15 `LaneContract` entries — all above lane IDs have contracts defined.

### 1.2 Daemon Handler Map

**File**: `packages/agent/src/workers/daemonScheduler.ts` (line 78)

14 handlers registered:

| LaneId | Handler Function | Role |
|--------|-----------------|------|
| `market-catalog` | `marketCatalogDaemon` | Catalog/stock/rotation analysis |
| `operations-manager` | `operationsManagerDaemon` | Claims, questions, orders, reputation |
| `cost-supplier` | `costSupplierDaemon` | Margin, cost, restock analysis |
| `creative-assets` | `creativeAssetsDaemon` | Creative quality/moderation |
| `creative-commercial` | `creativeCommercialDaemon` | Commercial/campaign analysis |
| `creative-studio` | `creativeStudioDaemon` | Asset generation (MiniMax) |
| `product-ads-monitor` | `productAdsMonitorDaemon` | Ad performance monitoring |
| `product-ads-ceo-profitability` | `ceoProfitabilityHandler` | CFO-grade ad profitability |
| `product-ads-profitability` | `productAdsProfitabilityDaemon` | Per-product ad economics |
| `supplier-manager` | `supplierManagerDaemon` | Stock gaps, price shifts |
| `morning-report` | `morningReportDaemon` | Daily briefing |
| `eod-summary` | `eodSummaryDaemon` | End-of-day summary |
| `owned-ecommerce` | `ownedEcommerceDaemon` | Medusa storefront monitoring |
| `unanswered-questions` | `unansweredQuestionsDaemon` | Question aging |

### 1.3 Daemon Handler Signature

**File**: `packages/agent/src/workers/daemonTypes.ts` (line 69)

```typescript
export type DaemonHandler = (input: {
  claim: AgentMessage;
  reader: OperationalReadModelReader;
  cortex: GraphEngine;
  bus: AgentMessageBusStore;
  sellerIds: string[];
  accountContexts?: Map<string, AgentAccountContext>;
  supplierMirrorStore?: SupplierMirrorStore;
  ceoContext?: CeoHandlerContext;
  advisor?: SupplierMirrorDeepSeekAdvisor;
  operationsAdvisor?: OperationsDeepSeekAdvisor;
  catalogAdvisor?: CatalogDeepSeekAdvisor;
  costSupplierAdvisor?: CostSupplierDeepSeekAdvisor;
  creativeAdvisor?: CreativeDeepSeekAdvisor;
}) => Promise<DaemonResult>;
```

**Critical observation**: Handlers receive `sellerIds: string[]` — a list of all seller accounts. Each handler iterates over `sellerIds`, queries the operational read model, brain, and Cortex scoped per seller, then enqueues findings to the CEO bus. The `accountContexts` Map provides additional per-account context (AccountAsset with capabilities, profit goals, etc.).

**The handler signature is stateless** — each daemon cycle creates fresh state. No session continuity across cycles.

### 1.4 Daemon Scheduler (Tick & Dispatch)

**File**: `packages/agent/src/workers/daemonScheduler.ts` (line 78)

**Tick generation** (`enqueueDaemonTick`, line 127):
- For every `laneId` × `sellerId` combination, enqueues a `daemon-tick` message
- Dedupe key: `${laneId}:${sellerId}:tick:${hourKey}` (ISO-8601 hour prefix)
- This prevents cross-account dedupe collisions

**Dispatch cycle** (`startDaemonScheduler`, line 152):
- Runs immediately on start, then on `intervalMs` (default: 15 minutes)
- Builds per-seller `AgentAccountContext` map
- Enqueues autonomous ticks
- Filters `listCompanyAgents()` to active agents with matching daemon handlers
- Runs all active daemons in **parallel** with error isolation
- Per-daemon: calls `bus.claimNext(laneId)`, then dispatches the claim to the handler
- **CEO message consumption**: After daemon dispatch, claims CEO-addressed messages (`bus.claimNext("ceo")`), persists to `CeoInboxStore`, auto-submits consensus reviews for high-risk proposals
- Reader is wrapped with per-cycle cache (`createCachingReader`) to avoid redundant data reads

**Key architectural properties**:
- DUAL-SELLER: `enqueueDaemonTick` iterates ALL seller accounts — `maustian` and `plasticov` never mix
- Per-cycle cache prevents repeated ORM reads across daemon handlers
- 15-minute default interval (configurable)
- No session-awareness — handlers are pure functions of claim + reader + cortex + bus

### 1.5 Existing Agent Loop / Routine Patterns

**File**: `packages/agent/src/conversation/agentLoop.ts`

The CEO agent loop (`createAgentLoop`) is the conversational entry point:
- DeepSeek Transport injection (real/fake/fixture)
- Tool registration (40+ business MCP tools)
- System prompt with autonomy level, account context, strategies
- Cache block injection (Block B for operational daily aggregates, Block C for Cortex/evidence/lessons)
- `recordLlmUsage()` records every LLM call to `WorkforceCostCacheLedgerStore` with token counts, model, laneId
- Turn-level Escribano observation for Hebbian learning

**No periodic wake/sleep logic exists** — the agent loop processes one user message at a time. The daemon scheduler handles periodic polling independently.

---

## 2. Existing Stores (SQLite Schemas)

All stores use `better-sqlite3`, follow `CREATE TABLE IF NOT EXISTS` pattern, and reject malformed rows gracefully (return `undefined` rather than crashing).

### 2.1 Stores in `packages/memory/src/`

| Store | File | Has seller_id | Schema |
|-------|------|:---:|--------|
| `operationalReadModel` | `operationalReadModel.ts` | YES | `operational_snapshots(seller_id TEXT, item_id TEXT, kind TEXT, data_json TEXT, ...)` + `ingestion_checkpoints(seller_id TEXT, kind TEXT, ...)` |
| `supplierMirrorStore` | `supplierMirrorStore.ts` | YES (via `target_seller_id`) | 8 tables: suppliers, supplier_items, stock_observations, target_mappings, target_policies, mirror_ledger, notification_preferences, learned_fallback_policies |
| `ownedEcommerceStore` | `ownedEcommerceStore.ts` | NO (projection-scoped) | 6 tables: candidates, projections, validations, approvals, executions, audit |
| **Cortex** | `cortex/database.ts` | YES | `nodes(seller_id TEXT)`, `edges(seller_id TEXT)`, `darwinian_lessons(seller_id TEXT)`, `actor_simulations`, `probe_results` |

### 2.2 Stores in `packages/agent/src/conversation/`

| Store | File | Has seller_id | Key Tables & Columns |
|-------|------|:---:|--------|
| `ceoInboxStore` | `ceoInboxStore.ts` | YES | `agent_proposals(seller_id TEXT NOT NULL, proposal_id, sender_agent_id, proposal_type, payload_json, risk_level, status, routed_to)` |
| `agentMessageBusStore` | `agentMessageBusStore.ts` | YES (nullable) | `agent_message_bus(seller_id TEXT, message_id, sender_agent_id, receiver_agent_id, message_type, payload_json, status, dedupe_key, outcome_score, ...)` |
| `agentConsensusStore` | `agentConsensusStore.ts` | YES (nullable) | `agent_reviews(seller_id TEXT, proposal_id, reviewer_agent_id, verdict, rationale, confidence)` |
| `workforceCostCacheLedgerStore` | `workforceCostCacheLedgerStore.ts` | **NO** | `workforce_cost_cache_ledger_entries(entry_id, agent_id, lane_id, department_id, provider, model, prompt_cache_hit_tokens, prompt_cache_miss_tokens, ...)` + rollups table |
| `companyAgentStore` | `companyAgentStore.ts` | NO | `company_agents(id, lane_id, label, department_id, stable_prefix, ...)` |
| `companyAgentLearningStore` | `companyAgentLearningStore.ts` | YES (nullable) | `company_agent_lessons(seller_id TEXT, lesson_id, target_agent_id, department_id, scope, lesson_type, summary, ...)` |
| `companyAgentSkillStore` | `companyAgentSkillStore.ts` | NO | `agent_skills(skill_id, agent_id, label, category, description, proficiency)` |
| `creativeJobQueueStore` | `creativeJobQueueStore.ts` | YES | `creative_jobs(seller_id TEXT NOT NULL, job_id, request_id, status, kind, channel, provider, ...)` |
| `accountAssetStore` | `accountAssetStore.ts` | YES (PK) | `account_assets(seller_id TEXT PRIMARY KEY, ...)`, `account_capabilities(seller_id TEXT)`, `account_health_history(seller_id TEXT)`, `account_strategy_notes(seller_id TEXT)`, `account_risks(seller_id TEXT)`, `account_opportunities(seller_id TEXT)` |
| `sessionStore` | `sessionStore.ts` | YES | Conversation session persistence |
| `strategyStore` | `strategyStore.ts` | YES (nullable) | CEO strategy rules with `seller_id` |

### 2.3 Store Creation Patterns

All stores follow the same pattern:

```typescript
// 1. SCHEMA_SQL constant with CREATE TABLE IF NOT EXISTS
const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS table_name (...); CREATE INDEX IF NOT EXISTS ...`;

// 2. Factory function accepting Database.Database
export function createXxxStore(db: Database.Database): XxxStore {
  db.exec(SCHEMA_SQL);
  // Optional: idempotent column migrations via columnExists()
  // 3. Prepared statements using db.prepare()
  // 4. Return API object with methods
}
```

**Idempotent migrations**: Several stores (agentMessageBusStore, agentConsensusStore, companyAgentLearningStore, Cortex) use `db.pragma("table_info(...)")` / `columnExists()` to add columns only when missing. Example:

```typescript
function columnExists(db: Database.Database, table: string, column: string): boolean {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return info.some((col) => col.name === column);
}
```

### 2.4 workforceCostCacheLedgerStore — Key Pattern

**File**: `packages/agent/src/conversation/workforceCostCacheLedgerStore.ts`

This is the most relevant existing store for the cache portion of this change:

- **Schema**: `workforce_cost_cache_ledger_entries(entry_id, agent_id, lane_id, provider, model, operation, prompt_cache_hit_tokens, prompt_cache_miss_tokens, input_tokens, output_tokens, estimated_cost_micros, currency, cache_status, metadata, measured_at, created_at)`
- **Rollups**: `workforce_cost_cache_ledger_rollups(day, agent_id, department_id, model, input_tokens_agg, output_tokens_agg, cache_hit_tokens_agg, cache_miss_tokens_agg, ...)`
- **LaneId** is tracked per entry via `lane_id TEXT`
- **Cache status**: `hit | miss | partial | unknown`
- **Cache efficiency**: Computed as `cacheHitTokens / (cacheHitTokens + cacheMissTokens)`
- **Pricing model** for cost estimation: `supplierMirrorDeepSeekPolicy.ts`
- **No seller_id column** — this is a cross-account ledger (tracks total workforce cost)

### 2.5 Connection Pool

**File**: `packages/memory/src/connectionPool.ts`

- Singleton `getSharedDb(path?)` — all packages share one `better-sqlite3` handle
- Defaults to `":memory:"` (tests), file path for production
- WAL mode, foreign keys ON, busy_timeout 5000ms

---

## 3. DeepSeek Transport & Cache

### 3.1 Transport Interface

**File**: `packages/agent/src/conversation/transports/deepseekTransport.ts` (line 56)

```typescript
export type DeepSeekTransport = {
  listModels(): Promise<DeepSeekModel[]>;
  createChatCompletion(request: DeepSeekChatRequest): Promise<DeepSeekChatResponse>;
  streamChatCompletion(request: DeepSeekChatRequest): AsyncIterable<DeepSeekStreamChunk>;
};
```

### 3.2 Transport Implementations

| Class | Use Case | Details |
|-------|----------|---------|
| `DeepSeekRealTransport` | Production | Wraps OpenAI SDK, `maxRetries: 3`, `timeout: 60000`, normalizes `usage` with `prompt_tokens_details.cached_tokens` |
| `DeepSeekFakeTransport` | Unit tests | Returns predefined responses from array (round-robin), no request validation |
| `DeepSeekFixtureTransport` | Integration tests | Keyed by `model:firstMessageContent`, returns matching fixture or default |

### 3.3 Cache-Related Fields in Response

**File**: `packages/agent/src/conversation/transports/deepseekTransport.ts` (line 42-50)

```typescript
export type DeepSeekChatResponse = {
  // ...
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number } | undefined;
  } | undefined;
};
```

The `prompt_tokens_details.cached_tokens` field is extracted from the OpenAI SDK response and passed through. This is the DeepSeek API's disk cache mechanism — tokens that were cached from a previous identical prompt prefix.

### 3.4 Cache Telemetry in Domain

**File**: `packages/agent/src/conversation/lanes.ts` (line 18)

```typescript
export type CacheTelemetry = {
  provider: string;
  model: string;
  laneId: LaneId;
  promptCacheHitTokens: number | null;
  promptCacheMissTokens: number | null;
  credentialRefRedacted?: string;
  measuredAt: string;
};
```

This type exists but is **only used in `LaneOutput`** (conversational lane output, not daemon output).

### 3.5 Prompt Construction — No Cache-Optimization

**Current state**: Prompts are constructed dynamically per-call in each daemon handler and advisor. There is NO prefix structuring, NO prompt hashing, and NO cache-hit optimization strategy. The DeepSeek API cache works at the transport level (disk cache) based on identical prefix bytes — the application does not optimize for this.

### 3.6 How DeepSeek Is Called

**Daemon handlers** → `*DeepSeekAdvisor.analyze()` → `transport.createChatCompletion()` → response with usage → `workforceCostCacheLedgerStore.insertEntry()`

**CEO agent loop** → `createRealClientFromTransport()` → `transport.createChatCompletion()` → `recordLlmUsage()` → `workforceCostCacheLedgerStore.insertEntry()`

Each advisor is configured with `transport`, `sellerIds`, and `ledger`. The advisor constructs the LLM prompt and handles the enrichment loop.

**Advisor examples**:
- `OperationsDeepSeekAdvisor` — claims + reputation enrichment
- `CatalogDeepSeekAdvisor` — low-visit, relist-expiring enrichment  
- `CreativeDeepSeekAdvisor` — creative signal enrichment
- `CostSupplierDeepSeekAdvisor` — margin/cost enrichment
- `SupplierMirrorDeepSeekAdvisor` — stock-gap enrichment

---

## 4. Cortex Graph Structure

### 4.1 Node & Edge Schema

**File**: `packages/memory/src/cortex/database.ts`

```sql
CREATE TABLE nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  activation REAL NOT NULL DEFAULT 0.0,
  metadata TEXT NOT NULL DEFAULT '{}',
  seller_id TEXT DEFAULT 'unknown'
);

CREATE TABLE edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source INTEGER NOT NULL REFERENCES nodes(id),
  target INTEGER NOT NULL REFERENCES nodes(id),
  weight REAL NOT NULL DEFAULT 0.5,
  last_activated TEXT,
  co_occurrence_count INTEGER NOT NULL DEFAULT 0,
  distilled_lesson TEXT,
  seller_id TEXT,
  UNIQUE(source, target)
);
```

### 4.2 Seller Scoping

Both nodes and edges have `seller_id` columns (added via idempotent migration). The engine enforces:
- `createNode(label, metadata, sellerId?)` — `sellerId` is optional (NULL = global)
- `reinforceEdge(source, target, sellerId?)` — validates source/target nodes share scope
- `spreadActivation(nodeIds, { sellerId })` — CTE filter: `n.seller_id = ? OR n.seller_id IS NULL OR n.seller_id = 'unknown'`
- `prune({ sellerId })` — scoped edge archival
- `queryByMetadata({ sellerId })` — multi-strategy query (canonical column + JSON fallback)
- `getNodesBySeller(sellerId)` — returns scoped + global nodes
- `ensureAccountAssetNode(sellerId)` — creates `account_asset:{sellerId}` root node, links to existing listing/order/claim/strategy/lesson nodes

### 4.3 Darwinian Lessons

```sql
CREATE TABLE darwinian_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_node INTEGER NOT NULL,
  target_node INTEGER NOT NULL,
  lesson TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  seller_id TEXT
);
```

Lesson rows include `seller_id`. The `prune()` method extracts lessons from weak edges and scopes them by seller.

### 4.4 Engine Capabilities

- **Hebbian learning**: `reinforceEdge(+0.1)` / `penalizeEdge(-0.15)` with seller scope validation
- **Spreading activation**: Recursive CTE with depth, decay, threshold, and sellerId filter
- **Darwinian pruning**: Archives edges < 0.05 weight as lessons, deletes them; node cap FIFO cleanup
- **Convergence detection**: Cosine similarity between consecutive activation snapshots
- **Actor persona seeding**: `seedActorNodes()` for comprador/proveedor/competidor profiles
- **Probe storage**: Honey-pot probe results with Hebbian feedback on competidor actor edges
- **Concept nodes**: `findOrCreateConceptNode()` / `getOrCreateNode()` with seller scope

### 4.5 Experience Recording

The existing pattern for recording agent experiences is:
1. **Escribano observer** (`packages/agent/src/conversation/escribano.ts`) — observes conversation turns, writes to Cortex via Hebbian reinforcement
2. **CompanyAgentLearningStore** — stores `ceo-correction | research-finding | outcome-lesson | policy` lessons scoped to agent + department + optional seller
3. **Darwinian lessons table** — extracted from pruned edges

**No dedicated agent work-session recording exists.** The Escribano records at the turn level; the learning store records after-the-fact; there is no session-level entity.

---

## 5. CEO Tools & Proposal Flow

### 5.1 Proposal Lifecycle

1. **Daemon detects findings** → enqueues message to `"ceo"` via `bus.enqueue({ receiverAgentId: "ceo", messageType: "proposal", ... })`
2. **Scheduler consumes CEO messages** after daemon dispatch:
   - Parses `payloadJson` for summary, severity, action
   - Persists to `CeoInboxStore.insert({ seller_id, sender_agent_id, risk_level, ... })`
   - Auto-submits consensus reviews for high-risk proposals via `consensusStore.submitReview()`
   - Resolves the bus message
3. **CEO agent loop** can access proposals via inbox store (not currently wired as a tool)

### 5.2 Proposal Payload Structure

Daemon proposals carry:
```json
{
  "type": "proposal",
  "summary": "...",
  "findings": [{ "kind", "severity", "summary", "evidenceIds" }],
  "recommendedAction": "...",
  "capturedAt": "ISO-8601",
  "noMutationExecuted": true,
  "aiEnrichment": { ... }  // optional, from DeepSeek advisor
}
```

### 5.3 CEO Inbox Schema

`agent_proposals(seller_id, proposal_id, sender_agent_id, proposal_type, payload_json, normalized_summary, risk_level, status [pending|routed|reviewed|archived], routed_to, created_at, updated_at)`

Supports `routeToTelegram(proposalId, chatId, threadId?)` — marks status as "routed".

### 5.4 MCP Tools Available to CEO

40+ tools registered in `agentLoop.ts`:
- MercadoLibre reads: listings, orders, claims, questions, reputation, notices, product ads insights, promotions
- MercadoLibre writes (prepare-only): listing create/update, price change, stock change, image flow, answer questions, sync product
- Internal workforce: delegate_to_subagent, request_agent_evidence, list_company_agents, create_company_agent, record_agent_lesson, list_agent_lessons, declare_agent_skill, list_agent_skills, update_agent_skill, update_company_agent, list_workforce_cost_cache_ledger_entries, record_workforce_cost_cache_ledger_entry
- Supplier mirror: supplier_info, supplier_pricing_policy, supplier_ecommerce_bridge
- Owned ecommerce: projection tools
- Security: detect_probes, propose_honey_pot, get_business_context

---

## 6. Test Patterns

### 6.1 Store Testing (SQLite in-memory)

**Pattern** (from `packages/agent/src/agent.test.ts`):

```typescript
import Database from "better-sqlite3";

it("roundtrips data in SQLite", () => {
  const db = new Database(":memory:");  // ephemeral
  const store = createXxxStore(db);
  // ... exercise store ...
  db.close();
});

it("persists across database reopen", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "msl-test-"));
  const dbPath = join(tempDir, "test.sqlite");
  let db = new Database(dbPath);
  // ... write data, close, reopen, verify ...
  rmSync(tempDir, { recursive: true, force: true });
});
```

- **`:memory:`** for fast unit tests
- **tmpdir + file path** for persistence tests
- **Direct SQL injection for malformed rows** to test defensive parsing

### 6.2 Transport Mocking (DeepSeek)

Three patterns:

1. **`DeepSeekFakeTransport`**: Returns canned responses from array (round-robin). Used in unit tests where no LLM is needed.
2. **`DeepSeekFixtureTransport`**: Returns responses keyed by `model:firstMessageContent`. Used in integration tests.
3. **`createDeepSeekProviderFromEnv()`**: Falls back to FakeTransport when `DEEPSEEK_API_KEY` is absent.

Agent tests inject FakeTransport via:
```typescript
const loop = createAgentLoop({
  mockClient: true,  // or deepSeekTransport: new DeepSeekFakeTransport([...])
  // ...
});
```

### 6.3 Test Framework

- **Vitest** (`vitest.config.ts` at root)
- Command: `npm test`
- Packages tested: agent, memory, workers, domain
- E2E: Playwright via `scripts/run-e2e.mjs`

---

## 7. Gap Analysis

What exists vs. what needs to be built per the 15 sections of the agent-work-sessions-cache spec.

### Section 1: Agent Routine Configuration
**Status**: ❌ NOT BUILT
- No wake/sleep schedules exist
- Daemon scheduler runs on fixed interval only (15 min)
- Need: per-agent routine definitions (period, time windows, seller_id scoping)

### Section 2: Session Lifecycle (Wake/Sleep)
**Status**: ❌ NOT BUILT
- Agents are stateless — each daemon tick creates fresh state
- No concept of "session open" between consecutive ticks
- Need: session entity, state machine (dormant → waking → active → dozing → dormant), persistence

### Section 3: Agent Session Store (SQLite)
**Status**: ❌ NOT BUILT
- Need: new table `agent_work_sessions(session_id, agent_id, lane_id, seller_id, status, routine_config, started_at, ended_at, last_active_at, cycle_count, summary_json, ...)`
- Pattern: follow existing store patterns (CREATE TABLE IF NOT EXISTS, columnExists migration)
- seller_id column: **MUST be present** — prevents cross-account contamination

### Section 4: Wake Experience Recording
**Status**: ❌ NOT BUILT
- No per-session experience recording exists
- Escribano records at turn level; LearningStore records lessons — neither is session-scoped
- Need: write Cortex nodes for each session wake, link findings/decisions, record outcomes

### Section 5: Cache-Friendly Prompt Construction
**Status**: ❌ NOT BUILT (partial infrastructure exists)
- `CacheTelemetry` type exists in lanes.ts but unused in daemons
- `prompt_tokens_details.cached_tokens` already extracted from transport
- `workforceCostCacheLedgerStore` tracks cache_hit/miss tokens
- **Missing**: prefix stabilization, deterministic prompt ordering, prompt hashing for cache key, cache-hit optimization strategy per agent seller

### Section 6: Prompt Cache Strategy per Agent
**Status**: ❌ NOT BUILT
- No per-agent cache strategy exists
- Need: each agent should have a stable prefix (system prompt + lane context + seller context), followed by dynamic content (current state)

### Section 7: DeepSeek Cache Integration
**Status**: ⚠️ PARTIAL (transport level only)
- Transport passes `cached_tokens` from API response
- No application-level cache priming
- No `extra_body` with cache control hints (DeepSeek supports disk_cache_ttl via extra_body)

### Section 8: Seller-Scoped Sessions (Plasticov ≠ Maustian)
**Status**: ⚠️ PARTIAL (infrastructure exists, sessions don't)
- `enqueueDaemonTick` already scopes ticks per `laneId × sellerId` with dedupe keys
- `DaemonHandler` receives `sellerIds: string[]` and `accountContexts` Map
- Cortex has seller-scoped nodes/edges/lessons
- `agent_proposals`, `agent_reviews`, `company_agent_lessons` all have `seller_id`
- **Missing**: session store must enforce seller scoping from day one

### Section 9: Experience Graph Recording
**Status**: ⚠️ PARTIAL (Cortex capability exists, no session integration)
- `GraphEngine.createNode()` accepts sellerId
- `findOrCreateConceptNode()` supports seller scope
- `reinforceEdge()` validates cross-seller edges
- Hebbian learning (`+0.1`/`-0.15`) exists
- **Missing**: session-level node creation, session → outcome edge linking, session summary distillation

### Section 10: Cost Optimization
**Status**: ⚠️ PARTIAL (ledger exists, session attribution missing)
- `workforceCostCacheLedgerStore` tracks per-call costs with laneId
- Cache efficiency computed in `aggregateCosts()`
- **Missing**: cost attribution per session, per-seller cost tracking (ledger has no seller_id)

### Section 11: Daemon Scheduler Enhancement
**Status**: ✅ EXISTS (scheduler supports the pattern)
- `startDaemonScheduler()` already dispatches per laneId × sellerId
- Parallel execution with error isolation
- Per-cycle reader cache
- `DaemonHandler` signature is extensible via optional params
- **What changes**: session-aware dispatch (check if session should be active before dispatching), session lifecycle hooks (onWake, onSleep)

### Section 12: CEO Inbox Integration
**Status**: ✅ EXISTS (inbox already handles proposals)
- `CeoInboxStore` supports seller-scoped proposals
- Scheduler already persists CEO messages to inbox
- **What changes**: include session_id in proposals, group by session

### Section 13: Agent Self-Reporting
**Status**: ❌ NOT BUILT
- No agent introspection tools exist
- Need: tool for agents to query their own session state, routine config, recent activity

### Section 14: Experience Aggregation
**Status**: ❌ NOT BUILT
- No cross-session aggregation exists
- Need: `AgentSessionStore.aggregateBySeller(sellerId)` → session summaries, lesson extractor

### Section 15: Testing
**Status**: ✅ PATTERNS EXIST (infrastructure ready)
- Vitest + better-sqlite3 `:memory:` for store tests
- FakeTransport/FixtureTransport for LLM mocking
- `createAgentLoop({ mockClient: true })` for agent tests
- **Need**: session lifecycle tests, cache-hit verification tests, cross-seller isolation tests

---

## 8. File Structure (Existing Package Layout)

```
packages/
  agent/src/
    conversation/
      agentLoop.ts            — CEO conversational loop, tool registration, LLM usage recording
      agentMessageBusStore.ts — Message bus with dedupe, claim, resolve, lifecycle
      agentConsensusStore.ts  — Multi-agent review consensus
      ceoInboxStore.ts        — CEO proposal inbox with Telegram routing
      companyAgentStore.ts    — Durable company agent registry
      companyAgentLearningStore.ts — Agent lessons/learning records
      companyAgentSkillStore.ts    — Agent skill declarations
      companyAgents.ts        — CompanyAgent types, CompanyAgentRegistry, listCompanyAgents()
      workforceCostCacheLedgerStore.ts — LLM cost & cache hit tracking
      creativeJobQueueStore.ts — Creative asset job pipeline
      accountAssetStore.ts    — Account asset/capability/risk/opportunity storage
      sessionStore.ts         — Conversation session persistence
      strategyStore.ts        — CEO strategy rules
      lanes.ts               — LaneId type, LANE_CONTRACTS, LaneContract, CacheTelemetry
      types.ts               — AgentProposal, ConversationState, AutonomyLevel, etc.
      deepseekClient.ts       — Singleton DeepSeek OpenAI client
      deepseekRuntime.ts      — Runtime config resolution
      guardrails.ts           — Spanish validator, harmful content filter, autonomy gate
      selfVerify.ts           — Calibrated trust self-verification
      systemPrompt.ts         — System prompt construction
      cacheBlocks.ts          — Block B/C injection (Cortex context, operational evidence)
      escribano.ts            — Memory scribe observer (Hebbian writes to Cortex)
      tools.ts                — Internal workforce tools (delegate, request evidence, etc.)
      syncTools.ts            — MercadoLibre business tools (40+)
      supplierMirrorTools.ts  — Supplier mirror tools
      ownedEcommerceTools.ts  — Owned ecommerce tools
      probeDetector.ts        — Honey-pot probe detection
      actorSimulator.ts       — Actor simulation
      operationalDataSource.ts — Daily operational aggregates
      operationalEvidenceProvider.ts — Lane-scoped evidence provider
      backgroundIngestion.ts  — Background data ingestion loop
      learningPipeline.ts     — Outcome scoring pipeline
      transports/
        deepseekTransport.ts   — Transport interface + real/fake/fixture implementations
        deepseekFactory.ts     — Transport from env
        deepseekErrors.ts      — Error types
      loop/                   — Extracted loop modules (builders, clients, metrics, turnResolution)
      ingestion/              — Ingestion processors, analysis, insights
    reasoning/                — DeepSeek reasoning gateway, cost estimator, model router
    runtime/                  — Owned ecommerce executor
    workers/
      daemonScheduler.ts      — Scheduler: tick gen, dispatch, CEO consumption
      daemonTypes.ts          — DaemonHandler, CeoHandlerContext, DaemonResult
      operationsManagerDaemon.ts — Claims/questions/orders/reputation monitoring
      marketCatalogDaemon.ts  — Catalog/stock/rotation analysis
      costSupplierDaemon.ts   — Margin/cost/restock analysis
      creativeAssetsDaemon.ts — Creative quality/moderation
      creativeCommercialDaemon.ts — Commercial/campaign analysis
      creativeStudioDaemon.ts — MiniMax asset generation
      productAdsMonitorDaemon.ts — Ad performance monitoring
      productAdsProfitabilityDaemon.ts — Per-product ad economics
      ceoProfitabilityHandler.ts — CFO-grade ad profitability → Telegram
      supplierManagerDaemon.ts — Stock gaps, price shifts
      morningReportDaemon.ts  — Daily briefing
      eodSummaryDaemon.ts     — End-of-day summary
      ownedEcommerceDaemon.ts — Medusa storefront monitoring
      unansweredQuestionsDaemon.ts — Question aging
      dlqMonitorDaemon.ts     — Dead letter queue monitor
      systemHealthDaemon.ts   — System health checks
      ceoDeepSeekClient.ts    — CEO-specific DeepSeek client (deprecated? mostly unused)
      productAdsShared.ts     — Shared Product Ads utilities
      minimaxRetryPolicy.ts   — MiniMax retry configuration
    index.ts                  — Public API exports

  memory/src/
    connectionPool.ts         — Shared SQLite singleton
    backup.ts                 — Database backup
    operationalReadModel.ts   — Snapshot store (search, upsert, freshness)
    supplierMirrorStore.ts    — Supplier registry, items, mappings, policies
    ownedEcommerceStore.ts    — Storefront projections, approvals, executions
    supplierMirrorCortexBridge.ts — Supplier → Cortex ingestion
    supplierMirrorRuntime.ts  — Runtime singleton
    cortex/
      database.ts             — Schema + migration
      engine.ts               — Graph engine (Hebbian, spreading, pruning, query)
      types.ts                — GraphNode, GraphEdge, TraversalResult, etc.
      feedback.ts             — Cortex feedback decisions
      index.ts                — Re-exports
    index.ts                  — Public API exports

  domain/src/
    (17 domain type files: seller, listing, order, claim, reputation, message, etc.)
    index.ts

  mercadolibre/src/           — ML API client, MLC client, sync engine
  mcp/src/                    — MCP server exposing business tools
  creative-studio/src/        — MiniMax integration, image generation
  workers/src/                — Background workers (supplier mirror, owned ecommerce)
  tools/src/                  — Shared tool utilities (ApprovalQueueRepository)
  bot/src/                    — Telegram bot
  ecommerce-medusa/src/       — Medusa ecommerce integration

apps/
  web/                        — Next.js demo app
```

---

## Recommendation

The existing architecture is well-prepared for this change:

1. **Session store** should follow the `workforceCostCacheLedgerStore` pattern (entry table + rollups) with `seller_id` from day one
2. **Daemon handler signature** doesn't need breaking changes — add optional `sessionStore` and `routineConfig` params to `DaemonHandler`
3. **Cortex session recording** can leverage `getOrCreateNode()` with `sellerId` + `reinforceEdge()` for Hebbian learning — same patterns as Escribano
4. **Cache-friendly prompts** should extend the `DeepSeekTransport` `extra_body` pattern with `disk_cache_ttl` (DeepSeek supports this)
5. **Scheduler enhancement** is additive: the existing `enqueueDaemonTick` per laneId × sellerId is the correct dispatch point; add session-awareness to the dispatch loop
6. **Cross-account isolation** is already proven in the existing infrastructure — all new stores/tables MUST include `seller_id` column

### Ready for Proposal

**Yes.** The infrastructure is solid, the patterns are consistent, and the gaps are clearly identified. The change is primarily additive:

- 2-3 new stores (session store, routine config store, possibly session-lesson store)
- Daemon scheduler enhancement (session-aware dispatch)
- Prompt construction optimization per agent
- Cortex session node recording
- No breaking changes to existing handlers, stores, or types
