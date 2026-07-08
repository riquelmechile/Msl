# dual-account-oauth Specification

## Purpose

Per-seller OAuth application routing with HMAC-protected callback state. Each seller (Plasticov, Maustian) connects through its own MercadoLibre OAuth app with distinct credentials, while preserving backward compatibility for single-app deployments.

## Requirements

### Requirement: Per-Seller OAuth App Routing

The system MUST route each seller to its configured OAuth application. `getAuthorizationUrl(sellerId, state)`, `exchangeCodeForToken(sellerId, code)`, and `refreshAccessToken(sellerId)` MUST resolve `{clientId, clientSecret, redirectUri}` per sellerId. When only one config is provided, the system MUST behave as a single OAuthManager.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Seller routed to own app | Plasticov→App A, Maustian→App B | `getAuthorizationUrl("plasticov", state)` | URL uses App A's clientId and redirectUri |
| Single-app fallback | Only one OAuthManagerConfig | Any sellerId used | All sellers routed to that config |
| Token exchange per seller | Plasticov→App A | `exchangeCodeForToken("plasticov", code)` | Uses App A's clientId, clientSecret, redirectUri |

### Requirement: Env Var Hierarchy

`MERCADOLIBRE_SOURCE_CLIENT_ID/SECRET/REDIRECT_URI` for Plasticov and `MERCADOLIBRE_TARGET_CLIENT_ID/SECRET/REDIRECT_URI` for Maustian MUST take priority. Legacy `MERCADOLIBRE_CLIENT_ID/SECRET/REDIRECT_URI` MUST serve as fallback when per-seller vars are absent.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Per-seller priority | Both SOURCE and legacy CLIENT_ID set | Plasticov config resolved | SOURCE_CLIENT_ID used |
| Legacy fallback | Only legacy CLIENT_ID set | Any seller config resolved | Legacy CLIENT_ID used |

### Requirement: Connect Route

`GET /api/meli/connect` MUST accept `role` query param (`source`=Plasticov, `target`=Maustian). It MUST resolve sellerId via `MERCADOLIBRE_SOURCE_SELLER_ID`/`MERCADOLIBRE_TARGET_SELLER_ID`, generate an HMAC-signed state token containing `{role, sellerId, nonce, createdAt}`, and redirect (302). Unknown roles MUST return 400.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Source role | `?role=source` | Request received | 302 to Plasticov's ML auth URL with HMAC state |
| Unknown role | `?role=admin` | Request received | 400 Unknown role |

### Requirement: Callback Route

`GET /api/meli/callback` and `GET /callback` MUST read `code` and `state` from query params, validate HMAC signature with `MSL_OAUTH_STATE_SECRET`, reject expired states (configurable TTL, default 10 min), reject unknown sellerIds or role/sellerId mismatches, and call `exchangeCodeForToken(sellerId, code)`. Response MUST be HTML with `user_id` and `nickname` — MUST NOT expose `access_token` or `refresh_token`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Valid callback | Valid code+state, sellerId=plasticov | Callback received | 200 HTML with user_id, nickname; no tokens |
| Expired state | State older than 10 min | Callback received | 400 State expired |
| Tampered state | State fails HMAC validation | Callback received | 400 Invalid state |
| Role mismatch | State: role=source, sellerId=maustian | Callback received | 400 Role/seller mismatch |
| Missing code | No code in query | Callback received | 400 Missing code |

### Requirement: Token Storage Isolation

Tokens MUST be stored in the existing `oauth_tokens` table by `seller_id`. Plasticov and Maustian rows MUST coexist. Encryption MUST use `MSL_ENCRYPTION_KEY` (unchanged). Refresh of one seller MUST NOT affect the other.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Two tokens coexist | No tokens exist | Both sellers complete OAuth | Two rows in oauth_tokens, one per seller_id |
| Isolated refresh | Both tokens stored | Plasticov token refreshed | Maustian row unchanged |

### Requirement: HMAC State Security

State parameters MUST be HMAC-signed with `MSL_OAUTH_STATE_SECRET`. Invalid or missing state MUST return 400. Tokens MUST NOT appear in logs or HTTP responses.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| State missing | Callback with code, no state | Callback processed | 400 Missing state |
| Token absent from response | Valid callback succeeds | HTML rendered | No access_token or refresh_token in body |

### Requirement: Backward Compatibility

Existing deployments with only `MERCADOLIBRE_CLIENT_ID/SECRET/REDIRECT_URI` MUST continue working. TokenStore MUST NOT require schema migration. The public API contract (method signatures) MUST remain unchanged.
