# Archive Report: MercadoLibre Dual-Account Production Connection

**Change**: mercadolibre-dual-account-production-connection
**Status**: Archived / Implemented
**Date**: 2026-07-11
**Baseline SHA**: 7af1ae1 (P0 PR 2/4 — Durable Runtime Operations)

## What Was Delivered

P0 PR 3/4 — MercadoLibre Dual-Account Production Connection. Converted the locally-verified dual OAuth connection into a production-grade, observable, secure runtime capability.

### Core Deliverables

1. **Shared environment loader** (`packages/mercadolibre/src/env.ts`) — deterministic repo-root detection, `.env` + `.env.local` loading with clear precedence, CI skip mode, works from any cwd. Removed the `apps/web/.env.local` symlink requirement.

2. **Account registry** (`packages/mercadolibre/src/connection/registry.ts`) — canonical typed registry for Plasticov (source) and Maustian (target) with cross-binding validation, operational scopes, and connection policies.

3. **Connection health service** (`packages/mercadolibre/src/connection/healthService.ts`) — 4-mode health inspection (inspect-only, refresh-if-needed, smoke-read, no-network) with per-seller status, token evaluation, identity verification, and error classification.

4. **Read-only smoke service** (`packages/mercadolibre/src/connection/smokeService.ts`) — bounded API verification (identity, orders, items) with PII sanitization, graceful error handling, and no-network support.

5. **Safe auto-refresh** — enhanced `OAuthManager` with `MercadoLibreRefreshError` classification (invalid_grant, network_error, rate_limited, etc.), clock injection, and `onTokenRefresh` → metrics wiring.

6. **Production readiness integration** — live token validation in `SellerAccountReadinessChecker`, `assertMercadoLibreWriteDisabled()` fail-closed gate, read/write capability separation.

7. **Observability** — `onTokenRefresh` wired to structured logger and metrics collector. ML connection health events (`meli-refresh-succeeded`, `meli-identity-verified`, etc.) with sanitized metadata.

8. **CLI commands** — `meli:connection:status`, `meli:refresh`, `meli:smoke`, `meli:connect:url` with JSON output and seller resolution (source/target → actual IDs).

9. **CEO tools** — `inspect_mercadolibre_connections`, `inspect_mercadolibre_account_health`, `run_mercadolibre_read_smoke` in MCP server.

10. **Documentation** — operational guide, threat model, secrets policy, OAuth lifecycle, account isolation policy, read-only production policy, smoke test plan, recovery runbook.

### What Was NOT Delivered (PR 4/4 scope)

- Write operations (publish, update, stock, price, ads, questions, messages)
- Economic data conversion (EconomicCostComponent, UnitEconomics)
- Financial Truth integration with real ML data
- Landed cost and cash flow calculations
- CI/CD pipeline (no `.github/workflows/` created)

## Architecture Decisions

- **No dotenv dependency** — manual K=V parser using Node.js built-ins only
- **Feature-branch-chain strategy** for chained PRs (advisory)
- **Seller isolation by design** — separate OAuth configs, separate token rows, separate health
- **Write blocked at gate level** — `assertMercadoLibreWriteDisabled()` throws for any mutation
- **Read-only production by default** — write readiness requires explicit P0 PR 4/4 approval

## Post-Archive State

- `openspec/changes/mercadolibre-dual-account-production-connection/` → archived at `openspec/changes/archive/2026-07-11-mercadolibre-dual-account-production-connection/`
- Code in main branch at HEAD
- Both Plasticov and Maustian: read-ready, write-blocked, production-healthy

## Next Steps

P0 PR 4/4 — Real Ingestion & Economic Adapters:
- Transform real order/item data into EconomicCostComponent and UnitEconomics
- Wire Financial Truth with production data
- Landed cost and cash flow from real transactions
