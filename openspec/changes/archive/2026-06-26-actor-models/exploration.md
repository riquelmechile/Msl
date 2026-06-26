# Exploration: Actor Models / Shadow Actors (Phase 4)

## Current State

The agent loop (`packages/agent/src/conversation/agentLoop.ts`) processes a single user message per turn via the DeepSeek LLM. The system prompt establishes business identity and hard rules; CEO strategies are injected as a `## Estrategias del CEO` section. Two tools exist:

- **`get_business_context`** — queries the Cortex neural graph via spreading activation, returning activated nodes/edges as key-value context injected into the LLM prompt.
- **`prepare_action`** — maps an LLM-generated action description into an `AgentProposal` that enters the guardrail pipeline (`strategyValidator` → `actionSafetyValidator`) and requires explicit seller confirmation ("dale").

The Cortex neural graph (`packages/memory/src/cortex/engine.ts`) provides Hebbian learning (`reinforceEdge` / `penalizeEdge`), spreading activation via recursive CTE, Darwinian pruning (weight < 0.05), and convergence detection. The `TraversalResult.context` is a flat key-value record injected into the LLM prompt as Block C (query-specific, ~0.3–2K tokens).

The guardrail system (`packages/agent/src/conversation/guardrails.ts`) validates Spanish input, filters harmful content, checks action safety against domain risk levels, and validates proposals against CEO strategies (margin floors, category exclusions, pricing caps).

**What's missing**: The agent reasons from a SINGLE perspective — it has system prompt + CEO strategies + Cortex context, but no internal simulation of buyer/seller/competitor mental models. Every recommendation is based on the seller's data alone, without modeling how the other side (buyer, supplier, competitor) would react.

## Affected Areas

- **`packages/agent/src/conversation/tools.ts`** — new tool definitions for actor simulation (or extended context injection). This is the primary integration surface.
- **`packages/agent/src/conversation/agentLoop.ts`** — the `converse()` method must route actor consultation tool calls, and optionally pre-load actor context into the messages array. The `LlmClient` interface may need to handle multi-turn tool call loops.
- **`packages/agent/src/conversation/systemPrompt.ts`** — `buildSystemPrompt()` may need to include actor personas as a new prompt section (similar to CEO strategies).
- **`packages/agent/src/conversation/types.ts`** — new types for actor definitions, actor consultation requests/responses, and agent-specific `Strategy` extensions (`RuleType.competitor` already exists but has no actor semantics).
- **`packages/memory/src/cortex/engine.ts`** — `GraphEngine` may need actor-specific methods: `seedActorNodes()`, `reinforceActorOutcome()`, `penalizeActorOutcome()`.
- **`packages/memory/src/cortex/database.ts`** — schema migration to add actor-specific metadata columns on `nodes` or a new `actor_simulations` table for outcome tracking.
- **`packages/agent/src/conversation/guardrails.ts`** — actor simulation outputs must not bypass strategy validation; the `strategyValidator` must be aware that actor-advised proposals still require CEO compliance checks.
- **`ROADMAP.md`** — Phase 4 tracker update.

## Approaches

### 1. Independent LLM Calls per Actor (Parallel Sub-Prompts)

For each actor persona (buyer, supplier, competitor, repeat customer, seller self-model), fire a separate, parallel LLM call with an actor-specific system prompt. The main agent receives summaries of all actor responses and synthesizes a final recommendation.

- **Pros**: Deep, independent reasoning for each actor. No cross-contamination between actor perspectives. Each actor prompt can be heavily customized with demographic/MercadoLibre Chile specifics.
- **Cons**: N LLM calls per turn (minimum 3: buyer, supplier, competitor). Expensive in tokens and latency. Destroys DeepSeek's prefix cache because each actor prompt is different. Complex orchestration. Hard to test end-to-end. Each actor call consumes its own Block A/B/C budget.
- **Effort**: High

### 2. Single-Prompt Chain-of-Thought (Self-Simulation)

Extend the system prompt to instruct the LLM to internally simulate buyer, supplier, and competitor perspectives as a structured chain-of-thought before producing its response. Example: "Antes de recomendar, simulá: 1) ¿Qué pensaría un comprador típico de ML Chile al ver este precio? 2) ¿Qué condiciones daría el proveedor para este volumen? 3) ¿Cómo reaccionaría la competencia?"

