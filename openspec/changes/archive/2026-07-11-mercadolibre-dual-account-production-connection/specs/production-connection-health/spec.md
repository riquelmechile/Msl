# production-connection-health Specification

## Purpose

OAuth connection health monitoring, token inspection, safe refresh with error classification, read-only smoke testing, and per-seller readiness status for Plasticov and Maustian.

## Requirements

### Requirement: Per-Seller OAuth Configuration Validation

The system MUST validate that each seller has complete OAuth configuration before any connection health check proceeds. Missing env vars SHALL block further checks with a diagnostic reason.

#### Scenario: All required env vars present → ready

- **GIVEN** MERCADOLIBRE_SOURCE_CLIENT_ID, MERCADOLIBRE_SOURCE_CLIENT_SECRET, MERCADOLIBRE_SOURCE_SELLER_ID, and MSL_ENCRYPTION_KEY are all set
- **WHEN** MercadoLibreConnectionHealthService validates Plasticov's configuration
- **THEN** the configuration check returns status `ready`

#### Scenario: Missing client_id → blocked + reason

- **GIVEN** MERCADOLIBRE_SOURCE_CLIENT_ID is not set
- **WHEN** MercadoLibreConnectionHealthService validates Plasticov's configuration
- **THEN** the configuration check returns status `blocked`
- **AND** the reason includes `missing MERCADOLIBRE_SOURCE_CLIENT_ID`

#### Scenario: Missing encryption key → blocked + reason

- **GIVEN** MSL_ENCRYPTION_KEY is not set but all seller-specific vars are present
- **WHEN** MercadoLibreConnectionHealthService validates any seller's configuration
- **THEN** the configuration check returns status `blocked`
- **AND** the reason includes `missing MSL_ENCRYPTION_KEY`

### Requirement: Inspect-Only Token Inspection

The system MUST provide a read-only token inspection capability. `inspectToken(sellerId)` SHALL assess token state without modifying stored tokens, triggering refreshes, or making any API call.

#### Scenario: Token present and decryptable → valid

- **GIVEN** Plasticov has a stored encrypted token that decrypts successfully and expires in 30 minutes
- **WHEN** `inspectToken("plasticov")` is called
- **THEN** the result is `{ status: "valid", expiresIn: ~1800 }`
- **AND** no refresh is triggered, no API call is made

#### Scenario: Token missing → missing

- **GIVEN** Maustian has no token row in `oauth_tokens`
- **WHEN** `inspectToken("maustian")` is called
- **THEN** the result is `{ status: "missing" }`

#### Scenario: Decryption fails → decryption-failed

- **GIVEN** Plasticov's stored token blob cannot be decrypted with MSL_ENCRYPTION_KEY
- **WHEN** `inspectToken("plasticov")` is called
- **THEN** the result is `{ status: "decryption-failed" }`
- **AND** no API call is made

#### Scenario: Token expiring within 5 minutes → expiring

- **GIVEN** Plasticov's decrypted access token expires in 3 minutes
- **WHEN** `inspectToken("plasticov")` is called
- **THEN** the result is `{ status: "expiring", expiresIn: ~180 }`

### Requirement: Safe Automatic Token Refresh (Seller-Scoped)

The system SHALL refresh access tokens when they are expired or within the expiry window. Refresh errors MUST be classified. Refresh of one seller MUST NOT affect the other.

#### Scenario: Valid token → no refresh triggered

- **GIVEN** Plasticov's access token is valid for 20 more minutes
- **WHEN** `ensureFreshToken("plasticov")` is called
- **THEN** no refresh API call is made
- **AND** the existing token is returned as-is

#### Scenario: Expired token, refresh succeeds → refreshed

- **GIVEN** Plasticov's access token is expired but the refresh_token is valid
- **WHEN** `ensureFreshToken("plasticov")` is called
- **THEN** a POST to MercadoLibre's OAuth token endpoint succeeds
- **AND** the new access token and refresh token are encrypted and persisted
- **AND** `onTokenRefresh` callback is invoked with the new expiry

#### Scenario: Refresh rejected with invalid_grant → reauthorization-required

- **GIVEN** Plasticov's refresh_token has been revoked or is invalid
- **WHEN** `ensureFreshToken("plasticov")` is called
- **THEN** the ML API returns `{"error": "invalid_grant"}`
- **AND** the connection status transitions to `reauthorization-required`
- **AND** no retry is attempted

#### Scenario: Network error during refresh → degraded

- **GIVEN** Plasticov's access token is expired
- **WHEN** `ensureFreshToken("plasticov")` is called
- **AND** the ML OAuth endpoint is unreachable (ETIMEDOUT)
- **THEN** the connection status transitions to `degraded`
- **AND** the error is classified as retryable

#### Scenario: Refresh of Plasticov does not affect Maustian

- **GIVEN** both sellers have stored tokens; only Plasticov's is expired
- **WHEN** `ensureFreshToken("plasticov")` executes a successful refresh
- **THEN** Maustian's token row in `oauth_tokens` remains unchanged
- **AND** Maustian's connection status is unaffected

### Requirement: Identity Verification via GET /users/{sellerId}

The system MUST verify that the authenticated user identity returned by the MercadoLibre API matches the expected seller ID.

#### Scenario: user_id matches expected seller → identity verified

