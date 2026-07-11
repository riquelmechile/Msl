# Smoke Test Plan — MercadoLibre Dual-Account Connection

## Purpose

Smoke tests verify that the MercadoLibre read-only connection is working correctly for each seller account without performing any mutations.

## Test Scenarios

### S1: Identity Verification
- **Endpoint**: `GET /users/{sellerId}`
- **Expected**: Response contains `id` matching the expected seller ID
- **Failure mode**: `seller_mismatch` — returned user ID does not match expected
- **Manual command**: `npm run meli:smoke -- --seller source`

### S2: Orders Access
- **Endpoint**: `GET /orders/search` with `seller={id}`, `limit=3`
- **Expected**: Returns order list (may be empty if no recent orders)
- **Failure mode**: HTTP error (401 = bad token, 403 = wrong scope, 429 = rate limited)

### S3: Items Access
- **Endpoint**: `GET /users/{sellerId}/items/search` with small limit
- **Expected**: Returns item list
- **Failure mode**: Same as orders

## Manual Execution

```bash
# Smoke test Plasticov
npm run meli:smoke -- --seller source
npm run meli:smoke -- --seller source --json  # Structured output

# Smoke test Maustian
npm run meli:smoke -- --seller target
```

## CEO MCP Tool

The `run_mercadolibre_read_smoke` MCP tool provides the same smoke test via the MCP protocol. Tool description includes: "DO NOT run automatically — only when explicitly requested by the CEO."

## Automated Health Checks

The connection health service's `smoke-read` mode runs:
1. `refreshIfNeeded()` — ensures valid token
2. `runIdentitySmoke()` — identity check
3. `runOrdersSmoke()` — orders endpoint check
4. `runItemsSmoke()` — items endpoint check

Results are aggregated: all must pass for `ready` status.

## Failure Response

| Failure | Health Status | Action |
|---------|--------------|--------|
| Identity mismatch | `blocked` | Verify seller ID env var, re-authorize |
| Token expired | `degraded` | Run `meli:refresh` |
| Refresh rejected | `reauthorization-required` | Re-authorize via `meli:connect:url` |
| Network error | `degraded` | Check connectivity, retry |
| Rate limited (429) | `degraded` | Wait, reduce frequency |
| Orders/item access denied | `degraded` | Verify OAuth scopes, re-authorize |

## Schedule

- Smoke tests are **on-demand only** — no automated schedule
- After OAuth authorization or token refresh, run smoke to verify
- Before enabling any new capability, run smoke for both sellers
