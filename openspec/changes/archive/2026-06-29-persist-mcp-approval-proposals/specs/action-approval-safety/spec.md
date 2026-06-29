# Delta for Action Approval Safety

## MODIFIED Requirements

### Requirement: Product Sync Proposals Remain Pending

Product sync business operations MUST remain pending prepared actions unless a future approved slice adds explicit execution, approval, and audit behavior. This slice MAY persist prepared proposal state when durable approval storage is configured, but it MUST NOT execute sync mutations, replay audits, calculate sync previews, persist credentials, or expand the approval/execution surface.
(Previously: Product sync proposals were pending only and explicitly did not persist approval state.)

#### Scenario: Prepared sync proposal is returned

- GIVEN a valid single-product sync request passes safety validation
- WHEN the proposal is created
- THEN it MUST have pending approval status and `requiresApproval: true`
- AND it MUST include intended target, rationale, risk, and expiry metadata

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

#### Scenario: Durable storage is not configured

- GIVEN durable proposal storage is not configured
- WHEN a product sync proposal is prepared
- THEN the system MUST keep default in-memory proposal behavior
- AND it MUST disclose that proposals do not survive restart

#### Scenario: Storage failure occurs during proposal preparation

- GIVEN durable proposal storage is configured but unavailable
- WHEN a product sync proposal is prepared
- THEN the system MUST return a controlled blocked response with redacted error details
- AND it MUST NOT execute mutation, replay audit, or calculate sync preview
