# economic-learning Specification

Verified economic outcomes feeding Cortex Darwinian learning through a three-tier deterministic architecture: eligibility gating, attribution evaluation, and idempotent reinforcement with full audit and reversal support. Ingestion run provenance on cost components and snapshots enables audit-grade traceability. Multi-dimensional reconciliation evaluates revenue, cost, and coverage independently.

## Requirements

### Requirement: Ingestion Run Provenance on Cost Components and Snapshots

The system SHALL add `ingestion_run_id TEXT NOT NULL` to `economic_cost_components` and `unit_economics_snapshots` tables. Every component and snapshot created during ingestion MUST carry the run ID that produced it.

#### Scenario: Component carries run provenance

- GIVEN an ingestion run with `runId = 'r-abc'`
- WHEN cost components are persisted
- THEN every component row MUST have `ingestion_run_id = 'r-abc'`

#### Scenario: Snapshot carries run provenance

- GIVEN an ingestion run with `runId = 'r-abc'`
- WHEN unit economics snapshots are persisted
- THEN every snapshot row MUST have `ingestion_run_id = 'r-abc'`

---

### Requirement: Reconciliation — Multi-Dimensional with Incomplete Semantics

The system MUST reconcile economic outcomes across three independent dimensions: `revenueReconciliation`, `costReconciliation`, and `coverage`. Each dimension SHALL produce its own status independently. An outcome with zero revenue AND zero cost SHALL be classified as `incomplete`, NOT `balanced`.

#### Scenario: Revenue balanced but cost mismatched

- GIVEN an outcome where revenue delta is zero but cost delta is non-zero
- WHEN reconciliation evaluates
- THEN `revenueReconciliation.status` MUST be `balanced` AND `costReconciliation.status` MUST be `mismatched` AND overall status MUST NOT be `balanced`

#### Scenario: Zero-both-sides is incomplete

- GIVEN an outcome with 0 revenue AND 0 cost
- WHEN reconciliation runs
- THEN overall status MUST be `incomplete` AND `coverage.meaningful` MUST be `false`

#### Scenario: All dimensions balanced

- GIVEN an outcome where revenue, cost, and coverage all reconcile within tolerance
- WHEN reconciliation runs
- THEN overall status MUST be `balanced` AND each dimension status MUST be `balanced`

---

### Requirement: Economic Learning Eligibility — Only Verified Outcomes

The system MUST gate all economic learning behind a deterministic eligibility evaluator. Only outcomes with status `verified` SHALL proceed to signal calculation, attribution, and reinforcement. Outcomes with status `pending`, `observing`, `observed`, `disputed`, or `invalidated` MUST be blocked with the reason code `outcome-not-verified`.

The eligibility evaluator SHALL be a pure function with no I/O, no AI, and no heuristics. It SHALL evaluate 10 block reasons. First failure wins.

#### Scenario: Verified complete outcome is eligible

- GIVEN an outcome with status `verified`, observed impact present, complete snapshot, matching sellers, and unprocessed
- WHEN `evaluateEconomicLearningEligibility` runs
- THEN `eligible` MUST be `true` AND `reasonCodes` MUST be empty

#### Scenario: Pending outcome is blocked

- GIVEN an outcome with status `pending`
- WHEN `evaluateEconomicLearningEligibility` runs
- THEN `eligible` MUST be `false` AND `reasonCodes` MUST include `outcome-not-verified`

#### Scenario: Verified but incomplete is blocked

- GIVEN an outcome with status `verified` but snapshot has `calculationStatus: "partial"` with missing inputs
- WHEN `evaluateEconomicLearningEligibility` runs
- THEN `eligible` MUST be `false` AND `reasonCodes` MUST include `incomplete-economic-data`

#### Scenario: Already processed outcome is blocked

- GIVEN an outcome with status `verified` but already processed in the learning ledger
- WHEN `evaluateEconomicLearningEligibility` runs with `alreadyProcessed: true`
- THEN `eligible` MUST be `false` AND `reasonCodes` MUST include `already-processed`

