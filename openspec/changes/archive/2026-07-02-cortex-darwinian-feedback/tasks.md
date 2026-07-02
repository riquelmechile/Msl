# Tasks: Cortex Darwinian Feedback

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 120–150 |
| 400-line budget risk | Low |
| 800-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Rejection Detection

- [x] 1.1 Export `hasRejectionPattern(message: string): boolean` in `packages/agent/src/conversation/agentLoop.ts` — word-boundary-anchored regex matching standalone `no`, `cancelá`, `cancela`, `cancelar`, `rechazo`, `no quiero`.
- [x] 1.2 Inject `hasRejectionPattern` check into `resolveTurnOutcome` in `agentLoop.ts` — return `"rejected"` before the existing confirmation/blocked logic when pattern matches AND a `pendingProposal` exists in the turn.

## Phase 2: Constellation Propagation & Outcome Recording

- [x] 2.1 In `packages/agent/src/conversation/escribano.ts`, remove the `#handleConfirmation` call for `"confirmed"` outcome branch. Keep `#handleGuardrailRejection` for `"blocked"`.
- [x] 2.2 Add constellation propagation in `observeTurn` for `"confirmed"` and `"rejected"` outcomes: call `engine.traverse()`, iterate `traversedEdges`, call `reinforceEdge(src,tgt)` for confirmed or `penalizeEdge(src,tgt)` for rejected on every edge.
- [x] 2.3 Add persistent outcome-node recording in `observeTurn`: call `engine.createNode("proposal_outcome_…", {type, outcome, sellerId, timestamp})` for every `"confirmed"` or `"rejected"` turn — even when `traversedEdges` is empty.

## Phase 3: Tests

- [x] 3.1 In `packages/agent/src/agent.test.ts`, add unit tests for `hasRejectionPattern`: matches `"no"`, `"cancelá"`, `"rechazo"`, `"no quiero"`; rejects `"confirmo"`, `"tecnología"`, `"novedad"`.
- [x] 3.2 In `packages/agent/src/agent.test.ts`, add unit test for `resolveTurnOutcome`: returns `"rejected"` when pattern matches + proposal present; returns `"none"` without proposal.
- [x] 3.3 In `packages/agent/src/agent.test.ts`, add integration test: 3 edges in graph, confirmed turn → all 3 reinforced +0.10. Rejected turn → all 3 penalized −0.15.
- [x] 3.4 In `packages/memory/src/memory.test.ts`, add integration test: empty constellation → 0 edge calls, outcome node still created with metadata.

## Verification

```bash
npm test
npm run typecheck
npm run lint
```

All existing tests must pass. Spec scenarios from `specs/cortex-darwinian-feedback/spec.md` must be covered by the new test cases above.
