# Proposal: Cortex Darwinian Feedback

## Intent

Cortex currently learns through targeted Hebbian updates — one confirmed proposal reinforces one edge. This misses the network effect: a rejection of "pricing in Plasticov" should weaken ALL edges in the activated reasoning constellation, not just one pattern. Spreading-activation outcome propagation makes one "no" generalize across the full reasoning chain.

## Scope

### In Scope
- `TurnOutcome`: add `"rejected"` (Spanish negation-pattern detection)
- `Escribano.observeTurn`: after outcome resolution, traverse activated constellation via `GraphEngine.traverse()` and propagate outcome through ALL activated edges:
  - `approved` → `reinforceEdge` on every edge in constellation (+0.10)
  - `rejected` → `penalizeEdge` on every edge in constellation (−0.15)
- Outcome-node recording: persist `proposal_outcome` node with metadata even when constellation is empty
- Unit tests: Vitest verifying multi-edge weight deltas for both outcomes

### Out of Scope
- `rejected_with_correction` — requires LLM-annotated reasoning chains for corrected-constellation identification
- New `GraphEngine` primitives or weight-delta tuning (use existing `reinforceEdge`/`penalizeEdge` as-is at +0.10/−0.15)
- `feedback.ts` contract wiring (CEO-lane abstraction, preserved untouched)
- Time-delayed business outcome validation
- `pending_clarification` follow-up questions
- Operational DB mutations

## Capabilities

### New Capabilities
- `cortex-darwinian-feedback`: Spreading-activation outcome propagation through activated Cortex constellations. After each turn with approved or rejected outcome, Escribano traverses the activated constellation and adjusts all participating edges together using existing Hebbian primitives. Includes rejection-signal detection and persistent outcome-node recording for decision-history accumulation.

### Modified Capabilities
- None. The `neural-graph-memory` spec's Darwinian Business Outcome Reinforcement requirement already covers this as an observer concern; this change implements it via constellation propagation rather than targeted edge adjustment.

## Approach

1. **Rejection detection**: `resolveTurnOutcome` returns `"rejected"` when user message contains standalone Spanish negation (`no`, `cancelá`, `rechazo`, `no quiero`) following a pending proposal — distinct from neutral `"none"`.
2. **Constellation propagation**: In `Escribano.observeTurn`, after outcome resolution, call `GraphEngine.traverse()` seeded from current-turn concept nodes. For every edge in the activated set:
   - `approved` → `reinforceEdge(source, target)`
   - `rejected` → `penalizeEdge(source, target)`
3. **Outcome recording**: Always persist a `proposal_outcome` node with metadata (`outcome`, `sellerId`, `timestamp`) — even when no edges are activated — accumulating auditable decision history.
4. **No engine changes**: All propagation uses existing primitives at current fixed deltas. Constellation-wide propagation is the innovation, not weight values.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/types.ts` | Modified | Add `"rejected"` to `TurnOutcome` union |
| `packages/agent/src/conversation/agentLoop.ts` | Modified | Rejection-pattern detection in `resolveTurnOutcome` |
| `packages/agent/src/conversation/escribano.ts` | Modified | Constellation traversal + edge propagation in `observeTurn` |
| `packages/memory/src/cortex/engine.ts` | None | All primitives exist (`traverse`, `reinforceEdge`, `penalizeEdge`) |
| `packages/memory/src/cortex/feedback.ts` | None | CEO-lane contracts preserved, not wired |
| `packages/agent/src/agent.test.ts` | Added | Rejection detection + constellation-propagation tests |
| `packages/memory/src/memory.test.ts` | Added | Multi-edge weight-delta verification |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Over-penalization: one rejection weakens many edges simultaneously | Medium | −0.15 penalty is moderate per edge; pruning threshold (0.05) gates removal; edges re-strengthen via future approvals |
| Rejection false positives: "no sé" triggers `rejected` | Low | Standalone word-boundary-anchored patterns only |
| Empty constellation produces no edge adjustment | Low | Outcome node still recorded; future slices build edges from accumulated history |

## Rollback Plan

1. Remove `"rejected"` from `TurnOutcome` union — TS compiler flags all consumers
2. Revert `resolveTurnOutcome` to map negation patterns to `"none"`
3. Revert `observeTurn` to targeted edge adjustment (git revert Escribano diff)
4. Existing `proposal_outcome` nodes in SQLite are inert — no migration needed

## Dependencies

- `GraphEngine.traverse()` — already in use for context injection
- `reinforceEdge` / `penalizeEdge` — already used by current Escribano Hebbian logic

## Success Criteria

- [ ] Seller rejection (`"no"`, `"cancelá"`) after pending proposal penalizes at least one edge in activated constellation
- [ ] Seller approval (`"dale"`) after pending proposal reinforces at least one edge in activated constellation
- [ ] Outcome node recorded even when constellation is empty
- [ ] Existing outcomes (`confirmed`, `blocked`, `none`) unchanged
- [ ] Vitest suite passes with new constellation-propagation test cases
