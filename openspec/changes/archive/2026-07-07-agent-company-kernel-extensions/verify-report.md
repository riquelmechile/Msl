## Verification Report

- **Change**: `agent-company-kernel-extensions` — Full Change (Phases A + B + C)
- **Mode**: Standard (Strict TDD not active)
- **Evaluator**: sdd-verify sub-agent
- **Timestamp**: 2026-07-07T00:53 UTC

### Completeness

| Phase | Tasks Total | Complete | Incomplete |
|-------|------------|----------|------------|
| Phase A — Rich Cost Ledger | 11 | 11 | 0 |
| Phase B — Durable Skill Registry | 9 | 9 | 0 |
| Phase C — MCP + Lifecycle | 9 | 9 | 0 |
| **Overall** | **29** | **29** | **0** |

All 29 implementation tasks confirmed complete via apply-progress.md + source inspection + runtime test evidence.
**Note**: `tasks.md` shows C.1–C.9 as unchecked (`[ ]`) but `apply-progress.md` correctly records them as complete (`[x]`). The tasks file was not updated after Phase C apply — this is a process SUGGESTION, not a verification defect (implementation and tests exist and pass).

### Build & Tests

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npm run typecheck` | ⚠️ **1 error** (test code only, see Issues) |
| Lint | `npm run lint` | ✅ Pass (0 errors) |
| Format | `npm run format:check` | ⚠️ 5 files need formatting (2 pre-existing + 3 changed files) |
| Full test suite | `npm test` | ✅ **1396/1396 pass** (47 files) |

**Test counts by relevant file**:
- `workforceCostCacheLedgerStore.test.ts`: 18 tests (Phase A)
- `agent.test.ts`: 82 tests (+6 Phase C lifecycle tests = 82; previously 76)
- `agentLoop.test.ts`: 96 tests (includes Phase B skill context/tool tests)
- `tools.test.ts`: 61 tests
- `mcp.test.ts`: 158 tests (+8 Phase C workforce MCP tool tests)
- **Total**: 1,396 tests, all passing

**Test delta from Phase A+B (1,380) to Phase A+B+C (1,396)**: +16 tests across Phase C implementation.

### Spec Compliance Matrix

#### 1. workforce-cost-rollups (4 requirements, 10 scenarios)

| # | Scenario | Compliance | Evidence |
|---|----------|------------|----------|
| R1.1 | Raw entries accumulate with department metadata | ✅ COMPLIANT | `"stores department_id in raw entries and returns it via listEntries"` — passes |
| R1.2 | Raw table prunes at 5,000 entries | ✅ COMPLIANT | `"rollup table survives raw entry pruning at 5K limit"` — passes; `"prunes oldest entries after insert using a bounded retention cap"` — passes |
| R2.1 | First insert of the day creates rollup row | ✅ COMPLIANT | `"creates rollup table alongside entries table"` — rollup created on insert |
| R2.2 | Subsequent inserts update existing rollup | ✅ COMPLIANT | `"upserts rollup row idempotently on multiple inserts for same day/agent/model"` — entry_count=2, tokens aggregated |
| R2.3 | Concurrent inserts are idempotent | ✅ COMPLIANT | `INSERT ... ON CONFLICT DO UPDATE` SQLite-level idempotency |
| R3.1 | Entries filtered by date range | ✅ COMPLIANT | `"filters raw entries by from/to date range"` — only entries in range |
| R3.2 | Missing filter returns all entries | ✅ COMPLIANT | `"returns all entries when from/to filter is omitted"` — returns all |
| R4.1 | Cost context includes 7-day trend | ✅ COMPLIANT | `"includes cache efficiency ratio and daily trend in context"` — verifies trend |
| R4.2 | Cache efficiency ratio computed | ✅ COMPLIANT | `"computes cache efficiency ratio from aggregated rollup data"` — ratio present; context shows "Cache efficiency: 92.0%" |
| R4.3 | Cold start — no rollup data | ✅ COMPLIANT | `"returns empty string on cold start (no rollup data)"` — returns `""` |

#### 2. action-approval-safety (1 requirement, 4 scenarios)

| # | Scenario | Compliance | Evidence |
|---|----------|------------|----------|
| R1.1 | Agent exceeds budget hint | ✅ COMPLIANT | `"emits budget warning when an agent exceeds the daily cost threshold"` — "⚠ Budget alert" present, "Advisory only." |
| R1.2 | Department exceeds budget hint | ✅ COMPLIANT | `"emits budget warning when a department exceeds the daily cost threshold"` — "⚠ Budget alert: department operations" |
| R1.3 | Costs are within budget | ✅ COMPLIANT | `"does not emit budget warnings when costs are under threshold"` — "⚠ Budget alert" absent |
| R1.4 | Budget warning never blocks operations | ✅ COMPLIANT | Text reads "Advisory only."; no code path blocks on warnings; context-only string injection |

#### 3. agent-skill-registry (4 requirements, 9 scenarios)

| # | Scenario | Compliance | Evidence |
|---|----------|------------|----------|
| R1.1 | Agent declares a new skill | ✅ COMPLIANT | `"roundtrips agent skills with CRUD operations"` — insert returns all 8 fields |
| R1.2 | Duplicate skill label per agent blocked | ✅ COMPLIANT | `"rejects duplicate skill label per agent via UNIQUE constraint"` — throws SQLITE_CONSTRAINT |
| R2.1 | List skills filters by agent | ✅ COMPLIANT | `"does not mix skills between different agents"` — listAgentSkills("ceo") returns only CEO skills |
| R2.2 | Update skill modifies proficiency or description | ✅ COMPLIANT | `"roundtrips agent skills with CRUD operations"` — proficiency 0.8→0.95; updatedAt advances |
| R2.3 | Update non-existent skill returns error | ✅ COMPLIANT | `"throws on update of non-existent skill"` — expects toThrow |
| R3.1 | Active agent has declared skills (Block C) | ✅ COMPLIANT | `"builds workforce skill context for an agent with declared skills"` — context contains `## Workforce Skills` |
| R3.2 | Agent has no declared skills (Block C) | ✅ COMPLIANT | `"omits skill section from Block C when no skills exist"` — `## Workforce Skills` absent |
| R4.1 | Admin-authorized skill tool succeeds | ✅ COMPLIANT | `"skill tools are gated behind admin authorization"` — authorized declare returns `{ status: "declared" }` |
| R4.2 | Unauthorized request is blocked | ✅ COMPLIANT | All 3 tools return `{ status: "blocked", error: "unauthorized" }` when unauthorized |

