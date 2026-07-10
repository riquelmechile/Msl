# Economic Outcome Specification

## Purpose

Action→result linkage with audit-grade lifecycle. Tracks an action from intent through observation, verification, dispute, or invalidation. Contracts Cortex integration boundaries.

## Requirements

### Requirement: Outcome Lifecycle

`EconomicOutcome` MUST enforce a 5-state lifecycle: `pending → observing → observed → verified | disputed | invalidated`. The system MUST reject regressive transitions (e.g., `verified → observed`).

| From | Valid To | Invalid To |
|------|----------|------------|
| `pending` | `observing` | `observed`, `verified`, `disputed`, `invalidated` |
| `observing` | `observed` | `verified`, `disputed`, `invalidated` |
| `observed` | `verified`, `disputed`, `invalidated` | `pending`, `observing` |
| `verified` | (terminal) | any |
| `disputed` | (terminal) | any |
| `invalidated` | (terminal) | any |

#### Scenario: Normal lifecycle progression

- **GIVEN** an outcome in `pending` state
- **WHEN** transitioned to `observing`, then `observed`, then `verified`
- **THEN** each transition MUST succeed in order

#### Scenario: Invalid backward transition rejected

- **GIVEN** an outcome in `verified` state
- **WHEN** transition to `observed` is attempted
- **THEN** the system MUST throw `EconomicOutcomeStateError`

#### Scenario: Dispute from observed

- **GIVEN** an outcome in `observed` state with conflicting evidence
- **WHEN** transitioned to `disputed`
- **THEN** the transition MUST succeed — terminal state reached

#### Scenario: Invalidation from observed

- **GIVEN** an outcome in `observed` state where underlying action was undone
- **WHEN** transitioned to `invalidated`
- **THEN** the transition MUST succeed — terminal state reached

### Requirement: Outcome Structure

An `EconomicOutcome` MUST carry: `outcomeId`, `sellerId`, `proposalId`, `correlationId`, `orderId`, `actionType`, `status` (from lifecycle), `expectedImpact` (Money), `observedImpact` (Money | null), `observationWindow`, `baselineRef`, `unitEconomicsRef`, `evidenceIds`, `createdAt`, and `updatedAt`.

#### Scenario: Outcome creation in pending state

- **GIVEN** a new action with expected impact, correlation ID, and observation window
- **WHEN** an EconomicOutcome is created
- **THEN** `status = "pending"`, `observedImpact = null`, timestamps set

### Requirement: Cortex Integration Contract

Only outcomes in `verified` status MAY feed Cortex learning (in a future PR). Outcomes in `pending`, `observing`, or `observed` MUST NOT reinforce Cortex. Outcomes in `disputed` or `invalidated` MUST NEVER reinforce a Cortex constellation.

#### Scenario: Verified outcome eligible for Cortex

- **GIVEN** an outcome in `verified` status
- **WHEN** Cortex integration is evaluated (future PR)
- **THEN** the outcome MAY be considered for learning reinforcement

#### Scenario: Pending outcome blocked from Cortex

- **GIVEN** an outcome in `pending` status
- **WHEN** Cortex integration examines it
- **THEN** it MUST NOT feed any reinforcement signal

#### Scenario: Disputed outcome permanently excluded

- **GIVEN** an outcome in `disputed` status
- **WHEN** Cortex integration examines it
- **THEN** it MUST NEVER reinforce a constellation — permanently excluded