#### Scenario: Seller scope mismatch is blocked

- GIVEN an outcome with seller `plasticov` and a snapshot with seller `maustian`
- WHEN `evaluateEconomicLearningEligibility` runs
- THEN `eligible` MUST be `false` AND `reasonCodes` MUST include `seller-scope-mismatch`

#### Scenario: All 10 block reasons are distinguishable

- GIVEN different failure conditions
- WHEN `evaluateEconomicLearningEligibility` runs for each
- THEN each condition MUST produce its specific `BlockReason` code from the set: `outcome-not-verified`, `incomplete-economic-data`, `disputed-evidence`, `invalidated-outcome`, `missing-observed-impact`, `currency-conflict`, `missing-attribution-target`, `stale-evidence`, `already-processed`, `seller-scope-mismatch`

---

### Requirement: Economic Signal Calculation — Deterministic

The system MUST compute an economic signal from the outcome and its unit economics snapshot. The signal SHALL include direction (`positive`, `neutral`, `negative`), magnitude (bounded 0..1), and confidence (0..1). The calculator MUST be deterministic — given the same inputs, the output MUST be identical. No NaN, no Infinity, and no floating-point arithmetic SHALL appear in any output field.

#### Scenario: Profitable outcome produces positive signal

- GIVEN an outcome with net profit of CLP 50000 and contribution margin > 0
- WHEN `computeEconomicSignal` runs
- THEN `direction` MUST be `"positive"` AND `magnitude` MUST be > 0

#### Scenario: Loss-making outcome produces negative signal

- GIVEN an outcome with net profit of CLP -20000
- WHEN `computeEconomicSignal` runs
- THEN `direction` MUST be `"negative"` AND `magnitude` MUST be > 0

#### Scenario: Break-even outcome produces neutral signal

- GIVEN an outcome with net profit of CLP 0 within tolerance
- WHEN `computeEconomicSignal` runs
- THEN `direction` MUST be `"neutral"`

#### Scenario: Partial data reduces confidence

- GIVEN a snapshot with `calculationStatus: "partial"` and missing inputs
- WHEN `computeEconomicSignal` runs
- THEN `confidence` MUST be < 1.0

#### Scenario: No NaN or Infinity in output

- GIVEN any valid snapshot input
- WHEN `computeEconomicSignal` runs
- THEN `magnitude`, `confidence`, and all `sourceValues` MUST be finite numbers in [0, 1] range

#### Scenario: Baseline comparison affects magnitude

- GIVEN a baseline snapshot and a current snapshot with better profit
- WHEN `computeEconomicSignal` runs with baseline
- THEN `magnitude` MUST reflect the positive delta from baseline

---

### Requirement: Attribution Evaluation — 5 Strength Levels

The system MUST evaluate the strength of attribution between an economic outcome and its originating decision chain using a 5-level scale: `none`, `associated`, `contributory`, `experiment-supported`, `causal`. The evaluation SHALL have a deterministic fast path using shared identity fields. Stronger levels SHALL require progressively more evidence.

#### Scenario: No shared IDs produces none attribution

- GIVEN an outcome with no shared proposal, execution, agent, session, or correlation IDs
- WHEN `EconomicAttributionEvaluator.evaluate()` runs
- THEN `strength` MUST be `"none"`

#### Scenario: Shared correlation ID produces associated attribution

- GIVEN an outcome sharing a `correlationId` with a proposal but no direct execution link
- WHEN `EconomicAttributionEvaluator.evaluate()` runs
- THEN `strength` MUST be `"associated"`

#### Scenario: Shared execution ID produces contributory attribution

- GIVEN an outcome linked via `executionId` and `proposalId` to an agent action
- WHEN `EconomicAttributionEvaluator.evaluate()` runs
- THEN `strength` MUST be at least `"contributory"`

