# Action Approval Safety Specification

## Purpose

Define approval, audit, and risk controls for business writes and public-facing actions. Proposals may originate from conversational LLM or deterministic agent.

## Requirements

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

Audit MUST record who approved, what changed, why, when, business risk, and proposer type (deterministic/conversational). For executed `sync_product` proposals, records MUST additionally capture pre-execution snapshot, ML API evidence (endpoint, payload, itemId/permalink), post-execution status, and rollback path.
(Previously: no execution audit record contract.)

#### Scenario: Approved action audited

- GIVEN seller approves a prepared action
- WHEN executed
- THEN it MUST store audit record with rationale and status

#### Scenario: Execution audit captures ML evidence

- GIVEN a `sync_product` proposal is executed
- WHEN audit is written
- THEN it MUST include pre-snapshot, ML API evidence, post-status, and rollback path

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

### Requirement: Sync Product Execution Eligibility Model

Product sync business operations MUST remain pending prepared actions by default. Proposals that pass approval recording, readiness eligibility, idempotency checks, and `canExecuteSyncProduct` MAY reach execution per the `sync-product-execution` contract. Execution eligibility is contract-only; future implementation slice required for runtime. This slice MAY persist proposal state and non-sensitive preview evidence. It MUST NOT execute mutations, replay audits, or persist credentials without passing execution gates.
(Previously: "Product Sync Proposals Remain Pending" blocked all execution; renamed and replaced with eligibility model.)

#### Scenario: Prepared sync proposal returned

- GIVEN a valid sync request passes safety validation
- WHEN the proposal is created
- THEN it MUST have pending status and `requiresApproval: true`

#### Scenario: Read-only preview evidence attached

- GIVEN complete item evidence and strategies are available
- WHEN a proposal is prepared
- THEN it MAY include non-sensitive preview evidence with `noMutationExecuted: true`

#### Scenario: Incomplete preview degrades safely

- GIVEN source evidence fails completeness validation
- WHEN a proposal is prepared
- THEN it MUST remain pending with preview-unavailable and MUST NOT mutate state

#### Scenario: Execution without eligibility gates blocked

- GIVEN a pending proposal exists
- WHEN execution is attempted before approval, readiness, idempotency, and guard pass
- THEN the system MUST return controlled blocked response

#### Scenario: Durable storage preserves proposals

- GIVEN durable storage is configured
- WHEN a proposal is prepared and process restarts
- THEN the proposal MUST remain available without persisting credentials

#### Scenario: Credential-like payload blocked

- GIVEN a prepared write target contains credentials or db paths
- WHEN validated
- THEN the system MUST block before save and MUST NOT echo the payload

#### Scenario: Durable storage not configured

- GIVEN durable storage is not configured
- WHEN a proposal is prepared
- THEN the system MUST disclose in-memory behavior and non-surviving-restart

#### Scenario: Storage failure handled safely

- GIVEN durable storage is configured but unavailable
- WHEN a proposal is prepared
- THEN the system MUST return controlled blocked response with redacted details

#### Scenario: Storage unavailable at MCP startup

- GIVEN storage is configured but cannot open at startup
- WHEN MCP runtime constructs
- THEN it MUST recover with degraded in-memory storage without exposing raw errors

### Requirement: Non-Mutating Product Sync Proposal Retrieval

The approval safety boundary MUST allow authenticated, exact-ID, read-only retrieval of stored `sync_product` proposal status. Retrieval MUST preserve pending/no-execution semantics and MUST NOT record approval, execute actions, replay audits, mutate stored proposal state, persist new proposal data, or expand approval/execution APIs.

#### Scenario: Pending proposal is retrieved for review

- GIVEN a pending stored `sync_product` proposal exists and auth is valid
- WHEN its exact action ID is retrieved for status review
- THEN the response MUST report pending approval requirements and safe review metadata
- AND it MUST preserve the proposal as non-executed and approval-required

#### Scenario: Expired status is derived safely

- GIVEN a stored `sync_product` proposal expiry is in the past
- WHEN its exact action ID is retrieved
- THEN the response MUST indicate an expired-style status derived from stored timestamps
- AND it MUST NOT update approval status, write audit records, or mutate expiry fields

#### Scenario: Non-sync or missing action is requested

- GIVEN auth is valid
- WHEN retrieval targets a missing action, non-`sync_product` action, or unsupported stored proposal
- THEN the system MUST return a controlled redacted response
- AND it MUST NOT reveal sensitive record contents, credentials, storage paths, or action enumeration signals

