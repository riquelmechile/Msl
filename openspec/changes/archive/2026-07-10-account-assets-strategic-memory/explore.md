# Exploration: account-assets-strategic-memory

**Date**: 2026-07-09
**Base commit**: `b5a211c` (`feat(runtime): wire production providers and secrets readiness (#122)`)
**Artifact store**: openspec

---

## Current State

### Package Inventory

| Package | Role |
|---------|------|
| `domain` | TypeScript domain types for seller, listing, order, message, claim, reputation, stock, approval, audit, cache, preparedAction |
| `memory` | SQLite persistence: Cortex graph engine, operational read model, supplier mirror store, owned ecommerce store |
| `agent` | Conversation agent (agentLoop, systemPrompt, tools), daemon scheduler with 14 handlers, strategic stores (strategies, autonomy, consensus, lessons, workforce ledger, session, inbox) |
| `tools` | Approval queue repository (SQLite), write action execution with safety gates |
| `mercadolibre` | ML API client + OAuth token store (AES-256-GCM encrypted), sync engine |
| `bot` | Telegram bot runtime that wires agentLoop + Cortex + operational reader per seller |
| `workers` | Creative studio, supplier mirror, insights, owned ecommerce workers |
| `mcp` | MCP server with all MercadoLibre tools |

### Domain Types — sellerId Usage

**`Packages/domain/src/seller.ts`** defines:
- `SellerId = string` — the foundation type
- `SellerAccount = { id: SellerId, site: MarketplaceSite, displayName, connectedAt, accessStatus }`
- `SellerPreference = { sellerId, topic, rule, learnedFrom, confidence, updatedAt }`

All operational domain types already carry `sellerId`:
- `Listing`, `ListingSnapshot`, `Order`, `Message`, `Claim`, `Reputation`, `Stock`, `SpecializationEvidence`
- `PreparedAction.sellerId` — every proposed action is scoped
- `ApprovalRecord.sellerId` — scoped to action's sellerId
- `AuditRecord.sellerId` — scoped to action's sellerId
- `OperationalEvidenceQuery.sellerId` — required for every snapshot query

**Gap**: There is no `AccountAsset` domain type or `AccountCapability` type. The concept of an account as a strategic entity with capabilities, profit goals, and risk level does not exist.

### Store Inventory — seller_id Status

**ALREADY SELLER-SCOPED (operational data — touch ML API):**

| Store | Table | seller_id |
|-------|-------|-----------|
| OperationalReadModel | `operational_snapshots` | ✅ PK `(seller_id, item_id, kind)` |
| OperationalReadModel | `ingestion_checkpoints` | ✅ PK `(seller_id, kind)` |
| AgentMessageBusStore | `agent_message_bus` | ✅ column `seller_id` |
| CeoInboxStore | `agent_proposals` | ✅ column `seller_id` NOT NULL |
| SupplierMirrorStore | `item_mappings`, `scope_policies`, `price_history` | ✅ uses `target_seller_id` |

**NOT SELLER-SCOPED (strategic data — the core gap):**

| Store | Table | Files Affected |
|-------|-------|---------------|
| Cortex/GraphEngine | `nodes` | `memory/src/cortex/database.ts`, `engine.ts` |
| Cortex/GraphEngine | `edges` | `memory/src/cortex/database.ts`, `engine.ts` |
| Cortex/GraphEngine | `darwinian_lessons` | `memory/src/cortex/database.ts`, `engine.ts` |
| StrategyStore | `ceo_strategies` | `agent/src/conversation/strategyStore.ts` |
| AutonomyEngine | `autonomy_state` | `agent/src/conversation/autonomyEngine.ts` |
| AutonomyEngine | `kpi_history` | `agent/src/conversation/autonomyEngine.ts` |
| AutonomyEngine | `degradation_events` | `agent/src/conversation/autonomyEngine.ts` |
| AgentConsensusStore | `agent_reviews` | `agent/src/conversation/agentConsensusStore.ts` |
| CompanyAgentLearningStore | `company_agent_lessons` | `agent/src/conversation/companyAgentLearningStore.ts` |
| CompanyAgentStore | `company_agents` | `agent/src/conversation/companyAgentStore.ts` |
| CompanyAgentSkillStore | `agent_skills` | `agent/src/conversation/companyAgentSkillStore.ts` |
| WorkforceCostCacheLedgerStore | `workforce_cost_cache_ledger` | `agent/src/conversation/workforceCostCacheLedgerStore.ts` |
| CreativeJobQueueStore | `creative_jobs` | `agent/src/conversation/creativeJobQueueStore.ts` |
| ApprovalQueue (tools) | `approval_queue_entries` | `packages/tools/src/index.ts` |
| ApprovalQueue (tools) | `approval_records` | `packages/tools/src/index.ts` |
| ApprovalQueue (tools) | `audit_records` | `packages/tools/src/index.ts` |

