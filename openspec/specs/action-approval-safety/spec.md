# Action Approval Safety Specification

## Purpose

Define approval, audit, and risk controls for business writes and public-facing actions.

## Requirements

### Requirement: Human Approval for Writes

The system MUST require explicit seller approval before price changes, stock changes, customer messages, cancellations, refunds, listing edits, or creative publication.

#### Scenario: Agent prepares a write action

- GIVEN the agent recommends a business write
- WHEN the action is ready
- THEN it MUST show the exact proposed change and wait for explicit approval

#### Scenario: Approval is absent

- GIVEN no explicit approval has been recorded
- WHEN execution is attempted
- THEN the system MUST block the action

### Requirement: Risk Audit Trail

The system MUST record who approved, what changed, why it was recommended, when it was approved, and the expected business risk.

#### Scenario: Approved action is executed

- GIVEN the seller approves a prepared action
- WHEN the system executes it
- THEN it MUST store an audit record with rationale and resulting status

#### Scenario: High-risk action is proposed

- GIVEN an action may affect claims, refunds, cancellations, reputation, or public content
- WHEN approval is requested
- THEN the system MUST highlight the risk before approval can be accepted
