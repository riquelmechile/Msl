# Apply Progress: Cortex Darwinian Feedback

**Status**: Completed — all 9 tasks implemented
**Mode**: Standard (strict_tdd: false)
**Date**: 2026-07-02

## Completed Tasks

### Phase 1: Rejection Detection

- [x] 1.1 — `hasRejectionPattern()` exported from `agentLoop.ts`
  - Uses `(?:^|\s)...(?:\s|$)` boundaries instead of `\b` because JavaScript `\b` does not recognise accented characters (á, é, í, ó, ú, ñ) as word characters.
  - Matches: `no`, `cancelá`, `cancela`, `cancelar`, `rechazo`, `no quiero`
  - Rejects: `confirmo`, `tecnología`, `novedad`, `cancelación`, `nota`, `noble`

- [x] 1.2 — Rejection check injected into `resolveTurnOutcome`
  - Returns `"rejected"` when `hasRejectionPattern(userMessage)` AND effective proposal exists (direct `proposal` parameter OR `extractPendingProposal(state.messages)`).
  - `state` parameter added as optional to support pending-proposal extraction from conversation history.
  - Call site in `converse()` updated to pass `state`.

### Phase 2: Constellation Propagation & Outcome Recording

- [x] 2.1 — Removed `#handleConfirmation` call for `"confirmed"` outcome branch
  - Method `#handleConfirmation` deleted (dead code after removal).
  - `#handleGuardrailRejection` kept for `"blocked"` — unchanged.
  - `#ensureAndReinforce` kept (still used by `#handleActorConsult`).
  - Class JSDoc updated to describe Darwinian Hebbian observer behavior.

- [x] 2.2 — Constellation propagation for `"confirmed"` and `"rejected"`
  - Calls `engine.traverse()` → iterates `traversedEdges`
  - Confirmed → `engine.reinforceEdge(source, target)` on every edge
  - Rejected → `engine.penalizeEdge(source, target)` on every edge
  - Each call wrapped in try/catch for pruned-edge safety

- [x] 2.3 — Persistent outcome-node recording
  - `engine.createNode("proposal_outcome_${timestamp}")` with `{type, outcome, sellerId, timestamp}` metadata
  - Runs for both `"confirmed"` and `"rejected"` — always, even when `traversedEdges` is empty
  - Wrapped in try/catch for safety

### Phase 3: Tests

- [x] 3.1 — Unit tests for `hasRejectionPattern` in `agent.test.ts`
  - 5 test cases covering standalone words, false positives, partial matches

- [x] 3.2 — Unit tests for `resolveTurnOutcome` in `agent.test.ts`
  - 6 test cases: rejected (direct proposal), rejected (pending from state), none (no proposal), confirmed (dale/ok), none (confirmation without proposal), blocked

- [x] 3.3 — Integration tests for constellation propagation in `agent.test.ts`
  - Confirmed: 3 edges, verify all reinforced +0.10
  - Rejected: 2 edges, verify all penalized −0.15
  - Uses in-memory SQLite via `createGraphEngine(":memory:")`

- [x] 3.4 — Integration test for empty constellation in `memory.test.ts`
  - 3 test cases: traverse empty graph, createNode with outcome metadata, multiple outcomes persist independently
  - All engine-level (no cross-package import needed)

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/agent/src/conversation/agentLoop.ts` | Modified | Added `hasRejectionPattern()` (exported), modified `resolveTurnOutcome` (exported), updated call site to pass `state` |
| `packages/agent/src/conversation/escribano.ts` | Modified | Removed `#handleConfirmation`, added constellation propagation + outcome recording in `observeTurn`, updated JSDoc |
| `packages/agent/src/index.ts` | Modified | Added `hasRejectionPattern`, `resolveTurnOutcome` to exports |
| `packages/agent/src/agent.test.ts` | Modified | Added ~200 lines of tests: hasRejectionPattern unit, resolveTurnOutcome unit, constellation integration |
| `packages/agent/tests/conversation/escribano.test.ts` | Modified | Updated confirmed test for constellation behavior, added rejected constellation test, fixed idempotency test |
| `packages/memory/src/memory.test.ts` | Modified | Added engine-level outcome node recording tests |
| `openspec/changes/cortex-darwinian-feedback/tasks.md` | Modified | All 9 tasks marked `[x]` |

## Deviations from Design

1. **Regex boundaries**: Design specified `\b` word boundaries. Changed to `(?:^|\s)`/`(?:\s|$)` because JavaScript `\b` does not recognise accented Spanish characters (á, é, í, ó, ú, ñ) as word characters. The `\bcancelá\b` pattern would never match "cancelá" because `á` is a non-word char in JS. The explicit space/string-boundary pattern preserves the same semantics (standalone word matching).

2. **`resolveTurnOutcome` state parameter**: Added optional `state?: ConversationState` to enable pending-proposal extraction from conversation history. Without this, rejection detection would miss cases where the LLM didn't produce a fresh proposal on the rejection turn but a pending proposal existed from a previous turn. This is internal plumbing — the Escribano `observeTurn` signature remains unchanged as specified.

## Issues Found

1. **Pre-existing test failure**: `packages/agent/tests/conversation/actorIntegration.test.ts` line 131 — "strategyValidator blocks a proposal even after actor simulation" — fails because the agent loop's `selfVerify` check adds a "⚠️ Requiere tu revisión" prefix to the Phase 1 confirmation response, which doesn't match the test's expected pattern `/confirmada|perfecto|ejecutará/i`. This is unrelated to the Darwinian feedback changes.

2. **`isConfirmation` regex has same `\b` issue**: The existing `isConfirmation("sí")` function also uses `/^(dale|s[iíí]|ok|confirmo|confirmar|ejecut[áa]|ejecutar)\b/` which won't match standalone "sí" due to the `\b`+`í` issue. Only affects pure "sí" — "sí," works because the comma triggers the boundary. Not addressed here (out of scope) but noted for future.

## Verification Results

- ✅ `npm test`: 1011/1012 tests pass (1 pre-existing failure in actorIntegration.test.ts)
- ✅ `npm run typecheck`: Clean
- ✅ `npm run lint`: Clean
- ✅ `npm run format:check`: Clean

## Reviewed Tests

### Unit tests added (agent.test.ts)
- `hasRejectionPattern`: standalone "no", "cancelá"/"cancela", "rechazo", "no quiero"; rejects "confirmo", "tecnología", "novedad", "cancelación", "nota", "noble"
- `resolveTurnOutcome`: rejected (direct proposal), rejected (pending from state), none (no proposal), confirmed (dale), confirmed (ok), none (confirmation without proposal), blocked

### Integration tests added (agent.test.ts)
- Confirmed: 3 edges (0.5→0.6, 0.6→0.7, 0.5→0.6) — all 3 reinforced
- Rejected: 2 edges (0.7→0.55, 0.5→0.35) — both penalized

### Integration tests added (memory.test.ts)
- Empty graph `traverse()` → zero edges, zero nodes
- `createNode` with `proposal_outcome` metadata → queryable by type
- Multiple outcomes persist independently

### Updated existing tests (escribano.test.ts)
- Confirmed test: pre-seeds edges, verifies 2x reinforce + outcome node
- Rejected test: pre-seeds edges, verifies 2x penalize + outcome node
- Idempotency test: verifies 2 outcome nodes after 2 confirmed turns
