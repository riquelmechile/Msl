# Proposal: Agent Company Kernel Extensions

## Intent

Extend the Agent Company Kernel (`@msl/agent`) with three capabilities gated behind the existing Durable Company Kernel backbone. The current workforce operates with ephemeral lanes, a pruned raw cost ledger, and no skill registration. Agents lack durable identity metadata, the cost ledger throws away historical data after ~1,000 entries, and workforce admin tools are invisible to external MCP clients. This proposal adds durable skills, a cache-efficient dual-table ledger, MCP-admin surface, budget warnings, and an enhanced agent lifecycle — all within the existing Block C injection contract so DeepSeek prefix cache stays intact.

## Scope

### Phase A — Rich Cost Ledger (dual-table)

- **Rollup table**: `workforce_cost_cache_ledger_rollups` with columns `day TEXT`, `agent_id TEXT`, `department_id TEXT`, `model TEXT`, `input_tokens_agg INTEGER`, `output_tokens_agg INTEGER`, `cache_hit_tokens_agg INTEGER`, `cache_miss_tokens_agg INTEGER`, `estimated_cost_micros_agg INTEGER`, `entry_count INTEGER`
- **Auto-rollup on insert**: upsert today's row for `(agent_id, model)`, increment counters idempotently
- **Raw table scale-up**: increase `LEDGER_LIMITS.defaultMaxEntries` from `1_000` to `5_000` (~1 week of raw data with pruning)
- **New column**: `department_id TEXT` on `workforce_cost_cache_ledger_entries`
- **Time-range filter**: add `from`/`to` ISO date params to `ListWorkforceCostCacheLedgerEntriesFilter`
- **Richer context**: replace `buildWorkforceCostCacheContext` in `agentLoop.ts:447` with rollup-backed aggregation: last 7 days trends, per-department totals, cache efficiency ratio
- **Cache constraint**: ALL ledger context MUST remain in Block C only (appended via `buildBlockCContext` at `agentLoop.ts:517`)

### Phase B — Durable Skill Registry

- **New types** in `companyAgents.ts`: `SkillDefinition`, `AgentSkill`, `SkillCategory`
- **New store** `companyAgentSkillStore.ts`: SQLite table `agent_skills` with columns `skill_id TEXT PK`, `agent_id TEXT`, `label TEXT`, `category TEXT`, `description TEXT`, `proficiency REAL`, `declared_at TEXT`, `updated_at TEXT`
- **Store interface**: `insertAgentSkill`, `listAgentSkills` (by agent_id), `updateAgentSkill`
- **Tools**: `declare_agent_skill`, `list_agent_skills`, `update_agent_skill` in `tools.ts`
- **Skills are self-declared**: agents declare their own capabilities at registration or via admin tools — no CEO-defined catalog
- **Context injection**: skill summaries injected into Block C for the active agent (alongside existing lesson and cost context in `buildBlockCContext`)
- **Cache constraint**: skill context belongs in Block C only

### Phase C — MCP Exposure + Agent Lifecycle

- **MCP tools**: expose `list_company_agents`, `declare_skill`, `list_agent_skills`, `list_workforce_ledger`, `list_agent_lessons` via `@msl/mcp`
- **Update agent**: add `updateCompanyAgent` to `CompanyAgentStore` (allow profile field updates)
- **Suspended state**: add `"suspended"` to agent status enum (between `"active"` and `"archived"`) in `companyAgents.ts:28` and `companyAgentStore.ts:44`
- **Department column**: add `department_id` to ledger table for per-department queries
- **Budget warnings**: in Block C context, if agent/department exceeds a configurable budget hint, emit a non-blocking warning line

## Non-Goals

- No budget enforcement (warning-only per user decision)
- No department hierarchy (flat `"executive" | "operations" | "commercial"`)
- No agent self-registration (still requires admin authorization)
- No agent KPI/performance metrics tracking
- No migration of types to `@msl/domain` (types stay in `@msl/agent`)
- No lesson auto-creation from outcomes
- No foreign keys between tables

