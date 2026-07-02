# Delta for action-approval-safety

## MODIFIED Requirements

### Requirement: Conversational Proposal Pipeline

The system MUST accept LLM natural-language proposals and format them as pending prepared work. In Phase 1 CEO delegation, seller confirmation words such as "dale", "sí", or "ok" MUST approve bounded investigation, preparation, or proposal advancement only; they MUST NOT execute external/productive effects.
(Previously: confirmation words executed the prepared action after approval.)

#### Scenario: Agent proposes an action

- GIVEN the agent suggests "¿bajo el precio 10%?"
- WHEN the proposal is formatted
- THEN it MUST create a `PreparedAction` with pending status

#### Scenario: User confirms Phase 1 delegation

- GIVEN a pending CEO delegation proposal exists
- WHEN the user writes "dale"
- THEN the system MUST advance bounded investigation or preparation only
- AND it MUST record `noMutationExecuted: true`

#### Scenario: User rejects or ignores

- GIVEN a pending proposal exists
- WHEN the user writes "no" or ignores the proposal
- THEN the system MUST NOT execute the action

## ADDED Requirements

### Requirement: Phase 1 No-Mutation Boundary

The system MUST block Phase 1 approvals from publishing, mutating MercadoLibre, charging payments, interacting with SII, messaging customers, or executing external effects.

#### Scenario: Productive effect requested after dale

- GIVEN the seller says "dale" to a CEO proposal
- WHEN the proposal implies publication, payment, customer messaging, or MercadoLibre mutation
- THEN the system MUST block execution and explain the Phase 1 boundary in Spanish

#### Scenario: Preparation allowed

- GIVEN the seller approves preparation
- WHEN the system drafts analysis, campaign copy, or a next-step proposal
- THEN it MAY prepare the artifact without external side effects
- AND it MUST preserve audit evidence
