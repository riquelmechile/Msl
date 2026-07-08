# Reasoning Levels Specification

## Purpose

Define the `ReasoningLevel` taxonomy, auto-execution boundary, autonomy gate integration, and per-level risk and timeout profiles.

## Requirements

### Requirement: Five Reasoning Levels

The system SHALL define five `ReasoningLevel` values in ascending risk order:

| Level | Risk | Description |
|-------|------|-------------|
| `classification` | low | Categorize or label data |
| `summarization` | low | Condense information |
| `prioritization` | low | Rank items by urgency/importance |
| `recommendation` | medium | Suggest actions with rationale |
| `decision` | high | Concrete action proposal requiring approval |

### Requirement: Auto-Execute Boundary

`classification`, `summarization`, and `prioritization` SHALL be auto-execute levels. The gateway SHALL set `requiresApproval: false` for these levels UNLESS `autonomyGate` blocks. `recommendation` and `decision` SHALL always set `requiresApproval: true`.

#### Scenario: Classification auto-executes

- GIVEN `level` is `classification` and autonomy gate passes
- WHEN `reason()` completes
- THEN `requiresApproval` SHALL be `false`

#### Scenario: Decision always requires approval

- GIVEN `level` is `decision`
- WHEN `reason()` completes
- THEN `requiresApproval` SHALL be `true` regardless of autonomy level

### Requirement: Autonomy Gate Integration

Auto-execute levels SHALL call `autonomyGate(action, engine)` with the gate's risk-level mapping before execution. When the gate returns a Spanish reason, `requiresApproval` SHALL be `true` and the reason SHALL be included in the result.

#### Scenario: Gate overrides auto-execute

- GIVEN autonomy level is 1 (SUGIERE) and level is `prioritization` (low-risk)
- WHEN `autonomyGate` returns a reason requiring "dale"
- THEN `requiresApproval` SHALL be `true` and the reason SHALL be in Spanish

### Requirement: Risk and Timeout Profiles

Each level SHALL map to a timeout as defined in the gateway spec:

| Level | Risk | Timeout |
|-------|------|---------|
| classification | low | 5s |
| summarization | low | 5s |
| prioritization | low | 5s |
| recommendation | medium | 15s |
| decision | high | 30s |

### Requirement: Model Selection by Level

The gateway SHALL use `deepseek-v4-flash` for auto-execute levels and `deepseek-v4-pro` for recommendation and decision levels unless `forcePro` is set.
