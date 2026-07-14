# MercadoLibre Dual-Account Production Connection

Operational guide for the MercadoLibre dual-account OAuth production connection. Covers Plasticov (source) and Maustian (target) accounts with separate OAuth applications, encrypted token storage, and read-only production capability.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    MSL Monorepo                           │
│                                                           │
│  ┌─────────────────┐       ┌─────────────────┐           │
│  │ Plasticov (src)  │       │ Maustian (tgt)   │           │
│  │ OAuth App A      │       │ OAuth App B      │           │
│  │ Client ID: env   │       │ Client ID: env   │           │
│  │ Redirect: env    │       │ Redirect: env    │           │
│  └────────┬────────┘       └────────┬────────┘           │
│           │                         │                    │
│           └─────────┬───────────────┘                    │
│                     ▼                                    │
│         ┌───────────────────────┐                        │
│         │   MultiAppOAuthManager │                       │
│         │   - Per-seller tokens  │                       │
│         │   - Mutex-locked refr. │                       │
│         │   - Refresh callback   │                       │
│         └───────────┬───────────┘                        │
│                     ▼                                    │
│         ┌───────────────────────┐                        │
│         │   TokenStore (SQLite)  │                       │
│         │   - AES-256-GCM encr.  │                       │
│         │   - OAuth DB path: env │                       │
│         │   - Key: MSL_ENCRYPTION│                       │
│         └───────────────────────┘                        │
│                                                           │
│  Read Operations: ✅ Enabled (orders, items, identity)    │
│  Write Operations: ❌ BLOCKED (publish, update, stock,    │
│                       price, ads, questions, messages)    │
└──────────────────────────────────────────────────────────┘
```

## Environment Variables

All variables are documented in `.env.example`. Key groups for the dual-account connection:

| Variable                            | Purpose                                          | Required     |
| ----------------------------------- | ------------------------------------------------ | ------------ |
| `MERCADOLIBRE_SOURCE_CLIENT_ID`     | Plasticov OAuth app ID                           | ✅           |
| `MERCADOLIBRE_SOURCE_CLIENT_SECRET` | Plasticov OAuth app secret                       | ✅           |
| `MERCADOLIBRE_SOURCE_REDIRECT_URI`  | Plasticov OAuth callback URL                     | ✅           |
| `MERCADOLIBRE_TARGET_CLIENT_ID`     | Maustian OAuth app ID                            | ✅           |
| `MERCADOLIBRE_TARGET_CLIENT_SECRET` | Maustian OAuth app secret                        | ✅           |
| `MERCADOLIBRE_TARGET_REDIRECT_URI`  | Maustian OAuth callback URL                      | ✅           |
| `MERCADOLIBRE_SOURCE_SELLER_ID`     | Plasticov MercadoLibre user ID                   | ✅           |
| `MERCADOLIBRE_TARGET_SELLER_ID`     | Maustian MercadoLibre user ID                    | ✅           |
| `MSL_ENCRYPTION_KEY`                | AES-256-GCM encryption key for tokens            | ✅           |
| `MSL_MERCADOLIBRE_OAUTH_DB_PATH`    | SQLite path for token storage                    | ✅           |
| `MSL_OAUTH_STATE_SECRET`            | HMAC secret for OAuth state signing              | ✅           |
| `MSL_SKIP_ENV_FILE`                 | Skip `.env`/`.env.local` loading (CI/containers) | —            |
| `MSL_ALLOW_INSECURE_DEV_SECRETS`    | Allow dev without encryption key                 | — (dev only) |

## Connection Flow

### 1. Generate OAuth Authorization URL

```bash
npm run meli:connect:url -- --seller source
npm run meli:connect:url -- --seller target
```

Opens the MercadoLibre authorization page. The user grants permissions and is redirected to the callback URL.

### 2. OAuth Callback Exchange

The callback endpoint (`/api/meli/callback`) exchanges the authorization code for access and refresh tokens. Tokens are encrypted with AES-256-GCM and stored in the OAuth SQLite database.

### 3. Token Refresh

Tokens are refreshed automatically when they expire or approach expiry (within 5 minutes). Each seller has an independent refresh with a per-seller mutex lock. The `onTokenRefresh` callback emits structured log events.

## CLI Commands

```bash
# Connection status for all sellers
npm run meli:connection:status

# Refresh token for a specific seller
npm run meli:refresh -- --seller source
npm run meli:refresh -- --seller target

# Run read-only smoke tests
npm run meli:smoke -- --seller source
npm run meli:smoke -- --seller target

