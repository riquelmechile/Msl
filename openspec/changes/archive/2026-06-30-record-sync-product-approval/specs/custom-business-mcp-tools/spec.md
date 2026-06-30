# Delta for Custom Business MCP Tools

## ADDED Requirements

### Requirement: Sync Product Approval Recording Tool

The MCP tool surface MUST expose a narrow approval-recording operation for one exact stored `sync_product` proposal ID. The operation MUST authenticate before repository lookup, MUST accept only stored pending unexpired `sync_product` proposals, and MUST return redacted non-enumerating failures. It MUST NOT mutate MercadoLibre, execute sync, replay audit, call `ProductSyncEngine`, expose `sync_all`, perform multi-product sync, add a separate preview-only tool, or approve non-sync proposals.

#### Scenario: Pending sync proposal approval is recorded

- GIVEN MCP API-key auth is valid and an exact stored pending unexpired `sync_product` proposal exists
- WHEN the approval-recording operation is requested for that action ID
- THEN it MUST record approval state for that proposal only
- AND it MUST return sanitized metadata including `noMutationExecuted: true`

#### Scenario: Authentication fails before lookup

- GIVEN MCP API-key auth is missing or invalid
- WHEN the approval-recording operation is requested
- THEN it MUST reject before repository lookup
- AND it MUST NOT disclose proposal existence or storage configuration

#### Scenario: Unsupported proposal cannot be approved

- GIVEN MCP API-key auth is valid
- WHEN the requested action ID is missing, malformed, non-`sync_product`, unauthorized, expired, rejected, or already finalized
- THEN it MUST return a controlled non-enumerating unavailable response
- AND it MUST NOT reveal whether another record exists or why validation failed

#### Scenario: Approval recording cannot execute sync

- GIVEN a stored `sync_product` proposal is approved through the operation
- WHEN the response is produced
- THEN the tool MUST NOT call MercadoLibre mutation APIs, `ProductSyncEngine`, audit replay, `sync_all`, or multi-product behavior
- AND it MUST preserve the existing prepared proposal evidence for a future execution slice