### Agent Architecture

**Daemon Scheduler** (`packages/agent/src/workers/daemonScheduler.ts`):
- 14 daemon handlers registered in `daemonHandlerMap`
- CEO is a proposal sink (no handler)
- Daemons receive `sellerIds: string[]` from config but most don't iterate per seller
- `CeoHandlerContext` has `sellerNames?: Record<string, string>` for human-readable names
- The scheduler enqueues per-lane ticks via `enqueueDaemonTick()` with hourly dedupe keys

**DaemonHandler signature** (from `daemonTypes.ts`):
```typescript
DaemonHandler = (input: {
  claim: AgentMessage; reader: OperationalReadModelReader;
  cortex: GraphEngine; bus: AgentMessageBusStore;
  sellerIds: string[]; // ← already passed, but few handlers use it per-seller
  ceoContext?: CeoHandlerContext;
  // ... optional advisors
}) => Promise<DaemonResult>;
```

**AgentLoop** (`packages/agent/src/conversation/agentLoop.ts`):
- `AgentLoopConfig` has `sellerId?: string` — single-seller binding at construction
- Session state is scoped: `ConversationState.sessionMetadata.sellerId`
- "dale" confirmation matches regex `/^dale\b|^s[iíí]\b|.../` — NO per-seller context in the approval resolution
- DeepSeek cache context uses `sellerId` for workforce cost tracking

### Cortex Current State

**Graph Schema** (`memory/src/cortex/database.ts`):
- `nodes(id, label, activation, metadata)` — JSON metadata carries sellerId ad-hoc for some node types
- `edges(id, source, target, weight, last_activated, co_occurrence_count, distilled_lesson)`
- `darwinian_lessons(id, source_node, target_node, lesson, archived_at, reason)`
- No `seller_id` on any table

**How seller context leaks into Cortex today:**
- `Escribano` creates `proposal_outcome_*` nodes with `sellerId` in metadata JSON
- `queryByMetadata()` can filter by `JSON_EXTRACT(metadata, '$.sellerId')`
- Supplier mirror ingestion creates nodes with `sellerId` in metadata

**What Cortex CAN'T do today (due to no seller scoping):**
- List all nodes for a specific seller
- Scope Hebbian reinforcement to per-seller edges
- Darwinian pruning cannot be seller-aware
- Two sellers' strategic patterns contaminate each other in the same graph

### Approval Queue

**Schema** (`packages/tools/src/index.ts`):
```sql
approval_queue_entries(action_id PK, action_json, requested_at, highlighted_risk, status)
approval_records(action_id PK, approval_json, approved_at)
audit_records(id PK, action_id, audit_json, recorded_at)
```
- `action_json` serializes the full `PreparedAction` which HAS `sellerId`
- But tables themselves have no `seller_id` column — can't query "all pending approvals for seller X"
- `canExecutePreparedAction()` DOES check `approval.sellerId !== action.sellerId` (cross-seller enforcement)

**The "dale" flow:**
1. User says "dale" in Telegram → `bot.on("message:text")` resolves sellerId from config
2. AgentLoop matches regex `isConfirmationPattern()` and resolves `extractPendingProposal()`
3. If pending proposal exists → `turnResolution.ts` marks outcome `"confirmed"`
4. Escribano observes outcome and reinforces/penalizes Cortex edges
5. **No per-seller approval context**: "dale" always resolves against the bot's configured `sellerId`

### Hardcoded Seller References

- **Bot**: `env.MSL_CHAT_SELLER_ID` defaults → `env.MERCADOLIBRE_TARGET_SELLER_ID` → `"telegram-demo"`; `sellerName` defaults to `"Plasticov"`
- **Bot startup**: `MSL_CHAT_SELLER_NAME` env var → defaults to `"Plasticov"`
- **System prompt**: references `plasticov` and `maustian` as example values
- **MCP sync tools**: hardcoded `plasticovToMaustianDirection` direction assertion
- **Test fixtures**: `"seller-plasticov"` and `"seller-maustian"` are common test values
- **Bot Cortex path**: `createSellerScopedSqlitePath()` isolates DB per seller (file-level isolation)