#### Scenario: Baseline comparison produces experiment-supported attribution

- GIVEN an outcome with baseline snapshot, experiment ID, and before/after comparison
- WHEN `EconomicAttributionEvaluator.evaluate()` runs
- THEN `strength` MUST be `"experiment-supported" OR "causal"` (depending on evidence quality)

#### Scenario: Causal attribution is blocked without extraordinary evidence

- GIVEN an attribution request without experiment contract, baseline, or control group
- WHEN `EconomicAttributionEvaluator.evaluate()` requests `causal`
- THEN `strength` MUST NOT be `"causal"` AND the cap MUST be enforced

#### Scenario: Alternative explanations reduce confidence

- GIVEN an attribution with supporting evidence but also contradicting evidence
- WHEN `EconomicAttributionEvaluator.evaluate()` runs
- THEN `confidence` MUST be reduced proportional to contradicting evidence weight

#### Scenario: Cross-seller attribution is rejected

- GIVEN an attribution request where outcome seller differs from attribution target seller
- WHEN `EconomicAttributionEvaluator.evaluate()` runs
- THEN the evaluation MUST fail with a seller-scope error

#### Scenario: DeepSeek cannot override evidence limits

- GIVEN optional DeepSeek hypothesis generation is active
- WHEN DeepSeek proposes `causal` without experiment evidence
- THEN the evaluator MUST cap strength at the evidence-supported maximum

---

### Requirement: Reinforcement Planning — Separated from Application

The system MUST generate reinforcement plans as immutable, validated objects before applying any Cortex mutation. The planner SHALL apply per-strength policies, enforce a global magnitude cap, handle negative signals, and prevent single episodes from creating global rules.

The planner MUST be a separate phase from the Cortex bridge. A validated plan SHALL carry `noExternalMutationExecuted: true`.

#### Scenario: None attribution produces no reinforcement

- GIVEN an attribution strength of `"none"`
- WHEN `EconomicReinforcementPlanner.createPlan()` runs
- THEN `proposedAdjustments` MUST be empty AND `targetEdges` MUST be empty AND a factual outcome node MAY be recorded

#### Scenario: Associated attribution creates episodic memory only

- GIVEN an attribution strength of `"associated"`
- WHEN `EconomicReinforcementPlanner.createPlan()` runs
- THEN any lesson candidates MUST be type `"episodic"` AND edge adjustments SHALL be minimal or zero

#### Scenario: Contributory attribution produces moderate adjustment

- GIVEN an attribution strength of `"contributory"` with positive signal
- WHEN `EconomicReinforcementPlanner.createPlan()` runs
- THEN adjustment deltas MUST be > 0 AND capped by the configurable contributory maximum

#### Scenario: Causal attribution is capped by global magnitude limit

- GIVEN an attribution strength of `"causal"` with maximum signal magnitude
- WHEN `EconomicReinforcementPlanner.createPlan()` runs with `maxMagnitude: 0.25`
- THEN no single edge adjustment delta MUST exceed 0.25

#### Scenario: Negative signal produces negative deltas

- GIVEN a signal with `direction: "negative"` and attribution `"contributory"`
- WHEN `EconomicReinforcementPlanner.createPlan()` runs
- THEN adjustment deltas MUST be negative (penalize)

#### Scenario: Single outcome cannot create global rule

- GIVEN a single positive outcome with `"contributory"` attribution
- WHEN `EconomicReinforcementPlanner.createPlan()` runs
- THEN lesson candidates MUST have explicit `scope` (not "global") with `confidence` < 1.0 AND `expiryDays` MUST be set

#### Scenario: Policy versions are recorded

- GIVEN any reinforcement plan
- WHEN `EconomicReinforcementPlanner.createPlan()` completes
- THEN `reinforcementPolicyVersion`, `attributionPolicyVersion`, and `signalPolicyVersion` MUST be present in the plan

---

