# OAuth Token Lifecycle — MercadoLibre Dual-Account Connection

## States

```
                    ┌──────────┐
                    │  AUTHORIZE│  User clicks OAuth URL
                    │  PENDING  │  → browser redirect to ML
                    └────┬─────┘
                         │ ML redirects to callback
                         ▼
                    ┌──────────┐
                    │  EXCHANGE │  POST /oauth/token
                    │  CODE     │  code → access + refresh
                    └────┬─────┘
                         │ Tokens stored encrypted
                         ▼
              ┌─────────────────────┐
              │     ACTIVE          │
              │  access_token valid  │
              │  refresh_token valid │
              └─────────┬───────────┘
                        │
            ┌───────────┼───────────┐
            ▼           │           ▼
     ┌──────────┐      │    ┌──────────────┐
     │ EXPIRING │      │    │   REFRESH    │  POST /oauth/token
     │ < 5 min  │──────┘    │   IN FLIGHT  │  grant_type=refresh_token
     └────┬─────┘           └──────┬───────┘
          │                        │
          │                 ┌──────┼──────┐
          │                 ▼      │      ▼
          │          ┌──────────┐ │ ┌──────────────┐
          │          │ REFRESHED│ │ │REFRESH_REJECT│
          │          │ new token│ │ │invalid_grant │
          │          └────┬─────┘ │ └──────┬───────┘
          │               │       │        │
          └───────────────┘       │        ▼
                                  │ ┌───────────────────┐
                                  │ │ REAUTHORIZATION    │
                                  │ │ REQUIRED           │
                                  │ │ Manual OAuth flow  │
                                  │ └───────────────────┘
                                  │
                                  ▼
                           ┌──────────────┐
                           │  ACTIVE      │
                           │  (loop back) │
                           └──────────────┘
```

## Key Operations

### Authorization (`/authorization`)
- URL: `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id={id}&redirect_uri={uri}&state={hmac}`
- State parameter: HMAC-SHA256(timestamp + nonce, MSL_OAUTH_STATE_SECRET)
- TTL: 10 minutes
- One-time use: state consumed on successful callback

### Token Exchange (`POST /oauth/token`)
- Grant type: `authorization_code`
- Parameters: `code`, `redirect_uri`, `client_id`, `client_secret`
- Response: `{ access_token, refresh_token, expires_in, user_id }`
- Validation: `user_id` must match expected seller ID
- Storage: encrypted with AES-256-GCM, stored in SQLite

### Token Refresh (`POST /oauth/token`)
- Grant type: `refresh_token`
- Parameters: `refresh_token`, `client_id`, `client_secret`
- Trigger: token expired or within 5-minute window
- Concurrency: per-seller mutex lock (`withLock`)
- On failure: classify error (`invalid_grant`, `network_error`, `rate_limited`, etc.)
- Old token: preserved until new token is persisted

### Expiry Detection
- `inspectToken()` reads stored token, evaluates expiry against current time
- `TOKEN_EXPIRY_WINDOW_SECONDS = 300` (5 minutes)
- Statuses: `valid`, `expiring`, `expired-refreshable`, `refresh-rejected`, `decryption-failed`, `missing`

## Observations

- `onTokenRefresh` callback fires on every successful refresh. Wired to structured logging (JSON log event) and metrics.
- Per-seller independence: Plasticov refresh failure does not affect Maustian.
- No proactive refresh: tokens are refreshed on demand (lazy), not on a schedule.
- Token store path: `MSL_MERCADOLIBRE_OAUTH_DB_PATH` (defaults to `.msl/mcp-oauth.db`)

## Code Paths

| File | Role |
|------|------|
| `packages/mercadolibre/src/oauth/oauthManager.ts` | MultiAppOAuthManager, ensureValidToken, refresh logic |
| `packages/mercadolibre/src/oauth/tokenStore.ts` | Encrypted token persistence |
| `packages/mercadolibre/src/connection/healthService.ts` | Token inspection, refresh orchestration |
| `packages/mcp/src/runtimeDependencies.ts` | OAuth config resolution, health service wiring |
