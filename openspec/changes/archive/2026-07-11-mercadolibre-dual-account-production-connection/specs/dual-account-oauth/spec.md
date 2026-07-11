# Delta for dual-account-oauth

## ADDED Requirements

### Requirement: Refresh Error Classification

The system MUST classify OAuth refresh errors from the MercadoLibre API into discrete states. The `refreshAccessToken(sellerId)` function SHALL return a typed error rather than a generic `Error` so callers can branch on the failure category.

#### Scenario: invalid_grant from ML API → reauthorization-required

- **GIVEN** Plasticov's refresh_token has been revoked
- **WHEN** `refreshAccessToken("plasticov")` calls the ML OAuth token endpoint
- **AND** the ML API responds with `{"error": "invalid_grant", "error_description": "..."}`
- **THEN** an `OAuthRefreshError` is thrown with `code: "invalid_grant"`
- **AND** the connection health status updates to `reauthorization-required`

#### Scenario: invalid_client → blocked

- **GIVEN** Maustian's OAuth client_id or client_secret is wrong
- **WHEN** `refreshAccessToken("maustian")` calls the ML OAuth token endpoint
- **AND** the ML API responds with `{"error": "invalid_client"}`
- **THEN** an `OAuthRefreshError` is thrown with `code: "invalid_client"`
- **AND** the connection health status updates to `blocked`

#### Scenario: Network error → degraded (retryable)

- **GIVEN** Plasticov's access token is expired
- **WHEN** `refreshAccessToken("plasticov")` attempts the API call
- **AND** the request fails with `ECONNREFUSED`, `ETIMEDOUT`, or `ENOTFOUND`
- **THEN** an `OAuthRefreshError` is thrown with `code: "network_error"` and `retryable: true`
- **AND** the connection health status updates to `degraded`

#### Scenario: Rate limited → degraded (retry with backoff)

- **GIVEN** Plasticov's access token is expired
- **WHEN** `refreshAccessToken("plasticov")` calls the ML OAuth token endpoint
- **AND** the ML API responds with HTTP 429
- **THEN** an `OAuthRefreshError` is thrown with `code: "rate_limited"` and `retryable: true`
- **AND** the `Retry-After` header value is included in the error metadata

#### Scenario: malformed_response → degraded

- **GIVEN** Plasticov's access token is expired
- **WHEN** `refreshAccessToken("plasticov")` calls the ML OAuth token endpoint
- **AND** the response body is valid JSON but missing `access_token`
- **THEN** an `OAuthRefreshError` is thrown with `code: "malformed_response"` and `retryable: true`
- **AND** the connection health status updates to `degraded`

### Requirement: Refresh Metric Emission

Every token refresh attempt MUST emit a structured log event. Success and failure metrics SHALL be recorded so that token health and refresh reliability can be monitored over time.

#### Scenario: Each refresh attempt emits structured log event

- **GIVEN** Plasticov's access token is expired
- **WHEN** `refreshAccessToken("plasticov")` is called
- **THEN** a structured log event is emitted containing `sellerId`, `operation: "token_refresh"`, and `outcome`
- **AND** the event is written before the function returns (success or failure)

#### Scenario: Success/failure metrics are recorded

- **GIVEN** Plasticov's refresh succeeds and Maustian's refresh fails with `invalid_grant`
- **WHEN** both refreshes complete
- **THEN** the metrics include `token_refresh_success{ seller: "plasticov" }` and `token_refresh_failure{ seller: "maustian", code: "invalid_grant" }`
- **AND** metrics are queryable per seller

#### Scenario: Token age and next expiry are tracked

- **GIVEN** Plasticov's token is refreshed successfully with a 6-hour expiry
- **WHEN** the refresh completes
- **THEN** the emitted event includes `tokenAge: 0s` and `expiresIn: 21600s`
- **AND** the new expiry timestamp is stored alongside the encrypted token

### Requirement: Cross-Process Refresh Advisory

The system SHOULD serialize refresh operations per seller within the same process. Cross-process coordination is documented as a known limitation for the first production deployment.

#### Scenario: withLock(sellerId) serializes within same process

- **GIVEN** two concurrent calls to `refreshAccessToken("plasticov")` arrive in the same Node.js process
- **WHEN** `withLock("plasticov")` is used around the refresh logic
- **THEN** only one refresh API call is made
- **AND** the second caller receives the token from the first caller's result

#### Scenario: Documentation notes cross-process risk

- **GIVEN** the system runs in a multi-process deployment (e.g., cluster mode, multiple workers)
- **WHEN** two different processes attempt to refresh Plasticov's token simultaneously
- **THEN** both may make API calls to the ML OAuth endpoint
- **AND** this is documented as `Cross-process refresh race` with the recommended mitigation (single-refresher pattern or distributed lock in a future PR)
- **AND** the last persisted token wins (no data corruption)