## Capabilities

### New Capabilities

- `agent-skill-registry`: durable self-declared skill registration per agent with CRUD store, tools, and Block C context injection
- `workforce-cost-rollups`: dual-table ledger with aggregated daily rollups surviving raw entry pruning; richer Block C cost context with trends and cache ratios

### Modified Capabilities

- `multi-agent-orchestration`: adds `suspended` lifecycle state, `updateCompanyAgent`, and skill-aware context injection into the workforce orchestration loop
- `custom-business-mcp-tools`: exposes workforce admin tools (`list_company_agents`, `declare_skill`, `list_agent_skills`, `list_workforce_ledger`, `list_agent_lessons`) via MCP server
- `cortex-darwinian-feedback`: enhanced cost/cache context with rollup-based trends feeding into Darwinian feedback loops

## DeepSeek Cache Strategy

DeepSeek V4 Context Caching on Disk is automatic (no code changes needed) and works as follows:

**Cache rules** (from [official docs](https://api-docs.deepseek.com/guides/kv_cache)):
- Cache anchors at **token 0** — only identical prefixes from position 0 get cache hits
- **Common prefix detection**: DeepSeek auto-identifies and persists shared prefixes across different requests as independent cache units
- Cache construction takes **seconds** — first call of session/day is a cold miss
- Cache auto-clears after **hours/days** — daily usage patterns matter
- **Best-effort**: no 100% hit guarantee; design must tolerate 0% hits
- Cache write: **$0** (free); cache read: **~5-8× cheaper** than full input

### Two-Layer Architecture (cache-optimized)

```
┌──────────────────────────────────────────────────────────────┐
│ LAYER 1 — Specialist Agents (cheap, cache-friendly)          │
│                                                               │
│  Model: Flash ($0.028/M cache read, $0.14/M full input)      │
│  Block A → shared prefix across ALL agents → auto cache hit  │
│  Lane prefix → cached per specialist lane                     │
│  Evidence → Block C dynamic (minor miss, small footprint)    │
│  Produces: compressed result for CEO                         │
└───────────────────────┬──────────────────────────────────────┘
                        │ results injected into Block C
                        ▼
┌──────────────────────────────────────────────────────────────┐
│ LAYER 2 — CEO Agent (informed, more expensive)                │
│                                                               │
│  Model: Pro ($0.145/M cache read, $1.74/M full input)        │
│  Block A+B → cache hit (stable)                              │
│  Block C → specialist results + ledger summary (dynamic)     │
│  Produces: business decision for Telegram                    │
└──────────────────────────────────────────────────────────────┘
```

**Cold-start strategy**: first call of day uses Flash (cheaper cold miss). Once cache is warm (cache_hit_tokens > 0), subsequent calls can use Pro for complex reasoning. `recordLlmUsage` in `agentLoop.ts:819` already tracks cache hit/miss — this feeds into the rollup table for cache efficiency monitoring.

### Ledger Cache Alignment

| Component | Resides in | Cache Impact |
|-----------|-----------|--------------|
| Raw ledger entries | SQLite only, NEVER to LLM | Zero |
| Daily rollup summary | Block C (~200 tokens) | Minimal — Block C is dynamic anyway |
| 7-day trend context | Block C (~300 tokens) | Minimal — same Block C budget |
| Budget warnings | Block C (~50 tokens) | Negligible |

The dual-table design (raw + rollups) ensures that what reaches the LLM is always a tiny aggregated summary, never raw token dump. This keeps Block C lean and the prefix cache (Block A+B) untouched.

## Approach

Layer extensions on top of the existing Durable Company Kernel backbone in `@msl/agent`:

1. **Ledger** (`workforceCostCacheLedgerStore.ts`): add rollup table schema + upsert trigger in `insertEntry`. Existing `buildWorkforceCostCacheContext` (`agentLoop.ts:447`) reads from rollups for aggregation, falling back to raw entries for recent detail. All context injected via `buildBlockCContext` (`agentLoop.ts:517`) — never touches Block A/B.

2. **Skills** (`companyAgentSkillStore.ts` — NEW file): follows the same pattern as `companyAgentLearningStore.ts` (SQLite + prepared statements). Registers as optional dependency on `AgentLoopConfig` alongside `companyAgentLearningStore` and `workforceCostCacheLedgerStore`. New `buildWorkforceSkillContext` function analogs `buildWorkforceLessonContext`.

3. **MCP** (`mcp/src/index.ts`): new tool factories wrapping existing `@msl/agent` store interfaces. Gated behind `companyAgentAdminAuthorized` flag.

4. **Lifecycle** (`companyAgentStore.ts`): add `UPDATE` prepared statement, extend `status` CHECK constraint to include `"suspended"`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/companyAgents.ts` | Modified | +`SkillDefinition`, +`AgentSkill`, +status `"suspended"` |
| `packages/agent/src/conversation/companyAgentSkillStore.ts` | New | Skill registry store (SQLite) |
| `packages/agent/src/conversation/workforceCostCacheLedgerStore.ts` | Modified | +rollup table, +`department_id`, time filter, maxEntries 5K |
| `packages/agent/src/conversation/companyAgentStore.ts` | Modified | +`updateCompanyAgent`, +`"suspended"` state |
| `packages/agent/src/conversation/tools.ts` | Modified | +skill tools, +`update_agent` tool, richer ledger listing |
| `packages/agent/src/conversation/agentLoop.ts` | Modified | Richer cost context, skill context, budget warnings |
| `packages/mcp/src/index.ts` | Modified | Expose workforce admin tools via MCP |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Raw ledger 1K→5K: 5× storage increase | Low | SQLite handles millions of rows trivially; pruning still runs on insert |
| Rollup table: concurrent upsert safety | Low | SQLite serializes writes; idempotent `INSERT … ON CONFLICT DO UPDATE` pattern |
| Self-declared skills: trust-the-agent model | Medium | Skills are self-declared metadata only; routing/gating decisions remain admin-controlled |
| MCP exposure expands attack surface | Medium | All workforce tools gated behind `companyAgentAdminAuthorized` flag |
| Cache invalidation if context leaks to Block A/B | Low | New context functions follow existing `appendBlockCSection` pattern explicitly |

## Rollback Plan

- Rollups: drop `workforce_cost_cache_ledger_rollups` table; raw ledger is unchanged
- Skills: drop `agent_skills` table and remove `buildWorkforceSkillContext` call from `buildBlockCContext`
- MCP tools: remove tool registrations from `mcp/src/index.ts` server setup
- Lifecycle: downgrade any `"suspended"` agents to `"archived"` before removing the state

## Dependencies

- Existing `better-sqlite3` (already in `@msl/agent`)
- Existing `@modelcontextprotocol/sdk` (already in `@msl/mcp`)
- No new external dependencies

## Success Criteria

- [ ] Rollup table stores aggregated daily stats per agent/model; survives raw entry pruning
- [ ] `buildWorkforceCostCacheContext` shows 7-day trends, per-department totals, cache efficiency
- [ ] Skill CRUD works via LLM tools and MCP; skills appear in Block C context
- [ ] `suspended` state prevents agent from receiving requests; admin can reactivate
- [ ] MCP `list_workforce_ledger` returns entries filtered by agent, department, and time range
- [ ] All new context (ledger, skills, budget warnings) stays in Block C — zero change to Block A/B
- [ ] Existing ledger, learning, and agent tests continue to pass

## Deviation from Exploration

| Exploration assumption | Final proposal |
|------------------------|----------------|
| Single raw table ledger | Dual-table: raw (recent, pruned) + rollups (daily/agent, never pruned) |
| CEO-defined skill catalog | Agent self-declared skills at registration |
| No MCP workforce tools | Full MCP exposure for workforce admin |
| Budget enforcement (blocking) | Budget warnings only (non-blocking) |
| Types migrate to `@msl/domain` | Types stay in `@msl/agent` |
