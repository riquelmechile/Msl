# creative-job-dispatcher Specification

## Purpose

`CreativeJobDispatcher` port and `request_creative_asset` CEO tool. Validates input, gates on durable budget ledger, dispatches atomically with stable seller-scoped idempotency identity.

## Requirements

### Requirement: Input Validation

`request_creative_asset` SHALL validate before any row or message creation: seller identity (authenticated, active), policy compliance (product truth: reference asset present for product kinds; channel is in allowlist). Validation failure SHALL reject with structured error. SHALL create ZERO rows, ZERO messages, and make ZERO provider calls on validation failure.

#### Scenario: All valid

- GIVEN valid seller, policy, channel
- WHEN validated
- THEN proceeds to budget gate

#### Scenario: Seller invalid

- GIVEN unknown or disabled seller
- WHEN validated
- THEN rejected: "Invalid seller"; zero rows; zero messages; zero calls

#### Scenario: Policy violation

- GIVEN product kind without reference asset
- WHEN validated
- THEN rejected: "Reference required"; zero rows; zero messages; zero calls

#### Scenario: Unknown channel

- GIVEN channel not in allowlist
- WHEN validated
- THEN rejected; zero rows; zero messages; zero calls

### Requirement: Budget Gate Dispatch

After input validation passes: SHALL check `DurableCostLedger.canAfford()`. If budget allows → atomically create one durable row + enqueue one bus message → `provider-routing`. If exhausted → create/reuse one row in `awaiting-budget-approval` (phase=pre-dispatch); ZERO messages; ZERO provider calls. Repeated request with same idempotency key SHALL reuse existing row.

#### Scenario: Budget allowed

- GIVEN valid input; budget ok
- WHEN dispatch executes
- THEN one row + one message → `provider-routing`

#### Scenario: Budget exhausted

- GIVEN valid input; daily budget exhausted
- WHEN dispatch executes
- THEN one row in `awaiting-budget-approval` (pre-dispatch); zero messages; zero calls

#### Scenario: Retry already dispatched

- GIVEN row at `provider-routing`; same idempotency key
- WHEN dispatch executes
- THEN existing row returned; zero new messages/calls

#### Scenario: Retry pre-enqueue

- GIVEN row created; message not yet enqueued; same key
- WHEN dispatch executes
- THEN resume enqueue exactly once; advance state

#### Scenario: Retry awaiting-budget

- GIVEN row in `awaiting-budget-approval`; same key
- WHEN dispatch executes
- THEN existing row returned; zero messages until CEO approval

### Requirement: CEO Approval Dispatch

CEO approves pre-dispatch job in `awaiting-budget-approval` (phase=pre-dispatch): SHALL re-validate seller identity, policy compliance, and authorization. On success: atomically enqueue one message → `provider-routing`. SHALL NOT create second row. Audited. Global daily cap unchanged. (Runtime budget approvals SHALL be handled by the daemon via ledger, not through dispatcher.)

#### Scenario: Approval success

- GIVEN row in `awaiting-budget-approval`; re-checks pass
- WHEN CEO approves
- THEN one message → `provider-routing`; audited; cap unchanged

#### Scenario: Re-check fails

- GIVEN seller invalid since original dispatch
- WHEN CEO approves
- THEN rejected; stays `awaiting-budget-approval`

#### Scenario: Post-enqueue crash recovery

- GIVEN message enqueued by CEO approval; crash before status update
- WHEN restart; store checked
- THEN state advanced to `provider-routing`; no second message

### Requirement: Seller and Channel Enforcement

Every dispatch SHALL be seller-scoped. Reference assets SHALL NOT cross seller boundaries. Channel SHALL be validated against allowlist.

#### Scenario: Cross-seller guard

- GIVEN Seller A dispatches using Seller B reference data
- WHEN enforced
- THEN rejected; zero rows; zero messages
