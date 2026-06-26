# Tasks: El Escribano — Memory Scribe Agent (Phase 1)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~300 (150 escribano + 10 types + 5 agentLoop + 15 engine + 120 tests) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

## Phase 1: Foundation — Engine + Types

- [x] 1.1 Add `findOrCreateConceptNode(label, metadata)` to `packages/memory/src/cortex/engine.ts` — SELECT by label, INSERT if absent, return node
- [x] 1.2 Add `EscribanoConfig` to `packages/agent/src/conversation/types.ts` — `engine: GraphEngine`, `pruneInterval?: number`
- [x] 1.3 Add `escribano?: EscribanoObserver` to `AgentLoopConfig` in `agentLoop.ts`

## Phase 2: Core — EscribanoObserver

- [x] 2.1 Create `packages/agent/src/conversation/escribano.ts` with `TurnOutcome` type and `EscribanoObserver` class
- [x] 2.2 Implement `detectConfirmation()` — `isConfirmation()` + proposal present → `reinforceEdge` on concept nodes
- [x] 2.3 Implement `detectGuardrailRejection()` — response starts with `⛔` → `penalizeEdge`
- [x] 2.4 Implement `detectStrategyMention()` — regex `/margen|precio|stock/` on last user message → `findOrCreateConceptNode` + co-occurrence edge
- [x] 2.5 Implement `maybePrune()` — call `engine.prune()` every `pruneInterval` turns (default 10)
- [x] 2.6 Wire `observeTurn()` into `converse()` return path in `agentLoop.ts` — call after `ConverseResult` is built, before return

## Phase 3: Tests

- [x] 3.1 Unit tests for `findOrCreateConceptNode` idempotency in `engine.test.ts`
- [x] 3.2 Unit tests for `detectConfirmation` with various "dale" variants and proposals
- [x] 3.3 Unit tests for `detectGuardrailRejection` with blocked responses
- [x] 3.4 Unit tests for `detectStrategyMention` with Spanish messages containing margin/price/stock
- [x] 3.5 Integration test: full `observeTurn()` with mock GraphEngine spying on edge operations
- [x] 3.6 Integration test: observer wired into `converse()` with mock client confirming proposal

## Phase 4: Verification

- [x] 4.1 Run `npm test` — all tests green
- [x] 4.2 Run `npm run typecheck` — zero errors
- [x] 4.3 Commit + push to branch
