# Autonomy Engine Specification

## Purpose

Define the autonomy level state machine, KPI tracking, degradation rules, and guardrail gate that determine when the agent may auto-execute actions without "dale" confirmation. Autonomy is now **per-seller**, keyed by `seller_id`.

## Requirements

### Requirement: Autonomy Level State Machine

The system SHALL maintain an integer autonomy level 0–5 **per seller, keyed by `seller_id`** persisted in SQLite. Level 0 means all actions require "dale". Level 5 means only `critical`-risk actions require "dale". The level SHALL default to 1 (SUGIERE) for new sellers until the CEO issues a promotion. Existing data SHALL be migrated to `seller_id = 'default'`.

(Previously: global singleton.)

#### Scenario: New seller starts at level 1

- GIVEN a seller has no prior autonomy state
- WHEN `AutonomyEngine` initializes
- THEN `currentLevel` MUST be 1 (SUGIERE) for that seller

#### Scenario: CEO promotes one account only

- GIVEN Plasticov level 2, Maustian level 1
- WHEN `setLevel("plasticov", 3, reason)` is called
- THEN Plasticov level=3; Maustian level still 1

#### Scenario: Level persists per account

- GIVEN Plasticov=3, Maustian=1
- WHEN `converse()` starts for Maustian → level 1 loaded
- WHEN `converse()` starts for Plasticov → level 3 loaded

#### Scenario: Level is bounded 0–5

- GIVEN current level is 5
- WHEN the engine evaluates a promotion
- THEN the level MUST NOT exceed 5

---

### Requirement: Risk-to-Level Threshold Mapping

The system SHALL map each `AutonomyLevel` to a maximum `RiskLevel` the agent may auto-execute. The mapping is: CONSULTA = none, SUGIERE = `low`, PREPARA = `low`, BAJO_RIESGO = `medium`, MEDIO_RIESGO = `medium`, FULL = `high`. Actions at or below the threshold SHALL skip "dale" confirmation. Actions above the threshold SHALL require "dale". `critical`-risk actions SHALL always require "dale" regardless of autonomy level. Mapping identical per seller but NOW evaluated per-seller. Auto-approval is per-account: level 3 Plasticov auto-approves `low`; level 0 Maustian blocks `low`.

(Previously: global.)

#### Scenario: Low-risk action auto-approved at BAJO_RIESGO (level 3)

- GIVEN current autonomy level is 3 (BAJO_RIESGO) and the action risk is `low`
- WHEN `canAutoApprove("low")` evaluates
- THEN it MUST return `true`

#### Scenario: High-risk action blocked at BAJO_RIESGO (level 3)

- GIVEN current autonomy level is 3 (BAJO_RIESGO) and the action risk is `high`
- WHEN `canAutoApprove("high")` evaluates
- THEN it MUST return `false`

#### Scenario: Critical-risk action always requires dale

- GIVEN current autonomy level is 5 (FULL) and the action risk is `critical`
- WHEN `autonomyGate(proposal, engine)` evaluates
- THEN it MUST return `reason` string requiring "dale"

---

### Requirement: KPI Tracking

The system SHALL record KPI snapshots after every executed action (auto-approved or CEO-confirmed) into the `kpi_history` table, **per seller** with `seller_id`. Tracked KPIs SHALL be: `margin_compliance`, `success_rate`, `safety_violations`, and `response_accuracy`. Each snapshot SHALL include the current `level`, `seller_id`, and `timestamp` (UTC).

(Previously: global.)

#### Scenario: Successful action records KPIs

- GIVEN a price change action executes successfully at margin 45% (strategy requires ≥ 40%)
- WHEN KPIs are recorded
- THEN `success_rate` MUST be 1, `margin_compliance` MUST be 1, `safety_violations` MUST be 0

#### Scenario: Failed action records KPIs

- GIVEN an action fails with an error
- WHEN KPIs are recorded
- THEN `success_rate` MUST be 0

#### Scenario: Margin violation recorded

- GIVEN a price change executes at margin 35% while strategy requires ≥ 40%
- WHEN KPIs are recorded
- THEN `margin_compliance` MUST be 0

#### Scenario: KPIs isolated per seller

- GIVEN Plasticov succeeds, Maustian fails
- WHEN KPIs recorded
- THEN Plasticov: success_rate=1; Maustian: success_rate=0

---

### Requirement: Auto-Degradation

The system SHALL evaluate degradation before every `converse()` turn by querying KPI windows via `queryKpiWindow(sellerId)`, scoped to that seller's KPIs only. If `safety_violations > 3` in the last 24 hours FOR THAT SELLER, the level SHALL drop to 0 (CONSULTA). If average `margin_compliance < 0.8` in the last 7 days, the level SHALL degrade by 1. If average `success_rate < 0.5` in the last 30 days, the level SHALL degrade by 1. Degradation SHALL be cumulative if multiple thresholds are breached. The agent SHALL explain the degradation in Spanish: "Bajé tu nivel de autonomía a {N} porque..." with the specific breached threshold.

(Previously: global evaluation.)

#### Scenario: Safety violations force level 0

- GIVEN current level is 3 and the last 24 hours have > 3 `safety_violations=1` records for this seller
- WHEN `evaluateDegradation(sellerId)` runs
- THEN level MUST drop to 0 (CONSULTA)
- AND a `degradation_events` row MUST record the event with reason citing safety violations

#### Scenario: Low margin triggers degradation

