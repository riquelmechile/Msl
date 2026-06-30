# Delta for Custom Business MCP Tools

## ADDED Requirements

### Requirement: Read-Only Product Sync Proposal Status Tool

The MCP tool surface MUST expose a read-only status operation for stored `sync_product` proposals. The operation MUST require MCP API-key authentication, accept only one exact action ID, return non-enumerating redacted responses, and MUST NOT approve, execute, replay, mutate, call `ProductSyncEngine`, expose `sync_all`, perform multi-product sync, or add separate preview-only tools.

#### Scenario: Stored product sync proposal is inspected

- GIVEN MCP API-key auth is valid and a stored `sync_product` proposal exists for the exact action ID
- WHEN the status operation is requested
- THEN it MUST return redacted status, expiry, risk, target, rationale, preview summary, and storage metadata
- AND it MUST disclose that no approval, execution, audit replay, or MercadoLibre mutation occurred

#### Scenario: Unknown or unauthorized ID is requested

- GIVEN MCP API-key auth is valid
- WHEN the status operation receives an unknown, unauthorized, malformed, or unsupported action ID
- THEN it MUST return a controlled non-enumerating response
- AND it MUST NOT reveal whether another seller, action kind, storage path, or raw record exists

#### Scenario: Status derivation remains read-only

- GIVEN a stored proposal is expired or degraded storage metadata applies
- WHEN the status operation derives the response status
- THEN it MUST derive status from stored metadata without mutating repository state
- AND it MUST redact database paths, credentials, raw errors, and validation details

#### Scenario: Unauthenticated request is blocked

- GIVEN MCP API-key auth is missing or invalid
- WHEN the status operation is requested
- THEN it MUST reject the request before repository lookup
- AND it MUST NOT disclose proposal existence or storage configuration
