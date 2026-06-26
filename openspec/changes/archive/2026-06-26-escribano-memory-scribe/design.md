# Design: El Escribano — Memory Scribe Agent (Phase 1)

## Technical Approach

Synchronous post-turn observer injected into `agentLoop.ts` via `AgentLoopConfig.escribano`. Runs after `converse()` returns, analyzes turn outcome via regex/keyword heuristics, and applies Hebbian updates to Cortex through existing `GraphEngine` primitives + new `findOrCreateConceptNode()`.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Middleware hook chain | Overengineered for 4 observers; no existing middleware pattern | Reject — single class with private detector methods |
| Per-turn pruning | Excessive DB writes; weight decays slowly | Every N turns (N=10) |
| New tables for patterns | Adds schema migration; rule-based patterns are transient | Reject — existing edges + nodes are sufficient |

**Rationale**: Single class follows existing patterns (`AutonomyEngine`, `StrategyStore` injected into `AgentLoopConfig`). Regex-based detection reuses Spanish keyword patterns already in `guardrails.ts`. Cortex primitives already exist — only `findOrCreateConceptNode` is new.

## Data Flow

```
converse() → ConverseResult { response, updatedState, proposal }
     │
     ▼ (if config.escribano)
EscribanoObserver.observeTurn(state, response, proposal, outcome)
     │
     ├── detectConfirmation()  → reinforceEdge on involved nodes
     ├── detectRejection()     → penalizeEdge on rejected nodes
     ├── detectStrategyMention() → findOrCreateConceptNode + co-occurrence
     └── maybePrune()          → GraphEngine.prune() every N turns
     │
     ▼
GraphEngine (existing: reinforceEdge, penalizeEdge, createEdge, prune)
              (new: findOrCreateConceptNode)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/escribano.ts` | Create | EscribanoObserver class + TurnOutcome type + pattern detectors |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Add `escribano?: EscribanoObserver` to AgentLoopConfig; call observer after converse() |
| `packages/agent/src/conversation/types.ts` | Modify | Add `EscribanoConfig` type |
| `packages/memory/src/cortex/engine.ts` | Modify | Add `findOrCreateConceptNode(label, metadata)` method |

## Interfaces

```typescript
// New in types.ts
export type EscribanoConfig = {
  /** Cortex engine for Hebbian writes. Required for observer to function. */
  engine: GraphEngine;
  /** Prune every N turns (default 10). Set 0 to disable auto-pruning. */
  pruneInterval?: number;
};

// New in escribano.ts
export type TurnOutcome = "confirmed" | "rejected" | "blocked" | "none";

export class EscribanoObserver {
  constructor(config: EscribanoConfig);
  observeTurn(
    state: ConversationState,
    response: string,
    proposal?: AgentProposal,
    outcome?: TurnOutcome,
  ): void;
}
```

## Key Detectors (private methods)

| Detector | Pattern | Cortex Operation |
|----------|---------|-----------------|
| `detectConfirmation` | `isConfirmation()` + proposal present | `reinforceEdge` between concept nodes |
| `detectGuardrailRejection` | Response starts with `⛔` | `penalizeEdge` on rejected-proposal → rejection_concept |
| `detectStrategyMention` | `/\bmargen\b|\bprecio\b|\bstock\b/` on user msg | `findOrCreateConceptNode` + `createEdge` if absent |
| `detectActorConsult` | Tool messages with `simulate_actor` in state | `reinforceEdge` on actor → concept edges |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `detectConfirmation`, `detectRejection`, `detectStrategyMention` | Pure functions tested with string inputs; deterministic regex |
| Unit | `findOrCreateConceptNode` idempotency | In-memory SQLite DB, call twice, assert no duplicate |
| Integration | Full `observeTurn` with mock GraphEngine | Spy on `reinforceEdge`/`penalizeEdge` calls |
| Integration | Observer wired into `agentLoop` | End-to-end `converse()` with `escribano` in config |

## Migration / Rollout

No migration required. `EscribanoConfig` is optional in `AgentLoopConfig` — omit to disable. `findOrCreateConceptNode` is additive and backward-compatible.

## Open Questions

None — Phase 1 scope is well-defined. Phase 2 (LLM analysis) deferred.
