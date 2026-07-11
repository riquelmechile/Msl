# Delta for economic-learning

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Economic Learning Eligibility — Only Verified Outcomes

The system MUST gate all economic learning behind a deterministic eligibility evaluator. Only outcomes with status `verified` SHALL proceed to signal calculation, attribution, and reinforcement. Outcomes with status `pending`, `observing`, `observed`, `disputed`, or `invalidated` MUST be blocked with the reason code `outcome-not-verified`.

The eligibility evaluator SHALL be a pure function with no I/O, no AI, and no heuristics. It SHALL evaluate 10 block reasons. First failure wins.

(Previously: No changes to eligibility logic — ingestion_run_id on components/snapshots enables provenance queries but does not alter eligibility rules.)

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

### Requirement: Reconciliation — Multi-Dimensional with Incomplete Semantics

The system MUST reconcile economic outcomes across three independent dimensions: `revenueReconciliation`, `costReconciliation`, and `coverage`. Each dimension SHALL produce its own status independently. An outcome with zero revenue AND zero cost SHALL be classified as `incomplete`, NOT `balanced`.

(Previously: Reconciliation produced a single `balanced`/`mismatched` status. Zero-both-sides was treated as `balanced`.)

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