**No production logic hardcodes Plasticov/Maustian as seller IDs** — they're all env-configurable. The MCP sync direction assertion is the closest to "hardcoded business logic."

### Existing Scoping Patterns

1. **Bot DB isolation**: `createSellerScopedSqlitePath(sqlitePath, sellerId)` — suffixes the DB file with `telegram-{sanitizedSellerId}`. This gives each seller its own Cortex + strategy + autonomy file.
2. **`futureOpts.ts`**: Already has `MultiSellerIsolation` stub interface with explicit docs: "When implemented, all Cortex tables, strategies, sync state, and autonomy levels will carry a `seller_id` column."
3. **`backgroundIngestion.ts`**: Properly loops `for (const sellerId of config.sellerIds)` — good pattern to follow.
4. **`OperationalReadModel`**: Every query requires `sellerId: SellerId` — gold standard.

---

## Gap Analysis

### Store-by-Store Gap

| Store | Gap | Effort |
|-------|-----|--------|
| Cortex (nodes/edges/lessons) | No `seller_id` column; metadata-only ad-hoc | **HIGH** — needs schema migration + engine API changes |
| StrategyStore (`ceo_strategies`) | No `seller_id`; all CEO strategies are global | MEDIUM — ALTER TABLE + migration |
| AutonomyEngine | No `seller_id` on `autonomy_state`, `kpi_history`, `degradation_events` | MEDIUM — singleton state becomes per-seller |
| AgentConsensusStore | No `seller_id` on `agent_reviews` | MEDIUM — ALTER TABLE + migration |
| CompanyAgentLearningStore | No `seller_id` on `company_agent_lessons` | LOW-MEDIUM — table already scoped by agentId |
| CompanyAgentStore | No `seller_id` on `company_agents` | LOW — agents are company-level, not seller-level |
| WorkforceCostCacheLedgerStore | No direct `seller_id` (has `agentId`) | LOW — can inject via metadata |
| CreativeJobQueueStore | No `seller_id` | LOW — job requests can carry sellerId in payload |
| ApprovalQueue (tools) | Tables lack `seller_id` column (data in JSON) | MEDIUM — ALTER + schema |
| ApprovalQueue (audit) | `audit_records` lacks `seller_id` | LOW — audit record already has `sellerId` in JSON |

### What's Missing vs. Target Architecture

1. **AccountAsset domain model** → Does not exist. Need: `AccountAsset`, `AccountCapability`, `AccountHealthSnapshot`, `AccountStrategy`, `AccountRisk`
2. **AccountAssetStore** → Does not exist. Would be a new store.
3. **Cortex account-as-strategic-node** → Partially possible today with metadata. No first-class node type.
4. **Memory scoping** → `futureOpts.ts` has the stub but no implementation.
5. **Agent account context** → `sellerIds: string[]` is passed to daemons but most don't iterate.
6. **Agent work sessions** → No periodic routine framework exists for session-scoped agent loops.
7. **CEO account dashboard** → Not in codebase. Only routing to Telegram exists.
8. **Account capabilities** → Does not exist as a typed concept.
9. **Approval queue scoping** → Tables lack `seller_id`; "dale" doesn't resolve per-account.
10. **Learning loop per account** → `CompanyAgentLearningStore` scopes by `targetAgentId` but not by `sellerId`.

---

## Implementation Feasibility

### Compatibility Assessment

**High confidence — the architecture supports it.** Evidence:

1. The `SellerId` type is already ubiquitous in domain types.
2. `OperationalReadModel` already demonstrates correct per-seller query patterns.
3. `backgroundIngestion` already demonstrates correct per-seller iteration.
4. `futureOpts.ts` already documents the `MultiSellerIsolation` intention.
5. The bot already has `createSellerScopedSqlitePath` — proves per-seller-isolation is a design goal.
6. Cortex's `metadata` JSON already carries ad-hoc `sellerId` on some nodes.
7. `ApprovalRecord.sellerId` already enforces cross-seller execution check in `canExecutePreparedAction()`.

### Migration Complexity

