# Delta for action-approval-safety

## MODIFIED Requirements

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
