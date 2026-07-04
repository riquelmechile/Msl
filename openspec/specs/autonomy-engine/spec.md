# Autonomy Engine Specification

## Purpose

Define the autonomy level state machine, KPI tracking, degradation rules, and guardrail gate that determine when the agent may auto-execute actions without "dale" confirmation.

## Requirements

### Requirement: Autonomy Level State Machine

The system SHALL maintain an integer autonomy level 0–5 per seller session, persisted in SQLite. Level 0 means all actions require "dale". Level 5 means only `critical`-risk actions require "dale". The level SHALL default to 1 (SUGIERE) until the CEO issues a promotion.

#### Scenario: New seller starts at level 1

- GIVEN a seller has no prior autonomy state
- WHEN `AutonomyEngine` initializes
- THEN `currentLevel` MUST be 1 (SUGIERE)

#### Scenario: CEO promotes via dale on promotion proposal

- GIVEN current level is 2 and KPI windows are green
- WHEN the engine generates a promotion proposal and CEO confirms "dale"
- THEN `currentLevel` MUST increment to 3
- AND a `degradation_events` row MUST record the level change with reason

#### Scenario: Level persists across turns

- GIVEN level was set to 3 in a prior turn
- WHEN a new `converse()` turn starts
- THEN `AutonomyEngine` MUST load level 3 from SQLite

#### Scenario: Level is bounded 0–5

- GIVEN current level is 5
- WHEN the engine evaluates a promotion
- THEN the level MUST NOT exceed 5

---

### Requirement: Risk-to-Level Threshold Mapping

The system SHALL map each `AutonomyLevel` to a maximum `RiskLevel` the agent may auto-execute. The mapping is: CONSULTA = none, SUGIERE = `low`, PREPARA = `low`, BAJO_RIESGO = `medium`, MEDIO_RIESGO = `medium`, FULL = `high`. Actions at or below the threshold SHALL skip "dale" confirmation. Actions above the threshold SHALL require "dale". `critical`-risk actions SHALL always require "dale" regardless of autonomy level.

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

The system SHALL record KPI snapshots after every executed action (auto-approved or CEO-confirmed) into the `kpi_history` table. Tracked KPIs SHALL be: `margin_compliance`, `success_rate`, `safety_violations`, and `response_accuracy`. Each snapshot SHALL include the current `level` and `timestamp` (UTC).

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

---

### Requirement: Auto-Degradation

The system SHALL evaluate degradation before every `converse()` turn by querying KPI windows via `queryKpiWindow()`. If `safety_violations > 3` in the last 24 hours, the level SHALL drop to 0 (CONSULTA). If average `margin_compliance < 0.8` in the last 7 days, the level SHALL degrade by 1. If average `success_rate < 0.5` in the last 30 days, the level SHALL degrade by 1. Degradation SHALL be cumulative if multiple thresholds are breached. The agent SHALL explain the degradation in Spanish: "Bajé tu nivel de autonomía a {N} porque..." with the specific breached threshold.

#### Scenario: Safety violations force level 0

- GIVEN current level is 3 and the last 24 hours have > 3 `safety_violations=1` records
- WHEN `evaluateDegradation()` runs
- THEN level MUST drop to 0 (CONSULTA)
- AND a `degradation_events` row MUST record the event with reason citing safety violations

#### Scenario: Low margin triggers degradation

- GIVEN average margin compliance < 0.8 in the last 7 days with KPI data
- WHEN `evaluateDegradation()` runs
- THEN level MUST degrade by 1

#### Scenario: Low success rate triggers degradation

- GIVEN average success rate < 0.5 in the last 30 days with KPI data
- WHEN `evaluateDegradation()` runs
- THEN level MUST degrade by 1

#### Scenario: Multiple thresholds breached

- GIVEN > 3 safety violations in 24h, margin_compliance < 0.8, and success_rate < 0.5
- WHEN `evaluateDegradation()` runs
- THEN level MUST drop to CONSULTA (safety rule takes precedence, further rules act cumulatively)

#### Scenario: Healthy KPIs do not degrade

- GIVEN all KPI thresholds are met in the evaluation windows
- WHEN `evaluateDegradation()` runs
- THEN level MUST remain unchanged

---

### Requirement: Autonomy Gate Guardrail

The system SHALL implement `autonomyGate(action, engine): GuardResult` as a guardrail function following the same pattern as `strategyValidator`. It MUST return `passed: true` always (this gate never blocks — it determines whether to skip "dale"). When `canAutoApprove` returns `true`, the response SHALL have no `reason` (no dale needed). When blocked, the reason SHALL be in Spanish prompting "dale". When auto-approved, the action SHALL skip "dale" but SHALL still record a KPI snapshot.

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

The system SHALL generate a promotion recommendation when all KPIs meet healthy thresholds (safety_violations=0, avg margin_compliance>0.9, avg success_rate>0.9, avg response_accuracy>0.9) in a 30-day window with KPI data present. Promotion SHALL only occur after CEO explicitly calls `setLevel()`. The system SHALL NOT auto-promote itself.

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
