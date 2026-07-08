# Delta for ml-api-integration

## MODIFIED Requirements

### Requirement: Multi-Account OAuth

The system MUST store and manage OAuth tokens for the configured Plasticov and Maustian MercadoLibre seller accounts independently on the `MLC` site. `MLC` is the MercadoLibre Chile site code, not an account identity. Each account SHALL have its own encrypted token record with refresh cycle, using per-seller OAuth application credentials for token exchange and refresh. OAuth token storage MUST validate the returned MercadoLibre `user_id` against a configured allowed seller account before saving.
(Previously: Both accounts shared a single OAuth application's credentials for token exchange and refresh.)

#### Scenario: Two accounts connected

- GIVEN Plasticov and Maustian OAuth tokens are stored via separate OAuth applications
- WHEN API requests target each account by sellerId
- THEN the correct token and app credentials MUST be resolved without cross-account leakage

#### Scenario: Token refresh on expiry

- GIVEN Maustian access token expires
- WHEN next API call requires Maustian access
- THEN the system MUST use Maustian's app credentials and stored refresh token to obtain a new access token BEFORE the call proceeds

#### Scenario: Refresh token also expired

- GIVEN both access and refresh tokens are expired
- WHEN an API call targets that seller
- THEN the system MUST return `ReconnectRequired` and SHALL NOT attempt the API call
