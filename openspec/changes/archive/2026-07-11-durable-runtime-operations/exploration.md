## Exploration: durable-runtime-operations

### Current State

MSL is a hexagonal-architecture TypeScript monorepo with ~24 SQLite stores spread across 6 packages. The system uses `better-sqlite3` as its sole SQLite driver. A `connectionPool.ts` singleton manages shared database instances with a consistent PRAGMA profile (WAL, busy_timeout=5000, foreign_keys=ON, synchronous=NORMAL, cache_size=-8000K, temp_store=MEMORY). The system runs via 4 PM2 processes: Telegram bot, web, worker-ingestion, and agent-daemons.

**What exists today for durability:** A single `backupDatabase()` function in `packages/memory/src/backup.ts` — clean, uses better-sqlite3's online backup API with optional VACUUM — but it is not wired into any runtime scheduler. The Cortex database has a proper migration framework (`migrate()` with version tracking in `schema_version`), but no other store uses it. All other stores use `CREATE TABLE IF NOT EXISTS` with varying degrees of idempotent column migration (via `columnExists()` guards).

**What's completely missing:** No backup scheduling, no backup verification, no restoration mechanism, no retention/cleanup policies, no `PRAGMA integrity_check` calls anywhere in the codebase, no `PRAGMA wal_checkpoint` management, no structured observability pipeline (only raw `console.log/warn/error`), no operational health endpoints beyond a lightweight `runSystemHealthCheck()`, and no explicit policy for `degraded` capabilities.

**Economic learning daemon** exists as `createEconomicLearningDaemon()` but is NOT registered in the `daemonHandlerMap` — it's dead code until wired in.

---

### SQLite Database Catalog (Complete)

#### Architecture Pattern

There are two distinct patterns for SQLite databases:

1. **Shared via `connectionPool` (`getSharedDb()`)** — The connection pool creates a singleton `better-sqlite3` Database per file path. Multiple stores share the same Database instance. Covers: Cortex, Operational Read Model, Economic Outcome, Economic Learning, Finance Director Assessment, Evidence Request, Owned Ecommerce, Work Sessions, Account Assets, Company Agents, Workforce Cost Cache, Autonomy, Strategy, Session.

2. **Standalone `new Database(path)`** — Creates independent connections. Covers: ML OAuth Token Store, ML Sync Store, Approval Queue, Supplier Mirror (own singleton via `supplierMirrorRuntime.ts`), Agent Message Bus, CEO Inbox, Agent Consensus, Creative Job Queue, Chat DB, Telegram DB.

Additionally, **Cortex database** has its own `createDatabase()` factory with PRAGMAs set directly (same profile). In production, `MSL_CORTEX_SQLITE_PATH` serves as the single physical file that multiple stores share (Cortex graph, operational read model, bus, all agent stores).

#### Store-by-Store Catalog

