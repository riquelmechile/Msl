# Delta for action-approval-safety

## ADDED Requirements

### Requirement: Sync Product Readiness Approval Boundary

The approval boundary MUST treat approved `sync_product` proposals as execution candidates only after a non-mutating readiness gate revalidates approval binding, dry-run/preview drift, seller/account safeguards, idempotency candidate, rollback plan, audit semantics, rate/error handling, and redaction. Approval alone MUST NOT authorize execution.

#### Scenario: Approval binding is revalidated

- GIVEN a stored approved `sync_product` proposal exists
- WHEN readiness evaluates it
- THEN approval MUST bind to the exact action ID, proposal kind, target, expiry, approver, rationale, and risk evidence
- AND mismatch MUST return `blocked` with `approval-binding-mismatch` or `approval-expired` and `noMutationExecuted: true`.

#### Scenario: Readiness records no execution audit

- GIVEN readiness returns `eligible`, `blocked`, or `degraded`
- WHEN audit semantics are derived
- THEN the system MAY record/read readiness review metadata only if it cannot imply execution
- AND it MUST NOT write completion audit records, replay audits, trigger rollback automation, or claim sync success.

#### Scenario: Execution prerequisites are incomplete

- GIVEN rollback, idempotency, seller/account, dry-run, rate/error, source evidence, or redaction checks are incomplete
- WHEN readiness evaluates the approved proposal
- THEN the response MUST be `blocked` or `degraded` using allowed redacted reason codes
- AND raw credentials, database paths, upstream errors, and validation internals MUST remain hidden.
