# Proposal: Real Ingestion Economic Adapters

## Intent

ML ingestion produces aggregated logs — no structured economic evidence reaches the domain. Finance Director has `EconomicOutcomeStore` but no live pipeline. Build honest, read-only adapters transforming ML data into `EconomicCostComponent`, `UnitEconomicsSnapshot`, and consumable evidence. Core: revenue≠profit, missing≠zero, sale≠causation.

## Scope

### In Scope
- `EconomicCostComponent` CRUD methods in `EconomicOutcomeStore` (table exists, queries missing)
- ML→Economic adapters: orders→listing prices/fees, claims→return/refund costs, ads→advertising, promotions→discount components, shipping→shipping costs
- `EconomicIngestionDaemon`: fetch recent orders, resolve economic data per order, create cost components, compute `UnitEconomicsSnapshot`, track `missingInputs`
- Seller isolation (Plasticov ≠ Maustian) at every layer

### Out of Scope
- `EconomicOutcome` for organic sales (only attributable actions); product cost/landed cost (Supplier Mirror needed, infra ready)
- FX rates; GET /orders/{id} detail endpoint; any ML mutation

## Capabilities

### New Capabilities
- `economic-cost-component-store`: SQLite CRUD for `EconomicCostComponent` — insert, list-by-seller, deduplicate
- `ml-economic-adapters`: Pure mappers: ML data → `EconomicCostComponent[]` with source attribution (`mercadolibre` for fees/shipping/claims/ads)
- `economic-ingestion-pipeline`: Daemon: orders→adapters→costs→snapshot→persist; reports `missingInputs` honestly

### Modified Capabilities
- `finance-director-assessment-store`: Add cost component queries for live evidence consumption
- `finance-director-tools`: Contracts receive real data through EconomicOutcomeStore

## Approach

Pipeline: Daemon → `getOrders()` → per-order fanout (listing prices, claims, ads, promotions, shipping) → adapters → cost components → `computeUnitEconomics()` → persist. Pure mapper functions: seller-scoped, PII-stripped, `missingInputs` enumerated — never silent zeros.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/memory/` | Modified | Cost component CRUD + queries |
| `packages/agent/src/workers/` | New | `economicIngestionDaemon.ts` |
| `packages/domain/` | Unchanged | `computeUnitEconomics()` already accepts cost components |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| ML rate limits on per-order fanout | Med | Batch + stagger; checkpoint pagination |
| Cross-seller data leak | Low | Seller scope at every adapter + query |
| Ghost data (product_cost=0 treated as real) | Med | Explicit `missingInputs` enum per snapshot |

## Rollback Plan

Daemon stop = data freeze. Cost component table has no FK cascade — safe truncation. Revert commit if needed.

## Dependencies

- `MlcApiClient` (~40 read endpoints, existing) | `EconomicOutcomeStore` | `computeUnitEconomics()` | Dual-account OAuth

## Success Criteria

- [ ] Cost component CRUD with dedup by source record; adapters map ML data→correct cost types in minor units
- [ ] `missingInputs` enumerates absent cost types per snapshot — never silently zero
- [ ] Finance Director tools return real revenue, known costs, and explicit gaps via live evidence
- [ ] Seller isolation (Plasticov≠Maustian), no PII stored, no ML mutation, currency consistency
- [ ] Integration test: ML mock→adapters→snapshot→store query end-to-end; graceful degradation on API errors
