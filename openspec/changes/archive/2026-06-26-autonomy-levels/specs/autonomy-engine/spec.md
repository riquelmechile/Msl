# Autonomy Engine Specification

## Purpose

Define the autonomy level state machine, KPI tracking, degradation rules, and guardrail gate that determine when the agent may auto-execute actions without "dale" confirmation.

## Requirements

### Requirement: Autonomy Level State Machine

The system SHALL maintain an integer autonomy level 0–5 per seller session, persisted in SQLite via `autonomyStore`. Level 0 means all actions require "dale". Level 5 means only `critical`-risk actions require "dale". The level SHALL default to 0 until the CEO issues a promotion.

#### Scenario: New seller starts at level 0

- GIVEN a seller has no prior autonomy state
- WHEN `AutonomyEngine` initializes
- THEN `currentLevel` MUST be 0

#### Scenario: CEO promotes via dale on promotion proposal

- GIVEN current level is 2 and KPI windows are green
- WHEN the engine generates a promotion proposal and CEO confirms "dale"
- THEN `currentLevel` MUST increment to 3
- AND an `autonomy_events` row MUST record `event_type: "promotion"` with reason

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

The system SHALL map each `AutonomyLevel` to a maximum `RiskLevel` the agent may auto-execute. The mapping MUST be: level 0 = none, level 1 = `low`, level 2 = `low`, level 3 = `medium`, level 4 = `medium`, level 5 = `high`. Actions at or below the threshold SHALL skip "dale" confirmation. Actions above the threshold SHALL require "dale". `critical`-risk actions SHALL always require "dale" regardless of autonomy level.

#### Scenario: Low-risk action auto-approved at level 2

- GIVEN current autonomy level is 2 and the action risk is `low`
- WHEN `autonomyLevelGate(proposal, 2)` evaluates
- THEN it MUST return `passed: true` with `autoApproved: true`

#### Scenario: High-risk action blocked at level 3

- GIVEN current autonomy level is 3 and the action risk is `high`
- WHEN `autonomyLevelGate(proposal, 3)` evaluates
- THEN it MUST return `passed: false` with reason requiring "dale"

#### Scenario: Critical-risk action always requires dale

- GIVEN current autonomy level is 5 and the action risk is `critical`
- WHEN `autonomyLevelGate(proposal, 5)` evaluates
- THEN it MUST return `passed: false` with reason requiring "dale"

---

### Requirement: KPI Tracking

The system SHALL record KPI snapshots after every executed action (auto-approved or CEO-confirmed) into the `kpi_history` Cortex table. Tracked KPIs SHALL be: `success_rate` (action returned without error), `margin_compliance` (final price ≥ strategy margin), `safety_violations` (guardrail blocked the action). Each snapshot SHALL include `kpi_name`, `value` (0 or 1 for binary KPIs), and `recorded_at` (UTC).

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

The system SHALL evaluate degradation before every `converse()` turn by querying the 7-day rolling KPI window via `getKpiWindow()`. If `safety_violations ≥ 3` in the window, the level SHALL degrade by 1. If `success_rate < 0.6` (fewer than 60% of actions succeeded) with ≥ 10 actions in the window, the level SHALL degrade by 1. If `margin_compliance < 0.7` with ≥ 5 price actions in the window, the level SHALL degrade by 1. Degradation SHALL be cumulative if multiple thresholds are breached. The agent SHALL explain the degradation in Spanish: "Bajé tu nivel de autonomía a {N} porque..." with the specific breached threshold.

#### Scenario: Three safety violations trigger degradation

- GIVEN current level is 3 and the last 7 days have 3 `safety_violations=1` records
- WHEN `evaluateDegradation()` runs
- THEN level MUST drop to 2
- AND an `autonomy_events` row MUST record `event_type: "degradation"` with reason citing safety violations

#### Scenario: Low success rate triggers degradation

- GIVEN 12 actions in the 7-day window with only 6 successes (success_rate = 0.5)
- WHEN `evaluateDegradation()` runs
- THEN level MUST degrade by 1

#### Scenario: Multiple thresholds breached

- GIVEN 4 safety violations, success_rate 0.4, and margin_compliance 0.5 all in the window
- WHEN `evaluateDegradation()` runs
- THEN level MUST degrade by 2 (safety + success) — one degradation per breached threshold

#### Scenario: Healthy KPIs do not degrade

- GIVEN all KPI thresholds are met in the 7-day window
- WHEN `evaluateDegradation()` runs
- THEN level MUST remain unchanged

#### Scenario: Insufficient data does not degrade

- GIVEN only 5 total actions in the 7-day window
- WHEN `evaluateDegradation()` runs
- THEN level MUST remain unchanged (not enough data for statistical thresholds)

---

### Requirement: Autonomy Gate Guardrail

The system SHALL implement `autonomyLevelGate(proposal: AgentProposal, level: AutonomyLevel): GuardResult` as a guardrail function following the same pattern as `strategyValidator`. It MUST return `passed: false` when the proposal's risk level exceeds the autonomy threshold, including a Spanish reason. When `passed: true` with `autoApproved: true`, the action SHALL skip "dale" but SHALL still generate an `AuditRecord` with `approvalMethod: "auto"`.

#### Scenario: Auto-approved action generates audit record

- GIVEN a low-risk action is auto-approved at level 2
- WHEN the action executes
- THEN an `AuditRecord` MUST be created with `approvalMethod: "auto"` and the current autonomy level

#### Scenario: Gate blocked yields Spanish reason

- GIVEN autonomy level 1 and a medium-risk proposal
- WHEN `autonomyLevelGate` evaluates
- THEN it MUST return `passed: false` with a Spanish reason including "dale" prompt

---

### Requirement: Promotion via CEO Confirmation

The system SHALL generate a promotion proposal when all KPIs meet healthy thresholds (safety_violations=0, success_rate≥0.9, margin_compliance≥0.9) for a consecutive 30-day window with ≥20 actions. The proposal SHALL describe current performance and the target level in Spanish. Promotion SHALL only occur after CEO "dale" on the proposal. The agent SHALL NOT auto-promote itself.

#### Scenario: Healthy 30-day window triggers promotion proposal

- GIVEN 30 consecutive days with 0 safety violations, 95% success rate, 92% margin compliance, and 25 total actions
- WHEN the engine evaluates promotion eligibility
- THEN it MUST generate a promotion proposal in Spanish

#### Scenario: CEO confirms promotion

- GIVEN a promotion proposal exists
- WHEN CEO writes "dale"
- THEN level MUST increment by 1
- AND an `autonomy_events` row MUST be recorded

#### Scenario: Promotion not triggered with violations

- GIVEN 1 safety violation in the 30-day window
- WHEN promotion eligibility is evaluated
- THEN no promotion proposal SHALL be generated