### Requirement: Cortex Economic Bridge — Idempotent Application

The system MUST apply reinforcement plans to the Cortex graph engine idempotently. The bridge SHALL compute before and after state hashes, record full audit trails, and degrade safely on Cortex failure without corrupting economic outcomes.

The bridge MUST use a composite idempotency key: `outcomeId + sellerId + reinforcementPolicyVersion`. Re-applying the same plan with the same key SHALL be a no-op.

#### Scenario: Successful plan application

- GIVEN a validated reinforcement plan with target edges
- WHEN `CortexEconomicReinforcementBridge.apply()` runs
- THEN edge weights MUST be adjusted per the plan AND a learning event MUST be persisted

#### Scenario: Idempotent re-application is a no-op

- GIVEN a plan that was already applied with the same idempotency key
- WHEN `CortexEconomicReinforcementBridge.apply()` runs again
- THEN no new adjustments MUST occur AND the result MUST indicate the plan was already applied

#### Scenario: Before and after state hashes are recorded

- GIVEN a successful application
- WHEN the learning event is persisted
- THEN `beforeStateHash` and `afterStateHash` MUST be present AND `beforeStateHash !== afterStateHash`

#### Scenario: Cortex failure does not corrupt economic outcomes

- GIVEN a Cortex graph engine that throws during application
- WHEN `CortexEconomicReinforcementBridge.apply()` runs
- THEN no `EconomicOutcome` status SHALL be modified AND the learning event status MUST be `"failed"` AND the bridge MUST return a degradation result

#### Scenario: Seller isolation is maintained

- GIVEN a plan for seller `plasticov`
- WHEN the bridge queries Cortex for target nodes
- THEN all queries MUST be scoped to seller `plasticov` AND Maustian nodes MUST NOT be returned or modified

#### Scenario: No raw metadata in learning events

- GIVEN a successful application
- WHEN the learning event is persisted
- THEN `metadata` MUST contain only bounded, structured data — no raw LLM output, no secrets, no console logs

---

### Requirement: Economic Learning Store — Seller-Scoped Ledger

The system MUST persist all learning events in a seller-scoped SQLite ledger. The `economic_learning_events` table SHALL enforce uniqueness on `idempotency_key`, index on `seller_id`, and support status transitions: `processed`, `failed`, `retryable`, `reversed`.

#### Scenario: Insert with duplicate idempotency key fails

- GIVEN a learning event with idempotency key `outcome-1-plasticov-0.1.0`
- AND another event with the same idempotency key
- WHEN the second event is inserted
- THEN the insert MUST fail with a uniqueness constraint violation

#### Scenario: Seller-scoped listing

- GIVEN events for both `plasticov` and `maustian`
- WHEN listing events with `seller_id = "plasticov"`
- THEN only Plasticov events MUST be returned

#### Scenario: Status transition to reversed

- GIVEN a learning event with status `processed`
- WHEN the event is reversed
- THEN status MUST change to `reversed` AND `reversed_at` timestamp MUST be set

#### Scenario: JSON columns support flexible schemas

- GIVEN a learning event with adjustments and policy versions
- WHEN the event is retrieved
- THEN `adjustments_json`, `lessons_created`, `target_node_ids`, and `policy_versions` MUST deserialize into their typed structures

---

### Requirement: Reversal Support

The system MUST support reversing learning events when their originating outcomes are disputed or invalidated. Reversal SHALL apply inverse adjustments where safe, mark events as `reversed`, create compensating events, and preserve history. Double reversal SHALL be prevented.

#### Scenario: Verified outcome later disputed triggers reversal

- GIVEN a learning event applied for a verified outcome
- WHEN the outcome status changes to `disputed`
- THEN the reversal engine MUST find the learning event AND apply inverse adjustments AND mark it `reversed` AND create a compensating event

#### Scenario: Invalidated outcome triggers full reversal

