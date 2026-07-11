# Proposal: MercadoLibre Dual-Account Production Connection (P0 PR 3/4)

## Intent

Plasticov and Maustian OAuth tokens work locally, but every script reimplements its own env loader, Next.js needs a symlink workaround, and there is zero connection observability — no refresh monitoring, no smoke testing, no guard against silent token expiry. This PR brings dual-account OAuth into production-grade health, hardening, and observability.

## Scope

### In Scope
- Shared `loadRepositoryEnvironment()` from any cwd, removing `apps/web/.env.local` symlink
- Canonical ML account registry (source=Plasticov, target=Maustian)
- `MercadoLibreConnectionStatus` and `OAuthTokenStatus` models
- `MercadoLibreConnectionHealthService`: inspect, refresh (with `invalid_grant` classification), smoke
- Read-only smoke test service (no ML mutations)
- CLI: `meli:connection:status`, `meli:refresh`, `meli:smoke`
- ProductionReadinessService + RuntimeHealth integration for live seller health
- CEO read-only tools (`inspect_mercadolibre_connections`, etc.)
- Env-loading consolidation across ingest, workers, bot, MCP, and web

### Out of Scope
- Write operations (publish, stock, price, ads, questions, sync)
- EconomicCostComponent / UnitEconomics conversion
- Any ML mutations; PR 4/4

## Capabilities

### New Capabilities
- `production-connection-health`: OAuth monitoring, smoke tests, reauthorization
- `shared-environment-loading`: Single env loader for all monorepo processes

### Modified Capabilities
- `dual-account-oauth`: Add `invalid_grant` → `reauthorization-required` error states
- `mercadolibre-account-integration`: Add `MercadoLibreConnectionStatus` model
- `runtime-env-validator`: Live token validity in startup checks
- `operational-health`: ML connection health in health cycle

## Approach

Create `packages/mercadolibre/src/connection/` (health service, state model, registry). Wire into `MultiAppOAuthManager`, `TokenStore`, `ProductionReadinessService`, and `RuntimeHealth`. CLI wraps the service. All scripts unified under shared env loader.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/connection/` | New | Health service, state model, registry |
| `packages/mercadolibre/src/oauth/` | Modified | Refresh error classification |
| `packages/mercadolibre/src/env.ts` | New | Shared env loader |
| `packages/domain/src/{production-readiness,health}/` | Modified | Live seller + connection health |
| `packages/{bot,mcp,workers}/src/`, `apps/web/`, `scripts/` | Modified | Env loading consolidation; symlink removal |
| `package.json` | Modified | CLI scripts |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cross-process refresh races | Medium | Advisory `withLock(sellerId)`; single-refresher pattern |
| Symlink removal breaks Next.js dev | Low | Test loader from `apps/web` cwd first |
| `invalid_grant` false positives | Low | Classify only explicit API response; network errors retry |

## Rollback Plan

Revert commit; restore symlink. No schema migration needed.

## Dependencies

- PR 2/4 (durable-runtime-operations) archived at `7af1ae1`
- `MSL_ENCRYPTION_KEY` in `.env.local`; both seller tokens in SQLite

## Success Criteria

- [ ] `meli:connection:status` returns health for both sellers
- [ ] `meli:refresh` triggers `onTokenRefresh` metrics
- [ ] `meli:smoke` completes read-only validation, zero mutations
- [ ] `npm run dev` from `apps/web` works without symlink
- [ ] All scripts use shared env loader
- [ ] CEO tools return per-seller connection status