| # | Store | Factory Function | Package | DB Path (env var) | PRAGMAs | Table Init | Migration Framework | Integrity Check |
|---|-------|------------------|---------|-------------------|---------|------------|---------------------|-----------------|
| 1 | **Cortex Graph** | `createDatabase(path)` | `@msl/memory` | `MSL_CORTEX_SQLITE_PATH` | WAL, FK, sync=NORMAL, cache=-8000, temp_store=MEMORY, busy=5000 | `nodes`, `edges`, `darwinian_lessons`, `actor_simulations`, `probe_results`, `schema_version` | ✅ Versioned (`migrate()` with 2 migrations) + idempotent column ALTER | ❌ None |
| 2 | **Operational Read Model** | `createSqliteOperationalReadModel(db)` | `@msl/memory` | Shared via connPool | Inherits from connPool | `operational_snapshots`, `ingestion_checkpoints` | ✅ `migrateOperationalStore()` with generated columns | ❌ None |
| 3 | **Economic Outcome Store** | `createSqliteEconomicOutcomeStore(db)` | `@msl/memory` | Shared via connPool | Inherits | `economic_outcomes`, `economic_cost_components`, `unit_economics_snapshots` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 4 | **Economic Learning Store** | (factory inside file) | `@msl/memory` | Shared via connPool | Inherits | `economic_learning_events`, `economic_learning_idempotency`, `economic_learning_eligibility`, `economic_attribution_assessments`, `economic_reinforcement_plans` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 5 | **Finance Director Assessment Store** | (factory inside file) | `@msl/memory` | Shared via connPool | Inherits | `finance_director_assessments` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 6 | **Evidence Request Store** | `createSqliteEvidenceRequestStore(db)` | `@msl/memory` | Shared via connPool | Inherits | `evidence_requests`, `evidence_responses`, `evidence_request_links` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 7 | **Supplier Mirror Store** | `createSqliteSupplierMirrorStore(db)` | `@msl/memory` | `MSL_SUPPLIER_MIRROR_DB_PATH` | WAL, FK, sync=NORMAL, cache=-8000, temp_store=MEMORY, busy=5000 (own instance) | `suppliers`, `supplier_items`, `stock_observations`, `item_mappings`, `target_policies`, `sync_ledger`, `notification_preferences`, `notification_events`, `learned_fallback_policies` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 8 | **Owned Ecommerce Store** | `createSqliteOwnedEcommerceStore(db)` | `@msl/memory` | Shared via connPool | Inherits | 8 tables (candidates, projections, validations, approvals, executions, audits, rollback, idempotency) | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 9 | **Agent Message Bus** | `createAgentMessageBusStore(db)` | `@msl/agent` | `MSL_AGENT_BUS_DB_PATH` | Inherits from Cortex `createDatabase()` | `agent_message_bus` | ✅ `migrateBusSchema()` with columnExists guards | ❌ None |
| 10 | **CEO Inbox Store** | `createCeoInboxStore(db)` | `@msl/agent` | Shared with Bus DB | Inherits | `agent_proposals` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 11 | **Agent Consensus Store** | `createAgentConsensusStore(db)` | `@msl/agent` | Shared with Bus DB | Inherits | `agent_reviews` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 12 | **Strategy Store** | `createStrategyStore(db)` | `@msl/agent` | Shared with Chat DB (or Cortex) | Inherits | `ceo_strategies` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 13 | **Session Store** | `createSessionStore(db)` | `@msl/agent` | Shared with Chat DB | Inherits | `sessions` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 14 | **Autonomy Engine** | `createAutonomyEngine(db)` | `@msl/agent` | Shared with Chat DB | Inherits | `autonomy_state`, `kpi_history`, `degradation_events` | ✅ Inline singleton→per-seller migration | ❌ None |
| 15 | **Account Asset Store** | `createAccountAssetStore(db)` | `@msl/agent` | Shared via connPool | Inherits | `account_assets`, `account_capabilities`, `account_health_snapshots`, `account_profit_goals`, `account_strategy_notes`, `account_risks`, `account_opportunities` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 16 | **Work Session Store** | `createAgentWorkSessionStore(db)` | `@msl/agent` | Shared via connPool | Inherits | `agent_work_sessions`, `agent_observations`, `agent_session_proposals`, `agent_session_lessons`, `agent_shift_summaries` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 17 | **Company Agent Store** | `createCompanyAgentStore(db)` | `@msl/agent` | Shared via connPool | Inherits | `company_agents` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 18 | **Company Agent Learning Store** | `createCompanyAgentLearningStore(db)` | `@msl/agent` | Shared via connPool | Inherits | `company_agent_lessons` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 19 | **Company Agent Skill Store** | `createCompanyAgentSkillStore(db)` | `@msl/agent` | Shared via connPool | Inherits | `agent_skills` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 20 | **Workforce Cost Cache Ledger** | (factory inside file) | `@msl/agent` | Shared via connPool | Inherits | `workforce_cost_cache_ledger_entries`, `workforce_cost_cache_ledger_rollups` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 21 | **Creative Job Queue** | `createCreativeJobQueueStore(db)` | `@msl/agent` | `MSL_CREATIVE_STUDIO_DB_PATH` | Inherits | `creative_jobs` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 22 | **Approval Queue** | `createSqliteApprovalQueueRepository(dbPath)` | `@msl/tools` | `MSL_APPROVAL_QUEUE_DB_PATH` | WAL only (own instance) | `approval_queue_entries`, `approval_records`, `audit_records` | ✅ `columnExists()` idempotent column migration | ❌ None |
| 23 | **ML OAuth Token Store** | `createTokenStore(dbPath)` | `@msl/mercadolibre` | `MSL_MERCADOLIBRE_OAUTH_DB_PATH` | WAL only (own instance) | `oauth_tokens` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 24 | **ML Sync Store** | `createSyncStore(dbPath)` | `@msl/mercadolibre` | (standalone, separate DB) | WAL only (own instance) | `product_sync_state` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 25 | **Chat DB** | inline in route.ts | `apps/web` | `MSL_CHAT_SQLITE_PATH` | WAL, FK, busy=5000 | `chat_seller_namespace` | ❌ CREATE IF NOT EXISTS only | ❌ None |
| 26 | **Telegram Session DB** | inline in bot/index.ts | `@msl/bot` | `MSL_TELEGRAM_SQLITE_PATH` | Inherits from Cortex `createDatabase()` | (shared: Cortex + operational + agent stores) | Inherits from shared DB | ❌ None |

