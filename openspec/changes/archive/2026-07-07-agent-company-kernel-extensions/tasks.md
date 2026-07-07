# Tasks: agent-company-kernel-extensions

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

~880 total lines across 3 independent phases (A:~350, B:~280, C:~250). Each fits single PR to main. No stacking.

## Phase A — Rich Cost Ledger

- [x] A.1 Add `department_id TEXT` (ALTER TABLE try/catch) + field to `WorkforceCostCacheLedgerRow` in `workforceCostCacheLedgerStore.ts`
- [x] A.2 Add `workforce_cost_cache_ledger_rollups` DDL to `SCHEMA_SQL`: UNIQUE(day, agent_id, model), token aggregate columns
- [x] A.3 Add `RollupRow` type, `rowToRollup`, `upsertRollupStmt` (ON CONFLICT DO UPDATE); call in `insertEntry` after raw insert
- [x] A.4 Add `departmentId?: string` to `RecordWorkforceCostCacheLedgerEntryInput`; pass in `insertEntry`
- [x] A.5 Bump `defaultMaxEntries` 1_000→5_000; add `from`/`to` ISO params to filter type + WHERE clauses in `listStmt`
- [x] A.6 Define `WorkforceCostAggregate` (byAgent,byDepartment,byPeriod,cacheEfficiency); implement `aggregateCosts({days})` from rollups; add to store interface
- [x] A.7 Rewrite `buildWorkforceCostCacheContext` (agentLoop.ts:447): `aggregateCosts({days:7})` for trends/departments/efficiency; raw-entries fallback on cold start
- [x] A.8 Add `BUDGET_WARNING_THRESHOLD_MICROS=500_000`; append advisory warning line when exceeded
- [x] A.9 Update `recordLlmUsage` (agentLoop.ts:819): resolve `departmentId` from active agent profile; pass to `insertEntry`
- [x] A.10 Test: rollup upsert idempotency, from/to filter, `aggregateCosts` accuracy, prune-at-5K preserves rollups
- [x] A.11 Test: context cold-start/rollups/budget-warning/char-limit; `recordLlmUsage` includes departmentId

## Phase B — Durable Skill Registry

- [x] B.1 Create `companyAgentSkillStore.ts`: `agent_skills` table (skill_id PK, agent_id, label, category, description, proficiency REAL, UNIQUE(agent_id,label)); follow `companyAgentLearningStore.ts` pattern
- [x] B.2 Implement `createCompanyAgentSkillStore(db)`: prepared stmts for insert/list/update/count; category validation; `insertAgentSkill`, `listAgentSkills(agentId)`, `updateAgentSkill(id,fields)`, `count()`
- [x] B.3 Add `AgentSkill` + `InsertAgentSkillInput` types to `companyAgents.ts`
- [x] B.4 Create tools in `tools.ts`: `createDeclareAgentSkillTool`, `createListAgentSkillsTool`, `createUpdateAgentSkillTool` — JSON Schema, admin-gated
- [x] B.5 Register `declare_agent_skill`/`list_agent_skills`/`update_agent_skill` in `agentLoop.ts` after L674, admin-gated
- [x] B.6 Implement `buildWorkforceSkillContext`: format `## Workforce Skills`, max 10 skills/1,200 chars; empty if no store/skills; wire into `buildBlockCContext` between cost and lessons
- [x] B.7 Add `companyAgentSkillStore?` to `AgentLoopConfig`
- [x] B.8 Test: CRUD, duplicate-label rejection, category validation, updated_at changes, non-existent skillId errors
- [x] B.9 Test: context empty/filled/overflow; Block C injection order integration

## Phase C — MCP + Lifecycle

- [x] C.1 Add `"suspended"` to status union in `companyAgents.ts:27` and `companyAgentStore.ts:44`
- [x] C.2 Implement `updateCompanyAgent(id,fields)` with COALESCE UPDATE (label/department_id/stable_prefix/status); add to store interface
- [x] C.3 Create `createUpdateCompanyAgentTool` in `tools.ts`: JSON Schema params + enum constraints, admin-gated; register in `agentLoop.ts`
- [x] C.4 Verify evidence/lesson tools already block non-active; add explicit suspended-agent test
- [x] C.5 Add `workforceAdmin` config to `McpServerConfig` (mcp/src/index.ts) with optional stores + admin flag
- [x] C.6 Register 6 MCP tools via `server.registerTool()` with zod: list_agents, declare_skill, list_skills, list_ledger, list_lessons, update_agent; read-only=API key, mutations=API key+admin
- [x] C.7 Wire `workforceAdmin` in `createMcpRuntimeDependencies` (runtimeDependencies.ts)
- [x] C.8 Test: updateCompanyAgent updates/non-existent/unauthorized; suspended agent excluded, blocked from evidence/lessons, reactivation
- [x] C.9 Test: MCP registrations present, admin-gated rejects, read-only returns with API key