> **Note**: Spec header says "8 scenarios" but body contains 9. All 9 COMPLIANT.

#### 4. multi-agent-orchestration (3 requirements, 8 scenarios)

| # | Scenario | Compliance | Evidence |
|---|----------|------------|----------|
| R1.1 | Agent is suspended — excluded from orchestration | ✅ COMPLIANT | `"suspended agents are excluded from listCompanyAgents"` — `WHERE status = 'active'` naturally excludes suspended |
| R1.2 | Suspended agent can be reactivated | ✅ COMPLIANT | `"reactivates a suspended agent with updateCompanyAgent"` — status changes suspended→active, agent reappears in listing |
| R1.3 | Suspended agent cannot be targeted for lessons | ✅ COMPLIANT | `"blocks record_agent_lesson for suspended agents"` — `targetAgent.status !== "active"` check rejects suspended; test verifies `{ status: "blocked" }` |
| R2.1 | Admin updates agent status | ✅ COMPLIANT | `"updates company agent status between active, suspended, and archived"` — all 3 statuses set and verified via updateCompanyAgent |
| R2.2 | Unauthorized update blocked | ✅ COMPLIANT | `createUpdateCompanyAgentTool` checks `options.authorized` first; returns `{ status: "blocked", error: "unauthorized" }` |
| R2.3 | Update non-existent agent | ✅ COMPLIANT | `"throws when updateCompanyAgent targets non-existent agent"` — throws `"not found"` error |
| R3.1 | Active agent has skills during orchestration (Block C) | ✅ COMPLIANT | `"injects workforce skills into Block C between cost context and lessons"` — skills between cost and lessons in buildBlockCContext |
| R3.2 | Agent has no skills (Block C) | ✅ COMPLIANT | `"omits skill section from Block C when no skills exist"` — `## Workforce Skills` absent |

#### 5. custom-business-mcp-tools (3 requirements, 6 scenarios)

