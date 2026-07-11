# Delta for operational-health

## ADDED Requirements

### Requirement: ML Connection Health in Periodic Health Cycle

The periodic health cycle MUST include MercadoLibre connection health checks for each configured seller. Connection status SHALL be reported per seller in the consolidated health report.

#### Scenario: Both sellers healthy in health cycle

- **GIVEN** Plasticov and Maustian both pass config, token, identity, and smoke checks
- **WHEN** the periodic health cycle runs
- **THEN** the health report includes `mlConnections: { plasticov: "ready", maustian: "ready" }`
- **AND** the overall health status is `healthy`

#### Scenario: One seller degraded in health cycle

- **GIVEN** Plasticov is `ready` but Maustian's token refresh fails with a network error
- **WHEN** the periodic health cycle runs
- **THEN** the health report shows `mlConnections: { plasticov: "ready", maustian: "degraded" }`
- **AND** the overall consolidated status is `degraded`
- **AND** the degradation reason (`maustian: network-error`) is included

#### Scenario: No sellers configured → ML health skipped

- **GIVEN** no MercadoLibre seller env vars are configured
- **WHEN** the periodic health cycle runs
- **THEN** the `mlConnections` section is absent or reports `mlConnections: "not-configured"`
- **AND** other health checks (DB integrity, WAL, migration, backup) run normally

### Requirement: OAuth DB Integrity Check

The operational health cycle MUST validate the integrity of the OAuth token store. Specifically, it SHALL verify that `oauth_tokens` is queryable and that encrypted token blobs are present for each seller that has completed the OAuth flow.

#### Scenario: oauth_tokens table is queryable and contains expected rows

- **GIVEN** both Plasticov and Maustian have stored tokens in `oauth_tokens`
- **WHEN** the OAuth DB integrity check runs
- **THEN** the check returns `{ oauthDb: "healthy", tokenCount: 2 }`
- **AND** each seller's row includes `seller_id` but NOT the token blob itself

#### Scenario: oauth_tokens has rows but one blob is zero-length

- **GIVEN** Plasticov has a valid token blob and Maustian's encrypted_blob is empty (0 bytes)
- **WHEN** the OAuth DB integrity check runs
- **THEN** the check returns `{ oauthDb: "degraded", tokenCount: 2, emptyBlobs: ["maustian"] }`

#### Scenario: oauth_tokens table query fails

- **GIVEN** the SQLite database file is locked or corrupted such that `SELECT` on `oauth_tokens` throws
- **WHEN** the OAuth DB integrity check runs
- **THEN** the check returns `{ oauthDb: "degraded", reason: "query-failed" }`
- **AND** the specific error is logged but the token contents are not

### Requirement: Token Refresh Metrics Surfaced in Health Report

The periodic health report MUST surface token refresh metrics aggregated per seller. This includes last refresh timestamp, refresh success/failure counts since the last health cycle, and current token expiry windows.

#### Scenario: Refresh metrics appear in health report

- **GIVEN** Plasticov's token was refreshed successfully 2 minutes ago and expires in 5 hours 58 minutes
- **AND** Maustian's token was refreshed 10 minutes ago and expires in 5 hours 50 minutes
- **WHEN** the health cycle runs
- **THEN** the health report includes:
  - `mlTokenMetrics.plasticov: { lastRefresh: "<2 min ago>", expiresIn: "5h58m", refreshOutcome: "success" }`
  - `mlTokenMetrics.maustian: { lastRefresh: "<10 min ago>", expiresIn: "5h50m", refreshOutcome: "success" }`

#### Scenario: Failed refresh counted in health report

- **GIVEN** Maustian's last refresh attempt failed with `invalid_grant` during this health cycle
- **WHEN** the health cycle completes
- **THEN** the health report includes `mlTokenMetrics.maustian: { refreshOutcome: "invalid_grant", lastRefresh: "<timestamp>" }`
- **AND** a health alert is raised for `maustian-reauthorization-required`

#### Scenario: No refresh occurred in this cycle → previous metrics preserved

- **GIVEN** neither seller's token needed refreshing during this health cycle
- **WHEN** the health cycle runs
- **THEN** the health report includes `mlTokenMetrics` with the last known refresh timestamps and expiry windows
- **AND** no zero-value metrics are reported