- GIVEN a learning event applied for a verified outcome
- WHEN the outcome status changes to `invalidated`
- THEN all associated learning events MUST be reversed

#### Scenario: Double reversal is prevented

- GIVEN an already-reversed learning event
- WHEN reversal is attempted again
- THEN the operation MUST be rejected with an appropriate error

#### Scenario: Partial failure does not leave inconsistent state

- GIVEN a reversal operation where some inverse adjustments fail
- WHEN the reversal is attempted
- THEN the reversal MUST document the limitation AND create a compensating event explaining what could not be undone

---

### Requirement: Finance Director Read-Only Tools

The system MUST provide three read-only tools for the Finance Director to inspect economic learning state: `explain_economic_learning`, `inspect_economic_learning_status`, and `list_economic_learning_events`. All tools SHALL require `sellerId`, scope queries to the requesting seller, return `noExternalMutationExecuted: true`, and return bounded responses with a default limit of 20.

#### Scenario: Explain economic learning shows full chain

- GIVEN a processed outcome with eligibility, signal, attribution, and plan
- WHEN `explain_economic_learning` is called
- THEN the response MUST include the outcome ID, evidence, attribution strength, signal direction, adjustment summary, and lessons created

#### Scenario: Inspect returns learning status

- GIVEN an outcome that has been processed
- WHEN `inspect_economic_learning_status` is called
- THEN the response MUST show eligibility, processing status, plan ID, and event status

#### Scenario: List returns seller-scoped events

- GIVEN learning events for both sellers
- WHEN `list_economic_learning_events` is called for `plasticov`
- THEN only Plasticov events MUST be returned

#### Scenario: Learning tool returns noExternalMutationExecuted

- GIVEN any economic learning tool call
- WHEN the tool completes
- THEN every return path MUST include `noExternalMutationExecuted: true`

---

### Requirement: Seller Isolation

The system MUST enforce seller isolation at every layer of the economic learning pipeline. Eligibility, attribution, planning, bridging, store queries, and tools SHALL all validate and scope by `sellerId`. A Plasticov outcome SHALL never reinforce a Maustian constellation or vice versa.

#### Scenario: Plasticov outcome cannot reinforce Maustian constellation

- GIVEN a Plasticov outcome producing a reinforcement plan
- WHEN the Cortex bridge applies the plan
- THEN all node and edge targets MUST belong to `seller_id = "plasticov"`

#### Scenario: Maustian attribution cannot use Plasticov evidence

- GIVEN a Maustian attribution evaluation
- WHEN evidence IDs are linked
- THEN no Plasticov evidence IDs SHALL appear in the attribution assessment

#### Scenario: Cross-seller query is blocked at store level

- GIVEN a store query without seller filter
- WHEN the query executes
- THEN it MUST fail or return empty (depending on enforcement strategy: SQL WHERE clause or pre-query validation)

---

### Requirement: Policy Versioning

The system MUST record policy versions with every learning artifact. Reinforcement plans SHALL carry `reinforcementPolicyVersion`, `attributionPolicyVersion`, and `signalPolicyVersion`. Learning events SHALL carry `reinforcementPolicyVersion`. This enables reproducibility, rule migration, reversal, and policy comparison.

#### Scenario: Plan includes all policy versions

- GIVEN any reinforcement plan
- WHEN the plan is created
- THEN `reinforcementPolicyVersion`, `attributionPolicyVersion`, and `signalPolicyVersion` MUST be non-empty strings

#### Scenario: Learning event records reinforcement policy version

- GIVEN any learning event
- WHEN the event is persisted
- THEN `reinforcementPolicyVersion` MUST match the plan's version

#### Scenario: Policy version enables re-evaluation with new rules

- GIVEN an outcome processed with policy version `0.1.0`
- WHEN a new policy version `0.2.0` changes attribution thresholds
- THEN the same outcome CAN be re-evaluated with the new policy AND a new event with a distinct idempotency key SHALL be created
