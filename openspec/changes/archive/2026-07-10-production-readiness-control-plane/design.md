# Design: Production Readiness Control Plane

## Architecture

```
ProductionReadinessService
├── EnvironmentReadinessChecker — env vars, modes, sensitivity
├── SellerAccountReadinessChecker — Plasticov vs Maustian per account
├── DatabaseReadinessChecker — SQLite paths, permissions, schema, WAL
├── ProviderReadinessChecker — DeepSeek, MiniMax, ML OAuth
├── RuntimeReadinessChecker — feature flags, runtime mode
├── FeatureGateReadinessChecker — Creative Studio, Owned Ecommerce, Supplier Mirror
└── SecurityReadinessChecker — encryption key, secret exposure, redaction
```

## Key Types (in @msl/domain)

```typescript
// packages/domain/src/productionReadiness.ts

export type ReadinessStatus = "ready" | "degraded" | "blocked" | "not-applicable";
export type ReadinessSeverity = "info" | "warning" | "critical";

export type ProductionCapability =
  | "deepseek-reasoning" | "telegram-ceo"
  | "mercadolibre-read-plasticov" | "mercadolibre-read-maustian"
  | "mercadolibre-write-plasticov" | "mercadolibre-write-maustian"
  | "operational-ingestion" | "economic-truth" | "economic-learning"
  | "creative-studio" | "supplier-mirror" | "owned-ecommerce"
  | "mcp-server" | "web-chat" | "background-workers" | "daemon-scheduler";

export type ConfigSensitivity = "public" | "conditional" | "secret" | "critical-secret";

export type ConfigValidation = "filled" | "missing" | "placeholder" | "malformed" | "next-public-exposed";
```

## Configuration Inventory

Single typed matrix in `packages/agent/src/readiness/productionConfig.ts`.

## Seller Isolation

Each seller evaluated independently. Token bindings, encryption readiness checked per-seller. Cross-binding rejected.

## Fail-Closed Gate

`assertProductionCapabilityReady()` — in dev/test preserves mocks. In production, blocks capabilities in `blocked` status for critical capabilities.

## Secret Redaction

Central sanitizer that replaces: API keys → `[present]`/`[missing]`, tokens → `[REDACTED:type]`, secrets → `[REDACTED]`.
