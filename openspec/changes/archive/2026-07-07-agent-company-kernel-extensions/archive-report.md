## Archive Report

- **Change**: `agent-company-kernel-extensions`
- **Archived**: 2026-07-07
- **Archiver**: sdd-archive sub-agent
- **SDD Cycle**: COMPLETE

### Summary

Delivered the Agent Company Kernel Extensions across three phases (A, B, C):

| Phase | Name | Tasks | Description |
|-------|------|-------|-------------|
| A | Rich Cost Ledger | 11/11 | Rollup aggregations, department tracking, budget warnings, 5K entry retention, from/to filters, 7-day trends in Block C context |
| B | Durable Skill Registry | 9/9 | `agent_skills` table, CRUD store, skill tools (declare/list/update), admin-gated, Block C skill context injection |
| C | MCP + Lifecycle | 9/9 | `"suspended"` status, `updateCompanyAgent`, MCP workforce tools (6 tools), update agent tool, suspension lifecycle enforcement |

### Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| proposal.md | `openspec/changes/archive/2026-07-07-agent-company-kernel-extensions/proposal.md` | ✅ Present |
| specs/ | `openspec/changes/archive/2026-07-07-agent-company-kernel-extensions/specs/` (3 domains) | ✅ Present |
| design.md | `openspec/changes/archive/2026-07-07-agent-company-kernel-extensions/design.md` | ✅ Present |
| tasks.md | `openspec/changes/archive/2026-07-07-agent-company-kernel-extensions/tasks.md` (29 tasks, all [x]) | ✅ Present |
| verify-report.md | `openspec/changes/archive/2026-07-07-agent-company-kernel-extensions/verify-report.md` | ✅ Present |
| apply-progress.md | `openspec/changes/archive/2026-07-07-agent-company-kernel-extensions/apply-progress.md` | ✅ Present |
| archive-report.md | `openspec/changes/archive/2026-07-07-agent-company-kernel-extensions/archive-report.md` | ✅ Present |

### Final Metrics

| Metric | Value |
|--------|-------|
| Tasks completed | 29/29 (100%) |
| Scenarios compliant | 37/37 (100%) |
| Specs covered | 5 (workforce-cost-rollups, action-approval-safety, agent-skill-registry, multi-agent-orchestration, custom-business-mcp-tools) |
| Tests passing | 1,396/1,396 (47 files) |
| Build: typecheck | ⚠️ 1 test-only TS error (runtime correct) |
| Build: lint | ✅ 0 errors |
| Build: format | ⚠️ 5 files need formatting (3 changed + 2 pre-existing) |
| Source changes | 12 files, +2,859/-195 lines |
| Verdict | PASS WITH WARNINGS |

### Delta Specs Synced

| Delta Spec | Merged Into | Merge Style | Requirements Added |
|------------|-------------|-------------|-------------------|
| `specs/action-approval-safety/spec.md` | `openspec/specs/action-approval-safety/spec.md` | `## ADDED: Agent Company Kernel Extensions (2026-07-07)` | 1 (Budget Warnings in Block C Context) |
| `specs/custom-business-mcp-tools/spec.md` | `openspec/specs/custom-business-mcp-tools/spec.md` | `## ADDED: Agent Company Kernel Extensions (2026-07-07)` | 3 (Workforce Admin MCP Tools, Admin Authorization Gating, Mutation Tools Require Admin) |
| `specs/multi-agent-orchestration/spec.md` | `openspec/specs/multi-agent-orchestration/spec.md` | `## ADDED: Agent Company Kernel Extensions (2026-07-07)` | 3 (Suspended Agent Lifecycle, Update Company Agent, Skill-Aware Context) |

### Source Files Changed

- `src/database/workforceCostCacheLedgerStore.ts` (+267 lines)
- `src/database/companyAgentSkillStore.ts` (new, +161 lines)
- `src/database/companyAgentStore.ts` (+30 lines)
- `src/database/index.ts` (+3 lines)
- `src/agents/agentLoop.ts` (+248 lines)
- `src/agents/tools.ts` (+694 lines)
- `src/agents/companyAgents.ts` (+12 lines)
- `src/mcp/src/index.ts` (+287 lines)
- `src/mcp/src/runtimeDependencies.ts` (+23 lines)
- `tests/workforceCostCacheLedgerStore.test.ts` (+185 lines)
- `tests/agent.test.ts` (+188 lines)
- `tests/mcp.test.ts` (+124 lines)

### Issues Carried Forward

| Severity | Issue |
|----------|-------|
| WARNING | TypeScript type error in `agent.test.ts:586` — test code only, runtime correct |
| SUGGESTION | Format warnings on 3 changed files |
| SUGGESTION | `department_id` not in rollup UNIQUE key (safe in practice) |
| SUGGESTION | Spec headers miscount scenarios |

### Archive Verification

- [x] Main specs updated correctly
- [x] Change folder moved to archive (`openspec/changes/archive/2026-07-07-agent-company-kernel-extensions/`)
- [x] Archive contains all artifacts (proposal, specs, design, tasks, verify-report, apply-progress, archive-report)
- [x] Archived `tasks.md` has all implementation tasks checked (`[x]`)
- [x] Active changes directory no longer has this change

### SDD Cycle Closed

The change has been fully planned, implemented, verified, and archived. Ready for the next change.
