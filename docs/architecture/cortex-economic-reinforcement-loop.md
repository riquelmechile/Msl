# Cortex Economic Reinforcement Loop — Architecture Document

> **Phase:** P1, PR 3/3 (Financial Truth)
> **Date:** 2026-07-10
> **Status:** Implemented

## Purpose

The Cortex Economic Reinforcement Loop closes the Financial Truth cycle by connecting verified economic outcomes to Cortex Darwinian learning. It is the third and final PR of the Financial Truth foundation series.

Before this PR, Cortex learned only from CEO approval/rejection signals — if the CEO said "dale", constellations were reinforced. But approval captures **preference**, not **effectiveness**. A CEO could approve a bad decision or reject a good one. Cortex had no way to learn from actual economic results.

This PR establishes the bridge: **verified economic outcomes feed Darwinian learning, graduated by attribution strength, bounded by deterministic safety rules, and fully auditable with reversal support.**

### Three PRs, Three Layers

| PR | Concern | Status |
|----|---------|--------|
| 1/3 | Economic domain, calculation, persistence | ✅ Merged |
| 2/3 | Finance Director — interpretation via DeepSeek | ✅ Merged |
| 3/3 | Cortex Economic Reinforcement Loop — learning from outcomes | ✅ Merged |

- **PR 1/3** answers "what happened" — the deterministic calculation layer.
- **PR 2/3** answers "what does it mean" — the interpretation layer.
- **PR 3/3** answers "what should we learn" — the learning layer.

## Key Concepts

### Preference vs. Effectiveness

| Signal | Teachs | Source | Existing before this PR |
|--------|--------|--------|------------------------|
| CEO approval | What the CEO wants | "dale" / rejection | ✅ Cortex Darwinian feedback |
| Economic outcome | What actually works | Verified profit/loss | — (this PR) |

These are distinct signals. A CEO might approve a campaign because it sounds good. Only the economic outcome reveals whether it produced real profit. The learning system must respect both but must never confuse approval with effectiveness.

### Verified ≠ Causal

A verified economic outcome means the numbers are confirmed accurate — revenue, costs, fees, refunds — all backed by traceable evidence. It does NOT prove that action X caused profit Y. Attribution must be evaluated separately, with explicit strength levels. Correlation (temporal proximity) without evidence of contribution must not produce strong reinforcement.

### Eligibility Gates

Only outcomes that pass a deterministic eligibility gate may advance to learning. The evaluation is pure logic — no AI, no inference, no ambiguity. If an outcome fails any gate, it is blocked with a specific, auditable reason code.

### Safety First

- Cortex is a learning system, not the ledger. Cortex failures must never modify or invalidate economic outcomes.
- All learning is auditable and reversible. Every reinforcement action is recorded in a ledger.
- Single episodes create episodic memory only — they do not create global rules.
- Learning is seller-scoped. Plasticov outcomes never reinforce Maustian constellations.

## Architecture: Three Tiers

```
Tier 1                          Tier 2                          Tier 3
Economic Truth                  Attribution                     Cortex Application
─────────────────               ─────────────────               ──────────────────
EconomicOutcome                 Evidence-based                  Graph engine
(verified status)               strength evaluation             Learning events
     │                                │                             │
UnitEconomicsSnapshot           5-level scale                   Outcome nodes
(deterministic calc)            (none→causal)                   Edge adjustments
     │                                │                             │
EconomicSignal                  Fast path: IDs                  Idempotent bridge
(direction/magnitude)           Slow path: DeepSeek             Before/after hashes
     │                                │                             │
     └──────────────┬────────────────┘                             │
                    │                                              │
                    ▼                                              │
             Reinforcement Plan                                    │
             (separated, validated)                                │
                    │                                              │
                    └──────────────────────────────────────────────┘
```

### Tier 1 — Economic Truth (Deterministic)

Source: `EconomicOutcomeStore`, `UnitEconomicsSnapshot`, verified evidence. This tier answers "what happened" and is 100% deterministic. No AI reasoning, no LLM, no heuristics.

Components:
- **Eligibility Evaluator** — deterministic gate: which outcomes are eligible?
- **Economic Signal Calculator** — direction (positive/neutral/negative), magnitude (0..1), confidence

### Tier 2 — Attribution (Evidence-Based)