| Component | Migration Strategy | Risk |
|-----------|-------------------|------|
| Cortex nodes/edges | ALTER TABLE ADD COLUMN `seller_id TEXT`; backfill from metadata JSON where available; default `'unknown'` for existing rows | MEDIUM |
| StrategyStore | ALTER TABLE ADD COLUMN `seller_id TEXT NOT NULL DEFAULT 'unknown'` | LOW |
| AutonomyEngine | The singleton pattern must change — `autonomy_state` single row per seller instead of single global row | MEDIUM |
| AgentConsensusStore | ALTER TABLE ADD COLUMN `seller_id TEXT` | LOW |
| CompanyAgentLearningStore | ALTER TABLE ADD COLUMN `seller_id TEXT` | LOW |
| ApprovalQueue | ALTER TABLE ADD COLUMN `seller_id TEXT DEFAULT ''`; extract from action_json for backfill | LOW |
| WorkforceLedger | Can inject via metadata column — no schema change needed | VERY LOW |
| AgentMessageBusStore | Already has `seller_id` — no change needed | NONE |

### Existing Patterns to Leverage

1. **`futureOpts.ts:54` — `MultiSellerIsolation` type** — the interface stub already exists, can expand it
2. **`OperationalReadModel.searchSnapshots()`** — already models `sellerId` as a required filter param — reuse pattern for Cortex queries
3. **`backgroundIngestion.processSellerListings()`** — already shows proper per-seller iteration with error isolation
4. **`Escribano`** — already writes `sellerId` into Cortex node metadata, showing the pattern works
5. **Bot's `createSellerScopedSqlitePath()`** — already isolates DB per seller at file level; the column-level scoping would complement this

### Cortex Extension Feasibility

Cortex can be extended with AccountAsset nodes **without breaking the existing graph**:
- New node label: `account_asset:{sellerId}` — can be `getOrCreate`'d idempotently
- Edges from account node → listing, order, claim, strategy, lesson nodes already work with existing APIs
- `queryByMetadata()` already supports `sellerId` filtering via JSON_EXTRACT
- `spread()` (activation spreading) works on any node — account node would be a natural seed

---

## Risk Assessment

### Data Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Existing strategic data has no seller assignment → backfill defaults | **MEDIUM** | LOW | Default `'unknown'` seller; over time as agents write new data, it will be scoped |
| AutonomyEngine singleton → per-seller migration | **MEDIUM** | MEDIUM | Must preserve existing autonomy level as default; auto-migrate to "default" seller scope |
| ApprovalQueue entries in production with no seller_id | **LOW** | MEDIUM | Extract from `action_json` during migration; approval queue entries are short-lived |
| Cross-seller contamination in existing Cortex graph | **MEDIUM** | MEDIUM | Backfill is best-effort from metadata; after migration, new writes are scoped |

### Migration Risks

| Risk | Severity |
|------|----------|
| ALTER TABLE on large Cortex DB (1000s of nodes) — migration time | LOW — SQLite ALTER is fast for small-medium DBs |
| Breaking existing tests that don't pass `sellerId` to strategic stores | MEDIUM — test fixture updates needed, but controlled |
| Daemon handlers not iterating per-seller causing single-seller behavior | MEDIUM — needs code changes in 14 handlers but the pattern is simple |
| "dale" ambiguity if two chats for different sellers — this already exists today | LOW — bot binds to one sellerId per instance |

### Regression Risks

- **Test suite**: 2085 tests across 95 files. Many tests inject `sellerId: "seller-1"` or `"seller-plasticov"`. After migration, strategic stores will require `sellerId` — tests will need updating.
- **Backward compatibility**: Old DBs without `seller_id` column will need migration to add it. Migration must be idempotent (check column exists before ALTER).
- **Bot instances**: Each bot instance binds to one seller. Column scoping shouldn't break this — it's additive safety.

---

## Recommended Approach

### Implementation Order

**Phase 1 — Foundation (low-risk, unblocks everything):**
1. Create `AccountAsset` domain type with `sellerId`, `name`, `marketplace`, `capabilities`, `profitGoal`, `riskLevel`
2. Add `MemoryScope` type (`"global" | "account"`) to domain
3. Migrate strategic store schemas to add `seller_id` columns (with `'unknown'` defaults)
4. Update store factory functions to accept/require `sellerId` parameter

**Phase 2 — Cortex:**
5. Add `seller_id TEXT` column to Cortex `nodes` table
6. Create `AccountAsset` node type with edges to strategic data
7. Scope `queryByMetadata`, `spread`, `traverse` to accept optional `sellerId`

