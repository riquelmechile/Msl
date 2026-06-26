# Proposal: Conversational Agent with DeepSeek — Natural Spanish Business Reasoning

## Intent

Replace the deterministic command-matching agent with a DeepSeek-powered conversational agent that converses in natural Spanish, infers intent without commands, proposes business actions requiring approval, and learns seller judgment via Cortex neural memory.

## Scope

### In Scope
- DeepSeek v4 Flash integration via `openai` npm + `baseURL`
- OpenAI Agents SDK JS (`@openai/agents`) for conversation loop, tool calling, guardrails
- 3-block prefix-anchored cache strategy (Block A: system prompt ~5K, Block B: daily aggregates ~15K, Block C: Cortex injection ~2K)
- Natural Spanish conversation — no commands, no menus
- Tool-based Cortex integration: `get_business_context` reads `GraphEngine.traverse().context`
- Safety gates: input/output guardrails mapped to `PreparedAction` → `ApprovalRecord` → `AuditRecord`
- Coexistence with deterministic `answerBusinessQuestion()` as structured fallback

### Out of Scope
- CEO strategy injection (Phase 3), Actor Models (Phase 4), Honey-Pot Probing (Phase 5), Real ML API (Phase 7)
- Multi-seller support, vector embeddings, semantic search
- Removal of deterministic agent (keep as fallback throughout Phase 2)

## Capabilities

### Modified Capabilities
- `conversational-business-agent`: Replace deterministic topic-matching with DeepSeek natural-language conversation; retain Spanish output, seller judgment learning, and business model learning requirements
- `action-approval-safety`: Extend approval pipeline to accept conversational agent proposals (LLM output → `PreparedAction` with `approvalStatus: "pending"`)

### New Capabilities
- None — this change modifies existing capabilities, not introducing new spec-level domains

## Approach

**Hybrid — OpenAI Agents SDK JS + Custom Cache Injection (Approach 4).**

`@openai/agents` handles conversation loop, streaming, tool calling, and guardrails. The 3-block cache strategy is injected via dynamic instruction assembly: Block A (static system prompt) + Block B (daily aggregates cached 24h) form a ~20K prefix-anchored cacheable segment. Block C injects Cortex context per-turn via the `get_business_context` tool, called by the agent only when needed. Guardrails enforce Spanish-only input, safety conflict detection (reusing deterministic agent's `detectSafetyConflict` logic), and action validation mapped to domain types.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/` | New | Conversation loop, system prompt builder, Cortex tools |
| `packages/agent/src/index.ts` | Modified | Export conversational entry points alongside deterministic agent |
| `packages/agent/package.json` | Modified | Add `openai`, `@openai/agents` dependencies |
| `apps/web/app/demo.ts` | Modified | Demonstrate conversational flow |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SDK v0.x API instability | Medium | Pin exact `@openai/agents` version; fallback to raw `openai` npm in hours |
| DeepSeek cache unpredictability | Low | Prefix-anchored structure (A+B identical across requests); Block C at end |
| Spanish guardrail false positives | Medium | Custom guardrails, not SDK defaults; test with Spanish prompts |
| Deterministic agent breakage | Low | Coexist — conversational path is additive, not replacement |

## Rollback Plan

1. Remove `@openai/agents` dependency
2. Remove `packages/agent/src/conversation/` directory
3. Revert `packages/agent/src/index.ts` to deterministic-only exports
4. Revert `apps/web/app/demo.ts` to deterministic agent usage
5. Rollback in minutes — no data migration required

## Dependencies

- `openai` npm (DeepSeek API via `baseURL`)
- `@openai/agents` npm (SDK for agent loop)
- `zod` (existing — tool parameter schemas)
- `DEEPSEEK_API_KEY` environment variable
- `@msl/memory` (existing Cortex `GraphEngine`)

## Success Criteria

- [ ] Seller can ask business questions in natural Spanish and receive relevant responses
- [ ] Agent proposes actions that require explicit "dale" approval (PreparedAction pipeline)
- [ ] Cortex learning: corrections adapt future recommendations via Hebbian updates
- [ ] 3-block cache delivers >90% cache hit rate on Block A+B
- [ ] Deterministic `answerBusinessQuestion()` still works as fallback
- [ ] All existing tests pass (deterministic agent + Cortex + safety gates)