#### Production Runtime DB Wiring (from start-agent-daemons.mjs)

In production, the daemon process uses a **single physical database file** (`MSL_CORTEX_SQLITE_PATH`) for:
- Cortex graph (`createGraphEngine(cortexPath)`)
- Agent Message Bus (`createAgentMessageBusStore(busDb)`) where `busDb = createDatabase(cortexPath)` — separate `createDatabase()` call, but same file path
- Operational Read Model (`createSqliteOperationalReadModel(readerDb)`) where `readerDb = createDatabase(cortexPath)` — separate `createDatabase()` call, same file

This means **Cortex, Bus, and Operational Read Model all share the same SQLite file**. Agent store tables (CEO Inbox, Consensus, Company Agents, Work Sessions, etc.) are initialized in the same database when their factories receive a DB from this same file. However, the `createDatabase()` function is called **3 separate times** for the same file path, resulting in 3 independent `better-sqlite3` connections to the same file.

### Current Observability State

#### What Exists
1. **`createLogger()` in `observability.ts`** — JSON-structured logger with `info()`, `warn()`, `error()` methods emitting `{ level, component, msg, ...ctx, ts }` objects. **Used only by 4 components:** EvidenceResponseRouter, OwnedEcommerceEvidenceAggregator, OwnedEcommerceMerchandisingAdvisor, EcommerceEvidenceRequestPlanner. The rest of the system (~20+ stores, 15 daemons, all runtime infrastructure) uses raw `console.log/warn/error`.

2. **`createMetrics()` in `observability.ts`** — Simple in-memory ring-buffer metrics collector with `record()`, `flush()`, `summarize()`. Has 10 MetricName entries defined. **Not wired into any production runtime.** No sink, no exporter, no health endpoint consuming it.

3. **`runSystemHealthCheck()`** — Lightweight health check checking bus backlog, failed messages, and Cortex node count. Runs every 30 minutes. No DB integrity check, no WAL health, no migration status.

4. **`runDlqMonitor()`** — Dead letter queue monitor that re-enqueues failed/stuck messages. Runs every 15 minutes.

5. **Raw console logging in daemons** — Each daemon uses `console.error()` on failures, `console.warn()` on degradations, `console.log()` on info. Prefixed with `[daemon-name]` (inconsistently).

#### What's Missing
- No structured logging in any store, daemon, or scheduler (except 4 components above)
- No correlation IDs for tracing across components
- No log level configuration
- No log sanitization for secrets
- No operational dashboards or health endpoints (no HTTP health check endpoint, no Prometheus metrics)
- No SQLite performance metrics (query timing, page counts, WAL size)
- No daemon execution metrics (success/failure rate, duration, last run)
- No backup/restore metrics

### Current FinanceDirectorValidator State

`FinanceDirectorValidator.validate()` applies 14 validation rules to LLM-generated `FinancialAssessment` output. The rule `checkInventedFigures` (Rule 1) is the most critical anti-hallucination check but is currently **minimal**:

