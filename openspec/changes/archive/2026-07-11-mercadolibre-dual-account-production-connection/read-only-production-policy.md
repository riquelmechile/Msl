# Read-Only Production Policy — MercadoLibre Dual-Account Connection

## Policy

The MercadoLibre dual-account connection operates in **read-only production** mode. All ML API reads are enabled with real OAuth tokens. All ML API writes are explicitly blocked.

## What Is Enabled (Read)

| Operation | Endpoint | Status |
|-----------|----------|--------|
| Get orders | `GET /orders/search` | ✅ Enabled |
| Get items | `GET /items?ids=...` | ✅ Enabled |
| Get listings | `GET /users/{id}/items/search` | ✅ Enabled |
| Get identity | `GET /users/{id}` | ✅ Enabled |
| Get reputation | ML reputation endpoints | ✅ Enabled |
| Get messages | ML messaging endpoints | ✅ Enabled |
| Get claims | `GET /post-purchase/v1/claims/search` | ✅ Enabled |
| Get listing prices | ML pricing endpoints | ✅ Enabled |
| Get category attributes | ML category endpoints | ✅ Enabled |
| Get product ads insights | Product Ads read endpoints | ✅ Enabled |

## What Is Blocked (Write)

| Operation | Gate | Error |
|-----------|------|-------|
| Publish item | `assertMercadoLibreWriteDisabled()` | `MercadoLibreWriteBlockedError` |
| Update item | `assertMercadoLibreWriteDisabled()` | `MercadoLibreWriteBlockedError` |
| Change stock | `assertMercadoLibreWriteDisabled()` | `MercadoLibreWriteBlockedError` |
| Change price | `assertMercadoLibreWriteDisabled()` | `MercadoLibreWriteBlockedError` |
| Product Ads mutations | `assertMercadoLibreWriteDisabled()` | `MercadoLibreWriteBlockedError` |
| Answer questions | `assertMercadoLibreWriteDisabled()` | `MercadoLibreWriteBlockedError` |
| Send messages | `assertMercadoLibreWriteDisabled()` | `MercadoLibreWriteBlockedError` |
| Claims actions | `assertMercadoLibreWriteDisabled()` | `MercadoLibreWriteBlockedError` |
| Cancellations | `assertMercadoLibreWriteDisabled()` | `MercadoLibreWriteBlockedError` |
| Refunds | `assertMercadoLibreWriteDisabled()` | `MercadoLibreWriteBlockedError` |

## Gate Implementation

```typescript
// packages/agent/src/readiness/runtimeGates.ts
export function assertMercadoLibreWriteDisabled(): void {
  throw new MercadoLibreWriteBlockedError(
    "MercadoLibre write operations are not yet implemented. " +
    "Read capability is operational. Write requires P0 PR 4/4."
  );
}
```

The gate is called at every write entry point in the agent, MCP, and worker packages.

## Verification

- Health service `noExternalMutationExecuted: true` on all responses
- CEO MCP tools: all descriptions contain "read-only" and "zero mutations"
- `inspect_mercadolibre_connections`: `writeReady: false` for all sellers
- Production readiness check: `mercadolibre-write-plasticov` and `mercadolibre-write-maustian` report `blocked`

## Future: Write Enablement (P0 PR 4/4)

When write operations are implemented:
1. Gate will be replaced with per-seller write capability check
2. CEO approval ("dale") required for each write
3. Audit trail recorded for every mutation
4. Cortex learning will use real outcomes for Darwinian reinforcement
5. Write will be independently gated per-seller