Estimates the strength of association between the outcome and the decision chain — proposals, actions, agents, sessions, campaigns. Uses a 5-level scale with explicit evidence requirements for each level. The fast path is deterministic (shared IDs); DeepSeek can optionally generate alternative hypotheses but cannot override evidence limits.

Components:
- **Attribution Evaluator** — strength assessment with evidence linkage
- **Anti-causality safeguards** — caps, alternative explanations, contradiction detection

### Tier 3 — Cortex Application (Learning)

Creates outcome nodes, links evidence, adjusts eligible connections, records learning events, prevents duplicates, and enables audit and reversal. Never recalculates profit — it reads from Tier 1.

Components:
- **Reinforcement Planner** — transforms signal + attribution into a validated plan
- **Cortex Economic Bridge** — applies the plan to Cortex with idempotency
- **Learning Store** — SQLite ledger with seller isolation

## Data Flow

```
EconomicOutcome (status: verified)
        │
        ▼
evaluateEconomicLearningEligibility()  →  EconomicLearningEligibility
        │
        ▼ (eligible === true)
computeEconomicSignal()                →  EconomicSignal {direction, magnitude, confidence}
        │
        ▼
EconomicAttributionEvaluator.evaluate() →  EconomicAttributionAssessment {strength, confidence}
        │                                   (fast path: deterministic IDs)
        │                                   (slow path: DeepSeek hypotheses, optional)
        ▼
EconomicReinforcementPlanner.createPlan() →  EconomicReinforcementPlan {targets, adjustments, lessons}
        │
        ▼ (validated)
CortexEconomicReinforcementBridge.apply() →  Apply to Cortex + persist EconomicLearningEvent
        │
        ▼
EconomicLearningStore (ledger)
```

## 1. Eligibility — Deterministic Gate

**Module:** `packages/domain/src/economicLearningEligibility.ts`

Pure deterministic function. Evaluates in order — first failure wins.

### Status Gate

| Outcome status | Result | Reason code |
|---------------|--------|-------------|
| `pending` | Blocked | `outcome-not-verified` |
| `observing` | Blocked | `outcome-not-verified` |
| `observed` | Blocked | `outcome-not-verified` |
| `disputed` | Blocked | `outcome-not-verified` |
| `invalidated` | Blocked | `outcome-not-verified` |
| `verified` | Continue evaluation | — |

### 10 Block Reasons

If the outcome passes the status gate, it must also pass these checks:

| # | Check | Block reason |
|---|-------|-------------|
| 1 | Outcome status is `verified` | `outcome-not-verified` |
| 2 | Observed economic impact is present | `missing-observed-impact` |
| 3 | Snapshot is not unverifiable or disputed | `disputed-evidence` |
| 4 | Snapshot is not partial with missing inputs | `incomplete-economic-data` |
| 5 | Snapshot currency is valid (CLP or USD) | `currency-conflict` |
| 6 | Outcome not already processed | `already-processed` |
| 7 | Attribution targets exist | `missing-attribution-target` |
| 8 | Snapshot seller matches outcome seller | `seller-scope-mismatch` |
| 9 | Evidence is not stale | `stale-evidence` |
| 10 | Outcome not invalidated | `invalidated-outcome` |

```typescript
// Simplified: only eligible if all gates pass
const eligibility = evaluateEconomicLearningEligibility({
  outcome,
  snapshot,
  hasAttributionTargets: true,
  alreadyProcessed: false,
});
// eligibility.eligible === true → proceed to signal calculation
// eligibility.eligible === false → eligibility.reasonCodes explains why
```

## 2. Economic Signal — Direction, Magnitude, Confidence

**Module:** `packages/domain/src/economicSignal.ts`

Deterministic. Calculates an economic signal from the outcome and its unit economics snapshot. Not just "profit > 0 = good" — considers baseline, expected impact, margins, refunds, missing costs, and the observation window.

### Signal Components

```
EconomicSignal {
  direction:   "positive" | "neutral" | "negative"
  magnitude:   0..1          // bounded score from financial deltas
  confidence:  0..1          // from completeness, evidence quality
  reasonCodes: string[]      // deterministic labels
  sourceValues: {}           // bounded metadata, no NaN/Infinity
}
```

### Direction Determination

- **Positive**: net profit > 0 AND contribution margin > 0, with complete data
- **Negative**: net profit < 0, or contribution margin < 0, or significant refunds/returns
- **Neutral**: net profit ≈ 0 within tolerance, or insufficient data to determine

