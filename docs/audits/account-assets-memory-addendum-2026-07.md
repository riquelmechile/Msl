# Account Assets Strategic Memory — Audit Addendum

**Date**: 2026-07-09
**Base audit**: `docs/audits/agent-brain-runtime-audit-2026-07.md` (PR #123)
**Change**: `account-assets-strategic-memory`
**Branches**: `feat/account-assets-strategic-memory` (PR 1–4 stacked-to-main)

---

## 1. Resolved Gaps from PR #123 Audit

| Gap                                     | Audit Finding                                                                                   | Resolution                                                                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Strategic stores lack `seller_id`**   | Cortex, strategies, autonomy, agent_lessons share a single brain between Plasticov and Maustian | ✅ RESOLVED. 10 stores migrated with `seller_id` column (PR1). Cortex Hebbian/Darwinian/spreading scoped per-seller (PR2). AutonomyEngine rebuilt per-seller (PR3). Agent lessons scoped per-seller (PR1).                                    |
| **AutonomyEngine singleton constraint** | `CHECK(id=1)` forces one global autonomy level                                                  | ✅ RESOLVED. Rebuilt as `autonomy_state(seller_id TEXT PRIMARY KEY, current_level, updated_at)`. Per-seller levels with independent promotion/degradation (PR3).                                                                              |
| **Daemon evidence not seller-scoped**   | All daemon handlers query operational reads without seller filtering                            | ✅ RESOLVED. 14 daemon handlers updated to iterate `sellerIds` and scope queries per-seller (PR3).                                                                                                                                            |
| **Approval queue not seller-scoped**    | `dale` applies globally; no per-account resolution                                              | ✅ RESOLVED. `listPendingBySeller()` added to tools (PR1). Bot "dale" flow resolves per-seller via name matching (PR3).                                                                                                                       |
| **Agent memory not account-scoped**     | AgentLoop has no awareness of which account it's serving                                        | ✅ RESOLVED. `AgentAccountContext` type added. `AgentLoopConfig.accountContext` injected into system prompt with account name, capabilities, profit goal, and risk level (PR3, PR4).                                                          |
| **No AccountAsset data model**          | Strategic accounts not modeled as first-class entities                                          | ✅ RESOLVED. `AccountAsset`, `AccountCapability`, `AccountHealthSnapshot`, `AccountStrategy`, `AccountRisk`, `AccountOpportunity`, `MemoryScope` types in `@msl/domain` (PR1). `AccountAssetStore` with 7 SQLite tables and 15 methods (PR4). |

---

## 2. Migration Audit

### What was migrated

| Store                    | Migration                                                                     | Backfill                                               |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| `ceo_strategies`         | `ALTER TABLE ADD COLUMN seller_id TEXT NOT NULL DEFAULT 'unknown'`            | None needed — `'unknown'` serves as global default     |
| `kpi_history`            | `ALTER TABLE ADD COLUMN seller_id TEXT`                                       | None — existing rows nullable, new rows scoped         |
| `degradation_events`     | `ALTER TABLE ADD COLUMN seller_id TEXT`                                       | None — existing rows nullable                          |
| `autonomy_state`         | **Rebuilt**: drop `CHECK(id=1)`, new schema with `seller_id TEXT PRIMARY KEY` | Existing singleton → `seller_id='default'`             |
| `agent_reviews`          | `ALTER TABLE ADD COLUMN seller_id TEXT`                                       | None — existing reviews are global                     |
| `company_agent_lessons`  | `ALTER TABLE ADD COLUMN seller_id TEXT`                                       | None — existing lessons are global (`NULL`)            |
| `approval_queue_entries` | `ALTER TABLE ADD COLUMN seller_id TEXT DEFAULT ''`                            | Best-effort: `JSON_EXTRACT(action_json, '$.sellerId')` |
| `approval_records`       | `ALTER TABLE ADD COLUMN seller_id TEXT DEFAULT ''`                            | Best-effort from `action_json`                         |
| `audit_records`          | `ALTER TABLE ADD COLUMN seller_id TEXT DEFAULT ''`                            | Best-effort from `action_json`                         |
| `nodes`                  | `ALTER TABLE ADD COLUMN seller_id TEXT DEFAULT 'unknown'` + index             | None — existing nodes default to `'unknown'`           |
| `edges`                  | `ALTER TABLE ADD COLUMN seller_id TEXT`                                       | None                                                   |
| `darwinian_lessons`      | `ALTER TABLE ADD COLUMN seller_id TEXT`                                       | None                                                   |
| `account_assets` (new)   | `CREATE TABLE IF NOT EXISTS` (7 tables)                                       | Seed data from `config/account-assets.seed.json`       |

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

| Item                                                                                            | Status   | Rationale                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CompanyAgentStore / SkillStore `seller_id`**                                                  | DEFERRED | Agents and skills are company-level, not per-account. No business case for scoping yet.                                                                                                                                                                           |
| **CreativeJobQueueStore**                                                                       | DEFERRED | Already has `seller_id TEXT NOT NULL` in schema. No migration needed.                                                                                                                                                                                             |
| **WorkforceCostCacheLedgerStore**                                                               | DEFERRED | `sellerId` injected via `metadata` field. No ALTER needed.                                                                                                                                                                                                        |
| **Multi-bot deployment for distinct sellerIds**                                                 | DEFERRED | Current single-instance bot maps both accounts to one `config.sellerId`. Multi-bot deployment (one instance per seller) is the intended future path. The column-scoped store layer is ready.                                                                      |
| **Bot direct `listPendingBySeller` wiring**                                                     | DEFERRED | `listPendingBySeller` exists in the tools package but the bot delegates "dale" resolution to the agent loop's internal flow. Direct wiring would add a fast-path for pending-action awareness in the bot's message handler. Current flow is correct but indirect. |
| **`OwnedEcommerceStore` DROP+CREATE pattern**                                                   | DEFERRED | Not in scope for this change. Audit finding from PR #123, addressed separately.                                                                                                                                                                                   |
| **Dedicated daemon tests for `ownedEcommerceDaemon`, `systemHealthDaemon`, `dlqMonitorDaemon`** | DEFERRED | Not in scope for this change. Coverage gap noted but unrelated to account scoping.                                                                                                                                                                                |

---

## 4. Test Coverage Summary

| Spec                                            | Tests                                                                                                       | Status   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| account-asset-store                             | 20 tests (schema, CRUD, comparison, health, scoping, capabilities, profit goals, recent memory, edge cases) | ✅ PR4   |
| neural-graph-memory (scoped)                    | 40+ tests (scoped-engine.test.ts, engine.test.ts)                                                           | ✅ PR2   |
| autonomy-engine (per-seller)                    | Existing autonomy tests updated + per-seller helpers                                                        | ✅ PR3   |
| action-approval-safety (scoped)                 | Existing approval + new `listPendingBySeller` tests                                                         | ✅ PR1   |
| daemon-scheduler (per-seller)                   | Existing daemon tests updated for multi-seller dispatch                                                     | ✅ PR3   |
| conversational-business-agent (account context) | Existing agent loop tests + system prompt injection verified                                                | ✅ PR3–4 |

**Full suite**: 2140 tests passing (typecheck + lint + test), 0 regressions.

---

## 5. Architecture Documentation

Updated `ARCHITECTURE.md` with:

- Account Asset model (domain types, column vs file scoping)
- Cortex subgraph per-seller (root node, edge types, scoping rules)
- Daemon per-seller flow diagram
- Approval "dale" scoping and bot single-instance limitation

---

## 6. Agent Work Sessions & Cache (Addendum — 2026-07-10)

### Change

**Change**: `agent-work-sessions-cache`
**Branch**: `feat/agent-work-sessions-cache` (PR #126 → PR #127 stacked-to-main)
**Related**: Builds on top of `account-assets-strategic-memory`

### Gaps This PR Resolves

| Gap                                                 | Audit Context                                                                                  | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WorkforceCostCacheLedgerStore lacks `seller_id`** | Deferred in §3. `sellerId` was injected via `metadata` field.                                  | ✅ RESOLVED. `seller_id`, `session_id`, `stable_prompt_hash`, `evidence_hash` columns added via idempotent `columnExists()` migration. `insertEntry()` extended with optional fields (backward compatible). New aggregates: `aggregateCostByAgentAndSeller(sellerId)`, `aggregateCacheEfficiencyBySeller(sellerId)`.                                                                                                                                              |
| **No agent work introspection**                     | CEO had no visibility into autonomous agent activity per account.                              | ✅ RESOLVED. `get_agent_work_status` tool registered. Returns agents worked today, observations, pending proposals, failed sessions, estimated cost, cache efficiency, and next steps — all read-only, `noMutationExecuted: true`.                                                                                                                                                                                                                                |
| **Daemon cycles not session-aware**                 | Handlers ran statelessly; no mechanism to skip redundant work.                                 | ✅ RESOLVED. `AgentWorkSessionRunner` orchestrates full lifecycle: signals → wake decision → session → DeepSeek → record → complete. `DaemonScheduler` extended with `enableWorkSessions` config. 6 sessionized lanes (`unanswered-questions`, `product-ads-profitability`, `creative-assets`, `operations-manager`, `morning-report`, `eod-summary`) route through session runner. Backward compatible: `enableWorkSessions: false` preserves existing behavior. |
| **No shift summaries**                              | Morning report and EOD summary daemons had no session data to aggregate.                       | ✅ RESOLVED. `agentShiftSummary` module: `createMorningBrief`, `createEndOfDaySummary`, `summarizeAccountShift`. DB-query-first; DeepSeek optional for compression.                                                                                                                                                                                                                                                                                               |
| **No Cortex work session recording**                | Agent work had no neural memory footprint.                                                     | ✅ RESOLVED. `agentWorkCortexBridge`: `recordWorkSessionToCortex`, `recordObservationToCortex`, `recordLessonToCortex`, `connectSessionToProposal`, `connectSessionToOutcome`. Graph model: `AccountAsset → Agent → WorkSession → Observation/Proposal/Lesson`. All seller-scoped. Transferable lessons link to `AccountAsset` root for cross-agent discovery.                                                                                                    |
| **No cache-friendly prompt architecture**           | Every daemon cycle generated full prompts from scratch — zero DeepSeek disk-cache utilization. | ✅ RESOLVED. `cacheFriendlyPromptBuilder`: 9-layer prompt (6 stable layers cached 24h, 3 variable layers per cycle). SHA-256 hashing for `stablePromptHash` and `evidenceHash`. DeepSeek `disk_cache_ttl: 86400`. `agentWakePolicy` deduplicates via signals hash comparison.                                                                                                                                                                                     |
| **Agent lessons not transferable across agents**    | Each agent learned in isolation; no cross-agent learning within same account.                  | ✅ RESOLVED. `transferable` flag on `AgentLesson`. Runner records lessons from DeepSeek output. `cacheFriendlyPromptBuilder` injects up to 3 transferable lessons into stable prompt prefix. Cortex bridge links transferable lessons to `AccountAsset` root.                                                                                                                                                                                                     |

### What Remains Pending

| Item                                        | Status  | Notes                                                                                                                                                                                                                                         |
| ------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CEO dashboard**                           | PENDING | `get_agent_work_status` returns structured JSON but no UI. Dashboard planned for future PR.                                                                                                                                                   |
| **`compare_account_assets`**                | PENDING | Cross-account comparison feature for CEO strategic decisions.                                                                                                                                                                                 |
| **Multi-bot concurrent work sessions**      | PENDING | Current architecture supports per-seller isolation; concurrent multi-bot deployment is a runtime concern.                                                                                                                                     |
| **Provider smoke tests**                    | PENDING | DeepSeek cache efficiency measurement in controlled test environments. Not in scope for this PR.                                                                                                                                              |
| **Full daemon handler session integration** | PARTIAL | 6 handlers have daemon-level session dispatch. Individual handlers can be enhanced to create structured session input (signals, evidence) for richer runner behavior. Current implementation is functional but could be deepened per handler. |

### Test Coverage (PR 2)

| Spec                          | Tests                                                                                                      | Status |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| agent-work-session-runner     | 7 tests (skip, complete, fail, proposals, invalid-json, scoping, manual-override)                          | ✅     |
| agent-work-cortex-bridge      | 8 tests (session recording, observations, lessons, transferable, proposals, outcomes, scoping, idempotent) | ✅     |
| agent-shift-summaries         | 5 tests (morning, EOD, account-shift, scoping, recommendations)                                            | ✅     |
| daemon-scheduler              | 3 tests (disabled, enabled+cooldown, backward-compatible)                                                  | ✅     |
| workforce-cost-rollups        | 6 tests (migration, attribution, backward-compatible, per-seller-cost, cache-efficiency)                   | ✅     |
| conversational-business-agent | 5 tests (no-store, seller-scoped, per-account, lessons, noMutation)                                        | ✅     |

**Full suite after PR 2**: 2242 tests (all passing), 7 skipped (smoke tests). No regressions.