#### Scenario: Retrieval cannot become execution

- GIVEN a stored `sync_product` proposal is available
- WHEN read-only retrieval is requested
- THEN the system MUST NOT call mutation APIs, `ProductSyncEngine`, approval recording, audit replay, `sync_all`, or multi-product sync behavior
- AND it MUST only return sanitized status derived from existing stored proposal data

### Requirement: Record-Only Product Sync Approval

The approval safety boundary MUST allow recording seller approval for an exact stored pending unexpired `sync_product` proposal without executing it. Approval recording MUST validate the stored proposal as sync-only before writing, MUST preserve future execution invariants, and MUST create an approval record that proves consent without claiming completion.

#### Scenario: Seller approval is recorded without execution

- GIVEN an authenticated exact stored pending unexpired `sync_product` proposal exists
- WHEN seller approval is recorded
- THEN the proposal MUST become approved for future execution eligibility only
- AND an approval record MUST capture action ID, approver, timestamp, rationale/risk linkage, and non-executed status

#### Scenario: Non-sync approval is blocked

- GIVEN authentication is valid
- WHEN approval recording targets a missing, malformed, expired, finalized, or non-`sync_product` proposal
- THEN the system MUST return a redacted controlled failure
- AND it MUST NOT write proposal state, approval records, audit records, or enumeration details

#### Scenario: Future execution invariants are preserved

- GIVEN approval has been recorded for a `sync_product` proposal
- WHEN later behavior evaluates the proposal for execution eligibility
- THEN the stored approval MUST be distinguishable from execution, audit replay, and sync completion
- AND it MUST retain approval-required metadata needed by a future approved execution slice

#### Scenario: Approval recording remains non-mutating

- GIVEN approval recording succeeds or fails
- WHEN the operation completes
- THEN it MUST NOT mutate MercadoLibre state, call `ProductSyncEngine`, run `sync_all`, perform multi-product sync, replay audits, or trigger rollback automation
- AND it MUST NOT persist OAuth tokens, API keys, client secrets, raw credentials, database paths, or raw validation errors

---

### Requirement: Sync Product Readiness Approval Boundary

The approval boundary MUST treat approved `sync_product` proposals as execution candidates only after readiness revalidates approval binding, preview drift, seller/account safeguards, idempotency, rollback plan, audit semantics, rate/error handling, and redaction. Approval alone MUST NOT authorize execution. Readiness `eligible` MUST feed the execution eligibility gate defined in `sync-product-execution`.
(Previously: readiness standalone; now explicitly feeds execution eligibility.)

#### Scenario: Approval binding revalidated

- GIVEN a stored approved proposal exists
- WHEN readiness evaluates it
- THEN approval MUST bind to exact actionId, kind, target, expiry, approver, rationale, risk
- AND mismatch MUST return `blocked` with `approval-binding-mismatch` or `approval-expired`

#### Scenario: Prerequisites incomplete

- GIVEN readiness checks are incomplete
- WHEN evaluating approved proposal
- THEN response MUST be `blocked` or `degraded` with redacted reason codes

#### Scenario: Eligible readiness feeds execution gate

- GIVEN readiness returns `eligible`
- WHEN execution eligibility is evaluated per `sync-product-execution`
- THEN `eligible` MUST be consumed as required gate input

### Requirement: Supplier Mirror Safety Gates

Supplier Mirror MUST NOT blind mass publish, blindly mutate prices, or bypass approval/autonomy gates. Emergency stock pauses MAY execute only after short verification, configured permission, sufficient evidence, audit logging, and CEO notification.

#### Scenario: Blind mass publishing attempted
- GIVEN many supplier items are discovered without approvals or target policy
- WHEN publication is requested
- THEN the system MUST block mass publishing and require CEO-approved policy

#### Scenario: Verified emergency pause allowed
- GIVEN a mapped approved item has confirmed supplier stock break
- WHEN emergency pause policy allows auto-pause
- THEN the listing MAY be paused with audit evidence and CEO notification

#### Scenario: Pause not permitted
- GIVEN a stock break is confirmed but target policy disallows auto-pause
- WHEN safety evaluates the action
- THEN the system MUST not pause and MUST ask the CEO for next action

### Requirement: Owned Ecommerce Deterministic Guardrails

The system MUST deterministically guard owned ecommerce previews and operations for stock authority, margin/freshness, secrets, checkout/payment activation, public publishing, price/stock mutation, and risky claims. DeepSeek outputs MUST NOT override these guardrails.

