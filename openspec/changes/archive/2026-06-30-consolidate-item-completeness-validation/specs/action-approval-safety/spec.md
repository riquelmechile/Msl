# Delta for action-approval-safety

## MODIFIED Requirements

### Requirement: Product Sync Proposals Remain Pending

Product sync business operations MUST remain pending prepared actions unless a future approved slice adds explicit execution, approval, and audit behavior. This slice MAY persist prepared proposal state and non-sensitive preview evidence when durable approval storage is configured, and MAY calculate read-only preview evidence only from source items that pass shared MercadoLibre completeness validation. Validation failure MUST degrade preview evidence without mutation. It MUST NOT execute sync mutations, replay audits, persist credentials, or expand the approval/execution surface.
(Previously: Read-only preview evidence could be attached, but validation failure handling was not explicitly required to degrade safely.)

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
