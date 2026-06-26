# Proposal: Actor Models / Shadow Actors — Phase 4

## Intent

The agent reasons exclusively from seller data. It cannot anticipate how buyers, suppliers, or competitors would react to pricing or sourcing decisions. This change gives the agent internal simulation models so recommendations account for counter-party behavior grounded in MercadoLibre Chile market realities.

## Scope

### In Scope
- 3 actor types: comprador (buyer), proveedor (supplier), competidor (competitor)
- Cortex actor profile nodes with Chilean market metadata, auto-injected as Block C context
- `simulate_actor` tool for on-demand deep LLM simulation per actor
- Hebbian learning loop: reinforce/penalize actor edges from confirmed seller outcomes
- `actor_simulations` table for tracking consultations → outcomes
- Guardrail compliance: CEO strategies override actor-advised proposals

### Out of Scope
- Multi-agent orchestration (Phase 6)
- Real-time market data scraping
- External agent spawning or inter-agent messaging

## Capabilities

### New Capabilities
- `actor-simulation-engine`: simulate_actor tool with actor-specific Spanish system prompts (comprador/proveedor/competidor personas); simulation outcome tracking; actor persona prompt curation.

### Modified Capabilities
- `neural-graph-memory`: GraphEngine gains seedActorNodes(), reinforceActorOutcome(), penalizeActorOutcome(); schema adds actor_simulations table and actor metadata columns on nodes.
- `conversational-business-agent`: agentLoop routes simulate_actor tool calls; get_business_context includes activated actor profiles; system prompt injects actor personas section.

## Approach

**Hybrid: Cortex profiles + on-demand simulate_actor tool** (Approach 5 from exploration).

Default turns: actor profiles injected via Cortex Block C (~100–200 tokens per actor, top-3 activated) at near-zero marginal cost. Deep simulation turns (~10–30% of pricing/competition queries): agent calls `simulate_actor(name, query)` for fresh LLM evaluation. Outcomes feed back via Hebbian reinforcement. Existing prefix cache (Blocks A+B) is preserved — actor profiles land in Block C only.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/memory/src/cortex/engine.ts` | Modified | Actor methods + node seeding |
| `packages/memory/src/cortex/database.ts` | Modified | Schema: actor_simulations, node metadata |
| `packages/agent/src/conversation/tools.ts` | Modified | New simulate_actor tool definition |
| `packages/agent/src/conversation/agentLoop.ts` | Modified | Route actor tool calls, inject profiles |
| `packages/agent/src/conversation/systemPrompt.ts` | Modified | Actor persona section |
| `packages/agent/src/conversation/types.ts` | Modified | Actor types, simulation request/response |
| `packages/agent/src/conversation/guardrails.ts` | Modified | Strategy-aware actor proposals |
| `ROADMAP.md` | Modified | Phase 4 status |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Token budget creep in Block C | Med | Cap profiles at 200 tokens, limit to top-3 actors |
| LLM hallucination in simulate_actor | Low | Constrain prompts with Cortex data; penalize wrong simulations |
| Multi-turn tool call latency (4 LLM round-trips worst-case) | Low | Batch tool calls; simulate only when first-pass insufficient |
| Actor profiles contradict CEO strategies | Low | strategyValidator runs after actor consultation — CEO wins |

## Rollback Plan

1. Remove `simulate_actor` tool registration from agent loop
2. Drop `actor_simulations` table and actor metadata columns (reversible migration)
3. Remove actor persona section from system prompt
4. Block C injection reverts to query-only context (no actor profiles)
5. Deploy rollback via single PR; no data loss outside simulation tracking

## Dependencies

- Existing Cortex graph engine + Hebbian learning (neural-graph-memory)
- Existing agent loop tool-calling infrastructure (conversational-business-agent)
- CEO strategy pipeline (strategyValidator must remain after actor consultation)

## Success Criteria

- [ ] Agent produces recommendations referencing buyer/supplier/competitor behavior
- [ ] simulate_actor tool returns structured Spanish simulation output
- [ ] Actor profiles auto-activate via Cortex traversal on relevant queries
- [ ] Confirmed outcomes feed back via Hebbian reinforcement (edges strengthen/weaken)
- [ ] CEO strategy compliance unchanged — actor advice never bypasses guardrails
- [ ] Per-turn cost within 15% of current baseline for non-simulation turns