### Magnitude Calculation

The magnitude is derived from financial deltas — how the outcome compares to baseline expectations — and is clamped to [0, 1]. Larger-than-expected profit yields higher magnitude. Refunds, returns, fees, and missing costs all reduce magnitude.

### Confidence

Based on:
- Snapshot completeness (partial vs. complete)
- Evidence quality (all costs verified vs. unverified)
- Calculation status
- Presence of missing inputs

### Guarantees

- No NaN, no Infinity in any output field
- All Money values validated before computation
- `assertFinite()` guards on all financial inputs
- Source values only contain finite integers/numbers

## 3. Attribution — 5 Strength Levels

**Module:** `packages/agent/src/finance/EconomicAttributionEvaluator.ts`

Evidence-based attribution strength evaluation. Fast path is deterministic (ID linking). DeepSeek path is optional and bounded.

### Strength Levels

| Level | Requirements | Max Reinforcement |
|-------|-------------|-------------------|
| `none` | No identifiable link between outcome and action | No reinforcement. Record factual outcome node only |
| `associated` | Temporal coincidence or shared context (correlationId, sessionId) but no direct execution link | Create episodic memory. Minimal or no edge adjustment |
| `contributory` | Linked execution IDs (proposalId, executionId, agentId) with coherent evidence chain | Moderate adjustment weighted by confidence × magnitude |
| `experiment-supported` | Baseline comparison or before/after analysis with control context | Larger adjustment, still globally capped |
| `causal` | Requires explicit experiment contract and extraordinary evidence | Maximum allowed adjustment, never unlimited |

### Fast Path (Deterministic)

Links by shared IDs:
- `proposalId` → `proposal` attribution target
- `executionId` → `action` attribution target
- `originatingAgentId` → `agent` attribution target
- `workSessionId` → `session` attribution target
- `correlationId` → cross-target coherence verification
- `orderId` / `itemId` / `sku` → evidence of delivery

Temporal proximity alone (same hour, same day) without ID linkage is at most `associated`.

### DeepSeek Path (Optional, Bounded)

DeepSeek can help formulate alternative explanations, identify contradictory evidence, and recommend caution. But DeepSeek **cannot**:
- Raise strength above evidence limits
- Assign `causal` without baseline/experiment context
- Invent evidence IDs
- Change profit totals
- Change outcome status

### Anti-Causality Safeguards

- `causal` requires explicit experiment contract (experimentId, baselineId, control group)
- Alternative explanations reduce confidence
- Contradicting evidence caps strength at `contributory` maximum
- Cross-seller attribution is rejected immediately

## 4. Reinforcement Plan — Separated from Application

**Module:** `packages/agent/src/finance/EconomicReinforcementPlanner.ts`

Transforms outcome + signal + attribution into a validated, immutable plan. Never applies directly. The separation ensures the plan is auditable before any Cortex mutation.

### Per-Strength Policies

| Strength | Edge Adjustment Policy |
|----------|----------------------|
| `none` | No edge changes. Optionally record factual outcome node |
| `associated` | Create episodic memory. Minimal or no edge adjustment. Weighted by confidence × magnitude |
| `contributory` | Moderate adjustment. Delta capped by `maxContributoryDelta` |
| `experiment-supported` | Larger adjustment. Delta capped by `maxExperimentDelta` |
| `causal` | Maximum allowed adjustment. Delta capped by `maxCausalDelta`. Never unlimited |

### Global Magnitude Cap

All edge adjustments are globally bounded by `maxMagnitude` (default 0.25). No single outcome, even with `causal` attribution, can change an edge weight by more than this cap. The cap is configurable — the plan includes `reinforcementPolicyVersion`, `attributionPolicyVersion`, and `signalPolicyVersion` for reproducibility.

### Negative Signal Policy

Negative-direction signals (net loss, refund-heavy outcomes) produce negative deltas. These weaken connections proportionally to magnitude × confidence. The magnitude is bounded identically — a single negative outcome cannot zero out a well-established connection.

### Single Outcome Constraint

A single outcome cannot create a global rule. The planner generates `LessonCandidate` entries with explicit `scope`, `confidence`, and `expiryDays`. Multiple corroborating outcomes are needed before lessons generalize.

### Memory Types in Lesson Candidates

