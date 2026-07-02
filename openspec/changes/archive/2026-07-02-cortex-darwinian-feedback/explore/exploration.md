# Exploration: Cortex Darwinian Feedback — First Implementation Slice

## Answer First

The safest first slice is to **enrich the Escribano observer** with strategy-aware outcome tracking and seller-rejection detection. The Escribano already runs `observeTurn()` on every conversation turn and has direct access to the `GraphEngine` primitives. The existing `feedback.ts` contracts (`DelegationFeedback`, `decideCortexFeedbackAction`) are designed for CEO lane proposal feedback and carry `reasoningEdgeIds` that individual agent proposals don't have — wiring them directly into agentLoop would create an impedance mismatch. Instead, extend what Escribano already does: from simple concept-node Hebbian (`proposal_X → CEO_decision`) to richer outcome-tracking that records proposal metadata, penalizes rejected recommendations, and reinforces the strategy-concept-to-proposal chain that succeeded.

## Current State

### Cortex Graph Engine (`packages/memory/src/cortex/engine.ts`)
- `reinforceEdge` (+0.1, clamped [0,1]) and `penalizeEdge` (−0.15, clamped [0,1]) — battle-tested, used by Escribano and `storeProbeResult`
- `reinforceActorOutcome(actorType, success)` — bulk reinforce/penalize all edges from an actor persona node
- `storeProbeResult(proposal)` — creates probe node + Hebbian on probe→actor edge, already outcome-aware
- `findOrCreateConceptNode(label)` — idempotent concept lookup, cached by Escribano
- `getOrCreateNode(label, metadata)` — upsert with full metadata, used for business-data nodes
- `prune()` — Darwinian archiving at weight < 0.05, node-cap FIFO with `excludeNodeIds`
- `traverse()` — returns activated nodes, edges, lessons, and LLM-injectable context
- `createEdge(source, target)` — idempotent edge creation (Escribano wraps with try/catch)

### Feedback Contracts (`packages/memory/src/cortex/feedback.ts`)
- `DelegationFeedback` union: approval, rejection, correction, pruning — each with `reasoningEdgeIds`
- `decideCortexFeedbackAction(feedback)` → `reinforce | penalize | create-corrective-lesson | prune`
- `canStoreInCortex(request)` — blocks full catalog snapshots
- **Critical gap**: `decideCortexFeedbackAction` is tested (`memory.test.ts`) but **never called by any production code**. These contracts are CEO-lane-focused: they require `reasoningEdgeIds` that `AgentProposal` objects don't carry.

### Escribano Observer (`packages/agent/src/conversation/escribano.ts`)
- The **live integration point** — wired into `agentLoop` via `AgentLoopConfig.escribano`
- `observeTurn(prevState, newState, response, proposal, outcome)` runs every turn (line 704)
- `observeToolResult(toolName, result)` runs after every tool execution (line 558)
- Current Hebbian logic:
  - `outcome === "confirmed"` → reinforce `proposal_X` → `CEO_decision` edge
  - `outcome === "blocked"` → penalize `proposal_X` → `guardrail_rejection` edge
  - Strategy keyword mentions → create concept nodes and co-occurrence edges
  - Actor consultations → reinforce `actor_X` → `actor_consultation` edge
  - Periodic pruning every 10 turns, FIFO cap every 50 turns
  - Business data: listings, visits, claims persisted as nodes with `#businessNodeIds` protection
- **Current limitation**: Only creates/reinforces edges between fixed concept labels. Does NOT:
  - Record proposal outcome metadata (proposal type, seller, timestamp)
  - Differentiate "rejected" from "none" outcomes
  - Connect strategy concepts (e.g., `strategy_margin`) to proposal outcomes
  - Create corrective Darwinian lessons on seller corrections
  - Track cumulative outcome quality per concept

### Agent Loop (`packages/agent/src/conversation/agentLoop.ts`)
- `resolveTurnOutcome(userMessage, proposal, responseText)` → `"blocked" | "confirmed" | "none"`
  - `"blocked"`: response starts with `⛔`
  - `"confirmed"`: user message matches `/dale|sí|ok|confirmo|.../` + pending proposal
  - `"none"`: everything else
- **Does NOT detect seller rejection** — "no", "cancelá", "rechazo" all map to `"none"`
- KPI recorded on "dale" confirmation, but no Cortex feedback path from this
- Tool execution results are observed by Escribano via `observeToolResult`

