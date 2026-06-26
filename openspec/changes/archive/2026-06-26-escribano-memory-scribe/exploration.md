## Exploration: El Escribano — Memory Scribe Agent

### Current State

The system has a rich Cortex neural graph (`GraphEngine` in `packages/memory/src/cortex/engine.ts`) with SQLite-backed nodes, edges, Hebbian learning (+0.1/-0.15), spreading activation via recursive CTE, Darwinian pruning (weight < 0.05), and cosine-similarity convergence detection (> 0.95). Cortex already receives mechanized writes from the agent loop:
- `storeProbeResult()` — honey-pot outcomes with Hebbian update on probe→competidor edges
- `storeSyncOutcome()` — sync results with Hebbian reinforcement on target seller nodes
- `reinforceActorOutcome()` — actor simulation results on actor persona edges
- KPI recording in `autonomyEngine` (separate tables)

However, these are all **action-triggered** writes — they occur when a specific tool or proposal is executed. What does NOT exist is an **observation layer** — a component that watches the full conversation transcript, detects patterns across turns, distills learning into new concept nodes, and updates Cortex independently of individual actions.

Key existing infrastructure relevant to the Escribano:
- **Conversation state**: `ConversationState` with `messages: ConversationMessage[]` (role, content, timestamp), exposed in every `converse()` return via `ConverseResult.updatedState`
- **Message history**: full user/assistant/tool turn history with timestamps
- **Proposal tracking**: `AgentProposal` (action, riskLevel, rationale) extracted from LLM responses; pending proposals persist in conversation state for "dale" resolution
- **CEO confirmations**: `isConfirmation()` matching "dale", "sí", "ok", "confirmo", "ejecutá" — these signal outcome acceptance
- **Guardrail violations**: Spanish reason strings from `strategyValidator`, `honeyPotValidator`, `actionSafetyValidator` — these signal rejected proposals
- **Actor consultations**: `SimulationResult` with actorType, recommendation, confidence, rationale — stored in `actor_simulations` table
- **Strategy CRUD intents**: regex-detected before LLM call — creates, supersedes, archives strategies
- **DeepSeek client**: `createDeepSeekClient()` in `agentLoop.ts` — OpenAI-compatible, same infrastructure usable for LLM-based analysis
- **Convergence**: `detectConvergence()` in `GraphEngine` — already detects when activation patterns stabilize

### Affected Areas

- `packages/agent/src/conversation/agentLoop.ts` — hook point: after `converse()` returns, Escribano observes the turn outcome. Lines 256-461 (`converse` method) and lines 473-511 (`converseStream`) are the primary integration points.
- `packages/agent/src/conversation/types.ts` — new types: `ObservationRecord`, `ConversationPattern`, `LearningEvent`, `EscribanoConfig` (injection config matching `AgentLoopConfig` pattern).
- `packages/memory/src/cortex/engine.ts` — new methods: `findOrCreateConceptNode(label, metadata)`, `updateEdgeWeight(source, target, delta)`, `extractLessons(archivedEdges)` → `distilled_lesson` strings. Most Hebbian primitives exist but lack a "create concept from pattern" higher-level API.
- `packages/memory/src/cortex/database.ts` — possible new tables: `conversation_patterns` (pattern type, frequency, confidence), `learning_events` (event type, conversation summary, cortex operations applied). Could also extend `nodes.metadata` and `edges.distilled_lesson` without new tables.
- `packages/agent/src/conversation/guardrails.ts` — Escribano could reuse Spanish input validators and strategy extractors as pattern-detection primitives.
- `packages/agent/src/conversation/strategyParser.ts` — `parseStrategy()` regex patterns could inform rule-based observation extraction (e.g., detecting margin mentions in conversation).

### Approaches

#### 1. Inline Rule-Based Observer (Regex + Heuristics)

The Escribano runs as a synchronous hook at the end of `converse()`. It receives the conversation state, the proposal (if any), and the confirmation status. It extracts patterns via regex and keyword matching, then writes to Cortex:

