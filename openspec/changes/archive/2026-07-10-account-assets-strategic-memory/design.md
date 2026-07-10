# Design: Account Assets & Strategic Memory Scoping

## Technical Approach

Add `seller_id` to 10 strategic stores via idempotent migrations with `'unknown'` defaults. Introduce `AccountAsset` domain model. Scope Cortex Hebbian/Darwinian/spreading by seller. Per-seller autonomy. Daemon per-seller iteration. Approval "dale" resolved per-account. Column-level scoping complements existing file-level bot isolation.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Column `seller_id` vs. new per-seller DB files | Column scoping lets one DB serve multi-seller for daemons; file isolation stays for bots | **Column — additive to file isolation** |
| `NULL` = global vs. separate `scope` enum | enum adds type safety but complicates ALTER; NULL is SQL-native | **`seller_id TEXT DEFAULT 'unknown'`; existing data defaults to `'unknown'`** |
| AutonomyEngine singleton → per-seller rows | Current `CHECK (id=1)` forces singleton; needs schema change | **Drop `CHECK (id=1)`; add `seller_id` column; PK becomes `(id, seller_id)`** |
| "dale" per-account via NLP vs. explicit selector | NLP fragile; explicit is clearer when ambiguous | **Match seller name from prompt; prompt user when 2+ accounts have pending actions** |

## Data Flow

```
Bot instance (single sellerId)
  └─ AgentLoop.converse(userText)
       ├─ "dale" → AgentLoop resolves approval queue scoped by sellerId
       └─ other   → LLM with accountContext injected via system prompt

Daemon Scheduler (multi-seller)
  └─ for each daemon lane → handler({ sellerIds, accountContexts })
       └─ for each sellerId → scoped queries on OperationalReadModel + Cortex + strategic stores
            └─ proposal enqueued to CEO bus with sellerId in payload
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/domain/src/accountAsset.ts` | **Create** | `AccountAsset`, `AccountCapability`, `AccountHealthSnapshot`, `AccountStrategy`, `AccountRisk`, `AccountOpportunity`, `MemoryScope` |
| `packages/domain/src/index.ts` | Modify | Export new types |
| `packages/memory/src/cortex/database.ts` | Modify | Add migration v2: `ALTER TABLE nodes ADD COLUMN seller_id TEXT DEFAULT 'unknown'`; index on `seller_id` |
| `packages/memory/src/cortex/engine.ts` | Modify | `createNode`, `spreadActivation`, `traverse`, `prune`, `reinforceEdge`, `penalizeEdge` accept optional `sellerId` |
| `packages/agent/src/conversation/strategyStore.ts` | Modify | Add `seller_id TEXT NOT NULL DEFAULT 'unknown'`; scoped `listActive(sellerId?)` |
| `packages/agent/src/conversation/autonomyEngine.ts` | Modify | Drop `CHECK(id=1)`; add `seller_id`; `getCurrentLevel(sellerId)`, seeded per-seller |
| `packages/agent/src/conversation/agentConsensusStore.ts` | Modify | Add `seller_id` column |
| `packages/agent/src/conversation/companyAgentLearningStore.ts` | Modify | Add `seller_id` column; `listAgentLessons` filter |
| `packages/agent/src/workers/daemonTypes.ts` | Modify | Add `accountContexts: Map<string, AccountAsset>` to `DaemonHandler` input |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Build `accountContexts` from `AccountAssetStore`; pass to handlers |
| `packages/agent/src/workers/*.ts` (14 handlers) | Modify | Iterate `sellerIds`; scope queries per-seller |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | `AgentLoopConfig.accountContext?: AccountAsset` |
| `packages/tools/src/index.ts` | Modify | Add `seller_id` to 3 tables; `listPendingBySeller(sellerId)` |
| `packages/bot/src/index.ts` | Modify | Wire `accountContext` into agentLoop; resolve "dale" per-seller |
| `config/account-assets.seed.json` | **Create** | Plasticov + Maustian seed data |
| `scripts/seed-account-assets.ts` | **Create** | Seed runner |

## Database Migrations (idempotent)

Migration pattern: check column existence via `PRAGMA table_info` before `ALTER TABLE ADD COLUMN`.

