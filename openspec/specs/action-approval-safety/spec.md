# Action Approval Safety Specification

## Purpose

Define approval, audit, and risk controls for business writes and public-facing actions. Proposals may originate from conversational LLM or deterministic agent.

## Requirements

### Requirement: Conversational Proposal Pipeline

The system MUST accept LLM natural-language proposals, format as `PreparedAction` with `approvalStatus: "pending"`, execute only after user confirms ("dale", "sí", "ok").

#### Scenario: Agent proposes an action

- GIVEN the agent suggests "¿bajo el precio 10%?"
- WHEN the proposal is formatted
- THEN it MUST create a `PreparedAction` with pending status

#### Scenario: User confirms

- GIVEN a pending proposal exists
- WHEN the user writes "dale"
- THEN the system MUST execute the action and record an `AuditRecord`

#### Scenario: User rejects or ignores

- GIVEN a pending proposal exists
- WHEN the user writes "no" or ignores the proposal
- THEN the system MUST NOT execute the action

### Requirement: SDK Guardrail Integration

The system MUST apply input guardrails (Spanish-only, no harmful) and output guardrails (safe actions) via guardrail functions.

#### Scenario: English input

- GIVEN the user writes in English
- WHEN input passes through guardrails
- THEN the system MUST reject and ask for Spanish

#### Scenario: Harmful intent

- GIVEN harmful intent is detected in input
- WHEN input passes through guardrails
- THEN the system MUST reject with a Spanish explanation

#### Scenario: High-risk LLM action

- GIVEN an LLM proposes a high-risk action
- WHEN the action is validated
- THEN the system MUST flag it and require extra confirmation

### Requirement: Natural-Language Rejection

When guardrails block, the system MUST explain in natural Spanish, not raw errors.

#### Scenario: Input blocked

- GIVEN input is blocked by a guardrail
- WHEN the rejection is returned
- THEN it MUST include a clear Spanish reason

#### Scenario: Output action blocked

- GIVEN an output action is blocked by a guardrail
- WHEN the rejection is returned
- THEN it MUST explain the safety concern in Spanish

### Requirement: Human Approval for Writes

The system MUST require explicit seller approval before price changes, stock changes, customer messages, cancellations, refunds, listing edits, or creative publication. Proposals MAY originate from conversational LLM or deterministic agent.

#### Scenario: Agent prepares a write action

- GIVEN the agent recommends a business write
- WHEN the action is ready
- THEN it MUST show the exact proposed change and wait for explicit approval

#### Scenario: Conversational proposal

- GIVEN the LLM agent proposes a write in Spanish
- WHEN it is formatted as `PreparedAction`
- THEN it MUST meet the same safety requirements as deterministic proposals

#### Scenario: Approval is absent

- GIVEN no explicit approval has been recorded
- WHEN execution is attempted
- THEN the system MUST block the action

### Requirement: Risk Audit Trail

The system MUST record who approved, what changed, why it was recommended, when it was approved, and the expected business risk. Audit records MUST distinguish deterministic vs conversational proposer.

#### Scenario: Approved action is executed

- GIVEN the seller approves a prepared action
- WHEN the system executes it
- THEN it MUST store an audit record with rationale and resulting status

#### Scenario: Conversational proposal recorded

- GIVEN an LLM proposal is approved and executed
- WHEN the audit trail is written
- THEN it MUST include the original proposal text and confirmation phrase

#### Scenario: High-risk action is proposed

- GIVEN an action may affect claims, refunds, cancellations, reputation, or public content
- WHEN approval is requested
- THEN the system MUST highlight the risk before approval can be accepted

### Requirement: Strategy-Based Action Validation

The system MUST validate every `AgentProposal` against active strategies via `strategyValidator(proposal, strategies): GuardResult` before presenting it to the seller. Proposals violating an active strategy constraint MUST be blocked with a Spanish explanation referencing the specific violated rule.

#### Scenario: Proposal violates margin strategy

- GIVEN an active strategy requires "margen ≥ 50% en electrónica"
- WHEN the agent proposes a price with margin 35% on an electrónica listing
- THEN `strategyValidator` MUST return `passed: false` with reason citing the margin strategy

#### Scenario: Proposal violates category exclusion

- GIVEN an active strategy excludes the "juguetes" category
- WHEN the agent proposes any action targeting a "juguetes" listing
- THEN `strategyValidator` MUST block the proposal regardless of action type

#### Scenario: Proposal complies with all strategies

- GIVEN active strategies cover margin and category focus
- WHEN the agent proposes an action that satisfies all constraints
- THEN `strategyValidator` MUST return `passed: true`

#### Scenario: No active strategies

- GIVEN no active strategies exist in the database
- WHEN a proposal is validated
- THEN `strategyValidator` MUST return `passed: true` without delay or overhead

#### Scenario: Blocked proposal explained in Spanish

- GIVEN a proposal is blocked by strategy validation
- WHEN the rejection is returned to the seller
- THEN it MUST include a natural Spanish explanation identifying which strategy rule was violated
