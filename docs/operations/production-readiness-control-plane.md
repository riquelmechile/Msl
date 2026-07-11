# Production Readiness Control Plane

> **Phase:** P0, PR 1/4
> **Date:** 2026-07-10
> **Status:** Implemented

## Purpose

A single, reliable system that answers: "Is MSL actually ready to start in production, with what capabilities, for which account, and what's blocking it?"

This module does NOT use real credentials, make HTTP calls, connect to MercadoLibre, or execute business mutations. It prepares, inspects, and validates the environment so subsequent PRs can connect real data safely.

## Capabilities Tracked

| Capability | Description |
|-----------|-------------|
| `deepseek-reasoning` | DeepSeek LLM inference |
| `telegram-ceo` | Telegram bot runtime |
| `mercadolibre-read-plasticov` | ML read access for Plasticov |
| `mercadolibre-read-maustian` | ML read access for Maustian |
| `mercadolibre-write-plasticov` | ML write access for Plasticov |
| `mercadolibre-write-maustian` | ML write access for Maustian |
| `operational-ingestion` | Background ingestion processors |
| `economic-truth` | Economic domain + persistence |
| `economic-learning` | Cortex economic reinforcement |
| `creative-studio` | MiniMax image/video generation |
| `supplier-mirror` | Supplier evidence + Jinpeng |
| `owned-ecommerce` | Medusa write boundary |
| `mcp-server` | MCP tool server |
| `web-chat` | Web chat console |
| `background-workers` | Background worker processes |
| `daemon-scheduler` | 15-minute daemon cycle scheduler |

## Architecture

```
ProductionReadinessService (orchestrator)
├── EnvironmentReadinessChecker — MSL_RUNTIME_MODE, paths
├── SellerAccountReadinessChecker — Plasticov vs Maustian
├── DatabaseReadinessChecker — SQLite paths, permissions, schema
├── ProviderReadinessChecker — DeepSeek, MiniMax, ML OAuth
├── RuntimeReadinessChecker — feature flags
├── FeatureGateReadinessChecker — env-gated features
└── SecurityReadinessChecker — encryption, secret exposure
```

## Readiness Statuses

| Status | Meaning |
|--------|---------|
| `ready` | Capability is fully configured and usable |
| `degraded` | Capability works partially (e.g., missing optional config) |
| `blocked` | Capability cannot operate (missing required config, security issue) |
| `not-applicable` | Capability is disabled by feature flag or not relevant |

## Seller Readiness

Plasticov and Maustian are evaluated independently:

- Each seller has separate OAuth binding checks
- Token binding validated per seller (no cross-binding)
- Encryption readiness checked per seller
- Read and write readiness flagged separately

## Configuration Inventory

A central typed matrix maps every `process.env` variable to:
- **Sensitivity** — public, conditional, secret, critical-secret
- **Capability** — which ProductionCapability it enables
- **Required condition** — when the variable is mandatory (e.g., MiniMax only if creative studio enabled)
- **Validation** — filled/missing/placeholder/malformed/next-public-exposed
- **Remediation** — human-readable fix instruction

## Fail-Closed Gate

`assertProductionCapabilityReady()` enforces that critical capabilities are not blocked:

- **Development/Test**: mocks preserved, gates are no-op
- **Production**: blocked critical capabilities prevent operation
- **Independent capabilities** (e.g., DeepSeek ready while ML blocked) can operate
- **Optional disabled capabilities** do not block the system

## CLI

```bash
npm run production:readiness        # Human-readable output
npm run production:readiness -- --json  # Machine-readable JSON
npm run production:readiness -- --strict  # Non-zero exit on degraded
```

Exit codes:
- `0` — ready or degraded (non-strict)
- `1` — blocked (and degraded with --strict)

## CEO Tool

`inspect_production_readiness` — read-only MCP tool:

- Full report or filtered by capability/seller
- Sanitized output (never exposes real secrets)
- `noExternalMutationExecuted: true`

## SQLite Readiness

Diagnostic checks for each SQLite database path:
- Path configured and parent directory exists
- File permissions (write test, delete test file)
- Schema initialization possible
- Expected tables present
- WAL mode when applicable
- Foreign keys enabled
- Busy timeout configured
- `:memory:` rejected in production
- Test paths rejected in production
- Cross-seller path sharing detected

## Secret Redaction

Central sanitizer redacts:
- API keys → `[present]`/`[missing]`
- Tokens → `[REDACTED:type]`
- Secrets → `[REDACTED]`
- Placeholders (test, example, changeme) → `[placeholder]`
- `NEXT_PUBLIC_*` secrets → flagged as exposed

Never outputs raw values. Never shows token lengths that could leak information.

## Limits

- **Zero HTTP**: no network calls
- **Zero mutations**: no data changes
- **Zero real credentials**: works with placeholders
- **Read-only**: purely diagnostic

## P0 PR Split

| PR | Scope | Status |
|----|-------|--------|
| 1/4 | Production Readiness Control Plane | ✅ Complete |
| 2/4 | Durable Runtime Operations (backups, migrations, observability) | Planned |
| 3/4 | MercadoLibre Dual-Account Production Connection (OAuth, tokens, smoke tests) | Planned |
| 4/4 | Real Ingestion & Economic Adapters (live data, UnitEconomics, fees) | Planned |

## Files

| File | Purpose |
|------|---------|
| `packages/domain/src/productionReadiness.ts` | Domain types and factories |
| `packages/agent/src/readiness/productionConfig.ts` | Configuration inventory matrix |
| `packages/agent/src/readiness/*Checker.ts` | 7 specialized readiness checkers |
| `packages/agent/src/readiness/ProductionReadinessService.ts` | Orchestrator |
| `packages/agent/src/readiness/runtimeGates.ts` | Fail-closed runtime gates |
| `packages/agent/src/readiness/cli.ts` | CLI entry point |
| `packages/agent/src/readiness/secretSanitizer.ts` | Central secret sanitizer |
| `packages/agent/src/conversation/tools/productionReadinessTools.ts` | CEO tool |
