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

The system MUST require explicit seller approval before price changes, stock changes, customer messages, cancellations, refunds, listing edits, or creative publication, **UNLESS** the current autonomy level permits auto-execution of actions at the proposal's risk level. When auto-approved, the system MUST still generate audit records with `approvalMethod: "auto"` and the effective autonomy level. Proposals MAY originate from conversational LLM or deterministic agent.

#### Scenario: Agent prepares a write action

- GIVEN the agent recommends a business write
- WHEN the action is ready
- THEN it MUST show the exact proposed change and wait for explicit approval **unless the autonomy level permits auto-approval**

#### Scenario: Conversational proposal

- GIVEN the LLM agent proposes a write in Spanish
- WHEN it is formatted as `PreparedAction`
- THEN it MUST meet the same safety requirements as deterministic proposals

#### Scenario: Approval is absent

- GIVEN no explicit approval has been recorded **and autonomy level does not permit auto-approval**
- WHEN execution is attempted
- THEN the system MUST block the action

#### Scenario: Auto-approved low-risk action skips dale

- GIVEN autonomy level is 3 (BAJO_RIESGO) and the agent proposes a low-risk `stock-update`
- WHEN `autonomyGate` returns auto-approval
- THEN the system MUST execute the action without "dale" confirmation
- AND MUST record a KPI snapshot

#### Scenario: High-risk action still requires dale at any level

- GIVEN autonomy level is 5 (FULL) and the agent proposes a high-risk `cancellation`
- WHEN `autonomyGate` returns a reason requiring dale
- THEN the system MUST present the proposal and wait for "dale" confirmation

#### Scenario: Level 0 always requires dale

- GIVEN autonomy level is 0 (CONSULTA) and the agent proposes any write action
- WHEN the action is ready
- THEN the system MUST show the exact proposed change and wait for explicit approval

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

---

### Requirement: Honey-Pot Operation Guardrail

The system MUST apply a `honeyPotGuardrail` with default-deny posture to all `WriteActionKind` entries `honey-pot-deploy` and `probe-analysis`. The guardrail SHALL block execution unless: (a) an active CEO strategy of type `probe` authorizes the target category, AND (b) the seller explicitly confirms with "dale". Blocked operations MUST return a Spanish explanation with TOS warning.

#### Scenario: Blocked without authorizing strategy

- GIVEN a `honey-pot-deploy` action targets "electrónica"
- WHEN `honeyPotGuardrail` evaluates
- THEN it MUST block with Spanish explanation citing missing CEO authorization
- AND MUST include TOS warning about fake listing risks

#### Scenario: Blocked without seller dale

- GIVEN active probe strategy authorizes "electrónica"
- WHEN seller has not confirmed "dale" for the specific operation
- THEN `honeyPotGuardrail` MUST block and prompt for explicit confirmation

#### Scenario: Approved with strategy and dale

- GIVEN active probe strategy authorizes "electrónica"
- WHEN seller confirms "dale" on the honey-pot proposal
- THEN `honeyPotGuardrail` MUST pass and allow execution

#### Scenario: probe-analysis requires same gate

- GIVEN a `probe-analysis` action is proposed
- WHEN `honeyPotGuardrail` evaluates
- THEN it MUST apply the same strategy + dale requirement as honey-pot-deploy

#### Scenario: Non-honey-pot actions unaffected

- GIVEN a regular `price-change` or `stock-update` action
- WHEN `honeyPotGuardrail` evaluates
- THEN it MUST pass through without blocking

### Requirement: Capability Refresh Mutation Deferral

The system MUST treat seller-impacting MercadoLibre capabilities discovered during the API capabilities refresh as `prepare-only` or `future-execute-with-approval`. Refreshed capability metadata MUST NOT introduce direct execution for listing edits, answer-question flows, catalog fixes, promotions, sync operations, public messages, refunds, cancellations, or other seller-impacting mutations.

