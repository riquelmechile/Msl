# Proposal: Dual-Account OAuth Apps

## Intent

`OAuthManager` uses a single `{clientId, clientSecret, redirectUri}` for ALL sellers. Plasticov and Maustian each have their own MercadoLibre OAuth app with distinct credentials (client IDs 797032636435817 / 1064904318495302). The system must route each seller to its own OAuth app.

## Scope

### In Scope
- `MultiAppOAuthManager` wrapper routing sellers to per-app `OAuthManager` instances
- Per-seller env var hierarchy: `MERCADOLIBRE_{SOURCE,TARGET}_CLIENT_ID/SECRET/REDIRECT_URI` takes priority; legacy `MERCADOLIBRE_CLIENT_ID/...` as fallback
- Next.js API routes: `/api/meli/connect?role=source|target` and callbacks (`/api/meli/callback`, `/callback`)
- HMAC state signing with `MSL_OAUTH_STATE_SECRET`
- `runtimeDependencies.ts` wired to `MultiAppOAuthManager`

### Out of Scope
- PKCE, multi-site (non-MLC), account switching UX, session auth, `TokenStore` changes

## Capabilities

### New Capabilities
- `dual-account-oauth`: Per-seller OAuth app routing, callback handling, HMAC state protection

### Modified Capabilities
- `mercadolibre-account-integration`: Seller-specific app selection replaces single-app assumption
- `ml-api-integration`: Token ops resolve per-seller OAuth apps, not a shared app

## Approach

`MultiAppOAuthManager` maps seller IDs to per-app `OAuthManager` instances. `getAuthorizationUrl`, `exchangeCodeForToken`, and `refreshAccessToken` delegate to the correct instance. Existing `TokenStore` (single DB, per-seller rows) is reused. Env hierarchy: per-seller vars → legacy fallback → explicit `PLASTICOV_SELLER_ID`/`MAUSTIAN_SELLER_ID` mapping.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/oauth/` | New | `MultiAppOAuthManager` |
| `packages/mcp/src/runtimeDependencies.ts` | Modified | Wire per-seller env vars |
| `apps/web/src/app/api/meli/` | New | Connect + callback routes |
| `packages/mercadolibre/src/accountRoles.ts` | Modified | Accept per-seller OAuth config |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Wrong app credentials per seller | Low | Config-driven mapping; mismatch fails on refresh with clear error |
| Single-app backward compat break | Low | Legacy env vars remain fallback; single-app path tested |
| State forgery across redirect URIs | Medium | HMAC signing with `MSL_OAUTH_STATE_SECRET` per callback |

## Rollback Plan

1. Revert `runtimeDependencies.ts` to single `OAuthManager`
2. Remove `apps/web/src/app/api/meli/` routes
3. Existing tokens in SQLite remain valid — no DB migration needed

## Dependencies

- `MSL_ENCRYPTION_KEY` (already in use); new: `MSL_OAUTH_STATE_SECRET` for HMAC state signing

## Success Criteria

- [ ] Plasticov seller uses Plasticov OAuth app (client ID 797032636435817) for auth and refresh
- [ ] Maustian seller uses Maustian OAuth app (client ID 1064904318495302) for auth and refresh
- [ ] Both tokens coexist in `oauth_tokens` table (two rows, one per seller)
- [ ] Single-app config (legacy env vars) continues to work for both sellers
- [ ] `/api/meli/connect?role=source` redirects to MercadoLibre with Plasticov app
- [ ] OAuth callback validates HMAC state, stores token for correct seller
- [ ] Tests pass: multi-app routing, env fallback, callback flows
