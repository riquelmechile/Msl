# Account Isolation Policy — Plasticov and Maustian

## Architecture

Plasticov (source) and Maustian (target) are MercadoLibre Chile seller accounts operated as independent commercial channels. MSL treats them as separate strategic assets with independent credentials, configurations, and operational state.

## Isolation Guarantees

### 1. Separate OAuth Applications
- Plasticov: `MERCADOLIBRE_SOURCE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`
- Maustian: `MERCADOLIBRE_TARGET_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`
- Each app is registered independently in MercadoLibre's Developer Dashboard
- Tokens from one app cannot authenticate as the other

### 2. Encrypted Token Store Segregation
- Tokens are stored in a single SQLite database (`MSL_MERCADOLIBRE_OAUTH_DB_PATH`)
- Each seller's tokens are keyed by `sellerId` binding (the ML user ID)
- `getToken(sellerId)` returns tokens for that seller only
- Cross-seller token confusion is caught by `user_id` validation during API calls

### 3. Read-Only Guarantee
- Both accounts operate in read-only mode
- `assertMercadoLibreWriteDisabled()` blocks all write operations for both sellers
- Write capability is independently gated — when enabled in PR 4/4, it will be per-seller

### 4. Operational Read Model
- 8 entity kinds (listings, claims, questions, orders, messages, reputation, product-ads-insights, pricing)
- All operational snapshots are column-scoped by `seller_id`
- Queries are per-seller by construction

### 5. Cortex Neural Graph
- Memory nodes are scoped by `seller_id`
- Darwinian learning is per-seller (outcomes for Plasticov do not affect Maustian learning)
- Cross-account comparison is done at the CEO agent level via `AccountBrainService`

### 6. Configuration Isolation
- Account registry derives entries from env vars — never hardcoded
- `createMercadoLibreAccountRegistry()` validates distinct seller IDs
- Same seller ID for source and target disables both entries

### 7. Runtime Health
- Connection health is reported per-seller
- `inspectAll()` returns independent health snapshots
- One seller's degraded status does not block the other

## Cross-Account Operations

The only cross-account operation planned is `sync_product` (Plasticov → Maustian), which:
- Prepares a proposal with field diffs (read-only)
- Requires CEO approval to execute (not yet implemented)
- Validates direction (source → target, not reverse)
- Rejects arbitrary seller IDs

## Operational Notes

- Each seller needs its own OAuth authorization (`npm run meli:connect:url -- --seller source`)
- Smoke tests are run independently per seller
- Refresh is per-seller, per-process mutex locked
- Monitoring: structured log events include `sellerId` and `accountRole`
