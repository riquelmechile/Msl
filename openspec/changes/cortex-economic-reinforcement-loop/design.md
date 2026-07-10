# Design: Cortex Economic Reinforcement Loop

> **Phase:** P1, PR 3/3 (Financial Truth)
> **Date:** 2026-07-10
> **Status:** Designed

## Technical Approach

Layered architecture: deterministic eligibility → signal calculation → attribution evaluation → reinforcement planning → Cortext bridge → ledger persistence. Each layer is independently testable. No layer modifies data from a lower layer. EconomicOutcomeStore remains the unchallenged source of truth.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Eligibility in domain vs agent | Domain = deterministic, no deps | Domain: `economicLearningEligibility.ts` |
| Signal in domain vs agent | Domain = pure math, no reasoning needed | Domain: `economicSignal.ts` |
| Attribution with or without DeepSeek | With = richer analysis; Without = safer | Hybrid: fast path deterministic + optional DeepSeek hypothesis generation (capped) |
| Planner as separate phase vs bridge doing it | Separate = testable, auditable | Separate: ReinforcementPlanner → validated plan → Bridge applies |
| New SQLite table vs reuse outcome store | New = clean isolation, easier reversal tracking | New: `economic_learning_store` table |
| Event-driven vs polling | Event = lower latency, less waste | Event-driven: listen for verified/disputed events |

## Data Flow

```
EconomicOutcome (verified)
        │
        ▼
EconomicLearningEligibilityEvaluator → eligible/blocked
        │
        ▼ (eligible)
EconomicSignalCalculator → EconomicSignal {direction, magnitude, confidence}
        │
        ▼
EconomicAttributionEvaluator → AttributionAssessment {strength, confidence, evidence}
        │                       (fast path: deterministic IDs)
        │                       (slow path: DeepSeek hypothesis, bounded)
        ▼
EconomicReinforcementPlanner → EconomicReinforcementPlan {targets, adjustments, lessons}
        │
        ▼ (validated)
CortexEconomicReinforcementBridge → apply to Cortex + persist EconomicLearningEvent
        │
        ▼
EconomicLearningStore (ledger)
```

## Module Breakdown

### 1. Domain Types (`packages/domain/src/economicLearning.ts`)

```typescript
// Eligibility
type EconomicLearningEligibility = {
  outcomeId: string; sellerId: string;
  eligible: boolean;
  reasonCodes: BlockReason[];
  outcomeStatus: EconomicOutcomeStatus;
  completeness: number; confidence: number;
  evidenceQuality: number;
  hasVerifiedEconomicImpact: boolean;
  hasAttributionTargets: boolean;
  currencies: Currency[];
  evaluatedAt: number;
};

type BlockReason =
  | "outcome-not-verified"
  | "incomplete-economic-data"
  | "disputed-evidence"
  | "invalidated-outcome"
  | "missing-observed-impact"
  | "currency-conflict"
  | "missing-attribution-target"
  | "stale-evidence"
  | "already-processed"
  | "seller-scope-mismatch";

// Attribution
type AttributionStrength = "none" | "associated" | "contributory" | "experiment-supported" | "causal";

type AttributionTargetType =
  | "agent" | "proposal" | "action" | "session"
  | "campaign" | "experiment" | "cortex-constellation";

type EconomicAttributionAssessment = {
  attributionId: string; outcomeId: string; sellerId: string;
  targetType: AttributionTargetType; targetId: string;
  strength: AttributionStrength; confidence: number;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  alternativeExplanations: string[];
  baselineId?: string; experimentId?: string;
  observationWindow?: { start: number; end: number };
  evaluator: string; createdAt: number;
  noMutationExecuted: true;
};

// Signal
type EconomicSignal = {
  direction: "positive" | "neutral" | "negative";
  magnitude: number; // 0..1
  confidence: number; // 0..1
  reasonCodes: string[];
  sourceValues: Record<string, number>; // bounded metadata
};

// Plan
type EconomicReinforcementPlan = {
  planId: string; outcomeId: string; sellerId: string;
  economicSignal: EconomicSignal;
  attributionStrength: AttributionStrength;
  confidence: number;
  targetNodes: ReinforcementTarget[]; targetEdges: ReinforcementTarget[];
  proposedAdjustments: NodeAdjustment[];
  lessonCandidates: LessonCandidate[];
  blockedTargets: BlockedTarget[];
  reasonCodes: string[];
  createdAt: number;
  status: PlanStatus; // proposed | validated | applied | rejected | reversed | failed
  reinforcementPolicyVersion: string;
  attributionPolicyVersion: string;
  signalPolicyVersion: string;
  noExternalMutationExecuted: true;
};

// Learning Event
type EconomicLearningEvent = {
  eventId: string; idempotencyKey: string;
  outcomeId: string; sellerId: string;
  planId: string; attributionId: string;
  targetNodeIds: string[]; targetEdgeIds: string[];
  adjustments: AppliedAdjustment[];
  lessonsCreated: string[];
  beforeStateHash: string; afterStateHash: string;
  appliedAt: number; reversedAt?: number;
  status: LearningEventStatus;
  errorCode?: string;
  metadata: Record<string, unknown>; // bounded, no secrets
};
```