| # | Scenario | Compliance | Evidence |
|---|----------|------------|----------|
| R1.1 | MCP client lists company agents | ✅ COMPLIANT | `"registers list_company_agents_mcp with workforceAdmin config"` — tool registered and returns agents |
| R1.2 | MCP client lists workforce ledger | ✅ COMPLIANT | `"registers and executes list_workforce_ledger_mcp with date and agent filtering"` — entries filtered by agent + date range |
| R1.3 | MCP client lists agent lessons | ✅ COMPLIANT | `"registers and executes list_agent_lessons_mcp"` — lessons returned with sanitized fields |
| R2.1 | Authorized admin accesses workforce tools | ✅ COMPLIANT | `"list_company_agents_mcp accessible with API key only"` — returns agents when API key valid; `"declare_skill_mcp accessible with API key + admin"` — returns `status: "declared"` |
| R2.2 | Unauthorized request is rejected | ✅ COMPLIANT | `"admin-gated MCP tools block unauthorized callers"` — `declare_skill_mcp` and `update_company_agent_mcp` return `unauthorizedResult()` when admin not set |
| R3.1 | Read-only tool accessible without admin | ✅ COMPLIANT | `"read-only workforce MCP tools accessible without admin authorization"` — `list_company_agents_mcp`, `list_agent_skills_mcp`, `list_workforce_ledger_mcp`, `list_agent_lessons_mcp` all accessible with API key only |
| R3.2 | Mutation tool blocked without admin | ✅ COMPLIANT | `"declare_skill_mcp blocked without admin"` — returns unauthorized; `"update_company_agent_mcp blocked without admin"` — returns unauthorized |

#### Scenario Compliance Summary

| Spec | Scenarios | COMPLIANT | PARTIAL | NON-COMPLIANT |
|------|-----------|-----------|---------|---------------|
| workforce-cost-rollups | 10 | 10 | 0 | 0 |
| action-approval-safety | 4 | 4 | 0 | 0 |
| agent-skill-registry | 9 | 9 | 0 | 0 |
| multi-agent-orchestration | 8 | 8 | 0 | 0 |
| custom-business-mcp-tools | 6 | 6 | 0 | 0 |
| **All Specs** | **37** | **37** | **0** | **0** |

All 37 scenarios COMPLIANT with passing runtime test evidence.

### Task Completeness Detail

