# Delta for mercadolibre-account-integration

## MODIFIED Requirements

### Requirement: OAuth Account Connection

The system MUST connect seller accounts through MercadoLibre OAuth using per-seller application credentials. Each seller (Plasticov, Maustian) SHALL use its own `{clientId, clientSecret, redirectUri}`. The system MUST only request scopes needed for enabled capabilities.
(Previously: All sellers shared a single OAuth application.)

#### Scenario: Seller connects account

- GIVEN the seller starts account connection with per-seller OAuth credentials
- WHEN OAuth authorization succeeds
- THEN the system MUST store access state and identify the account as `MLC`

#### Scenario: Authorization fails or is revoked

- GIVEN OAuth authorization fails or access is revoked
- WHEN protected data is requested
- THEN the system MUST block access and ask the seller to reconnect