```sql
-- Cortex nodes (version 2 migration)
ALTER TABLE nodes ADD COLUMN seller_id TEXT DEFAULT 'unknown';
CREATE INDEX IF NOT EXISTS idx_nodes_seller ON nodes(seller_id);

-- StrategyStore
ALTER TABLE ceo_strategies ADD COLUMN seller_id TEXT NOT NULL DEFAULT 'unknown';

-- AutonomyEngine: drop singleton constraint, add seller_id
-- (requires table rebuild since SQLite can't drop CHECK)
-- New schema: autonomy_state(seller_id TEXT PRIMARY KEY, current_level INTEGER, updated_at TEXT)

-- ApprovalQueue: extract sellerId from action_json for backfill
ALTER TABLE approval_queue_entries ADD COLUMN seller_id TEXT DEFAULT '';
-- Backfill: UPDATE approval_queue_entries SET seller_id = JSON_EXTRACT(action_json, '$.sellerId')
```

## Key API Changes

```typescript
// Cortex — scoped graph operations
createNode(label: string, metadata: Record<string, unknown>, sellerId?: string): GraphNode
getOrCreateNode(label: string, metadata: Record<string, unknown>, sellerId?: string): GraphNode
spreadActivation(nodeIds: number[], options?: SpreadingOptions & { sellerId?: string })
prune(options?: { maxNodes?: number; excludeNodeIds?: Set<number>; sellerId?: string })
reinforceEdge(source, target, sellerId?): GraphEdge  // validates both nodes share sellerId
traverse(sellerId?: string): TraversalResult

// StrategyStore — scoped queries
listActive(sellerId?: string): Strategy[]

// AutonomyEngine — per-seller factory changes
createAutonomyEngine(db, config?: { initialLevel?: AutonomyLevel })
getCurrentLevel(sellerId: string): AutonomyLevel  // now required param

// ApprovalQueue — scoped listing
listPendingBySeller(sellerId: string): ApprovalQueueEntry[]

// DaemonHandler — account context
DaemonHandler = (input: {
  // ... existing fields
  accountContexts: Map<string, AccountAsset>;  // NEW
}) => Promise<DaemonResult>;
```

## Cortex Scoping Design

| Feature | Scoping Rule |
|---------|-------------|
| Hebbian `reinforceEdge` | Validates source/target nodes share `sellerId`; cross-seller edges rejected at application level |
| Darwinian `prune` | `WHERE nodes.seller_id = ?` scoped to seller's subgraph; preserves per-seller node caps |
| Spreading activation | Seeds from `account_asset:{sellerId}` node; recursive CTE filters edges by source/target seller scoping |
| Node label pattern | `account_asset:{sellerId}` as the root node for each seller's subgraph |
| Edge types | `account_asset → listing, order, claim, strategy, lesson, opportunity, risk, action` |

## Approval "dale" Flow

```
1. User types "dale" or "dale la de Maustian"
2. Agent extracts seller name from message (regex: /dale.*(?:de|para)\s+(\w+)/i)
3. If name match → resolve to that sellerId from accountContexts
4. If no name + 1 seller has pending → auto-resolve to that seller
5. If no name + 2+ sellers have pending → prompt: "¿Cuál cuenta? Maustian o Plasticov?"
6. "dale" → validate approval via autonomyEngine.canAutoApprove(sellerId, riskLevel)
7. Confirmation → execute action, Escribano records outcome scoped by sellerId
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | Domain types, MemoryScope | Vitest, pure functions |
| Integration | Store CRUD with sellerId | SQLite in-memory, `sellerId: "seller-plasticov"`, no real HTTP |
| Integration | Cortex scoping | `graphEngine.createNode(label, meta, "seller-plasticov")`, verify `queryByMetadata` scoped |
| Integration | Autonomy per-seller | Two `getCurrentLevel("a")`/`getCurrentLevel("b")` returning independent values |
| Integration | Approval scoping | `listPendingBySeller` returns only that seller's entries |
| E2E | "dale" resolution | Mock bot with 2 sellerIds; verify prompt on ambiguity |

## Migration / Rollout

- All migrations idempotent via `PRAGMA table_info` guard before ALTER
- Backfill: `UPDATE nodes SET seller_id = JSON_EXTRACT(metadata, '$.sellerId') WHERE seller_id = 'unknown'`
- Bot instances unaffected — file-level isolation already scopes at DB level
- Rollback: `sellerId` params are additive; removing them restores global behavior
- AutonomyEngine: existing singleton data auto-migrated to `seller_id = 'default'`

## Open Questions

- [ ] Should `CompanyAgentStore` get `seller_id`? Exploration says LOW — agents are company-level. Defer to PR4.
- [ ] Backfill heuristic for nodes without `sellerId` in metadata: use `'unknown'` or try label prefix matching? Default: `'unknown'`, accept best-effort only.