- **Pros**: Zero infrastructure changes. Single LLM call — cheapest option. Works with existing tool calling. No additional token budget for tool results. Trivially testable (mock client can be extended).
- **Cons**: LLMs are unreliable at structured internal simulation without enforcement. Cannot validate whether the simulation actually occurred or was hallucinated. No learning mechanism — the agent can't improve its simulation over time. Mixes simulation with recommendation in one response — hard to audit which parts were "simulated" vs. "assumed."
- **Effort**: Low

### 3. Tool-Based Shadow Actors (`consult_buyer`, `consult_supplier`, `consult_competitor`)

Add new tool definitions (matching the existing `get_business_context` pattern) that the main LLM can invoke on-demand. Each tool wraps a focused LLM call with an actor-specific system prompt + relevant Cortex context. The main agent decides WHICH actors to consult and WHEN, then synthesizes results.

```typescript
// Example tool shape:
{
  name: "consult_buyer",
  description: "Simula la perspectiva de un comprador típico de MercadoLibre Chile.",
  parameters: {
    query: "string",    // e.g., "¿Comprarías este producto a $15.000 dado que la competencia lo vende a $13.500?"
    category: "string", // e.g., "Hogar y Muebles"
    pricePoint: "number"
  },
  execute: (args) => { /* focused LLM call with buyer persona prompt */ }
}
```

- **Pros**: Follows existing tool-calling pattern (`get_business_context`, `prepare_action`). On-demand — only consults actors when the main LLM deems it necessary (not every turn). Each tool independently testable with Vitest. Structured output enables verification. Actor consultations are logged in conversation history for audit. CEO strategies apply AFTER actor consultation, maintaining the guardrail pipeline.
- **Cons**: Each tool invocation that makes an LLM call adds latency and token cost. DeepSeek function-calling with tool results requires a follow-up LLM call (the main model processes the tool result). If all 3 actors are consulted, that's ~3 LLM calls + 1 main call = 4 calls per turn worst-case.
- **Effort**: Medium

### 4. Cortex-Backed Actor Profiles + Single Call (Profile Injection)

Store actor personas as Cortex graph nodes with rich metadata (demographic data, typical price sensitivity, trust factors, MercadoLibre Chile market behavior). On each conversation turn, spread activation from relevant actor nodes, and inject the resulting context into Block C along with the rest of the query-specific context. The main LLM reasons with these profiles as structured data, not as separate simulation calls.

```typescript
// Cortex nodes:
// BUYER_CHILE_TYPICAL → metadata: { price_sensitivity: "high", trust_drivers: ["reputation", "free_shipping"] }
// SUPPLIER_PLASTICOV → metadata: { min_order: 10, lead_time_days: 14, negotiation_lever: "volume" }
// COMPETITOR_ML_CATEGORY → metadata: { avg_price: 13500, listings: 89, strategy: "undercut_5pct" }
```

- **Pros**: Single LLM call (cheapest after Approach 2). Leverages existing Cortex infrastructure — Hebbian learning can strengthen/weaken connections between actor profiles and successful outcomes. DeepSeek's prefix cache anchors on the system prompt (Block A) — actor profile context is in Block C, which is cheap. Darwinian pruning naturally removes stale or inaccurate actor profiles. Profiles are auditable (stored in SQLite).
- **Cons**: Actor profiles are static between updates — they don't do fresh "reasoning" per query, they provide pre-computed biases. Requires seeding with good initial data. Initial activation patterns may be sparse until enough outcome data accumulates. No ability to simulate a nuanced "what if" scenario (e.g., "What if the buyer is particularly price-sensitive this week due to CyberMonday?").
- **Effort**: Medium

### 5. Hybrid: Cortex Profiles + On-Demand Tool

Combine Approaches 3 and 4. Actor profiles are stored as Cortex nodes and injected as context (Block C) on every turn, providing baseline behavioral priors. When the main LLM needs deeper simulation for a specific actor (e.g., a price change that could trigger competitive retaliation), it calls the `simulate_actor` tool to get a fresh, focused LLM evaluation. After the simulation, outcomes are stored back to Cortex via Hebbian reinforcement.

```
Turn flow:
1. User message
2. get_business_context() → Cortex activation (includes actor profile nodes)
3. Main LLM evaluates: "Do I need deeper actor simulation?"
4. IF yes: simulate_actor("buyer", query) → focused LLM call → result injected
5. Main LLM produces response + optional prepare_action() proposal
6. After outcome confirmed by seller: reinforceActorOutcome() in Cortex
```

