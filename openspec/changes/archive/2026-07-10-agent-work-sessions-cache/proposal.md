# Proposal: Agent Work Sessions & Cache

## Intent

Agents fire-and-forget every 15 minutes — no session persistence, no wake/sleep lifecycle, no cross-cycle experience recording, no cache-friendly prompt structuring. This causes redundant LLM calls, untraceable cost by seller, and no agent "memory" of prior cycles. Add stateful session lifecycles atop the existing stateless daemon infrastructure.

## Scope

### In Scope
- `AgentWorkSession` domain types (session, observation, lesson)
- `AgentWorkSessionStore` (SQLite, 5 tables, seller-scoped)
- Wake policy: signal hashing + cooldown + deduplication
- Cache-friendly prompt builder: stable prefix + variable evidence
- `AgentWorkSessionRunner` orchestrating full cycle per agent
- DaemonScheduler session-aware dispatch (opt-in)
- Cortex session recording bridge (nodes/edges/lessons)
- Shift summaries: morning brief + EOD via DB (no LLM)
- `seller_id` column on `workforce_cost_cache_ledger_entries`
- CEO tool: `get_agent_work_status` (query, no UI)
- 15 test scenarios across stores, sessions, cache, and isolation

### Out of Scope
- No dashboard UI — backend only
- No multi-bot
- No ML API writes
- No VPS/deployment
- No cross-seller data mixing (Plasticov ≠ Maustian)

## Capabilities

### New Capabilities
- `agent-work-session-model`: Domain types for session lifecycle, observations, lessons, and routine config
- `agent-work-session-store`: SQLite persistence with `seller_id` scoping, following existing store patterns
- `agent-wake-policy`: Signal hashing, cooldown windows, deduplication — no LLM call without signal
- `cache-friendly-prompt-builder`: Stable prefix ordering + variable evidence tail for DeepSeek disk cache
- `agent-work-session-runner`: Orchestrates full cycle (wake → observe → act → learn → sleep) per agent × seller
- `agent-shift-summaries`: Morning brief + EOD summaries from DB queries, no LLM required

### Modified Capabilities
- `daemon-scheduler`: Add optional session hooks — handler signature extensible, no breaking changes
- `neural-graph-memory`: Session node creation, observation recording, Hebbian reinforcement per session
- `workforce-cost-rollups`: Add `seller_id` column to `workforce_cost_cache_ledger_entries`
- `conversational-business-agent`: Register `get_agent_work_status` as internal workforce tool

## Approach

Additive enhancement — no breaking changes. New stores follow `createTableIfNotExists` + `columnExists()` patterns. Scheduler dispatch adds optional session context; handlers that don't use it remain unchanged. Prompt builder is a helper injected into existing advisors. Cortex bridge reuses `getOrCreateNode()` + `reinforceEdge()`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/workers/daemonScheduler.ts` | Modified | Session-aware dispatch hooks |
| `packages/agent/src/workers/daemonTypes.ts` | Modified | Extend `DaemonHandler` with optional session params |
| `packages/agent/src/conversation/workforceCostCacheLedgerStore.ts` | Modified | Add `seller_id` column |
| `packages/agent/src/sessions/AgentWorkSessionStore.ts` | New | Session + observation + lesson persistence |
| `packages/agent/src/sessions/AgentWorkSessionRunner.ts` | New | Full session lifecycle orchestrator |
| `packages/agent/src/prompts/cacheFriendlyPromptBuilder.ts` | New | Stable-prefix prompt construction |
| `packages/memory/src/cortex/engine.ts` | Modified | Session node recording methods |
| `packages/domain/src/agentWorkSession.ts` | New | Session domain types |
| `packages/agent/src/conversation/tools.ts` | Modified | Register `get_agent_work_status` tool |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Session store adds latency to daemon cycle | Low | SQLite in-process; queries are single-digit ms |
| Cross-seller data leak | Low | `seller_id` on every table; query filters enforced |
| Cache prefix breakage on code changes | Medium | Prefix hash validation; cache-hit ratio monitoring |
| Handler migration burden | Low | Session params optional; handlers unchanged if not needed |

## Rollback Plan

1. Set `MSL_AGENT_SESSIONS_ENABLED=false` → session runner short-circuits
2. `seller_id` column on ledger is additive (NULL default) — no data loss
3. No existing handler signatures broken — all changes additive

## Dependencies

- Daemon Scheduler (exists — `startDaemonScheduler`, `DaemonHandler` signature)
- Agent Message Bus (exists — dedupe keys, claim/resolve)
- Cortex Graph Engine (exists — `createNode`, `reinforceEdge`, seller scoping)
- Workforce Cost Cache Ledger (exists — entry + rollup tables)
- DeepSeek Transport (exists — `deepseekTransport`, `prompt_tokens_details.cached_tokens`)

## Success Criteria

- [ ] Session state survives across daemon cycles in SQLite (`:memory:` for tests, file for integration)
- [ ] Wake policy prevents redundant LLM calls when signals unchanged
- [ ] Cache-friendly prompts improve `prompt_cache_hit_tokens` ratio per agent seller
- [ ] `seller_id` on cost ledger enables per-account cost attribution
- [ ] Zero cross-contamination between Plasticov and Maustian session data
- [ ] All 15 test scenarios pass; existing Vitest suites unaffected
