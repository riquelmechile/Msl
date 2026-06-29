# Delta for Custom Business MCP Tools

## MODIFIED Requirements

### Requirement: Prepare-Only Product Sync Tool

The `sync_product` MCP tool MUST create an approval-required prepared business-operation proposal for one Plasticov-to-Maustian product sync intent and MUST NOT report fake execution success. When durable proposal storage is configured, responses MUST disclose storage durability metadata; otherwise the tool MUST preserve default in-memory behavior.
(Previously: The tool created only in-memory prepared proposals and did not report durable storage metadata.)

#### Scenario: Valid product sync intent is prepared

- GIVEN MCP API-key auth is valid and the request targets one supported product sync intent
- WHEN `sync_product` is requested with target, rationale, risk, expiry, and `requiresApproval: true`
- THEN the tool MUST return a pending prepared proposal with proposal metadata
- AND it MUST disclose that no MercadoLibre mutation has executed

#### Scenario: Durable metadata is reported when configured

- GIVEN MCP API-key auth is valid and durable proposal storage is configured
- WHEN `sync_product` prepares a valid proposal
- THEN the response MUST indicate durable proposal storage is active
- AND the metadata MUST NOT expose database paths, credentials, or raw error details

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
- THEN it MUST NOT expose approval execution tools, `sync_all`, mutation execution, or sync preview tools
- AND `sync_product` MUST remain prepare-only
