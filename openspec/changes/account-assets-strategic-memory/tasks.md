# Tasks: Account Assets & Strategic Memory Scoping

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

| PR | Focus | ~Lines |
|----|-------|--------|
| 1 | Domain types + 8 store migrations | 450 |
| 2 | Cortex migrations + engine scoping | 600 |
| 3 | Daemons + autonomy rebuild + approval | 550 |
| 4 | AccountAssetStore + tests + docs | 500 |

## PR 1 — Foundation: Domain Types + Store Migrations

- [x] 1.1 Create `packages/domain/src/accountAsset.ts` — `AccountAsset`, `AccountCapability`, `AccountHealthSnapshot`, `AccountStrategy`, `AccountRisk`, `AccountOpportunity`, `MemoryScope` types. Export from `packages/domain/src/index.ts`. **Spec**: account-asset-model (all)
- [x] 1.2 Add `seller_id?: string` to `GraphNode`/`GraphEdge`/`DarwinianLesson` in `packages/memory/src/cortex/types.ts`. **Gate fix #3**.
- [x] 1.3 Migrate `strategyStore.ts` — `ALTER TABLE ceo_strategies ADD COLUMN seller_id TEXT NOT NULL DEFAULT 'unknown'` (idempotent). Optional `sellerId` on `listActive()`. **Spec**: account-asset-model (AccountStrategy scoping)
- [x] 1.4 Migrate `autonomyEngine.ts` — `ALTER TABLE kpi_history`, `degradation_events ADD COLUMN seller_id TEXT` (idempotent). Defer `autonomy_state` rebuild to PR3. **Spec**: autonomy-engine (KPI/degradation)
- [x] 1.5 Migrate `agentConsensusStore.ts` — `ALTER TABLE agent_reviews ADD COLUMN seller_id TEXT`. Optional `sellerId` on `getConsensus()`. New `getConsensusBySeller()`. **Spec**: agent-consensus (all)
- [x] 1.6 Migrate `companyAgentLearningStore.ts` — `ALTER TABLE company_agent_lessons ADD COLUMN seller_id TEXT`. Optional `sellerId` on `getLessonsByAgent()`. New `getLessonsBySeller()`. **Spec**: learning-pipeline (all)
- [x] 1.7 Migrate `packages/tools/src/index.ts` — `ALTER TABLE approval_queue_entries`, `approval_records`, `audit_records ADD COLUMN seller_id TEXT DEFAULT ''`. Backfill from `action_json.sellerId`. New `listPendingBySeller()`, `getEntryForSeller()`. **Spec**: action-approval-safety (schema, queries)

## PR 2 — Cortex: Seller Scoping + Engine API

- [ ] 2.1 Migrate `nodes`: `ALTER TABLE ADD COLUMN seller_id TEXT DEFAULT 'unknown'` + `CREATE INDEX idx_nodes_seller` (idempotent with `PRAGMA table_info` guard). **Spec**: neural-graph-memory (node schema)
- [ ] 2.2 Migrate `edges` + `darwinian_lessons`: `ALTER TABLE ADD COLUMN seller_id TEXT` on both (idempotent). **Gate fix #1**. **Spec**: neural-graph-memory (graph schema)
- [ ] 2.3 Scope engine in `packages/memory/src/cortex/engine.ts` — `createNode`, `getOrCreateNode`, `queryByMetadata` accept optional `sellerId`. New `getNodesBySeller()`. **Spec**: neural-graph-memory (creation, query)
- [ ] 2.4 Scope Hebbian — `reinforceEdge`/`penalizeEdge` validate source/target share `sellerId`. Cross-seller requests rejected. **Spec**: neural-graph-memory (scoped-hebbian)
- [ ] 2.5 Scope spreading — `spread()` accepts `sellerId` in `SpreadingOptions`. CTE filters `WHERE nodes.seller_id = ? OR NULL`. **Spec**: neural-graph-memory (scoped-spreading)
- [ ] 2.6 Scope Darwinian — `prune(sellerId?)` evaluates only edges whose both endpoints match `sellerId`. **Spec**: neural-graph-memory (scoped-darwinian)
- [ ] 2.7 Seed AccountAsset node — `getOrCreateNode("account_asset:{sellerId}")` with edges to listing/order/claim/strategy/lesson nodes. **Spec**: learning-pipeline (cortex-chain)