```typescript
private checkInventedFigures(assessment, _evidence, issues) {
    // Currently ONLY checks that confidence is a valid 0-1 number
    // The _evidence parameter is completely unused
    // Comment claims: "any number in assessment not present in evidence"
    // BUT THIS IS NOT ACTUALLY IMPLEMENTED
}
```

**Hardening opportunities:**
1. **Implement the actual check** — Parse all numeric values in assessment text (summary, verifiedFacts, hypotheses.statement, recommendations.action/rationale), cross-reference against evidence data (snapshots, outcomes), flag any numeric claim not traceable to evidence IDs
2. **Check for fabricated metrics** — Metrics like ROAS, CAC, profit margin percentages that are not computable from available evidence
3. **Check for precision fabrication** — Numbers with unrealistic precision (e.g., "profit margin of 47.831%") not derivable from integer minor-unit Money types
4. **Check for undocumented Money amounts** — Claims about CLP/USD amounts without corresponding evidence
5. **Evidence linkage** — Verify each numeric claim has at least one `evidenceId` associated
6. **Currency attribution** — Ensure claimed currency matches the evidence's currency

---

### Existing Infrastructure to Build Upon

| Capability | Existing Foundation | Gap |
|-----------|---------------------|-----|
| **Backup** | `backupDatabase()` in `packages/memory/src/backup.ts` | No scheduling, verification, restoration, retention |
| **Migration** | Cortex `migrate()` + `schema_version` table; Operational Read Model `migrateOperationalStore()` | Only 2 of 26 stores use it. No unified migration framework |
| **Schema migrations** | `columnExists()` pattern used in 5 stores | No version tracking, no rollback, no audit trail |
| **Observability** | `createLogger()` and `createMetrics()` exist | Used by 4 of 40+ components. No sink, no endpoint |
| **Health check** | `runSystemHealthCheck()` + DLQ monitor | No DB integrity, no WAL, no migration status |
| **Production readiness** | Full control plane (PR 1/4) with 7 checkers, 16 capabilities, fail-closed gates | Database checker only checks paths; no schema/WAL/integrity |
| **Runtime gates** | `assertProductionCapabilityReady()` | No `degraded` policy beyond blocking in production |
| **Daemon scheduler** | 15 daemon handlers in `startDaemonScheduler()` | economicLearningDaemon NOT registered |
| **Observability logger** | JSON-structured, component-keyed | Not used in daemons, stores, or scheduler |
| **Operational Read Model** | 8 entity kinds with generated columns | No migration versioning for production deployments |

---

### Approaches

1. **Incremental Hardening — One Capability at a Time**
   - Build backup scheduling around existing `backupDatabase()`, then verification, then restoration
   - Extend Cortex `migrate()` pattern to other stores incrementally
   - Wire `createLogger()` into daemons and stores gradually
   - Add `PRAGMA integrity_check` to system health check
   - **Pros**: Lowest risk, each capability is independently testable and deployable. Builds on existing code.
   - **Cons**: More PRs, slower total delivery.
   - **Effort**: Medium per capability.

2. **Unified Durability Framework — Build Once, Apply Everywhere**
   - Create a `DatabaseManager` that wraps connection pool with backup, migration, integrity check, and observability
   - All stores get durability features by using the manager instead of raw `Database`
   - Create a `RuntimeMonitor` that schedules backup, runs integrity checks, collects metrics
   - **Pros**: Consistent across all stores, single place to change policy. Less code overall.
   - **Cons**: Higher upfront design cost, more coupling risk, harder to roll back individual features.
   - **Effort**: High upfront, low per-store.

3. **Hybrid — Shared Framework + Incremental Adoption**
   - Build a shared migration framework (`MigratableDatabase`) that wraps `better-sqlite3` and provides `migrate()`, `integrityCheck()`, `backup()`
   - Build a backup scheduler and verification pipeline
   - Build structured logging that wraps `createLogger()` and integrates with health checks
   - Wire the economic learning daemon
   - Grow the `degraded` capability policy
   - Harden `checkInventedFigures`
   - **Pros**: Combines consistency of framework with safety of incremental adoption. Can migrate stores gradually.
   - **Cons**: Moderate complexity. Need to design framework well.
   - **Effort**: Medium-High.

