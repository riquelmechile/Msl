# ml-api-integration Specification

## Purpose

Multi-account OAuth management, ML API read/write client, real HTTP transport, and Product Sync Engine for Plasticov→Maustian listing migration.

## Requirements

### Requirement: Multi-Account OAuth

The system MUST store and manage OAuth tokens for multiple MercadoLibre seller accounts independently. Each account SHALL have its own encrypted token record with refresh cycle. Token binding MUST be validated at every API call.

#### Scenario: Two accounts connected

- GIVEN Plasticov and Maustian OAuth tokens are stored
- WHEN API requests target each account by sellerId
- THEN the correct token MUST be resolved without cross-account leakage

#### Scenario: Token refresh on expiry

- GIVEN Maustian access token expires
- WHEN next API call requires Maustian access
- THEN the system MUST use the stored refresh token to obtain a new access token BEFORE the call proceeds

#### Scenario: Refresh token also expired

- GIVEN both access and refresh tokens are expired
- WHEN an API call targets that seller
- THEN the system MUST return `ReconnectRequired` and SHALL NOT attempt the API call

### Requirement: Encrypted Token Storage

The system MUST encrypt OAuth tokens at rest. Storage SHALL use libsodium secretbox with per-instance key derived from environment variable. Plaintext tokens MUST NOT be written to disk.

#### Scenario: Token saved encrypted

- GIVEN an OAuth authorization code exchange succeeds
- WHEN tokens are persisted
- THEN access and refresh tokens MUST be encrypted before SQLite INSERT

#### Scenario: Token read decrypts on load

- GIVEN valid encrypted tokens exist in SQLite
- WHEN the OAuth manager loads tokens at startup
- THEN decryption MUST succeed and tokens MUST be usable for API calls

### Requirement: ML API Write Operations

The system MUST expose write methods: `publishItem` (POST /items), `updateItem` (PUT /items/{id}), `changeItemStatus` (PUT /items/{id} with status body). Writes SHALL return confirmation snapshots with id, permalink, and freshness metadata.

#### Scenario: Publish listing to Maustian

- GIVEN a valid Maustian OAuth token
- WHEN `publishItem` is called with listing payload
- THEN the system MUST POST to `/items` with access token
- AND return the created item id and permalink

#### Scenario: Write fails on token mismatch

- GIVEN Plasticov token is active
- WHEN `publishItem` targets Maustian sellerId
- THEN the system MUST reject with `seller-access-mismatch`

### Requirement: Product Sync Engine

The system SHALL provide a `ProductSyncEngine` that extracts listings from a source account, applies CEO strategies programmatically, and publishes transformed listings to a target account. The engine MUST track sync state to enable differential updates.

#### Scenario: Full sync extracts and publishes

- GIVEN Plasticov has 50 active listings and Maustian is empty
- WHEN `syncProducts` is executed with an active margin strategy
- THEN listings MUST be extracted, priced per strategy, and published to Maustian
- AND sync state MUST record all published product mappings

#### Scenario: Differential sync skips unchanged

- GIVEN a prior sync published 40 products
- WHEN listings change for only 5 products
- THEN `syncProducts` MUST detect 5 changed listings and SHALL NOT re-publish the remaining 35

### Requirement: MCP Tool Surface

The system MUST expose MCP tools for sync operations using the `CustomBusinessTool` pattern: `sync_products`, `list_ml_categories`, `get_sync_status`, `initiate_sync`, `publish_product`, `get_ml_account_info`. Write tools SHALL require approval through the existing approval pipeline.

#### Scenario: Agent invokes sync_products

- GIVEN the agent receives CEO instruction "publicá electrónica en Maustian"
- WHEN the agent calls `sync_products` with category filter "electrónica"
- THEN the sync engine MUST execute and return results with product count

#### Scenario: Write tool requires approval

- GIVEN autonomy level is below auto-approval threshold
- WHEN `publish_product` is invoked
- THEN the tool MUST prepare an approval request instead of executing directly
