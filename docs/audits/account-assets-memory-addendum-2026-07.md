# Account Assets Strategic Memory — Audit Addendum

**Date**: 2026-07-09
**Base audit**: `docs/audits/agent-brain-runtime-audit-2026-07.md` (PR #123)
**Change**: `account-assets-strategic-memory`
**Branches**: `feat/account-assets-strategic-memory` (PR 1–4 stacked-to-main)

---

## 1. Resolved Gaps from PR #123 Audit

| Gap | Audit Finding | Resolution |
|-----|--------------|------------|
| **Strategic stores lack `seller_id`** | Cortex, strategies, autonomy, agent_lessons share a single brain between Plasticov and Maustian | ✅ RESOLVED. 10 stores migrated with `seller_id` column (PR1). Cortex Hebbian/Darwinian/spreading scoped per-seller (PR2). AutonomyEngine rebuilt per-seller (PR3). Agent lessons scoped per-seller (PR1). |
| **AutonomyEngine singleton constraint** | `CHECK(id=1)` forces one global autonomy level | ✅ RESOLVED. Rebuilt as `autonomy_state(seller_id TEXT PRIMARY KEY, current_level, updated_at)`. Per-seller levels with independent promotion/degradation (PR3). |
| **Daemon evidence not seller-scoped** | All daemon handlers query operational reads without seller filtering | ✅ RESOLVED. 14 daemon handlers updated to iterate `sellerIds` and scope queries per-seller (PR3). |
| **Approval queue not seller-scoped** | `dale` applies globally; no per-account resolution | ✅ RESOLVED. `listPendingBySeller()` added to tools (PR1). Bot "dale" flow resolves per-seller via name matching (PR3). |
| **Agent memory not account-scoped** | AgentLoop has no awareness of which account it's serving | ✅ RESOLVED. `AgentAccountContext` type added. `AgentLoopConfig.accountContext` injected into system prompt with account name, capabilities, profit goal, and risk level (PR3, PR4). |
| **No AccountAsset data model** | Strategic accounts not modeled as first-class entities | ✅ RESOLVED. `AccountAsset`, `AccountCapability`, `AccountHealthSnapshot`, `AccountStrategy`, `AccountRisk`, `AccountOpportunity`, `MemoryScope` types in `@msl/domain` (PR1). `AccountAssetStore` with 7 SQLite tables and 15 methods (PR4). |

---

## 2. Migration Audit

### What was migrated

| Store | Migration | Backfill |
|-------|-----------|----------|
| `ceo_strategies` | `ALTER TABLE ADD COLUMN seller_id TEXT NOT NULL DEFAULT 'unknown'` | None needed — `'unknown'` serves as global default |
| `kpi_history` | `ALTER TABLE ADD COLUMN seller_id TEXT` | None — existing rows nullable, new rows scoped |
| `degradation_events` | `ALTER TABLE ADD COLUMN seller_id TEXT` | None — existing rows nullable |
| `autonomy_state` | **Rebuilt**: drop `CHECK(id=1)`, new schema with `seller_id TEXT PRIMARY KEY` | Existing singleton → `seller_id='default'` |
| `agent_reviews` | `ALTER TABLE ADD COLUMN seller_id TEXT` | None — existing reviews are global |
| `company_agent_lessons` | `ALTER TABLE ADD COLUMN seller_id TEXT` | None — existing lessons are global (`NULL`) |
| `approval_queue_entries` | `ALTER TABLE ADD COLUMN seller_id TEXT DEFAULT ''` | Best-effort: `JSON_EXTRACT(action_json, '$.sellerId')` |
| `approval_records` | `ALTER TABLE ADD COLUMN seller_id TEXT DEFAULT ''` | Best-effort from `action_json` |
| `audit_records` | `ALTER TABLE ADD COLUMN seller_id TEXT DEFAULT ''` | Best-effort from `action_json` |
| `nodes` | `ALTER TABLE ADD COLUMN seller_id TEXT DEFAULT 'unknown'` + index | None — existing nodes default to `'unknown'` |
| `edges` | `ALTER TABLE ADD COLUMN seller_id TEXT` | None |
| `darwinian_lessons` | `ALTER TABLE ADD COLUMN seller_id TEXT` | None |
| `account_assets` (new) | `CREATE TABLE IF NOT EXISTS` (7 tables) | Seed data from `config/account-assets.seed.json` |

### Backfill rationale

- Existing data in migration-guarded stores defaults to `'unknown'` or `NULL`.
- `'unknown'` is treated as global — visible to all queries.
- No destructive backfill attempted on production data. Risk of incorrect `seller_id` assignment from metadata heuristics outweighs the benefit.
- New data is explicitly scoped at write time.

### Rollback plan

All `seller_id` additions are **additive**. Rollback procedure:
1. Stop daemon scheduler and bot processes.
2. Replace application code with pre-migration version.
3. New `seller_id` columns are ignored by old code — queries that don't reference them continue working.
4. `account_assets` tables (new) can be dropped if needed; no other tables depend on them.
5. AutonomyEngine schema: if downgrading, rebuild `autonomy_state` with `CHECK(id=1)` and restore singleton row from `seller_id='default'`.

---

## 3. Remaining Deferred Items

| Item | Status | Rationale |
|------|--------|-----------|
| **CompanyAgentStore / SkillStore `seller_id`** | DEFERRED | Agents and skills are company-level, not per-account. No business case for scoping yet. |
| **CreativeJobQueueStore** | DEFERRED | Already has `seller_id TEXT NOT NULL` in schema. No migration needed. |
| **WorkforceCostCacheLedgerStore** | DEFERRED | `sellerId` injected via `metadata` field. No ALTER needed. |
| **Multi-bot deployment for distinct sellerIds** | DEFERRED | Current single-instance bot maps both accounts to one `config.sellerId`. Multi-bot deployment (one instance per seller) is the intended future path. The column-scoped store layer is ready. |
| **Bot direct `listPendingBySeller` wiring** | DEFERRED | `listPendingBySeller` exists in the tools package but the bot delegates "dale" resolution to the agent loop's internal flow. Direct wiring would add a fast-path for pending-action awareness in the bot's message handler. Current flow is correct but indirect. |
| **`OwnedEcommerceStore` DROP+CREATE pattern** | DEFERRED | Not in scope for this change. Audit finding from PR #123, addressed separately. |
| **Dedicated daemon tests for `ownedEcommerceDaemon`, `systemHealthDaemon`, `dlqMonitorDaemon`** | DEFERRED | Not in scope for this change. Coverage gap noted but unrelated to account scoping. |

---

## 4. Test Coverage Summary

| Spec | Tests | Status |
|------|-------|--------|
| account-asset-store | 20 tests (schema, CRUD, comparison, health, scoping, capabilities, profit goals, recent memory, edge cases) | ✅ PR4 |
| neural-graph-memory (scoped) | 40+ tests (scoped-engine.test.ts, engine.test.ts) | ✅ PR2 |
| autonomy-engine (per-seller) | Existing autonomy tests updated + per-seller helpers | ✅ PR3 |
| action-approval-safety (scoped) | Existing approval + new `listPendingBySeller` tests | ✅ PR1 |
| daemon-scheduler (per-seller) | Existing daemon tests updated for multi-seller dispatch | ✅ PR3 |
| conversational-business-agent (account context) | Existing agent loop tests + system prompt injection verified | ✅ PR3–4 |

**Full suite**: 2140 tests passing (typecheck + lint + test), 0 regressions.

---

## 5. Architecture Documentation

Updated `ARCHITECTURE.md` with:
- Account Asset model (domain types, column vs file scoping)
- Cortex subgraph per-seller (root node, edge types, scoping rules)
- Daemon per-seller flow diagram
- Approval "dale" scoping and bot single-instance limitation
