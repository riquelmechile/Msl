# Delta for Action Approval Safety

## ADDED Requirements

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