| Type | Description | Example |
|------|-------------|---------|
| `episodic` | What happened in this specific instance | "Outcome 'o-42' produced 15% contribution margin from campaign 'c-7'" |
| `semantic` | What we now know about the domain | "Products in category MLM1234 with free shipping had 8% higher margin" |
| `procedural` | How to do something (or avoid doing) | "When listing in category X, prefer Classic over Premium for margins < 25%" |
| `economic` | How money flowed | "Campaign 'c-7' net profit: CLP 45000; ROAS: 2.3; margin: 15%" |

## 5. Cortex Bridge — Idempotent Application

**Module:** `packages/agent/src/finance/CortexEconomicReinforcementBridge.ts`

Receives a validated `EconomicReinforcementPlan` and applies it to the Cortex graph. This is the only component that mutates Cortex state for economic learning.

### Responsibilities

1. **Verify idempotency** — composite key: `outcomeId + sellerId + policyVersion`
2. **Load before-state** — capture current edge weights for audit
3. **Create/reuse economic outcome nodes** — `proposal_outcome` node with seller scoping
4. **Link evidence** — outcome → agent → action → seller via graph edges
5. **Apply bounded adjustments** — use existing Hebbian primitives (`reinforceEdge` / `penalizeEdge`)
6. **Record `EconomicLearningEvent`** — persisted in the Learning Store
7. **Compute after-state hash** — for reversal and audit
8. **Degrade safely on Cortex failure** — never modify `EconomicOutcomeStore`

### Idempotency

```
Idempotency Key: {outcomeId}-{sellerId}-{reinforcementPolicyVersion}
```

Re-applying the same plan with the same key is a no-op. Re-verification with new evidence produces a new policy version, enabling controlled re-evaluation.

### What the Bridge MUST NOT Do

- Write to `EconomicOutcomeStore` (except marking processing complete)
- Change outcome status
- Recalculate money or profit
- Call MercadoLibre API
- Call external HTTP APIs
- Store raw LLM output
- Mix seller data across accounts

### Safe Degradation

If Cortex operations fail:
1. The bridge records a `failed` learning event
2. Economic outcomes remain untouched — no data corruption
3. The failure is surfaced for retry or investigation
4. No half-applied state — the bridge is transactional where possible

## 6. Learning Store — SQLite Ledger

**Module:** `packages/memory/src/economicLearningStore.ts`

SQLite table `economic_learning_events` — append-only ledger for all learning operations.

### Schema

```sql
economic_learning_events (
  event_id          TEXT PRIMARY KEY,
  idempotency_key   TEXT UNIQUE NOT NULL,
  outcome_id        TEXT NOT NULL,
  seller_id         TEXT NOT NULL,
  plan_id           TEXT NOT NULL,
  attribution_id    TEXT NOT NULL,
  target_node_ids   TEXT,    -- JSON array
  target_edge_ids   TEXT,    -- JSON array
  adjustments_json  TEXT,    -- JSON array of AppliedAdjustment
  lessons_created   TEXT,    -- JSON array of lesson IDs
  before_state_hash TEXT NOT NULL,
  after_state_hash  TEXT NOT NULL,
  applied_at        INTEGER NOT NULL,
  reversed_at       INTEGER,
  status            TEXT NOT NULL,  -- processed | failed | retryable | reversed
  error_code        TEXT,
  policy_versions   TEXT,    -- JSON: {reinforcementPolicyVersion, attributionPolicyVersion, signalPolicyVersion}
  bounded_metadata  TEXT     -- JSON, no secrets, size-capped
);

CREATE INDEX idx_econ_learning_seller ON economic_learning_events(seller_id);
CREATE INDEX idx_econ_learning_outcome ON economic_learning_events(outcome_id);
```

### Key Design Decisions

- **Idempotency key is UNIQUE** — prevents duplicate application
- **seller_id indexed** — all queries are seller-scoped
- **Before/after hashes** — enable reversal verification and audit
- **Status transitions**: `processed` → `reversed` (terminal), `failed` → `retryable`
- **JSON columns** for flexible structures without schema migration
- **No raw LLM output** — bounded, structured metadata only

## 7. Reversal — Compensation for Disputed/Invalidated Outcomes

When a verified outcome is later disputed or invalidated:

1. Find all learning events by `outcome_id`
2. Apply inverse adjustments safely (where possible)
3. Mark events as `reversed`
4. Create compensating learning event
5. Maintain history — never delete records

