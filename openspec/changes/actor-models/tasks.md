# Tasks: Actor Models / Shadow Actors — Phase 4

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~540–570 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Types, DB schema, engine methods | PR 1 | Autonomous: seedActorNodes, reinforce/penalize + tests |
| 2 | ActorSimulator + createSimulateActorTool | PR 2 | Autonomous: 3 persona prompts, tool definition + tests |
| 3 | Agent loop wiring, system prompt, integration | PR 3 | Depends on PR 1+2 for types and tool |

## Phase 1: Foundation — Types, Schema & Engine

- [x] 1.1 Add `ActorType`, `ActorProfile`, `SimulationResult` to `packages/agent/src/conversation/types.ts`
- [x] 1.2 Add `ActorSimulation` row type to `packages/memory/src/cortex/types.ts`
- [x] 1.3 Add `actor_simulations` table to `SCHEMA_SQL` in `packages/memory/src/cortex/database.ts`
- [x] 1.4 Add `seedActorNodes()` to `GraphEngine` — upsert 3 actor nodes with Spanish metadata
- [x] 1.5 Add `reinforceActorOutcome(simId)` + `penalizeActorOutcome(simId)` to `GraphEngine`
- [x] 1.6 Write unit tests: seed idempotency, reinforce/penalize clamping, edge creation

## Phase 2: Core — ActorSimulator & simulate_actor Tool

- [ ] 2.1 Create `packages/agent/src/conversation/actorSimulator.ts` with 3 persona prompts and `simulateActor(name, query)` function
- [ ] 2.2 Add `createSimulateActorTool(engine)` to `packages/agent/src/conversation/tools.ts` following ToolDefinition pattern
- [ ] 2.3 Write unit tests for actorSimulator: valid/invalid actor name, empty query, prompt structure
- [ ] 2.4 Write unit tests for createSimulateActorTool: validation errors, execution with mock engine

## Phase 3: Integration — Agent Loop, System Prompt & Guardrails

- [ ] 3.1 Register `simulate_actor` tool in `createAgentLoop` and route tool calls in `converse()`
- [ ] 3.2 Inject actor profiles from `traverse()` result into Block C via `get_business_context`
- [ ] 3.3 Add `## Actores del Mercado` section to `buildSystemPrompt()` when profiles are seeded
- [ ] 3.4 Verify `strategyValidator` still runs after actor consultation (CEO wins)
- [ ] 3.5 Write integration tests: full turn with simulate_actor tool call, profile injection, guardrail