### 2. Eligibility Evaluator (`packages/domain/src/economicLearningEligibility.ts`)

Pure deterministic function. Rules:
- `pending` → blocked (`outcome-not-verified`)
- `observing` → blocked (`outcome-not-verified`)
- `observed` → blocked (`outcome-not-verified`)
- `disputed` → blocked (`outcome-not-verified`)
- `invalidated` → blocked (`outcome-not-verified`)
- `verified` → continue evaluation, then check: missing observed impact, incomplete snapshot, currency conflict, disputed primary evidence, missing attribution targets, already processed, stale evidence, seller mismatch

Returns `EconomicLearningEligibility` with `eligible: boolean` and `reasonCodes`.

### 3. Signal Calculator (`packages/domain/src/economicSignal.ts`)

Deterministic. Takes `EconomicOutcome` + `UnitEconomicsSnapshot`. Computes:
- Direction: positive/neutral/negative based on net profit vs expected impact
- Magnitude: 0..1, bounded score derived from financial deltas (Money-safe)
- Confidence: based on completeness, evidence quality, calculation status

Not just `profit > 0 = good`. Considers baseline, expected impact, margin, refunds, missing costs, observation window.

### 4. Attribution Evaluator (`packages/agent/src/EconomicAttributionEvaluator.ts`)

Fast path (deterministic): links by shared IDs (proposalId, executionId, correlationId, sessionId, agentId, sellerId, item/order/SKU, observation window).

Optional DeepSeek path: formulates hypotheses about alternative explanations, identifies contradictory evidence, recommends caution. DeepSeek **cannot**: raise strength above evidence limits, assign causal without baseline/experiment, invent evidence IDs, change profit, change outcome status.

Limits:
- Temporal coincidence only → max `associated`
- Linked IDs + coherent evidence → max `contributory`
- Baseline or before/after comparison → max `experiment-supported`
- `causal` requires explicit contract and extraordinary evidence

### 5. Reinforcement Planner (`packages/agent/src/EconomicReinforcementPlanner.ts`)

Transforms verified outcome + signal + attribution into a validated plan. Never applies directly. Policy:
- `none` → no edge changes; optionally record factual outcome node
- `associated` → create episodic memory; minimal or no edge adjustment
- `contributory` → moderate adjustment weighted by confidence × magnitude
- `experiment-supported` → larger adjustment, still capped
- `causal` → maximum allowed adjustment, never unlimited

Magnitude is globally bounded. Negative signal weakens connections.

### 6. Cortex Bridge (`packages/agent/src/CortexEconomicReinforcementBridge.ts`)

Receives validated plan. Responsibilities:
1. Verify idempotency
2. Load before-state
3. Create/reuse economic outcome nodes
4. Link outcome, agent, action, seller, evidence
5. Apply bounded adjustments
6. Record EconomicLearningEvent
7. Return structured result
8. Degrade safely on Cortex failure

Must NOT: write to EconomicOutcomeStore (except processing record), change outcome status, recalculate money, call MercadoLibre, call external APIs, store raw LLM output, mix sellers.

### 7. Learning Store (`packages/memory/src/economicLearningStore.ts`)

SQLite table `economic_learning_events` with:
- event_id, idempotency_key (UNIQUE), outcome_id, seller_id
- plan_id, attribution_id, target_node_ids_json, target_edge_ids_json
- adjustments_json, lessons_created_json
- before_state_hash, after_state_hash
- applied_at, reversed_at, status, error_code
- policy_versions_json, bounded_metadata_json
- seller_id index

Idempotency key: `sellerId + outcomeId + verifiedVersion + policyVersion`. Not just outcomeId — re-verification with new evidence needs controlled versioning.

## Reversal Design

