# Delta for Custom Business MCP Tools

## ADDED Requirements

### Requirement: Prepare-Only Product Sync Tool

The `sync_product` MCP tool MUST create an approval-required prepared business-operation proposal for one Plasticov-to-Maustian product sync intent and MUST NOT report fake execution success.

#### Scenario: Valid product sync intent is prepared

- GIVEN MCP API-key auth is valid and the request targets one supported product sync intent
- WHEN `sync_product` is requested with target, rationale, risk, expiry, and `requiresApproval: true`
- THEN the tool MUST return a pending prepared proposal with proposal metadata
- AND it MUST disclose that no MercadoLibre mutation has executed

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