- **Pros**: Best of both worlds — baseline actor awareness is essentially free (Cortex context injection, one call), deep simulation available on-demand (tool call). Learning loop is closed — outcomes feed back into Cortex. Cost is proportional to depth required (most turns are Approach 4; complex pricing/competition turns are Approach 3). CEO strategy compliance chain is preserved.
- **Cons**: More complex than any single approach. Two integration surfaces (Cortex injection + tool definition). Requires database migration for actor simulation tracking.
- **Effort**: Medium-High

## Recommendation

**Approach 5: Hybrid — Cortex Profiles + On-Demand `simulate_actor` Tool**

Rationale:

1. **Cost alignment with DeepSeek cache strategy**: Actor profiles injected via Cortex (Block C) cost ~$0.0003 per message. The `simulate_actor` tool is only called when the main LLM decides it's needed (est. 10–30% of turns for pricing/competition queries, 0% for simple questions). This keeps the per-turn cost close to the current baseline.

2. **Learning loop closure**: The Cortex already has Hebbian reinforcement (`reinforceEdge`, `penalizeEdge`). Actor profiles stored as graph nodes can have their edges strengthened when the simulation leads to a confirmed outcome that the seller rates positively, and weakened when it leads to poor results. This is the "shadow actors learn from outcomes" requirement from the roadmap.

3. **Incremental architecture**: This approach does NOT change the existing agent loop flow. It adds a new tool (parallel to `get_business_context` and `prepare_action`) and extends Cortex with actor-specific methods. The existing guardrail pipeline (`strategyValidator`, `actionSafetyValidator`) is preserved — actor-advised proposals still require CEO strategy compliance and seller "dale" confirmation.

4. **Testability**: Each actor tool is independently testable with Vitest (same pattern as `createGetBusinessContextTool`). Cortex actor nodes can be seeded in test fixtures. The main agent loop's mock client can be extended to simulate actor consultation scenarios.

5. **MercadoLibre Chile specificity**: Actor profiles can be seeded with real market data (price sensitivity of Chilean buyers, typical ML Chile supplier terms, competitive landscape by category) — stored as Cortex node metadata. This makes the simulation grounded in actual business data, not generic LLM priors.

### Implementation outline (Phase 4 decomposition)

1. **Cortex extension**: Add `ActorProfile` nodes to the database schema, plus `actor_simulations` table for tracking consultations → outcomes.
2. **`simulate_actor` tool**: New tool definition in `tools.ts` that wraps a focused LLM call with actor-specific system prompts.
3. **Actor context injection**: Extend `get_business_context` (or create a parallel `get_actor_context`) to include activated actor profile nodes in the traversal result.
4. **Guardrail integration**: Ensure `strategyValidator` checks actor-advised proposals.
5. **Learning loop**: `reinforceActorOutcome()` and `penalizeActorOutcome()` methods on `GraphEngine`.
6. **Actor persona prompts**: Curated Spanish system prompts for each actor type (buyer, supplier, competitor, repeat customer, seller self-model).

## Risks

- **Token budget creep**: Actor profile context in Block C might exceed the 2K token budget if profiles are too verbose. Mitigation: keep profiles concise (~100–200 tokens each), limit activation to top-3 most relevant actors per query.
- **LLM hallucination in simulation**: The `simulate_actor` tool relies on LLM reasoning, which can hallucinate buyer behavior. Mitigation: constrain the tool prompt with hard data (Cortex context), and use the learning loop to penalize consistently wrong simulations.
- **Multi-turn tool calling complexity**: DeepSeek function-calling with tool results requires a follow-up LLM call. If both `get_business_context` and `simulate_actor` are called in the same turn, that's 3+ LLM round-trips. Mitigation: batch tool calls where possible, and only call `simulate_actor` when the main LLM's first-pass analysis (with Cortex context) is insufficient.
- **Seeding actor profiles**: Initial actor profiles need market data that may not yet exist in Cortex (no buyer demographics, no competitive pricing data). Mitigation: use static seed data from ML Chile market research, treat as "moderate confidence" until Hebbian updates refine them.
- **CEO strategy conflicts**: An actor simulation might contradict a CEO strategy (e.g., buyer model says "price higher" but CEO strategy says "margin minimum 50%"). Mitigation: the existing `strategyValidator` runs AFTER actor consultation — CEO strategies always win.

## Ready for Proposal

**Yes.** The codebase is well-understood, the integration points are clear, and the approach is defined. The orchestrator should proceed with `sdd-propose` for `actor-models`.

The proposal should:
- Define the specific actor types and their persona prompts
- Specify the Cortex schema migration
- Define the `simulate_actor` tool contract
- Clarify the learning loop (reinforce/penalize rules)
- Include the token budget analysis for each actor context injection