### Existing Spec Requirements (`openspec/specs/neural-graph-memory/spec.md`)
- **Darwinian Business Outcome Reinforcement**: MUST reinforce on useful confirmed proposals, penalize on rejection/correction, archive weak patterns
- **Cortex and Read Model Boundary**: Cortex stores learned judgment only, NOT operational snapshots; operational DB stores full catalog data
- **No Operational Snapshots in Cortex**: enforced via `canStoreInCortex` and business-node exclusion

## Affected Areas

| File | Why affected |
|------|-------------|
| `packages/agent/src/conversation/escribano.ts` | Primary target — enrich `observeTurn` with strategy-aware reinforcement, outcome metadata nodes, and rejection handling |
| `packages/agent/src/conversation/agentLoop.ts` | Minor — extend `resolveTurnOutcome` to detect `"rejected"` from negative Spanish patterns; add `"rejected"` to `TurnOutcome` type |
| `packages/agent/src/conversation/types.ts` | Minor — add `"rejected"` to `TurnOutcome` union type |
| `packages/memory/src/cortex/engine.ts` | No changes needed — all required primitives already exist (`reinforceEdge`, `penalizeEdge`, `createEdge`, `findOrCreateConceptNode`, `getOrCreateNode`) |
| `packages/memory/src/cortex/feedback.ts` | No changes needed in first slice — contracts remain CEO-lane-focused; may be integrated in a future slice |
| `packages/memory/src/cortex/database.ts` | No changes needed — schema already has `nodes` (id, label, activation, metadata), `edges`, `darwinian_lessons` |
| `packages/agent/src/conversation/tools.ts` | No changes needed |
| `packages/memory/src/memory.test.ts` | Add tests for outcome-tracking Escribano patterns |
| `packages/agent/src/agent.test.ts` | Add tests for rejection detection and Escribano outcome handling |

## Approaches

### Approach A: Strategy-Aware Escribano Enhancement (RECOMMENDED)

Enrich the existing Escribano observer to do real Darwinian learning: track proposal outcomes with metadata, connect strategy concepts to proposal outcomes, detect and handle seller rejections, and reinforce/penalize edges between the business concepts that drove the recommendation.

- **Pros**:
  - Zero new `GraphEngine` API — all primitives exist
  - Escribano already wired into agentLoop — no new integration point needed
  - All learning is auditable in SQLite Cortex tables (`nodes`, `edges`, `darwinian_lessons`)
  - No operational DB mutation, no production side effects
  - Builds on battle-tested `reinforceEdge`/`penalizeEdge` mechanics
  - Strategy keywords already detected by Escribano's `handleStrategyMention`
  - Matches the spec requirement "Darwinian Business Outcome Reinforcement"
- **Cons**:
  - Still based on seller confirmation signals, not measured business outcomes (ML sales data)
  - Strategy-to-proposal edge mapping is heuristic (keyword matching from proposal summary)
  - No time-delayed outcome validation yet (requires future slice with `check_listing_visits` or `read_my_orders` correlation)
- **Effort**: Medium (200–300 lines of new/changed code across Escribano + agentLoop types)

### Approach B: Wire feedback.ts Contracts into AgentLoop

Transform `AgentProposal` objects into `DelegationFeedback` payloads and call `decideCortexFeedbackAction` directly from agentLoop after `resolveTurnOutcome`.

- **Pros**:
  - Uses the already-designed feedback contracts
  - Central feedback decision logic already tested