If exact inverse is unsafe (e.g., edge was pruned, node was merged), record a compensating event and document the limitation. Double reversal is prevented — once reversed, an event cannot be reversed again.

### Reversal Triggers

- `economic-outcome-disputed` → find prior events → reversal plan → compensate
- `economic-outcome-invalidated` → same path, final state more aggressive

## 8. Memory Types — Four Categories

The reinforcement loop creates lesson candidates across four memory types, stored in Cortex:

| Memory type | Cortex representation | When created |
|-------------|----------------------|--------------|
| **Episodic** — what happened | `proposal_outcome` node with metadata | Every processed outcome |
| **Semantic** — what we know | Constellation edges with learned weights | Multiple corroborating outcomes |
| **Procedural** — how to act | Hebbian-strengthened activation paths | Patterns with confident economic signals |
| **Economic** — money flow | Lesson candidates with financial data | Every outcome with complete economic data |

Cortex's existing Darwinian mechanisms (Hebbian reinforcement, pruning, convergence) operate on these nodes and edges, but now informed by verified economic truth in addition to CEO preference.

## 9. Finance Director Integration

The Finance Director Agent (PR 2/3) gains three new read-only tools for inspecting learning state:

| Tool | Purpose | Mutation |
|------|---------|----------|
| `explain_economic_learning` | Show outcome → evidence → attribution → signal → adjustments → lessons | None |
| `inspect_economic_learning_status` | Status of learning for an outcome (eligible, processed, failed, reversed) | None |
| `list_economic_learning_events` | Seller-scoped list of learning events with filters | None |

All tools: `noExternalMutationExecuted: true`, seller-scoped, bounded responses (default limit 20).

### Finance Director CAN

- Review verified outcomes and their learning status
- Propose attribution hypotheses
- Identify alternative explanations
- Draft lesson candidates
- Explain learning to the CEO

### Finance Director CANNOT (Enforced by Architecture)

