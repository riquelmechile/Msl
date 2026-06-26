# Proposal: Dual-Account ML API + Product Sync

## Intent

Enable the agent to read Plasticov listings and publish transformed products to Maustian — two MercadoLibre accounts — through OAuth-authenticated API operations with a Product Sync Engine that applies CEO strategies programmatically.

## Scope

### In Scope
- Multi-account OAuth manager with encrypted SQLite token store and refresh rotation
- Extended `MlcApiClient` with write methods (POST/PUT /items), categories, users/me
- Real HTTP transport with exponential backoff
- Product Sync Engine: extract → apply strategies → diff → publish, with state tracking
- 6 MCP tools: `sync_products`, `publish_product`, `initiate_sync`, `get_sync_status`, `list_ml_categories`, `get_ml_account_info`
- Agent tool registration and strategy-aware sync routing
- Cortex sync state nodes for Hebbian learning

### Out of Scope
Real OAuth credentials (stub-testable), bulk publish optimization (Phase 8), Platinum KPI monitoring, Maustian account registration (user handles ML-side).

## Capabilities

### New Capabilities
- `ml-api-integration`: OAuth multi-account, ML API read/write client, real HTTP transport, Product Sync Engine, categories/users endpoints, sync MCP tools

### Modified Capabilities
- `conversational-business-agent`: ADDED — agent SHALL register and route to ML API sync tools for dual-account product operations

## Approach

**Domain-Driven, phased**: OAuth (internal module) → Write surface (extend MlcApiClient) → Sync Engine (new `packages/sync/`) → MCP tools → Agent wiring. Each phase independently testable.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/oauth/` | New | Token store, OAuth manager |
| `packages/mercadolibre/src/` | Modify | Transport, write methods, new endpoints |
| `packages/sync/` | New | Sync engine, strategy applier, diff, store |
| `packages/tools/` | Modify | 6 sync `CustomBusinessTool` instances |
| `packages/agent/` | Modify | Tool registration, sync routing |
| `packages/memory/` | Modify | Sync tables, Cortex node types |
| `packages/domain/` | Modify | SellerAccount extensions |

## Risks

| Risk | Mitigation |
|------|------------|
| Token leakage | libsodium encryption at rest |
| Cross-account publishing | sellerId validated per API call |
| ML rate limits | Exponential backoff |
| Margin miscalculation | Pure-function math + unit tests |

## Rollback Plan

Feature flag `ENABLE_ML_SYNC`. Disable via config; agent falls back to read-only mode. Sync tables are additive — safe to truncate.

## Dependencies

- User registers ML App for OAuth before `sdd-apply` (external)
- Existing `packages/mercadolibre/`, `packages/tools/`, `packages/agent/`, `packages/memory/`

## Success Criteria

- [ ] OAuth stores/refreshes tokens for two accounts independently
- [ ] `MlcApiClient` reads Plasticov and writes to Maustian via real HTTP
- [ ] `ProductSyncEngine.diff()` detects changed listings between runs
- [ ] CEO margin strategy produces correct Maustian pricing
- [ ] Agent invokes `sync_products` from conversation
- [ ] Dual-account routing never cross-publishes
