# Design: Cortex Darwinian Feedback

## Technical Approach

At the end of each conversation turn, `Escribano.observeTurn` propagates the resolved outcome across ALL edges in the Cortex graph — not just one targeted edge. This implements spreading-activation Darwinian feedback: one rejection weakens every edge in the reasoning constellation, and one approval strengthens them all. Rejection is detected via standalone Spanish negation patterns in `resolveTurnOutcome`, and an outcome node is always persisted, even with an empty constellation.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Rejection detection | Word-boundary-anchored regex in `resolveTurnOutcome` | LLM-based intent classification, separate NLP module | Deterministic, zero-latency, trivially testable. O(1) per turn. False positives on "no sé" are mitigated by requiring a pending proposal to trigger `rejected`. |
| Constellation scope | All edges from `GraphEngine.traverse()` | Filtering by activation threshold, seeding from turn-specific nodes | `traverse()` returns the full graph — simpler, no new engine API. `reinforceEdge` clamps to [0,1]; pruning at 0.05 gates removal. Rapid convergence toward poles is the intended Darwinian behavior. |
| Outcome persistence | `engine.createNode("proposal_outcome_{ts}")` with metadata | Appending to an existing node, in-memory log | New node per outcome creates auditable decision history. Empty constellation still records the vote for future edge-building. |
| Targeted handler removal | Remove `#handleConfirmation` call for `confirmed` | Keep both targeted and constellation propagation | Constellation-wide supersedes single-edge. Double-reinforcing would homogenize even faster. The constellation now adjusts all edges uniformly. |

## Data Flow

```
userMessage ──→ resolveTurnOutcome() ──→ outcome ("rejected" | "confirmed" | "blocked" | "none")
                       │
                       ▼
              Escribano.observeTurn(..., outcome)
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   [rejected]    [confirmed]    [blocked]
         │             │             │
         └─────┬───────┘             │
               ▼                     ▼
    engine.traverse()         #handleGuardrailRejection()
         │                     (unchanged — guardrail-specific)
         ▼
  for edge in traversedEdges:
    outcome === "confirmed" → reinforceEdge(src, tgt)
    outcome === "rejected"  → penalizeEdge(src, tgt)
         │
         ▼
  engine.createNode("proposal_outcome_…", {outcome, sellerId, timestamp})
         (ALWAYS — even with zero edges)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Add `hasRejectionPattern()` (exported), inject rejection check into `resolveTurnOutcome` before confirmation check |
| `packages/agent/src/conversation/escribano.ts` | Modify | Remove `#handleConfirmation` call for `confirmed`. Add constellation propagation for `confirmed`/`rejected` using `traverse()` + loop over `traversedEdges`. Always call `engine.createNode()` for outcome recording. |
| `packages/agent/src/conversation/types.ts` | None | `TurnOutcome` already includes `"rejected"` (line 241). No change needed. |
| `packages/agent/src/agent.test.ts` | Modify | Add tests for `hasRejectionPattern` (unit: word-boundary, false positives on non-standalone "no"), and constellation propagation (integration: verify multi-edge weight deltas). |
| `packages/memory/src/memory.test.ts` | Modify | Add integration test: create multiple edges via `createEdge`, then call observeTurn flow to verify all edges adjusted. |

## Interfaces / Contracts

**Rejection detector (exported for testability)**:
```typescript
export function hasRejectionPattern(message: string): boolean
// Matches standalone: no, cancelá, cancela, cancelar, rechazo, no quiero
// Word-boundary anchored: /\bno\b/ etc.
```

**Outcome node metadata**:
```typescript
{
  type: "proposal_outcome",
  outcome: TurnOutcome,
  sellerId: string,
  timestamp: string  // ISO
}
```

**Escribano.observeTurn signature** — unchanged (5 params). Internal logic reworked.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `hasRejectionPattern` — matches "no", "cancelá", "rechazo", "no quiero"; rejects "confirmo", "tecnología", "novedad" | Vitest, pure function, no DB |
| Unit | `resolveTurnOutcome` returns `"rejected"` when rejection pattern + proposal present; returns `"none"` without proposal | Vitest, mock proposal |
| Integration | Constellation propagation: 3 edges in graph, confirmed turn → all 3 reinforced +0.10 | Vitest + in-memory SQLite (`better-sqlite3`) |
| Integration | Rejected turn penalizes all edges −0.15 | Vitest + in-memory SQLite |
| Integration | Empty constellation: 0 edges, outcome node still created | Vitest + in-memory SQLite |

## Migration / Rollout

No migration required. `TurnOutcome` already has `"rejected"`. Escribano already handles unknown outcomes with a no-op (no default case). Rollback: revert `resolveTurnOutcome` and `observeTurn` to git HEAD.

## Open Questions

None.
