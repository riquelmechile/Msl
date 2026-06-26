# probe-detection Specification

## Purpose

Detect competitor probing of seller listings through suspicious question/view pattern analysis and generate structured ProbeAlerts via Cortex Hebbian learning.

## Requirements

### Requirement: Suspicious Pattern Detection

The system MUST analyze `simulate_actor("competidor", query)` outputs for suspicious patterns: high-frequency category views, repetitive pricing questions, timing anomalies (rapid-fire queries). Detection SHALL trigger a ProbeAlert when confidence >= 0.6.

#### Scenario: Rapid-fire pricing questions

- GIVEN competidor simulation shows 5+ pricing questions on same category within 60s window
- WHEN pattern detector analyzes the simulation output
- THEN a ProbeAlert MUST be generated with confidence >= 0.7

#### Scenario: Normal behavior below threshold

- GIVEN competidor simulation shows 2 questions spread across different categories
- WHEN pattern detector analyzes the simulation output
- THEN no ProbeAlert MUST be generated

### Requirement: ProbeAlert with Confidence Scoring

The system MUST generate `ProbeAlert` objects with: `actor_id`, `category`, `pattern_type` (rapid_fire | price_probe | category_sweep), `confidence` (0.0-1.0), `detected_at`. Confidence scoring MUST use weighted heuristics: question_frequency (0.4), category_focus (0.3), timing_anomaly (0.3).

#### Scenario: High-confidence category sweep

- GIVEN competidor queries span 8+ categories with pricing focus
- WHEN ProbeAlert is computed
- THEN confidence MUST be >= 0.8 and pattern_type MUST be "category_sweep"

#### Scenario: Borderline detection at threshold

- GIVEN pattern scores at exactly 0.6
- WHEN ProbeAlert is computed
- THEN it MUST still generate since threshold is inclusive

### Requirement: Cortex Pattern Storage

The system MUST persist `competitor_observations` and `suspicious_events` in Cortex with Hebbian edges connecting probe patterns to actor nodes. `GraphEngine.recordProbeObservation()` MUST create graph nodes tagged `probe: true`.

#### Scenario: Probe observation persisted

- GIVEN a ProbeAlert is generated
- WHEN `recordProbeObservation()` is called
- THEN a Cortex node MUST be created with metadata tag `probe: true`

#### Scenario: Hebbian reinforcement on repeat patterns

- GIVEN the same competitor triggers 3 alerts for the same pattern type
- WHEN each alert is persisted
- THEN edge weights to the competidor actor node MUST increase by +0.05 per repeat detection