- **Cons**:
  - `AgentProposal` objects lack `reasoningEdgeIds` — the `DelegationFeedback` was designed for CEO lane proposals with cortex-aware reasoning chains, not for conversational agent proposals
  - High impedance mismatch between `AgentProposal.action.kind` and feedback kinds
  - Requires inventing fake `reasoningEdgeIds` or adding them to `AgentProposal` (LLM doesn't produce them)
  - Mixes CEO delegation feedback logic with general agent conversational outcomes
  - The `feedback.ts` file is not even imported anywhere in production code — it has no integration path
- **Effort**: High (requires bridging two incompatible type systems)

### Approach C: Time-Delayed Business Outcome Validation

Record proposal outcomes as pending, then correlate with later ML business data (visits, orders, claims) to retroactively reinforce or penalize based on measurable results.

- **Pros**:
  - Truly Darwinian — measured outcomes, not just approval signals
  - Uses real MercadoLibre business data for weight adjustment
- **Cons**:
  - Requires a background correlation worker or on-next-read validation
  - Completely new architecture component — no existing integration point
  - Too large for a first slice — this is a second or third slice
  - Risk of reinforcing noise if correlation logic is imperfect
- **Effort**: High (new worker/background job, new correlation tables, complex multi-turn state)

### Approach D: Correction-Based Criteria Adjustment via Darwinian Lessons

Detect when sellers correct the agent (e.g., "no, usá margen 18% no 50%"), extract the correction, and create `darwinian_lessons` entries that adjust the strategy criteria in the graph.

- **Pros**:
  - Directly implements "corrections adjust criteria" from the user's vision
  - Uses existing `darwinian_lessons` table
- **Cons**:
  - Correction detection is non-trivial — requires NLP on user messages
  - `TurnOutcome` doesn't have `"correction"` — would need new detection
  - First slice shouldn't attempt LLM-required features like natural correction parsing
  - Better suited for slice 2 or 3 after outcome tracking is solid
- **Effort**: Medium–High (NLP pattern matching + new TurnOutcome + Escribano extension)

## Recommendation

**Approach A** — Strategy-Aware Escribano Enhancement.

The Escribano is the designed integration point. It already runs every turn, owns the graph engine reference, and has all the helper primitives (`#getOrCreateConcept`, `#ensureAndReinforce`, `#ensureAndPenalize`). The gap isn't a missing API — it's that the current observer logic is too simplistic. It should:

1. **Record outcome nodes** with metadata (`type: "proposal_outcome"`, `outcome: "confirmed"|"rejected"`, `sellerId`, `proposalKind`, `timestamp`) so the graph accumulates auditable decision history
2. **Connect strategy concepts to proposals** — when a proposal is confirmed, the strategy concepts active during the conversation (detected via Escribano's existing keyword matching) get reinforced edges to the proposal outcome
3. **Detect seller rejections** — extend `resolveTurnOutcome` to return `"rejected"` when user says "no", "cancelá", "rechazo", etc.
4. **Penalize rejected patterns asymmetrically** — rejected proposal edges get a stronger penalization than neutral outcomes, using the same `−0.15` delta that eventually pushes them below the 0.05 pruning threshold

This approach uses only existing engine APIs and follows the spec requirement: "useful proposal confirmed → reinforce", "proposal rejected or corrected → penalize", "weak pattern → prune".

### Concrete First Slice Scope

**Include:**
- `TurnOutcome` type: add `"rejected"`
- `resolveTurnOutcome`: detect Spanish rejection patterns (`no`, `cancelá`, `rechazo`, `no quiero`, `no me sirve`, `descartá`)
- `Escribano.observeTurn`: create `proposal_outcome` node with metadata on confirmed/rejected
- `Escribano.observeTurn`: on confirmed, find active strategy concepts (via keyword matching on current conversation) and reinforce edges `strategy_X` → `proposal_outcome`
- `Escribano.observeTurn`: on rejected, penalize those same edges
- Tests: Vitest unit tests for Escribano outcome tracking with in-memory SQLite, verifying edge weight changes for confirmed/rejected/rejected-confirmed sequences

**Explicitly exclude:**
- Wiring `feedback.ts` contracts (wrong abstraction level for agent proposals)
- Time-delayed business outcome validation (future slice)
- Correction-based criteria adjustment (future slice)
- New `GraphEngine` methods
- Changes to the operational read model
- Background workers or correlation jobs
- `darwinian_lessons` creation from Escribano (pruning already handles this; future slice may add explicit correction lessons)

## Risks

- **Over-reinforcement of noisy patterns**: If the seller says "dale" to suboptimal proposals just to move forward, the graph reinforces noise. Mitigation: asymmetric penalization (−0.15) is stronger than reinforcement (+0.1), so bad patterns degrade faster than good ones strengthen.
- **Strategy keyword matching is heuristic**: Connecting strategy concepts to proposals via keyword presence in the conversation is approximate — it may miss subtle strategy influences or include irrelevant concepts. Mitigation: this is a first slice; precision improves in future slices with LLM-annotated reasoning chains.
- **Rejection detection false positives**: Spanish phrases like "no sé" or "no, pero..." might trigger rejection detection incorrectly. Mitigation: require rejection patterns to be standalone (word-boundary anchored) and not immediately followed by a correction or continuation.
- **No real outcome measurement**: This slice still operates on seller approval signals, not measured business outcomes. The feedback loop is indirect — what the seller says, not what the market says. Mitigation: explicitly document this as Phase 1 Darwinian feedback; Phase 2 (future change) will correlate with ML business data.

## Ready for Proposal

Yes. The proposal should define this as a contained Escribano enhancement slice: enrich `TurnOutcome` with `"rejected"`, extend `resolveTurnOutcome` in agentLoop, and add strategy-aware outcome tracking to Escribano's `observeTurn` — all using only existing `GraphEngine` APIs. The feedback.ts contracts are preserved for future CEO-lane integration but explicitly excluded from this slice.