**Phase 3 — Agent Context:**
8. Update `DaemonHandler` input to include per-seller context
9. Have daemons iterate per-seller when generating findings
10. Wire `agentAccountContext` into `AgentLoopConfig`

**Phase 4 — Approval Queue Scoping:**
11. Add `seller_id` to approval/audit tables
12. Wire "dale" resolution to account-scoped pending actions
13. Expose `listPendingBySeller()` in approval queue repository

**Phase 5 — Learning Loop & Dashboard:**
14. Scope `CompanyAgentLearningStore` by `sellerId`
15. Implement account-level lesson attribution
16. Build CEO dashboard query layer (read-only — no new UI yet)

**Phase 6 — Tests & Documentation:**
17. 12 test scenarios from requirements
18. Architecture doc + audit addendum

### Key Design Decisions for Proposal Phase

1. **Column vs. DB file isolation**: Keep current file-level isolation (bot pattern) AND add column-level scoping. They're complementary, not competing.
2. **`MemoryScope` design**: Should it be a column flag or a separate type? Recommend: column-level `seller_id` with `NULL = global`.
3. **AutonomyEngine per-seller**: Singleton becomes per-seller, keyed by `(seller_id)`. Current global value becomes default for `'default'` seller.
4. **Daemon per-seller iteration**: Each daemon should iterate `sellerIds` and scope its OperationalReadModel queries + proposal sending per seller — OR we could make the scheduler dispatch per-seller ticks. The iteration approach is simpler.
5. **DeepSeek cache for work sessions**: Already partially addressed — `AgentLoopConfig` can have a persisted session per seller with stable system prompt. Cache context plugin pattern exists.

---

## Files to Change

### Domain (`packages/domain/src/`)
- `seller.ts` — Add `AccountAsset`, `AccountCapability`, `AccountHealth`, `AccountStrategy`, `AccountRisk`, `MemoryScope`
- `index.ts` — Export new types

### Memory (`packages/memory/src/`)
- `cortex/database.ts` — Add `seller_id` column migration to `nodes` table
- `cortex/engine.ts` — Add `sellerId` param to `createNode`, `queryByMetadata`, `spread`, `traverse`
- `cortex/types.ts` — New `AccountAssetNode` type
- `cortex/feedback.ts` — Scope feedback decisions by sellerId
- `operationalReadModel.ts` — No change needed (already scoped)
- `index.ts` — Export new types

### Agent (`packages/agent/src/`)
- `workers/daemonTypes.ts` — Add `accountContext` to `DaemonHandler` input
- `workers/daemonScheduler.ts` — Dispatch per-seller context
- `workers/*.ts` (14 files) — Per-seller iteration in daemon handlers
- `conversation/strategyStore.ts` — Add `seller_id` column + scoped queries
- `conversation/autonomyEngine.ts` — Per-seller autonomy state
- `conversation/agentConsensusStore.ts` — Add `seller_id` column
- `conversation/companyAgentLearningStore.ts` — Add `seller_id` column
- `conversation/workforceCostCacheLedgerStore.ts` — Add `seller_id` to metadata or column
- `conversation/agentLoop.ts` — Wire account context into agent loop
- `conversation/escribano.ts` — Already writes sellerId — may need updates for new patterns
- `conversation/systemPrompt.ts` — Update seller references in prompt
- `conversation/futureOpts.ts` — Mark `MultiSellerIsolation` as implemented
- `conversation/types.ts` — Add account-related types
- `index.ts` — Export new types

### Tools (`packages/tools/src/`)
- `index.ts` — Add `seller_id` to approval/audit tables; expose scoped queries

### Bot (`packages/bot/src/`)
- `index.ts` — Wire account context into agent loop construction; resolve "dale" per-account
- `bot.test.ts` — Updated test fixtures

### MCP (`packages/mcp/src/`)
- `tools/syncTools.ts` — Update direction assertions (minor)

### Tests
- New test files: 12 scenarios from requirements
- Updated test files: Any test creating strategic store records will need `sellerId`

### Documentation
- `ARCHITECTURE.md` — Update with AccountAsset model
- `docs/audits/` — New audit addendum

**Estimated total affected files**: ~35-40 files (including tests)
**Estimated total line changes**: 1500-2500 lines (given the review budget of 800 lines, this must be split into multiple PRs)