- Verify outcomes (that's a separate process)
- Assign `causal` attribution without experiment evidence
- Apply reinforcement (only the Bridge does that)
- Modify edge weights directly
- Change reinforcement policies
- Approve its own learning assessments

## 10. Seller Isolation

Plasticov and Maustian remain strictly isolated:

- Every eligibility check validates `sellerId`
- Every attribution assessment rejects cross-seller targets
- Every plan is seller-scoped
- Every bridge operation uses seller-scoped graph queries
- Every learning event carries `seller_id`
- All store queries include `WHERE seller_id = ?`
- Cross-seller queries are architecturally impossible without bypassing the store interface

A Plasticov outcome cannot:
- Reinforce a Maustian constellation
- Consult a Maustian attribution assessment
- Generate a global lesson without explicit cross-seller process
- Use Maustian evidence to boost confidence

## 11. Policy Versioning

All learning applications record three policy versions for reproducibility:

```
reinforcementPolicyVersion  →  e.g., "0.1.0"
attributionPolicyVersion     →  e.g., "0.1.0"
signalPolicyVersion          →  e.g., "0.1.0"
```

These are centrally configured in `EconomicReinforcementPlanner.config`. Versioning enables:
- **Reproducibility**: replay a past outcome with different policies
- **Rule migration**: upgrade policies without retroactively changing past events
- **Reversal**: find which policy version produced what adjustment
- **Policy comparison**: evaluate policy changes against historical data

## 12. Event Processing & Wake Policy

Learning is event-driven, not polled:

| Event | Action |
|-------|--------|
| `economic-outcome-verified` | Eligibility → signal → attribution → plan → bridge → ledger |
| `verified-outcome-updated` | Re-evaluate with new evidence version |
| `economic-outcome-disputed` | Find prior events → reversal plan → compensate |
| `economic-outcome-invalidated` | Full reversal |
| `learning-retry-requested` | Retry failed events |

No Telegram notification per event. Escalate to CEO only for:
- Significant loss patterns (multiple negative outcomes linked to same agent/pattern)
- Contradictory attribution (same action, conflicting outcomes)
- Major reversal (causal attribution later proven wrong)
- Learning blocked by missing human-provided data
- Repeated high-impact patterns emerging

## 13. Economic Learning Pipeline

**Module:** `packages/agent/src/finance/EconomicLearningPipeline.ts`

Orchestrates the full Tier 1 → Tier 2 → Tier 3 flow for a single outcome. This is the event handler entry point — it chains eligibility, signal, attribution, planning, bridging, and ledger persistence into a single atomic-ish pipeline. Failures at any stage are recorded and surfaced for retry.

## 14. Out of Scope (What This PR Does NOT Do)

- Autonomous decision execution from learned patterns
- Price changes, ad spend adjustments, publishing, purchasing
- Cross-seller learning (Plasticov ↔ Maustian isolation maintained)
- Causal inference beyond evidence-supported attribution
- Statistical models, external ML training, fine-tuning
- Kafka, Redis, graph databases, vector databases
- HTTP calls to external APIs
- Raw LLM output storage in the learning ledger
- Real-time financial dashboard (deferred to P0)
- Landed cost production (requires supplier data)
- Full accounting cash flow (deferred to P0)
- Real financial data ingestion (pending P0 production credentials)

## Files

| File | Package | Purpose |
|------|---------|---------|
| `economicLearning.ts` | domain | All domain types: eligibility, attribution, signal, plan, event, factories |
| `economicLearningEligibility.ts` | domain | Deterministic eligibility evaluator (10 block reasons) |
| `economicSignal.ts` | domain | Deterministic economic signal calculator |
| `economicLearningStore.ts` | memory | SQLite ledger for learning events with seller isolation |
| `EconomicAttributionEvaluator.ts` | agent/finance | 5-level attribution strength evaluation with fast-path + optional DeepSeek |
| `EconomicReinforcementPlanner.ts` | agent/finance | Plan generation from signal + attribution with per-strength policies |
| `CortexEconomicReinforcementBridge.ts` | agent/finance | Idempotent Cortex bridge with before/after hashes and safe degradation |
| `EconomicLearningPipeline.ts` | agent/finance | Pipeline orchestrator: eligibility → signal → attribution → plan → bridge |
| `economicLearningTools.ts` | agent/tools | Finance Director read-only learning inspection tools (3) |

## Tests

~3,500 lines of test code across 9 test files:

| Test File | Tests |
|-----------|-------|
| `economicLearningEligibility.test.ts` | 15+ — all status gates, completeness, currency, seller mismatch, already-processed |
| `economicSignal.test.ts` | 18+ — positive, negative, neutral, refund, baseline, NaN/Infinity guards |
| `economicLearning.test.ts` | 5+ — factory functions, type guards, plan creation |
| `economicLearningStore.test.ts` | 15+ — CRUD, idempotency, seller isolation, status transitions |
| `EconomicAttributionEvaluator.test.ts` | 12+ — five strength levels, fast path, caps, cross-seller rejection |
| `EconomicReinforcementPlanner.test.ts` | 12+ — per-strength policies, magnitude caps, negative signal, isolated outcome |
| `CortexEconomicReinforcementBridge.test.ts` | 12+ — apply, idempotency, retry, Cortex failure isolation, seller isolation |
| `economicLearningTools.test.ts` | 8+ — explain, inspect, list, seller isolation, nonexistent, failed, reversed |
| `EconomicLearningPipeline.test.ts` | 8+ — end-to-end flow, failure at each tier, retry, reversal |

## Formula

```
Eligibility(outcome, snapshot, targets, processed) → eligible | blocked(reasonCodes)

IF eligible:
  Signal(outcome, snapshot, baseline?) → {direction, magnitude, confidence}
  Attribution(outcome, evidence, IDs) → {strength, confidence, evidence}
  Plan(signal, attribution, targets)  → {targets, adjustments, lessons}
  Bridge(plan, graph, store)          → {event, beforeHash, afterHash}

IF disputed:
  Reversal(outcomeId, store, graph)   → {compensatingEvent, reversedEvents}
```

## Integration with Existing Systems

- **EconomicOutcomeStore**: Read-only access. Bridge never modifies outcomes.
- **Cortex Graph Engine**: Hebbian/penalty primitives are reused. Bridge calls existing `reinforceEdge`/`penalizeEdge`.
- **Finance Director**: Reads eligibility, signal, attribution, plans, events. Cannot apply reinforcement.
- **Agent Message Bus**: Learning events flow through the bus for daemon processing.
- **Agent Work Sessions**: The economic learning lane routes through work sessions for stateful multi-turn learning.
- **Daemon Scheduler**: Economic learning daemon processes verified outcomes on the standard 15-minute cycle.