#### Scenario: Unsafe storefront operation blocked

- GIVEN an owned ecommerce proposal includes stale stock, weak margin, secrets, checkout activation, public publish, or price/stock mutation
- WHEN safety validation runs
- THEN the system MUST block or require explicit CEO approval according to risk
- AND it MUST record redacted reason codes.

#### Scenario: DeepSeek recommends unsafe action

- GIVEN DeepSeek recommends copy, ranking, or an operation that violates deterministic constraints
- WHEN the proposal is validated
- THEN deterministic guardrails MUST reject the unsafe portion
- AND the CEO-facing output MUST show the safe alternative or missing evidence.

### Requirement: Owned Ecommerce Publish and Checkout Boundary

Owned ecommerce storefront generation MUST remain preview/projection-only unless public publishing and checkout/payment activation have exact CEO approval, configured credentials, redacted audit records, and passing readiness checks.

#### Scenario: Preview projection allowed

- GIVEN Medusa-ready catalog and content projection data is available
- WHEN no publish or checkout approval exists
- THEN the system MAY create a non-public preview
- AND it MUST NOT activate checkout, payments, or public publishing.

#### Scenario: Publish requested without approval

- GIVEN a storefront projection exists
- WHEN public publishing or checkout/payment activation is attempted without exact approval
- THEN the system MUST block execution and ask the CEO Agent to request approval through Telegram.

### Requirement: Owned Ecommerce Evidence-Backed Public Claims

Public storefront copy, schema, metadata, and SEO/GEO content MUST only include claims backed by current evidence and MUST exclude unsupported health, legal, origin, availability, price, delivery, or superiority claims.

#### Scenario: Evidence-backed content passes

- GIVEN copy references availability, price, category, or product benefits supported by evidence
- WHEN content validation runs
- THEN the system MAY include the claim with evidence provenance.

#### Scenario: Unsupported risky claim blocked

- GIVEN generated content includes an unsupported risky claim
- WHEN content validation runs
- THEN the system MUST remove or rewrite the claim before projection or publish.

---

### Requirement: Exact Owned Ecommerce Execution Approval Binding

Owned ecommerce execution approval MUST be backend-verified and bound to the exact action ID, projection ID/version, target, operation kind, approver, risk, rationale, and expiry. Conversational claims, stale approvals, or partial matches MUST NOT authorize execution.

#### Scenario: Exact approval authorizes candidate

- GIVEN a stored approval exactly matches the owned ecommerce action, projection, target, risk, approver, and unexpired window
- WHEN execution eligibility is evaluated
- THEN the approval binding check MUST pass as one required gate
- AND it MUST NOT by itself execute the action.

#### Scenario: Approval mismatch blocks

- GIVEN any approval field is missing, expired, or differs from the stored action/projection/target
- WHEN execution eligibility is evaluated
- THEN the system MUST block with a redacted binding or expiry reason
- AND it MUST NOT create execution audit or mutation side effects.

#### Scenario: User claim is not proof

- GIVEN a conversation or tool payload says the CEO approved execution
- WHEN no matching backend approval record exists
- THEN the system MUST treat the action as unapproved
- AND it MUST preserve prepare-only semantics.

### Requirement: Durable Execution Audit, Idempotency, and Rollback Evidence

Before owned ecommerce runtime execution, the system MUST reserve idempotency, verify rollback evidence, and persist durable redacted audit state. Missing audit storage, duplicate idempotency, unsafe payloads, or absent rollback evidence MUST fail closed.

#### Scenario: Execution records durable evidence

- GIVEN approval binding, readiness, idempotency, rollback, and audit storage checks pass
- WHEN owned ecommerce execution starts and completes
- THEN the system MUST store redacted pre-state, operation intent, result status, approver, risk, and rollback reference
- AND sensitive credentials or raw storage paths MUST NOT be persisted.

#### Scenario: Duplicate idempotency key

- GIVEN an execution request repeats an idempotency key already associated with a completed or in-flight operation
- WHEN execution is requested again
- THEN the system MUST return the existing safe status or a controlled duplicate block
- AND it MUST NOT perform a second Medusa mutation.

#### Scenario: Audit or rollback prerequisite unavailable

- GIVEN audit persistence is unavailable or rollback evidence is missing
- WHEN execution eligibility is evaluated
- THEN the system MUST block execution with redacted reason codes
- AND it MUST preserve the action as not executed.