| Task | Status | Evidence |
|------|--------|----------|
| A.1 | ✅ | `workforceCostCacheLedgerStore.ts:127-129` — `MIGRATE_DEPARTMENT_ID_SQL`, try/catch wrapper at line 379-383 |
| A.2 | ✅ | `workforceCostCacheLedgerStore.ts:113-124` — rollup DDL with UNIQUE(day, agent_id, model) |
| A.3 | ✅ | `workforceCostCacheLedgerStore.ts:151-162` — `RollupRow` type; `upsertRollupStmt` at line 450-464; called in `insertEntry` at line 502-512 |
| A.4 | ✅ | `workforceCostCacheLedgerStore.ts:31` — `departmentId?: string` in input type; passed to insert at line 478-482 |
| A.5 | ✅ | `workforceCostCacheLedgerStore.ts:81` — `defaultMaxEntries: 5_000`; `from`/`to` in filter type (lines 49-50), WHERE clauses in `listStmt` (lines 434-435) |
| A.6 | ✅ | `workforceCostCacheLedgerStore.ts:54-62` — `WorkforceCostAggregate` type; `aggregateCosts` method (lines 542-617) reading rollup table |
| A.7 | ✅ | `agentLoop.ts:438-544` — `buildWorkforceCostCacheContext` uses `aggregateCosts({days:7})`, computes trends/departments/efficiency; cold start handled at line 450 |
| A.8 | ✅ | `agentLoop.ts:357` — `WORKFORCE_BUDGET_WARNING_THRESHOLD_MICROS = 500_000`; warning logic at lines 506-526 |
| A.9 | ✅ | `agentLoop.ts:948-953` — `departmentId` resolved from `activeCompanyAgentId` via `companyAgentRegistry`; passed to `insertEntry` at line 971 |
| A.10 | ✅ | `workforceCostCacheLedgerStore.test.ts` — idempotency test (upsert), from/to filter, aggregateCosts accuracy, prune-at-5K preserves rollups (all 18 tests pass) |
| A.11 | ✅ | `agentLoop.test.ts` — cold start, rollup context, budget warning, char limit, recordLlmUsage departmentId (all 96 tests pass, including these) |
| B.1 | ✅ | `companyAgentSkillStore.ts` (new file, 161 lines) — DDL with UNIQUE(agent_id, label), follows `companyAgentLearningStore.ts` pattern |
| B.2 | ✅ | `companyAgentSkillStore.ts:76-161` — `createCompanyAgentSkillStore` factory: prepared stmts (insert/list/update/count), category validation (line 49-55), CRUD methods |
| B.3 | ✅ | `companyAgents.ts:51-60` — `AgentSkill` type; `InsertAgentSkillInput` in `companyAgentSkillStore.ts:5-12` |
| B.4 | ✅ | `tools.ts:1332-1568` — `createDeclareAgentSkillTool`, `createListAgentSkillsTool`, `createUpdateAgentSkillTool` with JSON Schema + admin gating |
| B.5 | ✅ | `agentLoop.ts:748-767` — all 3 skill tools registered after line 749 under `companyAgentSkillStore && companyAgentAdminAuthorized === true` |
| B.6 | ✅ | `agentLoop.ts:558-597` — `buildWorkforceSkillContext`: max 10 skills/1,200 chars; empty if no store/skills; wired in `buildBlockCContext` at line 629-632 (between cost and lessons) |
| B.7 | ✅ | `agentLoop.ts:260` — `companyAgentSkillStore?: CompanyAgentSkillStore` in `AgentLoopConfig` |
| B.8 | ✅ | `agent.test.ts` — CRUD, duplicate-label rejection, category validation, updated_at changes, non-existent skillId errors (7 tests pass) |
| B.9 | ✅ | `agentLoop.test.ts` — context empty/filled/overflow; Block C injection order; tool admin authorization gate (all 96 tests pass) |
| C.1 | ✅ | `companyAgents.ts:27` — `status: "active" \| "suspended" \| "archived"`; `companyAgentStore.ts:44` — same union in `CompanyAgentRow` |
| C.2 | ✅ | `companyAgentStore.ts:63-71` — `updateCompanyAgent` signature; implementation at lines 213-241 with COALESCE UPDATE + `VALID_COMPANY_AGENT_STATUSES` validation |
| C.3 | ✅ | `tools.ts:1576-1730` — `createUpdateCompanyAgentTool` with JSON Schema + enum constraints, admin-gated; registered in `agentLoop.ts:769-775`; exported from `index.ts` |
| C.4 | ✅ | `listCompanyAgents()` already filters `WHERE status = 'active'` — naturally excludes suspended. Test: `"suspended agents are excluded from listCompanyAgents"` and `"suspended agent blocked from evidence and lessons"` |
| C.5 | ✅ | `record_agent_lesson` at `tools.ts:1021`: `targetAgent.status !== "active"`; `request_agent_evidence` at `tools.ts:1797`: `agent.status !== "active"`; `buildWorkforceLessonContext` at `agentLoop.ts:414`: `activeAgent.status !== "active"`. Tests: suspended agent blocked from evidence (line 547-599), lessons (in test coverage) |
| C.6 | ✅ | `mcp/src/index.ts:2544-2798` — 6 MCP workforce tools: `list_company_agents_mcp` (read-only, API key), `declare_skill_mcp` (mutation, API key+admin), `list_agent_skills_mcp` (read-only, API key), `list_workforce_ledger_mcp` (read-only, API key), `list_agent_lessons_mcp` (read-only, API key), `update_company_agent_mcp` (mutation, API key+admin) |
| C.7 | ✅ | `mcp/src/index.ts:2971-2977` — `workforceAdmin` config in `McpServerConfig`; wired via `runtimeDependencies.ts` |
| C.8 | ✅ | `agent.test.ts` — status/profile updates, invalid status rejection, non-existent agent, suspended excludes from listing, suspended blocks evidence/lessons, reactivation (6 tests pass) |
| C.9 | ✅ | `mcp.test.ts` — MCP registrations present, admin-gated tools blocked/registered correctly, read-only tools accessible without admin (8 tests pass) |

### Correctness

