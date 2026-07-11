# Delta for runtime-env-validator

## ADDED Requirements

### Requirement: Live Token Validity at Startup

`validateRuntimeEnv()` MUST consume connection health for each seller after the basic env var presence checks pass. A seller whose token is missing or decryptable but expired SHALL NOT block startup; it SHALL report as `degraded` with a clear diagnostic.

#### Scenario: Valid token at startup → seller readiness green

- **GIVEN** all required env vars for Plasticov are present
- **AND** Plasticov has a stored token that decrypts successfully and expires in 30 minutes
- **WHEN** `validateRuntimeEnv()` runs the connection health check for Plasticov
- **THEN** the result includes `sellers.plasticov: { status: "ready", readOnly: true }`
- **AND** the overall validation is `{ valid: true }`

#### Scenario: Expired token at startup → degraded, not blocking

- **GIVEN** Plasticov's stored token is expired and refresh fails with a network error
- **WHEN** `validateRuntimeEnv()` runs
- **THEN** the result includes `sellers.plasticov: { status: "degraded", reason: "token-refresh-failed" }`
- **AND** the overall validation is `{ valid: true }` (degraded capability, not blocking)

#### Scenario: Missing token at startup → degraded + reauthorization hint

- **GIVEN** Plasticov has no token in `oauth_tokens` but env vars are valid
- **WHEN** `validateRuntimeEnv()` runs
- **THEN** the result includes `sellers.plasticov: { status: "blocked", reason: "token-missing", action: "reauthorize" }`
- **AND** the overall validation is `{ valid: true }` (degraded, not blocking)

#### Scenario: Env var check still runs first

- **GIVEN** MERCADOLIBRE_SOURCE_CLIENT_ID is missing
- **WHEN** `validateRuntimeEnv()` runs
- **THEN** the basic env var check reports the missing var as an error
- **AND** the connection health check for Plasticov is skipped entirely
- **AND** the overall validation is `{ valid: false }`

### Requirement: Seller Account Readiness Consumes Connection Health

`ProductionReadinessService` MUST consume `MercadoLibreConnectionHealthService` to determine per-seller readiness. A seller SHALL be reported as ready for read operations only after passing configuration, token, identity, and smoke checks.

#### Scenario: All checks pass → seller marked ready for read

- **GIVEN** Plasticov passes config validation, token inspection, identity verification, and smoke tests
- **WHEN** `ProductionReadinessService.getSellerReadiness("plasticov")` is called
- **THEN** the result is `{ sellerId: "plasticov", read: "ready", write: "blocked" }`

#### Scenario: Token missing → seller not ready

- **GIVEN** Maustian has no token in `oauth_tokens`
- **WHEN** `ProductionReadinessService.getSellerReadiness("maustian")` is called
- **THEN** the result is `{ sellerId: "maustian", read: "blocked", write: "blocked" }`
- **AND** the reason references `token-missing`

### Requirement: Read Readiness Is Separate from Write Readiness

`ProductionReadinessService` MUST track read and write readiness independently. In this PR, write readiness SHALL always return `blocked` regardless of token health or API connectivity.

#### Scenario: Read ready, write blocked — single seller

- **GIVEN** Plasticov passes all connection health checks
- **WHEN** `ProductionReadinessService.getAllReadiness()` is called
- **THEN** Plasticov's entry shows `{ read: "ready", write: "blocked" }`
- **AND** the write block reason is `write-capability-not-implemented`

#### Scenario: Both sellers independently assessed

- **GIVEN** Plasticov has a valid token and Maustian's token is missing
- **WHEN** `ProductionReadinessService.getAllReadiness()` is called
- **THEN** Plasticov: `{ read: "ready", write: "blocked" }`
- **AND** Maustian: `{ read: "blocked", write: "blocked" }`
- **AND** the reasons for each block are distinct