# Generate OAuth authorization URL
npm run meli:connect:url -- --seller source
npm run meli:connect:url -- --seller target
```

All commands support `--json` for structured output.

## Health Monitoring

The connection health service (`createMercadoLibreConnectionHealthService`) provides four inspection modes:

| Mode                | What It Checks                              | API Calls           |
| ------------------- | ------------------------------------------- | ------------------- |
| `inspect-only`      | Token decryption, expiry evaluation         | None                |
| `refresh-if-needed` | Token decrypt + refresh if expired          | Refresh only        |
| `smoke-read`        | Identity check, orders access, items access | Read-only API calls |
| `no-network`        | Config validation only                      | None                |

### Health Statuses

| Status                     | Meaning                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| `ready`                    | Token valid, connection operational                                    |
| `degraded`                 | Token expiring, network error, or partial failure                      |
| `blocked`                  | Store unavailable, decryption failed, or config error                  |
| `disconnected`             | No token stored                                                        |
| `reauthorization-required` | Token refresh rejected (invalid_grant) — manual reauthorization needed |

### CEO MCP Tools

Three MCP tools are available for the CEO to inspect connections:

- `inspect_mercadolibre_connections` — All sellers, read-only
- `inspect_mercadolibre_account_health` — Detailed per-seller health
- `run_mercadolibre_read_smoke` — Read-only smoke tests (explicit CEO request only)

## Read vs Write

| Operation           | Status     | Gate                                |
| ------------------- | ---------- | ----------------------------------- |
| Read orders         | ✅ Enabled | Health service checks token         |
| Read items/listings | ✅ Enabled | Health service checks token         |
| Read identity       | ✅ Enabled | Smoke test verifies                 |
| Publish item        | ❌ BLOCKED | `assertMercadoLibreWriteDisabled()` |
| Update item         | ❌ BLOCKED | `assertMercadoLibreWriteDisabled()` |
| Change stock        | ❌ BLOCKED | `assertMercadoLibreWriteDisabled()` |
| Change price        | ❌ BLOCKED | `assertMercadoLibreWriteDisabled()` |
| Product Ads         | ❌ BLOCKED | `assertMercadoLibreWriteDisabled()` |
| Answer questions    | ❌ BLOCKED | `assertMercadoLibreWriteDisabled()` |
| Send messages       | ❌ BLOCKED | `assertMercadoLibreWriteDisabled()` |
| Claims actions      | ❌ BLOCKED | `assertMercadoLibreWriteDisabled()` |

Write operations require P0 PR 4/4 (real data ingestion and economic adapters).

## Recovery

### Token Expired

Expected behavior — the health service reports `degraded` with `reasonCodes: ["token_expired"]`. Run:

```bash
npm run meli:refresh -- --seller source
```

If refresh succeeds, token is updated and status returns to `ready`.

### Refresh Rejected (invalid_grant)

Status: `reauthorization-required`. The refresh token was rejected by MercadoLibre. This usually means:

1. The user revoked the app access
2. The app credentials changed
3. The token was manually invalidated

**Recovery steps:**

1. Run `npm run meli:connect:url -- --seller source` to generate a new authorization URL
2. Authorize the app in a browser
3. The callback will store the new token
4. Verify with `npm run meli:smoke -- --seller source`

### Decryption Failed

Status: `blocked` with `reasonCodes: ["decryption_failed"]`. The stored token cannot be decrypted. Causes:

- `MSL_ENCRYPTION_KEY` was changed after tokens were stored
- Database file is corrupted

**Recovery:** Delete the OAuth database file and re-authorize. The database path is `MSL_MERCADOLIBRE_OAUTH_DB_PATH`.

### Network Error

Status: `degraded`. Transient. The health service retries on next check. For persistent network issues, verify:

- VPS has internet connectivity
- `api.mercadolibre.com` is reachable
- No firewall or proxy blocking outbound HTTPS

## Environment Loading

The shared `loadRepositoryEnvironment()` runs at startup for all scripts and processes:

1. Walks up from CWD to find the monorepo root (`package.json` with `workspaces`)
2. Loads `.env` then `.env.local` from the root
3. Never overwrites pre-existing `process.env` values (PM2, Docker, OS)
4. Set `MSL_SKIP_ENV_FILE=true` to skip file loading (CI/containers)
5. No symlink (`apps/web/.env.local`) is needed — loader resolves repo root automatically

## Limitations

- **Cross-process refresh advisory**: The mutex lock (`withLock`) is per-process only. Multiple PM2 processes running `meli:refresh` simultaneously may race. Coordinate refreshes to avoid concurrent refresh on the same seller.
- **No CI/CD**: The OAuth DB path and encryption key must be configured manually on the VPS.
- **Write operations**: Not implemented. All mutations are blocked by `assertMercadoLibreWriteDisabled()`.
- **Single-instance token store**: The same SQLite OAuth database is shared by all MSL processes. Ensure it's on durable storage and backed up.

## Next: P0 PR 4/4

- Real data ingestion → `EconomicCostComponent` / `UnitEconomics`
- Financial Truth integration
- Write capability implementation (gated by CEO approval)

## Related Documentation

- `docs/production-secrets-setup.md` — Secrets configuration
- `docs/vps-deployment.md` — VPS deployment guide
- `docs/operations/production-readiness-control-plane.md` — Production Readiness Control Plane (PR 1/4)
- `openspec/changes/mercadolibre-dual-account-production-connection/` — SDD artifacts
