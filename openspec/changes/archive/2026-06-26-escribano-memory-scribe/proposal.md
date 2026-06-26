# Proposal: El Escribano — Memory Scribe Agent

## Intent

The Cortex neural graph learns only from explicit action outcomes (probes, syncs, actor simulations). There's no observation layer that watches the full conversation and autonomously updates Cortex from implicit signals — confirmations ("dale"), rejections (guardrail blocks), strategy mentions, and repeating patterns. The Escribano fills this gap: a background agent that observes every conversation turn and writes Hebbian updates to Cortex automatically.

## Scope

### In Scope
- `EscribanoObserver` class with `observeTurn(state, response, proposal, outcome)` method
- Pattern detection: proposal accepted → strengthen edges, proposal rejected → weaken edges, guardrail violation → penalize edges
- Strategy-domain keyword extraction (margin, stock, price) → co-occurrence increments
- `findOrCreateConceptNode(label, metadata)` — idempotent concept node lookup on GraphEngine
- Auto-pruning: after N turns trigger Darwinian pruning
- Integration into `agentLoop.ts` after each `converse()` call
- Unit tests for all pattern detection paths

### Out of Scope
- LLM-based post-session analysis (Phase 2)
- Session lifecycle / `finalizeSession()`
- Novelty trigger logic
- New database tables (`conversation_patterns`, `learning_events`)
- Stream variant (`converseStream`) integration

## Capabilities

### Modified Capabilities
- `neural-graph-memory`: ADDED — automatic Hebbian learning from conversation outcomes via EscribanoObserver; new GraphEngine method `findOrCreateConceptNode(label, metadata)`

## Approach

Inline rule-based observer (Approach 1 from exploration), injected via `AgentLoopConfig` following existing patterns. The observer runs synchronously after each `converse()` return, analyzes the turn outcome via regex/keyword matching, and writes Hebbian updates to Cortex. Zero API cost, deterministic, testable.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/escribano.ts` | New | EscribanoObserver class + pattern detectors |
| `packages/agent/src/conversation/agentLoop.ts` | Modified | Wire observer after converse(); add escribano to AgentLoopConfig |
| `packages/agent/src/conversation/types.ts` | Modified | Add EscribanoConfig type |
| `packages/memory/src/cortex/engine.ts` | Modified | Add `findOrCreateConceptNode()` method |
| `packages/agent/src/conversation/guardrails.ts` | None | Reuse strategy keyword patterns |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Regex false positives on Spanish conversation | Low | Scope to high-confidence patterns only (explicit "dale", explicit guardrail blocks, known strategy keywords) |
| Cortex write contention | Low | SQLite WAL mode serializes writes; observer runs synchronously post-turn |
| Duplicate concept nodes | Low | `findOrCreateConceptNode` is idempotent on label |

## Rollback Plan

Remove the `escribano` field from `AgentLoopConfig` (optional, so omitting it reverts to no-op). Delete `escribano.ts`. The `findOrCreateConceptNode` method on GraphEngine is additive and harmless if unused.

## Dependencies

- Existing `GraphEngine` with `reinforceEdge`, `penalizeEdge`, `createNode`, `createEdge`, `prune()`
- Existing `isConfirmation()` helper in `agentLoop.ts`
- Existing strategy keyword patterns in `guardrails.ts` and `strategyParser.ts`

## Success Criteria

- [ ] EscribanoObserver correctly strengthens Cortex edges on confirmed "dale" proposals
- [ ] EscribanoObserver correctly weakens/penalizes edges on guardrail-rejected proposals
- [ ] Strategy domain mentions (margin, stock, price) increment co-occurrence on relevant edges
- [ ] `findOrCreateConceptNode` is idempotent — same label returns existing node
- [ ] All tests pass: `npm test`
- [ ] Typecheck passes: `npm run typecheck`
