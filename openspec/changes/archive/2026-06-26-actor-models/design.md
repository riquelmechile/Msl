# Design: Actor Models / Shadow Actors — Phase 4

## Technical Approach

Hybrid: Cortex actor profile nodes provide baseline behavioral priors at near-zero marginal cost (Block C injection, top-3 activated). On-demand `simulate_actor(name, query)` fires a focused DeepSeek call with actor-specific Spanish persona prompts for ~10–30% of pricing/competition turns. Outcomes feed back via Hebbian reinforcement on the Cortex graph. CEO guardrail pipeline runs after actor consultation — strategies always win.

```
User msg → input guardrails → strategy CRUD routing → get_business_context (Cortex, incl. actor profiles)
  → LLM evaluates: actor sim needed?
    → simulate_actor(name, query) → inject result
  → synthesize response → prepare_action? → strategyValidator → response
  → (later, seller confirms) → reinforceActorOutcome / penalizeActorOutcome
```

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|-----------|
| Tool surface | Single `simulate_actor(name, query)` | One tool per actor type | Keeps tool list small (3 → 4 tools), follows `get_business_context` pattern, validates name at execution |
| Actor prompts location | `packages/agent/src/conversation/actorSimulator.ts` | Inline in tools.ts, or in system prompt | Separation of concerns — actor simulation is an independent module, testable in isolation |
| Profile injection path | Extend `GraphEngine.traverse()` to detect `actor_profile` nodes | New `get_actor_context` tool | Single Cortex call — profiles ride on existing spreading activation, no extra tool registration |
| DB migration | Add `actor_simulations` table to `SCHEMA_SQL` | Separate migration file | No migration framework exists in this codebase; `CREATE TABLE IF NOT EXISTS` is the established pattern |
| Actor profile seeding | `seedActorNodes()` called once from agent init, upserts via `INSERT OR REPLACE` | Seed in CLI script | Follows existing `createAnimalNodes` pattern; idempotent across restarts |
| Learning edges | Connect actor nodes to context nodes via `createEdge` on first co-activation | Pre-seed all connections | Mirrors organic Cortex behavior — edges form naturally through spreading activation, then Hebbian adjusts weights |

## Data Flow

```
seedActorNodes() → 3 Cortex nodes: comprador_ml_chile, proveedor_generico, competidor_categoria
On pricing query → spreadActivation([query seeds]) → actor nodes activate → traverse() includes actor_profiles
In LLM turn → system prompt includes ## Actores del Mercado → get_business_context returns profiles
On need → simulate_actor("comprador", query) → LLM call with persona prompt → SimulationResult → row in actor_simulations
On seller "dale" → reinforceActorOutcome(simId) → +0.1 on actor→context edges
On seller rejection → penalizeActorOutcome(simId) → −0.15 on actor→context edges
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/actorSimulator.ts` | Create | `simulateActor()`, actor persona prompts (comprador/proveedor/competidor), `SimulationResult` type |
| `packages/agent/src/conversation/types.ts` | Modify | Add `ActorType`, `SimulationResult`, `ActorProfile` types |
| `packages/agent/src/conversation/tools.ts` | Modify | Add `createSimulateActorTool(engine)` following ToolDefinition pattern |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Register simulate_actor tool, route tool calls, inject actor profiles into system prompt |
| `packages/agent/src/conversation/systemPrompt.ts` | Modify | `buildSystemPrompt` accepts optional `ActorProfile[]`, appends `## Actores del Mercado` |
| `packages/memory/src/cortex/engine.ts` | Modify | `seedActorNodes()`, `reinforceActorOutcome()`, `penalizeActorOutcome()` |
| `packages/memory/src/cortex/database.ts` | Modify | Schema: `actor_simulations` table, `actor_type` column on nodes |
| `packages/memory/src/cortex/types.ts` | Modify | `ActorSimulation` row type |

## Interfaces / Contracts

```typescript
// types.ts additions
type ActorType = "comprador" | "proveedor" | "competidor";

type ActorProfile = {
  actorType: ActorType;
  traits: Record<string, string | number>;
  activation: number;
};

type SimulationResult = {
  actorType: ActorType;
  recommendation: string;
  confidence: number;
  rationale: string;
  simulationId: number; // FK → actor_simulations
};

// engine.ts additions
seedActorNodes(): void; // CREATE OR REPLACE 3 actor profile nodes
reinforceActorOutcome(simulationId: number): void; // +0.1 to actor→context edges
penalizeActorOutcome(simulationId: number): void;  // −0.15 to actor→context edges
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `actorSimulator.ts` — persona prompts, simulateActor function | Vitest, mock LlmClient |
| Unit | `engine.ts` — seedActorNodes idempotency, reinforce/penalize clamping | Vitest with in-memory SQLite |
| Unit | `tools.ts` — createSimulateActorTool validation (invalid name, empty query) | Vitest, inject mock engine |
| Unit | `guardrails.ts` — strategyValidator + actor-advised proposals | Existing test patterns |
| Integration | Agent loop turn with simulate_actor tool call | Vitest, mock client + mock engine |
| E2E | Full conversation with actor consultation → proposal → guardrail | Playwright (if supported platform) |

## Migration / Rollout

No data migration required — `actor_simulations` table is additive (`CREATE TABLE IF NOT EXISTS`). Actor profile node seeding is idempotent. Rollback plan: remove tool registration, drop table, remove prompt section (all reversible in single PR).

## Open Questions

- [ ] Should `reinforceActorOutcome` connect actor nodes to ALL context nodes from the simulation turn, or only to nodes from the same `get_business_context` call? (Proposal: only context nodes that appeared in that turn's traversal — avoids noise.)
- [ ] How to link simulation → confirmed outcome: pass `simulationId` through the proposal pipeline, or log by timestamp correlation? (Proposal: pass `simulationId` on `AgentProposal` as an optional field, used when seller confirms.)