- GIVEN average margin compliance < 0.8 in the last 7 days with KPI data for this seller
- WHEN `evaluateDegradation(sellerId)` runs
- THEN level MUST degrade by 1

#### Scenario: Low success rate triggers degradation

- GIVEN average success rate < 0.5 in the last 30 days with KPI data for this seller
- WHEN `evaluateDegradation(sellerId)` runs
- THEN level MUST degrade by 1

#### Scenario: Multiple thresholds breached

- GIVEN > 3 safety violations in 24h, margin_compliance < 0.8, and success_rate < 0.5
- WHEN `evaluateDegradation(sellerId)` runs
- THEN level MUST drop to CONSULTA (safety rule takes precedence, further rules act cumulatively)

#### Scenario: Healthy KPIs do not degrade

- GIVEN all KPI thresholds are met in the evaluation windows
- WHEN `evaluateDegradation(sellerId)` runs
- THEN level MUST remain unchanged

#### Scenario: Seller-A degradation doesn't affect Seller-B

- GIVEN Plasticov >3 violations, Maustian 0
- WHEN `evaluateDegradation("plasticov")` → drops to 0
- WHEN `evaluateDegradation("maustian")` → unchanged

---

### Requirement: Autonomy Gate Guardrail

The system SHALL implement `autonomyGate(action, engine): GuardResult` as a guardrail function following the same pattern as `strategyValidator`. It MUST return `passed: true` always (this gate never blocks — it determines whether to skip "dale"). When `canAutoApprove` returns `true`, the response SHALL have no `reason` (no dale needed). When blocked, the reason SHALL be in Spanish prompting "dale". When auto-approved, the action SHALL skip "dale" but SHALL still record a KPI snapshot. Gate logic identical; operates per-seller state.

#### Scenario: Auto-approved action skips dale

- GIVEN a low-risk action is auto-approved at BAJO_RIESGO (level 3)
- WHEN the action executes
- THEN a KPI snapshot MUST be recorded and no "dale" prompt required

#### Scenario: Gate blocked yields Spanish reason

- GIVEN autonomy level 1 (SUGIERE) and a high-risk proposal
- WHEN `autonomyGate` evaluates
- THEN it MUST return `passed: true` with a Spanish `reason` including "dale" prompt

---

### Requirement: Promotion via CEO Confirmation

The system SHALL generate a promotion recommendation when all KPIs meet healthy thresholds (safety_violations=0, avg margin_compliance>0.9, avg success_rate>0.9, avg response_accuracy>0.9) in a 30-day window with KPI data present, evaluated per seller. Promotion SHALL only occur after CEO explicitly calls `setLevel()`. The system SHALL NOT auto-promote itself.

#### Scenario: Healthy 30-day window triggers promotion recommendation

- GIVEN 30 days with 0 safety violations, 95% margin, 95% success, and 95% response accuracy
- WHEN the engine evaluates promotion eligibility
- THEN it MUST recommend promotion to the next level

#### Scenario: CEO manually promotes

- GIVEN a promotion recommendation exists
- WHEN CEO calls `engine.setLevel(targetLevel, reason)`
- THEN level MUST be set to the target level
- AND a `degradation_events` row MUST be recorded

#### Scenario: Promotion not triggered with violations

- GIVEN 1 safety violation in the 30-day window
- WHEN promotion eligibility is evaluated
- THEN no promotion recommendation SHALL be generated

### Requirement: Progressive Supplier Mirror Autonomy

Supplier Mirror autonomy MUST start with manual CEO policy decisions, learn repeated pricing, targeting, stock, and notification decisions through Cortex, and later allow CEO-proposed deterministic policies before any broader auto-execution.

#### Scenario: Initial supplier policy missing
- GIVEN a supplier item requires pricing or target-account policy
- WHEN no learned or deterministic policy exists
- THEN the CEO MUST ask the user for a manual decision before action

#### Scenario: Deterministic policy proposed
- GIVEN repeated user answers form stable evidence for a supplier policy
- WHEN the CEO detects enough support
- THEN it MAY propose a deterministic policy for explicit approval

#### Scenario: Autonomy not ready
- GIVEN learning evidence is sparse or contradictory
- WHEN Supplier Mirror considers auto-execution
- THEN it MUST remain proposal-only except verified allowed emergency pauses

### Requirement: Per-Seller Autonomy State Schema

`autonomy_state` MUST gain `seller_id TEXT NOT NULL` via idempotent migration, default `'default'` for existing rows. PK: `(seller_id)`. New sellers start at level 1.

#### Scenario: Existing preserved

- GIVEN Row with level 2 exists
- WHEN Migration runs
- THEN `seller_id = 'default'`, level = 2

#### Scenario: New seller

- GIVEN "maustian" has no row
- WHEN Engine inits for maustian
- THEN Row created: level 1, seller "maustian"

### Requirement: Per-Seller KPI History

`kpi_history` MUST include `seller_id TEXT NOT NULL`. KPIs scoped to the action's seller.

#### Scenario: KPIs isolated

- GIVEN Plasticov succeeds, Maustian fails
- WHEN KPIs recorded
- THEN Plasticov: success_rate=1; Maustian: success_rate=0

### Requirement: Per-Seller Degradation Events

`degradation_events` MUST include `seller_id TEXT NOT NULL`. Degradation evaluated per seller using only that seller's KPIs.

#### Scenario: Isolated degradation

- GIVEN Plasticov >3 violations, Maustian 0
- WHEN `evaluateDegradation("plasticov")`
- THEN Plasticov → level 0; Maustian unchanged