#### Scenario: Mutation-like capability is requested

- GIVEN refreshed capability evidence identifies a seller-impacting operation
- WHEN the agent or tool is asked to perform that operation
- THEN the system MUST create a prepared action or defer execution to a future approved slice
- AND the prepared or deferred record MUST include intended change, rationale, risk, approval requirement, and audit expectation

#### Scenario: Direct execution is attempted before approval support exists

- GIVEN no approved execution slice exists for the refreshed capability
- WHEN direct execution is attempted from capability metadata
- THEN the system MUST block execution
- AND it MUST preserve existing approval, autonomy, and audit safeguards

### Requirement: Product Sync Proposals Remain Pending

Product sync business operations MUST remain pending prepared actions unless a future approved slice adds explicit execution, approval, and audit behavior. This slice MAY persist prepared proposal state and non-sensitive preview evidence when durable approval storage is configured, and MAY calculate read-only preview evidence only from source items that pass shared MercadoLibre completeness validation. Validation failure MUST degrade preview evidence without mutation. It MUST NOT execute sync mutations, replay audits, persist credentials, or expand the approval/execution surface.

#### Scenario: Prepared sync proposal is returned

- GIVEN a valid single-product sync request passes safety validation
- WHEN the proposal is created
- THEN it MUST have pending approval status and `requiresApproval: true`
- AND it MUST include intended target, rationale, risk, and expiry metadata

#### Scenario: Read-only preview evidence is attached

- GIVEN complete read-only item evidence and applicable strategies are available
- WHEN a product sync proposal is prepared
- THEN the proposal MAY include non-sensitive preview evidence for proposed field changes
- AND it MUST still disclose that no mutation, approval execution, or audit replay occurred

#### Scenario: Incomplete preview source evidence degrades safely

- GIVEN source item evidence fails shared completeness validation
- WHEN a product sync proposal is prepared
- THEN the proposal MUST remain pending with preview-unavailable evidence
- AND it MUST NOT mutate MercadoLibre state, replay audits, or expose raw validation details

#### Scenario: Execution is attempted from a prepared proposal

- GIVEN a pending product sync proposal exists
- WHEN execution is requested before an approved execution slice exists
- THEN the system MUST return a controlled blocked response
- AND it MUST NOT mutate MercadoLibre state or claim sync completion

#### Scenario: Durable prepared proposal storage is configured

- GIVEN durable proposal storage is configured
- WHEN a product sync proposal is prepared and the process restarts
- THEN the pending proposal MUST remain available with equivalent proposal metadata
- AND no OAuth token, API key, client secret, or raw credential MUST be persisted

#### Scenario: Credential-like generic prepared proposal is requested

- GIVEN the generic prepared write tool receives a target, exact change, or rationale containing API keys, OAuth tokens, client secrets, raw credentials, or database paths
- WHEN the proposal is validated
- THEN the system MUST block before repository save
- AND it MUST NOT persist or echo the credential-like payload

#### Scenario: Durable storage is not configured

- GIVEN durable proposal storage is not configured
- WHEN a product sync proposal is prepared
- THEN the system MUST keep default in-memory proposal behavior
- AND it MUST disclose that proposals do not survive restart

#### Scenario: Storage failure occurs during proposal preparation

- GIVEN durable proposal storage is configured but unavailable
- WHEN a product sync proposal is prepared
- THEN the system MUST return a controlled blocked response with redacted error details
- AND it MUST NOT execute mutation, replay audit, persist credentials, or expose raw errors

#### Scenario: Durable storage fails during MCP startup

- GIVEN durable proposal storage is configured but cannot be opened during MCP runtime construction
- WHEN the MCP runtime starts
- THEN the runtime MUST recover with controlled degraded in-memory proposal storage
- AND subsequent proposal responses MUST disclose that durable storage is unavailable
- AND they MUST NOT expose database paths, credentials, or raw startup errors