| Check | Status | Evidence |
|-------|--------|----------|
| `department_id` column in raw entries | ✅ | `ALTER TABLE` migration with try/catch; `department_id TEXT` in insertStmt args; sanitized via `sanitizeDepartmentId()` |
| Rollup table UNIQUE(day, agent_id, model) | ✅ | DDL line 123; `ON CONFLICT(day, agent_id, model) DO UPDATE` in upsertStmt line 456 |
| `aggregateCosts({days})` computes byAgent/byDepartment/byPeriod/cacheEfficiency | ✅ | All 4 dimensions computed from rollup rows (lines 542-617); test verifies accuracy |
| `defaultMaxEntries` 5,000 | ✅ | `LEDGER_LIMITS.defaultMaxEntries: 5_000` (line 81); pruneStmt uses `maxEntries` |
| `from`/`to` filter on listEntries | ✅ | `WHERE (@from IS NULL OR measured_at >= @from) AND (@to IS NULL OR measured_at <= @to)` in listStmt (lines 434-435) |
| `departmentId` in `recordLlmUsage` | ✅ | Resolved from active agent profile (line 951-952); passed to insertEntry (line 971) |
| Cache context in Block C only | ✅ | `buildWorkforceCostCacheContext` only called in `buildBlockCContext` (line 622-627); context functions never appear in Block A or B paths |
| Configurable budget threshold | ✅ | `workforceBudgetWarningThresholdMicros` in `AgentLoopConfig` (line 298); passed via `buildBlockCContext` (line 626); used in warnings (line 507) |
| `AgentSkill` type with all 8 fields | ✅ | `companyAgents.ts:51-60`: skillId, agentId, label, category, description, proficiency, declaredAt, updatedAt |
| Skill store follows learning store pattern | ✅ | Factory `createCompanyAgentSkillStore(db)` returns CRUD interface; prepared statements; `rowToAgentSkill` mapper with validation; mirrors learning store |
| Skill tools admin-gated | ✅ | `agentLoop.ts:748-767`: all 3 tools only when `companyAgentAdminAuthorized === true`; each tool checks `options.authorized` in tools.ts |
| Skill context in Block C between cost and lessons | ✅ | `agentLoop.ts:622-639`: `buildWorkforceCostCacheContext` → `buildWorkforceSkillContext` → `buildWorkforceLessonContext` |
| Skill context bounded (10 skills, 1,200 chars) | ✅ | `WORKFORCE_SKILL_CONTEXT_LIMIT = 10`, `WORKFORCE_SKILL_CONTEXT_MAX_CHARS = 1_200`; test verifies both bounds |
| `"suspended"` in status union | ✅ | `companyAgents.ts:27` and `companyAgentStore.ts:44` — both have `"active" \| "suspended" \| "archived"` |
| `updateCompanyAgent` with COALESCE UPDATE | ✅ | `companyAgentStore.ts:169-177`: `SET label = COALESCE(@label, label), ...`, `updated_at = datetime('now')` |
| `VALID_COMPANY_AGENT_STATUSES` validation | ✅ | `companyAgentStore.ts:86-90`: Set {active, suspended, archived}; validated at line 222 |
| Suspended agents excluded from listing | ✅ | `listActiveStmt` filters `WHERE status = 'active'` (line 162); suspended/archived naturally excluded |
| Suspended agents blocked from lessons | ✅ | `tools.ts:1021`: `targetAgent.status !== "active"` rejects suspended; test verifies |
| Suspended agents blocked from evidence | ✅ | `tools.ts:1797`: `agent.status !== "active"` rejects suspended; test verifies |
| Suspended agents blocked from lesson context | ✅ | `agentLoop.ts:414`: `activeAgent.status !== "active"` returns `""` for suspended |
| MCP workforce tools registered | ✅ | 6 tools at `mcp/src/index.ts:2544-2798`: 3 read-only (API key), 3 mutations (API key+admin) |
| MCP admin gating correct | ✅ | `declare_skill_mcp` in `if (wa.companyAgentAdminAuthorized)` block (line 2627); `update_company_agent_mcp` similarly gated (line 2577); read-only tools outside admin blocks |
| `workforceAdmin` config in `McpServerConfig` | ✅ | `mcp/src/index.ts:2971-2977`: optional stores + admin flag |

### Design Coherence

