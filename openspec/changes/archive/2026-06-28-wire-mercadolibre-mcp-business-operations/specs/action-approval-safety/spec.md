# Delta for Action Approval Safety

## ADDED Requirements

### Requirement: Product Sync Proposals Remain Pending

Product sync business operations MUST remain pending prepared actions unless a future approved slice adds explicit execution, approval, and audit behavior. This slice MUST NOT execute sync mutations, persist approval state, replay audits, or calculate sync previews.

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

#### Scenario: Approval persistence is requested

- GIVEN a product sync proposal is prepared
- WHEN the caller expects persistent approval storage or audit replay
- THEN the system MUST disclose that this slice does not persist approvals
- AND it MUST keep the proposal non-executing