- **GIVEN** Plasticov's seller ID is configured as MERCADOLIBRE_SOURCE_SELLER_ID
- **WHEN** `verifyIdentity("plasticov")` calls GET /users/me with the valid access token
- **AND** the response includes `{ "id": <matching seller ID>, "nickname": "PLASTICOVSTORE" }`
- **THEN** the result is `{ status: "identity-verified" }`

#### Scenario: user_id differs → identity mismatch

- **GIVEN** Maustian's seller ID is configured as MERCADOLIBRE_TARGET_SELLER_ID
- **WHEN** `verifyIdentity("maustian")` is called
- **AND** the API returns a user_id that does NOT match MERCADOLIBRE_TARGET_SELLER_ID
- **THEN** the result is `{ status: "identity-mismatch" }`
- **AND** the connection status transitions to `blocked`

#### Scenario: API unavailable → degraded

- **GIVEN** the ML /users/me endpoint returns a 5xx error
- **WHEN** `verifyIdentity("plasticov")` is called
- **THEN** the result is `{ status: "degraded", reason: "identity-check-unavailable" }`
- **AND** the connection status is marked `degraded`

### Requirement: Read-Only Smoke Tests

The system MUST provide bounded, read-only smoke tests that validate API connectivity without performing any mutations. Smoke results MUST NOT contain PII.

#### Scenario: Identity check passes → endpoint success

- **GIVEN** Plasticov has a valid access token and identity verification succeeds
- **WHEN** smoke test `verifyIdentity` is executed
- **THEN** the result includes `endpoint: "GET /users/me", status: "success"`
- **AND** no user_id, nickname, or PII is present in the smoke report

#### Scenario: Orders smoke test — small page, low limit, no persist

- **GIVEN** Plasticov has a valid access token
- **WHEN** the orders smoke test runs
- **THEN** it calls GET /orders/search with limit ≤ 5
- **AND** results are NOT persisted to any database
- **AND** the response is discarded after confirming a 200 status code

#### Scenario: Items smoke test — sample summary, no mutation

- **GIVEN** Plasticov has a valid access token and at least one active listing
- **WHEN** the items smoke test runs
- **THEN** it calls GET /users/{sellerId}/items/search with a small limit
- **AND** no PUT, POST, or DELETE requests are made
- **AND** the result reports `endpoint: "items", status: "success"` with no item detail

#### Scenario: No PII returned in smoke results

- **GIVEN** all smoke tests pass for both sellers
- **WHEN** the smoke report is generated
- **THEN** the report contains endpoint names and statuses only
- **AND** no access tokens, user IDs, nicknames, listing IDs, or order IDs appear

### Requirement: Connection Health Status Model

The system MUST model connection health with four discrete states. Status transitions MUST be atomic and monotonic toward degradation.

| Status | Condition |
|--------|-----------|
| `ready` | Config valid, token fresh, identity verified, smoke passed |
| `degraded` | Non-critical warning (network errors, API timeouts, token expiring) |
| `blocked` | Config missing, token missing, decryption failure, identity mismatch |
| `reauthorization-required` | Refresh returned `invalid_grant` — user action needed |

#### Scenario: All checks pass → ready

- **GIVEN** Plasticov's config, token, identity, and smoke checks all succeed
- **WHEN** `getConnectionStatus("plasticov")` is called
- **THEN** the status is `ready`

#### Scenario: Non-critical warning → degraded

- **GIVEN** Plasticov's identity check fails due to a network timeout but token is still valid
- **WHEN** `getConnectionStatus("plasticov")` is called
- **THEN** the status is `degraded`
- **AND** the degradation reason is included in the status details

#### Scenario: Token missing → blocked

- **GIVEN** Plasticov has no token row in `oauth_tokens`
- **WHEN** `getConnectionStatus("plasticov")` is called
- **THEN** the status is `blocked`
- **AND** the reason is `token-missing`

#### Scenario: Refresh rejected → reauthorization-required

- **GIVEN** Plasticov's refresh attempt returned `invalid_grant`
- **WHEN** `getConnectionStatus("plasticov")` is called
- **THEN** the status is `reauthorization-required`
- **AND** the reason includes the ML error code

### Requirement: Read vs Write Capability Separation

The system MUST enforce that read capability and write capability are independently assessed. In this PR, write capability SHALL always return `blocked`.

#### Scenario: Read capability can be ready while write is blocked

- **GIVEN** Plasticov passes all read checks (config, token, identity, smoke)
- **WHEN** `getReadiness("plasticov")` is called
- **THEN** `read` is `ready`
- **AND** `write` is `blocked`

#### Scenario: Write capability never transitions to ready in this PR

- **GIVEN** any seller and any connection state
- **WHEN** write capability is assessed
- **THEN** the result is always `blocked`
- **AND** the reason is `write-capability-not-implemented`
- **AND** `assertMercadoLibreWriteDisabled()` throws if called

#### Scenario: assertMercadoLibreWriteDisabled() blocks all write operations

- **GIVEN** a write operation (e.g., publish listing, change price) is attempted
- **WHEN** the operation calls `assertMercadoLibreWriteDisabled()`
- **THEN** a `MercadoLibreWriteBlockedError` is thrown
- **AND** the error message states that write operations are not available in this PR