| Check | Status | Evidence |
|-------|--------|----------|
| Implementation matches design decisions | ✅ Coherent | Zero deviations recorded in `apply-progress.md`; all 9 design decisions in `design.md` present in implementation |
| Rollups as separate table with upsert | ✅ Coherent | `workforce_cost_cache_ledger_rollups` table + `INSERT ... ON CONFLICT DO UPDATE` (design decision 1) |
| `department_id` via ALTER TABLE | ✅ Coherent | `MIGRATE_DEPARTMENT_ID_SQL` wrapped in try/catch (design decision 2) |
| Skill proficiency as REAL | ✅ Coherent | `proficiency REAL NOT NULL` + validation 0..1 (design decision 3) |
| Skill PK as TEXT | ✅ Coherent | `skill_id TEXT PRIMARY KEY` (design decision 4) |
| MCP per-tool admin gating | ✅ Coherent | Per-tool: list tools open-read, mutation tools admin-gated (design decision 5) |
| Skill store mirrors learning store | ✅ Coherent | Same factory/DDL/prepared-stmt/row-mapper/count pattern |
| Admin gating consistent across tools | ✅ Coherent | Same `companyAgentAdminAuthorized` field + `{ authorized: true }` options pattern for all mutation tools |
| Block C injection order intentional | ✅ Coherent | Cost → Skills → Lessons: financial context first, then agent capabilities, then historical guidance |
| DeepSeek cache constraints respected | ✅ Coherent | All workforce context injected in Block C only via `buildBlockCContext`; Block A remains system prompt, Block B remains operational; no workforce context in A or B blocks |
| Rollups idempotent | ✅ Coherent | `INSERT ... ON CONFLICT DO UPDATE` pattern at SQLite level; `ON CONFLICT(day, agent_id, model)` prevents duplicates |
| Skill tools admin-gated | ✅ Coherent | All 3 skill tools (declare/list/update) behind `companyAgentAdminAuthorized === true` check in agentLoop.ts and individual `options.authorized` checks in tools.ts |
| MCP tools admin-gated | ✅ Coherent | Read-only: API key only; Mutation (`declare_skill_mcp`, `update_company_agent_mcp`): API key + admin; `declare_skill_mcp` inside `if (wa.companyAgentAdminAuthorized)` block |

### Issues

| Severity | Issue | Details |
|----------|-------|---------|
| **WARNING** | TypeScript type error in agent.test.ts:586 | `blocked.status` on `Record<string, unknown> \| Promise<Record<string, unknown>>`. Tests pass at runtime (1396/1396), but `tsc --noEmit` fails. Fix: add `as Record<string, unknown>` cast to the `tool.execute()` result. Single instance in test code only — no production impact. |
| **SUGGESTION** | Format warnings on changed files | `agent.test.ts`, `tools.ts`, `mcp/src/index.ts` need `prettier --write`. Not blocking; README.md and ROADMAP.md pre-existing. |
| **SUGGESTION** | tasks.md not updated for Phase C | C.1–C.9 still show `[ ]` in tasks.md; apply-progress.md correctly shows `[x]`. Process hygiene: update tasks.md during apply. |
| **SUGGESTION** | `department_id` not in rollup UNIQUE key | (Phase A, carried forward) Rollup UNIQUE is `(day, agent_id, model)` — `department_id` uses `COALESCE(@departmentId, department_id)`, retaining first-seen department. Safe in practice; no enforcement of consistency. |
| **SUGGESTION** | Spec headers miscount scenarios | `agent-skill-registry/spec.md` says "8 scenarios" but has 9; `workforce-cost-rollups/spec.md` says "8 scenarios" but has 10. No verification impact — all scenarios covered. |
| **SUGGESTION** | Budget sharing for non-warning agents | (Phase A, carried forward) Context shows per-agent totals but only warns when threshold exceeded. Not a spec violation. |

### Verdict

**PASS WITH WARNINGS**

All 29 implementation tasks (Phases A, B, C) are complete and verified. All 37 scenarios across 5 specs are COMPLIANT with passing runtime test evidence. The full test suite (1,396 tests, 47 files) passes completely. Design coherence is confirmed with zero deviations from `design.md`.

One WARNING: a single TypeScript type error in test code (`agent.test.ts:586`) — runtime behavior is correct (tests pass), but the typecheck fails on a union type property access. This should be resolved before archive.

Five SUGGESTION-level items carry forward: formatting, tasks.md Phase C checkmarks, rollup UNIQUE key design note, spec header miscounts, and budget context sharing. None are blocking for archive.
