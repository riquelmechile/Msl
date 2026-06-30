# Delta for custom-business-mcp-tools

## MODIFIED Requirements

### Requirement: Prepare-Only Product Sync Tool

The `sync_product` MCP tool MUST create an approval-required proposal for one Plasticov-to-Maustian product sync intent and MUST NOT report fake execution success. It MAY include safe read-only preview metadata on the same pending proposal when available. Preview source item evidence MUST pass the shared MercadoLibre item completeness boundary before strategy calculation; validation failure MUST degrade to preview-unavailable metadata instead of execution. When durable proposal storage is configured, responses MUST disclose durability metadata; otherwise the tool MUST preserve default in-memory behavior.
(Previously: Preview metadata could be unavailable, but item completeness validation was not required to reuse the MercadoLibre-owned boundary.)

#### Scenario: Valid product sync intent is prepared

- GIVEN MCP API-key auth is valid and the request targets one supported product sync intent
- WHEN `sync_product` is requested with target, rationale, risk, expiry, and `requiresApproval: true`
- THEN the tool MUST return a pending prepared proposal with proposal metadata
- AND it MUST disclose that no MercadoLibre mutation has executed

#### Scenario: Safe preview metadata is available

- GIVEN the valid request has complete source item evidence and strategies
- WHEN `sync_product` prepares the proposal
- THEN the response MAY include proposed field-change preview evidence
- AND it MUST keep `approvalStatus: "pending"`, `requiresApproval: true`, and `noMutationExecuted: true`

#### Scenario: Incomplete source item evidence degrades preview

- GIVEN source item evidence fails shared MercadoLibre completeness validation
- WHEN `sync_product` prepares the proposal
- THEN the response MUST include preview-unavailable metadata with reason `source-read-failed`
- AND it MUST NOT execute mutation, expose raw validation details, or claim completion

#### Scenario: Preview metadata is unavailable

- GIVEN source reads or strategies are unavailable
- WHEN `sync_product` prepares the proposal
- THEN the response MUST still return a pending proposal with preview-unavailable metadata
- AND it MUST NOT execute mutation or claim completion

#### Scenario: Durable metadata is reported when configured

- GIVEN MCP API-key auth is valid and durable proposal storage is configured
- WHEN `sync_product` prepares a valid proposal
- THEN the response MUST indicate durable proposal storage is active
- AND the metadata MUST NOT expose database paths, credentials, or raw error details

#### Scenario: Durable storage startup is unavailable

- GIVEN durable proposal storage is configured but cannot be opened during MCP startup
- WHEN `sync_product` prepares a valid proposal
- THEN the runtime MUST continue with controlled degraded in-memory proposal storage metadata
- AND the metadata MUST NOT falsely report persistent storage or expose sensitive details

#### Scenario: Default in-memory behavior remains

- GIVEN MCP API-key auth is valid and durable proposal storage is not configured
- WHEN `sync_product` prepares a valid proposal
- THEN the response MUST indicate non-durable in-memory proposal storage
- AND it MUST NOT require deployment-specific persistence configuration

#### Scenario: Required proposal metadata is missing

- GIVEN MCP API-key auth is valid
- WHEN `sync_product` is requested without target, rationale, risk, expiry, or `requiresApproval: true`
- THEN the tool MUST return a controlled blocked response
- AND it MUST NOT create an executable success response

#### Scenario: Unsupported bulk sync is requested

- GIVEN MCP API-key auth is valid
- WHEN a request asks for `sync_all` or multi-product sync execution
- THEN the tool MUST block the request as out of scope
- AND it MUST limit guidance to preparing a single-product proposal

#### Scenario: Approval execution tools remain absent

- GIVEN durable proposal storage is active
- WHEN the MCP tool surface is listed or invoked
- THEN it MUST NOT expose approval execution tools, `sync_all`, mutation execution, or separate sync preview tools
- AND `sync_product` MUST remain prepare-only

#### Scenario: Generic prepared writes reject credential-like payloads

- GIVEN MCP API-key auth is valid and `prepare_mercadolibre_write` is available
- WHEN the request target, exact changes, or rationale includes API keys, OAuth tokens, client secrets, raw credential material, or database paths
- THEN the tool MUST return a controlled blocked response before repository save
- AND it MUST NOT persist or echo the credential-like payload

#### Scenario: Generic prepared write storage save fails

- GIVEN MCP API-key auth is valid and `prepare_mercadolibre_write` is available
- WHEN approval storage fails while saving the prepared proposal
- THEN the tool MUST return a controlled blocked response with redacted error details
- AND it MUST NOT expose database paths, credentials, or raw storage errors