**Observation pipeline** (post-turn):
1. Did the user confirm ("dale") a proposal? → strengthen edges between involved concept nodes
2. Did the user reject or the guardrail block a proposal? → weaken edges, record the guardrail reason as edge metadata
3. Did the user mention a strategy domain (margin, stock, category)? → increment co-occurrence on relevant edges
4. Did an actor simulation produce a recommendation? → create/reinforce actor-concept edges
5. Did the user ask a pricing/stock question that repeated a previous pattern? → increment co-occurrence on convergent edges

**Cortex operations**:
- `findOrCreateConceptNode()` — label-based idempotent node lookup, e.g., "strategy_margin", "actor_competidor", "question_pricing"
- `updateEdgeWeight()` — generic ±delta on existing edges; create edge if absent
- `detectConvergence()` — reuse existing snapshot comparison to detect pattern stabilization
- `prune()` — reuse existing Darwinian pruning; Escribano triggers it periodically

**Analysis method**: regex patterns for keyword extraction (`/\bmargen\b|\bprecio\b|\bstock\b/`), confirmation detection (`isConfirmation()` already exists), guardrail reason parsing (Spanish error strings → structured categories).

- **Pros**:
  - Zero latency — synchronous, no API call, no async worker
  - Zero cost — no LLM tokens consumed
  - Deterministic — testable with exact string inputs, no hallucination risk
  - Follows existing pattern-based architecture: `strategyParser`, `guardrails.ts` regex patterns, `detectStrategyIntent()`
  - Minimal new code: ~150 lines of observation logic + ~100 lines of Cortex helpers
  - Natural fit with existing inline Cortex updates (`storeProbeResult`, `storeSyncOutcome`)

- **Cons**:
  - Cannot understand semantic meaning — "dale, pero la próxima ajustá el margen" is treated as confirmation, missing the nuance
  - No lesson distillation beyond simple success/failure — cannot explain **why** patterns converge
  - Misses implicit learning signals (CEO tone, hesitation, multi-turn negotiation)
  - Cannot create genuinely new concept nodes — only reinforces pre-existing categories
  - Vulnerable to keyword false positives (a seller discussing margins without making a decision)

- **Effort**: Low (~250 lines of new code, ~200 lines of tests)

---

#### 2. LLM-Based Post-Session Analysis (DeepSeek Summarizer)

The Escribano runs asynchronously after a conversation session ends (or after every N turns). It sends the full transcript (system prompt + user messages + assistant responses + tool calls + proposals) to DeepSeek with a structured output prompt. The LLM returns an `ObservationReport` — a JSON object describing intent classification, action outcomes, detected patterns, and recommended Cortex mutations.

**Observation pipeline** (async, post-session):
1. Collector gathers `ConversationState.messages` array after session end signal
2. Prompt assembler builds a structured analysis prompt:
   - "You are El Escribano, the organizational memory of Msl. Analyze this conversation between a seller and their AI business agent. Identify: (a) the seller's primary intent, (b) actions proposed and their outcomes, (c) confirmation or rejection signals, (d) strategy compliance or violations, (e) patterns that repeat across turns, (f) any lessons to record in Cortex."
3. DeepSeek returns structured JSON (via `response_format: { type: "json_object" }`)
4. Escribano translates `ObservationReport` into Cortex mutations:
   - `findOrCreateConceptNode()` for each extracted concept
   - `reinforceEdge` / `penalizeEdge` for confirmed/rejected patterns
   - `prune()` if the report flags stale connections
   - New `setDistilledLesson()` on edges where the LLM explains WHY a connection decayed

**Cortex operations** (same as Approach 1, plus):
- `setDistilledLesson(edgeId, lessonText)` — writes human-readable lesson to `edges.distilled_lesson`
- `createNodeIfNovel()` — LLM can propose entirely new concept labels (e.g., "priority_electronics_weekend_surge")

**Analysis method**: DeepSeek Flash (~$0.0028/M cached input). Prompt stays in the A+B cache blocks for ~98% discount. Total cost per session: ~$0.0001–$0.001 (1K–10K tokens output at $0.28/M).

