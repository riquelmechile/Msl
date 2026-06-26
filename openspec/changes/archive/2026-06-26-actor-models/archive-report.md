# Archive Report: Actor Models / Shadow Actors — Phase 4

**Change**: actor-models
**Date**: 2026-06-26
**Status**: Archived (PASS WITH WARNINGS)

## Summary

Implemented hybrid actor simulation models: 3 Cortex actor profile nodes (comprador, proveedor, competidor) with Spanish persona metadata, a `simulate_actor(name, query)` tool for on-demand LLM simulation, Hebbian learning feedback from confirmed seller outcomes, and CEO strategy guardrail validation.

## Artifacts

| Artifact | Path |
|----------|------|
| Proposal | `openspec/changes/archive/2026-06-26-actor-models/proposal.md` |
| Design | `openspec/changes/archive/2026-06-26-actor-models/design.md` |
| Tasks | `openspec/changes/archive/2026-06-26-actor-models/tasks.md` |
| Exploration | `openspec/changes/archive/2026-06-26-actor-models/exploration.md` |
| Spec: actor-simulation | `openspec/specs/actor-simulation/spec.md` (new canonical) |
| Spec: conversational-business-agent | `openspec/specs/conversational-business-agent/spec.md` (merged delta) |
| Verify Report | `openspec/changes/archive/2026-06-26-actor-models/verify-report.md` |

## Spec Delta Merges

1. **actor-simulation** → Created as new canonical spec at `openspec/specs/actor-simulation/spec.md` (5 requirements, 12 scenarios)
2. **conversational-business-agent** → 3 ADDED requirements merged into existing canonical spec: Actor Profile Injection in Cortex Context, simulate_actor Tool Routing, Actor Persona Section in System Prompt

## Implementation Summary

| Area | Files | Tests |
|------|-------|-------|
| Types | `packages/agent/src/conversation/types.ts`, `packages/memory/src/cortex/types.ts` | 5 tests |
| DB Schema | `packages/memory/src/cortex/database.ts` (actor_simulations table) | 1 test |
| Engine | `packages/memory/src/cortex/engine.ts` (seedActorNodes, reinforceActorOutcome, recordSimulation) | 17 tests |
| Actor Simulator | `packages/agent/src/conversation/actorSimulator.ts` | 21 tests |
| simulate_actor Tool | `packages/agent/src/conversation/tools.ts` | 10 tests |
| Agent Loop | `packages/agent/src/conversation/agentLoop.ts` (tool routing, mock client) | 7 integration tests |
| System Prompt | `packages/agent/src/conversation/systemPrompt.ts` (`## Actores del Mercado`) | 0 tests (coverage gap) |

## Test Summary

- **342 tests**, all passing (`vitest run`, 6.20s)
- Build: `tsc -b` + `next build` ✅
- Typecheck: `tsc -b --pretty false` ✅
- 13/21 spec scenarios compliant (62%), 0 failures, 5 untested, 3 partial

## Residual Warnings

1. `actor_profiles` dedicated section not implemented in `get_business_context` tool (spec scenario: "Actor profiles included")
2. No token cap logic (≤200 tokens per actor, top-3 filtering)
3. 5 UNTESTED scenarios across both specs
4. No test for `buildSystemPrompt` with `actorProfiles: true`

## Rollback Plan

1. Remove `simulate_actor` tool registration from agent loop
2. Drop `actor_simulations` table and actor metadata columns
3. Remove actor persona section from system prompt
4. Block C injection reverts to query-only context
5. Deploy rollback via single PR; no data loss outside simulation tracking