## PR 3 — Daemon Iteration + Autonomy + Approval

- [ ] 3.1 Add `AgentAccountContext { sellerId: SellerId, asset?: AccountAsset }` to `packages/agent/src/conversation/types.ts`. **Gate fix #3**. **Spec**: daemon-scheduler, conversational-business-agent (context types)
- [ ] 3.2 Add `accountContexts: Map<string, AccountAsset>` to `DaemonHandler` input in `daemonTypes.ts`. **Spec**: daemon-scheduler (per-seller-dispatch)
- [ ] 3.3 Update `daemonScheduler.ts` — build `accountContexts`; per-seller dedupe keys `(laneId, sellerId)`; dispatch handler per `sellerId`. **Spec**: daemon-scheduler (dispatch, dedupe)
- [ ] 3.4 Update 14 daemon handlers in `packages/agent/src/workers/*.ts` — iterate `sellerIds`; scope `OperationalReadModel` queries per seller. **Spec**: daemon-scheduler (scoped-evidence)
- [ ] 3.5 Rebuild `autonomyEngine.ts` — drop `CHECK(id=1)`; new schema `autonomy_state(seller_id TEXT PRIMARY KEY, current_level, updated_at)`; migrate existing data to `seller_id='default'`. `getCurrentLevel(sellerId)`, `setLevel(sellerId,...)`, `evaluateDegradation(sellerId)`. **Gate fix #4**. **Spec**: autonomy-engine (all)
- [ ] 3.6 Wire `AgentLoopConfig.accountContext` in `agentLoop.ts` — inject into system prompt, tool context, outcome attribution, Escribano. **Spec**: conversational-business-agent (context, attribution)
- [ ] 3.7 Update `systemPrompt.ts` — inject account name, capabilities, `profitGoal`, `riskLevel` into Block A when context present. **Spec**: conversational-business-agent (aware-prompt)
- [ ] 3.8 Wire per-account "dale" in `packages/bot/src/index.ts` — `listPendingBySeller(botSellerId)`; multi-account ambiguity: "¿para cuál cuenta?". **Spec**: action-approval-safety (dale)

## PR 4 — AccountAssetStore + Validation + Documentation

- [ ] 4.1 Create `packages/agent/src/conversation/accountAssetStore.ts` — 7 SQLite tables (all with `seller_id TEXT NOT NULL`). Idempotent `CREATE TABLE IF NOT EXISTS`. Factory returns `AccountAssetStore` with 15 methods. **Spec**: account-asset-store (all)
- [ ] 4.2 Create `config/account-assets.seed.json` — Plasticov (MLC, goal 40%, low) + Maustian (MLC, goal 50%, medium) with capabilities. **Spec**: account-asset-store (per-account)
- [ ] 4.3 Create `scripts/seed-account-assets.ts` — seed via `upsertAccountAsset()`
- [ ] 4.4 Write integration tests — store CRUD, `compareAccounts()`, health history, global visibility, Cortex scoping, autonomy per-seller, "dale" ambiguity (12 spec scenarios). **Spec**: account-asset-store, neural-graph-memory, autonomy-engine, action-approval-safety
- [ ] 4.5 Full suite: `npm test && npm run typecheck && npm run lint` — 2085 tests green
- [ ] 4.6 Update `ARCHITECTURE.md` — AccountAsset model, column scoping, Cortex subgraph, daemon per-seller flow
- [ ] 4.7 Create `docs/audits/account-assets-addendum.md` — migration audit, backfill rationale, rollback plan

## Deferred (No Migration Needed)

| Store | Rationale |
|-------|-----------|
| CreativeJobQueueStore | Already has `seller_id TEXT NOT NULL` in schema |
| WorkforceCostCacheLedgerStore | No ALTER needed — `sellerId` injected via `metadata` field |
| CompanyAgentStore / SkillStore | Agents are company-level; deferred per design open question |