- **Pros**:
  - Deep semantic understanding — catches nuance, tone, implicit signals, multi-turn negotiation
  - Generates rich human-readable distilled lessons (`edges.distilled_lesson`)
  - Can create genuinely new concept nodes the regex approach can't anticipate
  - Handles Spanish conversational nuance (irony, hesitation, polite rejection) naturally
  - Natural fit with existing DeepSeek infrastructure (`createDeepSeekClient()`, OpenAI SDK)
  - Can batch-analyze entire sessions rather than processing per-turn noise

- **Cons**:
  - Adds API cost per session (though near-zero with DeepSeek Flash + caching)
  - Adds latency — Escribano runs async, so Cortex updates lag behind conversation
  - Prompt engineering needed: structured output format, hallucination risk, consistency across sessions
  - Hard to test deterministically — LLM output varies; need fuzzy matching in tests
  - Requires async worker or background trigger — new infrastructure not yet in the codebase
  - Cannot run inline in `converseStream()` without stalling the streaming UX

- **Effort**: Medium–High (~400 lines of new code, ~300 lines of tests, prompt engineering iterations)

---

#### 3. Hybrid Observer (Rules for Common, LLM for Novel)

Combines Approaches 1 and 2. The Escribano has two execution paths:

**Fast path (per-turn, inline)**:
- Runs at the end of each `converse()` turn, same as Approach 1
- Extracts obvious patterns: confirmations, rejections, guardrail violations, strategy mentions
- Updates Cortex immediately (Hebbian strengthen/weaken, co-occurrence increments)
- Only handles patterns with >90% regex confidence

**Deep path (post-session, async)**:
- Triggered when a session ends OR when the rule-based observer detects "novelty" (pattern confidence < 50%, unknown intent, multiple guardrail violations in one session)
- Sends full transcript to DeepSeek for semantic analysis
- LLM returns structured observations + lessons + new concept labels
- Escribano applies LLM insights to Cortex, overwriting fast-path weights if they conflict

**Novelty trigger logic** (when to invoke the deep path):
1. The fast path detects no clear intent for 3+ consecutive turns
2. A guardrail violation occurs (strategy rejected, safety blocked) — the "why" needs LLM analysis
3. The conversation mentions a new business domain not in the fast-path keyword set
4. Per-session minimum: deep path runs at least once per session regardless of fast-path confidence

**Cortex operations**: union of Approaches 1 and 2, with conflict resolution (LLM insights override fast-path edge weights when confidence is high).

- **Pros**:
  - Best of both worlds — fast immediate Cortex updates + deep semantic learning for complex sessions
  - Cost-efficient: LLM only called when needed (estimated 20–40% of sessions trigger deep path)
  - Fast-path provides immediate learning for common patterns; deep path handles edge cases and generates lessons
  - Graceful degradation: if DeepSeek is unavailable, fast path still works
  - Incremental: fast path can be built first (Phase 1), deep path added later (Phase 2)

- **Cons**:
  - More complex implementation — two code paths, novelty trigger logic, conflict resolution
  - Novelty trigger logic itself needs tuning (false positives → unnecessary LLM calls; false negatives → missed learning)
  - Both paths must produce compatible Cortex operations (shared write primitives)
  - Harder to test end-to-end — fast path is deterministic, deep path is not
  - Two-phase rollout means fast path ships alone initially, then deep path is layered on top

- **Effort**: Medium (Phase 1: ~250 lines, same as Approach 1; Phase 2: ~400 more lines)

---

#### 4. Conversation-Scoped Middleware (Hook Chain)

The Escribano is implemented as a middleware layer within the agent loop, parallel to existing guardrails. Each observation concern is a separate hook function composed into a chain:

```
turn → spanishValidator → harmfulFilter → strategyIntent → LLM → toolLoop → safetyValidator → strategyValidator → honeyPotValidator → confirmationGate → [ESCRIBANO CHAIN START] onConfirmHook → onRejectHook → onStrategyMentionHook → onActorConsultHook → convergenceCheck → [ESCRIBANO CHAIN END] → return
```

Each hook is a pure function `(context: TurnContext) => CortexOp[]`. The Escribano collects all Cortex operations and applies them.

**Pros**:
- Extreme testability — each hook is a pure function with explicit inputs/outputs
- Separation of concerns — confirmation learning, rejection learning, strategy learning, etc. are independent
- Easy to extend — add new hooks without touching existing ones
- Natural fit with existing guardrail pattern: each guardrail is already a `(input) => GuardResult` function

