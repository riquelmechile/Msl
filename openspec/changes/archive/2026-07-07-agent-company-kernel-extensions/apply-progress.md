# Apply Progress: agent-company-kernel-extensions — All Phases

## Mode
Standard Mode (strict TDD not enabled)

## Delivery Strategy
Single work unit, single PR to main. Phase A: ~350 lines, Phase B: ~280 lines, Phase C: ~250 lines.

## Completed Tasks

### Phase A — Rich Cost Ledger

- [x] A.1 Add `department_id TEXT` (ALTER TABLE try/catch) + field to `WorkforceCostCacheLedgerRow` in `workforceCostCacheLedgerStore.ts`
- [x] A.2 Add `workforce_cost_cache_ledger_rollups` DDL to `SCHEMA_SQL`: UNIQUE(day, agent_id, model), token aggregate columns
- [x] A.3 Add `RollupRow` type, `rowToRollup`, `upsertRollupStmt` (ON CONFLICT DO UPDATE); call in `insertEntry` after raw insert
- [x] A.4 Add `departmentId?: string` to `RecordWorkforceCostCacheLedgerEntryInput`; pass in `insertEntry`
- [x] A.5 Bump `defaultMaxEntries` 1_000→5_000; add `from`/`to` ISO params to filter type + WHERE clauses in `listStmt`
- [x] A.6 Define `WorkforceCostAggregate` (byAgent,byDepartment,byPeriod,cacheEfficiency); implement `aggregateCosts({days})` from rollups; add to store interface
- [x] A.7 Rewrite `buildWorkforceCostCacheContext` (agentLoop.ts): `aggregateCosts({days:7})` for trends/departments/efficiency; raw-entries fallback on cold start
- [x] A.8 Add `BUDGET_WARNING_THRESHOLD_MICROS=500_000`; append advisory warning line when exceeded
- [x] A.9 Update `recordLlmUsage`: resolve `departmentId` from active agent profile; pass to `insertEntry`
- [x] A.10 Test: rollup upsert idempotency, from/to filter, `aggregateCosts` accuracy, prune-at-5K preserves rollups
- [x] A.11 Test: context cold-start/rollups/budget-warning/char-limit; `recordLlmUsage` includes departmentId

### Phase B — Durable Skill Registry

- [x] B.1 Create `companyAgentSkillStore.ts`: `agent_skills` table (skill_id PK, agent_id, label, category, description, proficiency REAL, UNIQUE(agent_id,label)); follow `companyAgentLearningStore.ts` pattern
- [x] B.2 Implement `createCompanyAgentSkillStore(db)`: prepared stmts for insert/list/update/count; category validation; `insertAgentSkill`, `listAgentSkills(agentId)`, `updateAgentSkill(id,fields)`, `count()`
- [x] B.3 Add `AgentSkill` + `InsertAgentSkillInput` types to `companyAgents.ts`
- [x] B.4 Create tools in `tools.ts`: `createDeclareAgentSkillTool`, `createListAgentSkillsTool`, `createUpdateAgentSkillTool` — JSON Schema, admin-gated
- [x] B.5 Register `declare_agent_skill`/`list_agent_skills`/`update_agent_skill` in `agentLoop.ts`, admin-gated
- [x] B.6 Implement `buildWorkforceSkillContext`: format `## Workforce Skills`, max 10 skills/1,200 chars; empty if no store/skills; wire into `buildBlockCContext` between cost and lessons
- [x] B.7 Add `companyAgentSkillStore?` to `AgentLoopConfig`
- [x] B.8 Test: CRUD, duplicate-label rejection, category validation, updated_at changes, non-existent skillId errors
- [x] B.9 Test: context empty/filled/overflow; Block C injection order; tool admin authorization gate

### Phase C — MCP + Lifecycle

- [x] C.1 Add `"suspended"` to status union in `companyAgents.ts:27` and `companyAgentStore.ts:44`
- [x] C.2 Implement `updateCompanyAgent(id,fields)` with COALESCE UPDATE (label/department_id/stable_prefix/status); add to store interface
- [x] C.3 Create `createUpdateCompanyAgentTool` in `tools.ts`: JSON Schema params + enum constraints, admin-gated; register in `agentLoop.ts`; export from `index.ts`
- [x] C.4 `listCompanyAgents()` already filters `WHERE status = 'active'` — naturally excludes suspended (no code change needed)
- [x] C.5 Suspended agents already blocked from `record_agent_lesson`, `request_agent_evidence`, and `buildWorkforceLessonContext` via existing `status !== "active"` checks — explicit tests added
- [x] C.6 Register 6 MCP workforce tools: `list_company_agents_mcp`, `declare_skill_mcp`, `list_agent_skills_mcp`, `list_workforce_ledger_mcp`, `list_agent_lessons_mcp`, `update_company_agent_mcp` — read-only tools API-key only, mutation tools API-key + admin
- [x] C.7 Wire `workforceAdmin` via `McpServerConfig.workforceAdmin` optional config; caller-provided stores flow into tool registrations
- [x] C.8 Test: `updateCompanyAgent` status/profile updates, invalid status rejection, non-existent agent, suspended excludes from listing, suspended blocks evidence/lessons, reactivation
- [x] C.9 Test: MCP registrations present with workforceAdmin config, admin-gated tools blocked/registered correctly, read-only tools accessible without admin

## Verification Results

| Check | Result |
|-------|--------|
| TypeScript (`tsc --noEmit`) | ✅ Pass |
| agent.test.ts (82 tests) | ✅ All pass |
| agentLoop.test.ts (96 tests) | ✅ All pass |
| mcp.test.ts (158 tests) | ✅ All pass |

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/companyAgents.ts` | Modified | +`AgentSkill` type, +`"suspended"` in status union |
| `packages/agent/src/conversation/companyAgentSkillStore.ts` | **Created** | Skill registry store (SQLite + prepared statements) |
| `packages/agent/src/conversation/companyAgentStore.ts` | Modified | +`"suspended"` in Row type, +`updateCompanyAgent` with COALESCE UPDATE, +`VALID_COMPANY_AGENT_STATUSES` |
| `packages/agent/src/conversation/tools.ts` | Modified | +3 skill tool factories, +`createUpdateCompanyAgentTool`, +imports |
| `packages/agent/src/conversation/agentLoop.ts` | Modified | +`buildWorkforceSkillContext`, +`companyAgentSkillStore` config, +skill + update_company_agent tool registration |
| `packages/agent/src/index.ts` | Modified | +skill store + skill tool + `createUpdateCompanyAgentTool` exports |
| `packages/mcp/src/index.ts` | Modified | +`workforceAdmin` in `McpServerConfig`, +6 MCP workforce tool registrations, +standalone inputSchemas |
| `packages/agent/src/agent.test.ts` | Modified | +6 lifecycle tests (update, suspend, reactivate, block) |
| `packages/mcp/src/mcp.test.ts` | Modified | +8 MCP workforce tool tests (registration, auth gating, execution) |

## Deviations from Design

None — implementation matches design.

## Issues Found

None.

## Remaining Tasks

All phases complete. Ready for verify and archive.

## Workload / PR Boundary

- Mode: single PR to main
- Estimated review budget: Phase C ~250 lines (+~300 lines of tests)