---

### Recommendation

**Approach 3 (Hybrid)** is recommended. The existing `backupDatabase()` and Cortex `migrate()` are solid foundations. Building a shared durability framework that wraps `better-sqlite3` and provides backup, migration, integrity, and observability capabilities — then adopting it incrementally across stores — is the pragmatic path. This lets us deliver the 11 targeted capabilities while keeping each change reviewable and testable.

The work should be organized into these phases:
1. **Durability Core** — Unified migration framework + backup scheduler + integrity check pipeline
2. **Observability Core** — Wire `createLogger()` into daemons/stores, structured logs, correlation IDs
3. **Operational Health** — Extend system health check with DB integrity, WAL status, migration status, `degraded` policy
4. **FinanceDirectorValidator Hardening** — Implement actual numeric claim verification in `checkInventedFigures`
5. **Economic Learning Daemon Wiring** — Register in daemonHandlerMap

---

### Risks

- **Shared DB file with 3 connections**: `start-agent-daemons.mjs` opens 3 separate `better-sqlite3` connections to the same `MSL_CORTEX_SQLITE_PATH` file. Each has its own WAL connection. This works but is unconventional — should consolidate to the `connectionPool.ts` singleton.
- **No integrity checking anywhere**: Running for months without `PRAGMA integrity_check` risks silent DB corruption. This is the most critical gap.
- **OAuth token store contains encrypted secrets**: Backup of the token DB must handle encryption. The current `backupDatabase()` copies raw pages — encrypted tokens travel in backup files. Need to ensure backup files are never committed or exposed.
- **Agent stores share same DB as Cortex**: A single corrupted page could cascade across multiple subsystems.
- **No WAL checkpoint management**: Long-running daemons without periodic `PRAGMA wal_checkpoint(TRUNCATE)` can cause WAL file to grow unboundedly.
- **Test suite uses `:memory:` by default**: Migration tests don't exercise the persistent-file path. Part of the migration hardening should include at least one integration test with a real temp file.
- **Economic learning daemon is dead code**: `createEconomicLearningDaemon()` exists but isn't registered in `daemonHandlerMap`. If wiring it introduces bugs, the learning pipeline could produce incorrect Cortex reinforcement.

---

### Ready for Proposal

**Yes.** The exploration is complete. All 26 SQLite stores have been cataloged. The gaps are well-understood. The hybrid approach has clear phases. The orchestrator should launch **sdd-propose** next with the catalog and findings from this exploration.

---

### Affected Areas

- `packages/memory/src/backup.ts` — extend to scheduled backup + verification + restoration
- `packages/memory/src/connectionPool.ts` — extend with integrity check + WAL management
- `packages/memory/src/cortex/database.ts` — extract `migrate()` into shared framework
- `packages/memory/src/operationalReadModel.ts` — adopt shared migration framework
- `packages/agent/src/conversation/observability.ts` — wire into daemons and stores
- `packages/agent/src/workers/daemonScheduler.ts` — register economicLearningDaemon
- `packages/agent/src/workers/systemHealthDaemon.ts` — extend with DB integrity, WAL, migration status
- `packages/agent/src/finance/FinanceDirectorValidator.ts` — harden `checkInventedFigures`
- `packages/agent/src/readiness/DatabaseReadinessChecker.ts` — add schema/WAL/integrity checks
- `packages/agent/src/readiness/types.ts` — define `degraded` capability policy
- `packages/agent/src/readiness/runtimeGates.ts` — add degraded capability handling
- `packages/agent/src/conversation/agentMessageBusStore.ts` — adopt shared migration framework
- `packages/tools/src/index.ts` — adopt shared migration framework
- `packages/mercadolibre/src/oauth/tokenStore.ts` — adopt shared migration framework
- `packages/mercadolibre/src/sync/syncStore.ts` — adopt shared migration framework
- `scripts/start-agent-daemons.mjs` — consolidate DB connections, wire new durability components
- 15 daemon files in `packages/agent/src/workers/` — wire structured logging
- 20+ store files — adopt migration framework (incremental)