**Cons**:
- Middleware chain is **not established** in this codebase — `converse()` is a linear function with early returns, not a composable pipeline
- Adds abstraction that doesn't match the current procedural style — overengineering for a 5-hook chain
- Each hook needs access to the full conversation state (not just the current turn)
- Hook execution order matters (e.g., convergence check after all other observations) — implicit coupling
- `converse()` is already 200+ lines — adding a middle layer before extracting to helpers is technical debt

- **Effort**: Medium–High (middleware infrastructure + 5 hooks + tests; architectural shift)

### Recommendation

**Approach 3 — Hybrid Observer (Phased Rollout).**

This is the right fit for the project because:

1. **Immediate value with low risk (Phase 1 — Fast Path)**: The rule-based observer delivers immediate Hebbian learning from confirmations and rejections with ~250 lines of new code and zero API cost. This mirrors the existing inline Cortex updates (`storeProbeResult`, `storeSyncOutcome`) and follows the same pattern.

2. **Full vision with controlled complexity (Phase 2 — Deep Path)**: The LLM-based analysis layer unlocks the Escribano's core value proposition — semantic understanding, concept node creation, lesson distillation. It reuses the existing DeepSeek client and caching infrastructure (A+B blocks). Deferring Phase 2 avoids blocking MVP on async worker infrastructure.

3. **Fits existing architecture**: Both phases inject the Escribano via `AgentLoopConfig` (same pattern as `engine: GraphEngine`, `autonomyEngine: AutonomyEngine`, `store: StrategyStore`). The fast path is a synchronous post-turn hook. The deep path can start as a callable function (triggered manually or by a future session-end signal) without requiring an async worker upfront.

4. **Incremental testability**: Phase 1 is fully deterministic (regex patterns, known Cortex primitives). Phase 2 adds mock-friendly LLM stubs for testing structured output parsing independently of real API calls.

Tradeoff accepted: the novelty trigger logic for Phase 2 will need tuning in production, but Phase 1 ships first and provides value immediately. The trigger can start conservative (always invoke deep path on session end) and be refined with usage data.

### Risks

- **Fast-path false positives**: Regex matching on Spanish conversation may miscategorize intent. Mitigated by scoping fast-path to high-confidence patterns only (explicit "dale", explicit guardrail rejections, known strategy keywords).
- **Deep-path hallucination**: LLM may invent observation categories or misinterpret conversations. Mitigated by structured JSON output (`response_format`) and validation before Cortex writes.
- **Session-end signal**: No session lifecycle exists today — `ConversationState` is ephemeral. Need to decide: per-N-turns batching, explicit "end session" command, or timeout-based trigger. Recommendation: start with a `finalizeSession()` callable method on the Escribano, invoked by the hosting application.
- **Cortex write contention**: Fast path and deep path may write to the same edges concurrently. Mitigated by SQLite serialized writes (WAL mode is already enabled) and a write-merge strategy where deep path insights overwrite fast-path weights with higher confidence.
- **Lesson distillation quality**: Distilled lessons from pruned edges are only meaningful if the LLM analyzes WHY connections decayed. Fast-path pruning creates mechanical `"connection between X and Y"` lessons — Phase 2 deep path replaces these with semantic insights. Phase 1 lessons will be basic.
- **Spanish language scope**: Fast-path regex patterns are Spanish-specific and must cover Argentine voseo, Chilean variants, and neutral Spanish. This follows existing patterns in `detectStrategyIntent()` and `guardrails.ts`.

### Ready for Proposal

Yes — the approaches are well-defined, the recommendation is grounded in existing architecture, and the risks are documented with mitigations. The orchestrator should proceed to `sdd-propose` with the recommendation for **Approach 3 (Hybrid Observer)** in two phases:

- **Phase 1 (MVP)**: Inline rule-based observer — zero API cost, deterministic, immediate Hebbian learning from confirmations, rejections, and strategy mentions.
- **Phase 2 (Post-MVP)**: LLM-based post-session analyzer — semantic learning, concept node creation, and lesson distillation via DeepSeek.