When a verified outcome is later disputed or invalidated:
1. Find learning events by outcome_id
2. Apply inverse adjustments safely
3. Mark event as `reversed`
4. Create compensation event
5. Maintain history — never delete

If exact inverse is unsafe: record compensating event, document limitation.

## Finance Director Integration

New read-only tools (`noExternalMutationExecuted: true`):
- `explain_economic_learning` — show outcome, evidence, attribution, signal, adjustments, lessons, uncertainty
- `inspect_economic_learning_status` — status of learning for an outcome
- `list_economic_learning_events` — seller-scoped event list

Finance Director CAN: review verified outcomes, propose attribution, identify alternatives, draft lessons, explain learning to CEO.
Finance Director CANNOT: verify outcomes, mark causality alone, apply reinforcement, modify weights, change policies, approve own learning.

## Wake Policy

Event-driven, not polling:
- `economic-outcome-verified` → eligibility → attribution → plan → bridge → event
- `verified-outcome-updated` → re-evaluate with new evidence version
- `economic-outcome-disputed` → find prior events → reversal plan → compensate
- `economic-outcome-invalidated` → reversal
- `learning-retry-requested` → retry failed events

No Telegram notification per event. Escalate only on: significant loss, contradictory attribution, major reversal, learning blocked by human data, repeated high-impact patterns.

## Seller Isolation

Every eligibility, attribution, plan, event, node, edge, query, session, and tool validates sellerId. Plasticov outcome cannot: reinforce Maustian constellation, consult Maustian assessment, generate global lesson without explicit process, use Maustian evidence to boost confidence.

## Policy Versioning

All learning applications record: `reinforcementPolicyVersion`, `attributionPolicyVersion`, `signalPolicyVersion`. Thresholds centralized in typed config. Enables: reproducibility, rule migration, reversal, policy comparison.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/domain/src/economicLearning.ts` | New | All domain types for economic learning |
| `packages/domain/src/economicLearningEligibility.ts` | New | Deterministic eligibility evaluator |
| `packages/domain/src/economicSignal.ts` | New | Economic signal calculator |
| `packages/domain/src/index.ts` | Modify | Export new domain types |
| `packages/memory/src/economicLearningStore.ts` | New | SQLite ledger store |
| `packages/memory/src/index.ts` | Modify | Export new store |
| `packages/agent/src/finance/EconomicAttributionEvaluator.ts` | New | Attribution strength evaluation |
| `packages/agent/src/finance/EconomicReinforcementPlanner.ts` | New | Plan generation |
| `packages/agent/src/finance/CortexEconomicReinforcementBridge.ts` | New | Cortext bridge |
| `packages/agent/src/conversation/tools/economicLearningTools.ts` | New | FD read-only inspection tools |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Add economicStore, wire tools (already done in hardening) |
| `docs/architecture/cortex-economic-reinforcement-loop.md` | New | Architecture documentation |
| `openspec/specs/` | Modify | Delta specs for economic-learning lane |

## Test Plan

### Eligibility (10+ tests)
- pending/observing/observed/disputed/invalidated blocked
- verified complete eligible
- verified incomplete blocked (missing impact, currency conflict, seller mismatch, already processed)

### Signal (10+ tests)
- positive/negative/neutral profit
- high revenue + net loss, profit with refund, below expected
- no baseline, low confidence, no NaN/Infinity

### Attribution (12+ tests)
- Fast path identity links, slow path DeepSeek hypotheses
- Temporal-only → associated; linked execution → contributory; baseline supports → experiment-supported
- Causal blocked without strong evidence
- Alternative explanations reduce confidence
- No invented evidence IDs; cross-seller rejected

### Planner (10+ tests)
- none → no reinforcement; associated → episodic; contributory → moderate; experiment-supported → larger but capped
- Magnitude limit; negative weakens; neutral no change; isolated outcome no global rule

### Bridge (10+ tests)
- Successful application, idempotency, retry after failure
- Cortex failure ≠ outcome change; seller isolation; node dedup; event ledger; before/after hashes; no raw metadata

### Reversal (8+ tests)
- Verified→applied→disputed; invalidated; compensating event; double reversal blocked; partial failure; new evidence version

### Lessons (6+ tests)
- Single episode = episodic memory only; multiple outcomes = candidate; contradiction blocks generalization; lesson includes confidence/scope/expiry; CEO policy not overwritten

### Tools (6+ tests)
- explain/inspect/list; seller isolation; nonexistent/failed/reversed; noExternalMutationExecuted true
