# Proposal: Production Readiness Control Plane

> **Phase:** P0, PR 1/4 (Production Readiness)
> **Date:** 2026-07-10
> **Status:** Implemented

## Intent

Build a single, reliable system that answers:
"Is MSL actually ready to start in production, with what capabilities, for which account, and what's blocking it?"

This PR does NOT use real credentials, make HTTP calls, connect to MercadoLibre, or execute business mutations. It prepares, inspects, and validates the environment so subsequent PRs can connect real data safely.

## Problem

MSL has 15 daemon handlers, 16 lane contracts, ~40 MCP tools, and a DeepSeek integration. But there's no way to ask: "Can Plasticov connect to MercadoLibre? Is DeepSeek working? Why isn't this worker starting?" The environment validation is scattered across individual files with no central inventory, no fail-closed gates, and no readiness report.

## Scope

- Domain types for ProductionReadiness
- Central configuration inventory matrix
- Per-seller readiness assessment (Plasticov vs Maustian)
- SQLite readiness checks
- Fail-closed runtime gates
- CLI: `npm run production:readiness`
- CEO read-only tool: `inspect_production_readiness`
- Secret sanitization
- Zero HTTP, zero business mutations, zero real credentials

## Out of Scope

- Real credentials, OAuth HTTP, ML API calls
- Real ingestion, backups, deploys
- PR 2-4 of P0

## Acceptance Criteria

1. Readiness model is typed
2. Configuration inventory covers all env vars
3. Plasticov/Maustian evaluated independently
4. No secrets in output
5. ProductionReadinessService exists with sub-checkers
6. SQLite readiness diagnostic works
7. Fail-closed gates block in production
8. CLI exists with --json and --strict
9. CEO tool exists, read-only
10. All tests pass, no lint errors
