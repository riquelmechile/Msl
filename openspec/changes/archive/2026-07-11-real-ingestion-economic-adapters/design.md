# Design: Real Ingestion Economic Adapters

## Technical Approach

Six-layer read-only pipeline: ML API → normalization → pure adapters → calculation → persistence → consumption. No mutations to ML. No new packages. Feature-gated via `MSL_ECONOMIC_INGESTION_ENABLED`.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Adapters as classes with DI | Testable via injection but requires scaffolding | Pure functions `(NormalizedCommerceTransaction, context) → EconomicCostComponent[]` — zero side effects, trivial testing |
| Normalize inline in each adapter | Less types but duplicated parsing | Dedicated `NormalizedCommerceTransaction` — single source of truth, PII-stripped once |
| Hash full ML payload for provenance | Auditable but bloats storage | SHA-256 of selected economic fields only — `EconomicEvidenceReference` stores hash, not raw payload |
| All adapters in one file | Simple but hard to evolve | One file per adapter in `agent/src/economics/adapters/` — isolated, testable, stub-ready |
| Write cost components per adapter call | Simpler but breaks idempotency | Bulk insert per order via `EconomicIngestionPipeline`, idempotency key on `sellerId + sourceSystem + sourceEntityType + sourceRecordId + economicMeaning + sourceVersion` |

## Data Flow

```
MlcApiClient                 normalization.ts                Adapters (pure fns)
  getOrders() ──→ MlOrder[] ──→ NormalizedCommerceTransaction[] ──→ EconomicCostComponent[]
  getItem()    ──→ MlItem    ──┘                                          │
  getItemPrices() ─┘                                              ┌───────┘
  getClaimReturnCost() ──────────────────────────────────────────┘
  getProductAdsInsights() ───────────────────────────────────────┘
                                            │
                    EconomicIngestionPipeline ◄── computeUnitEconomics()
                            │                           │
                    EconomicOutcomeStore          UnitEconomicsSnapshot
                   (cost components, snapshots)
```

## Adapter-to-API Mapping

| Adapter | ML Endpoint | Field(s) Used | Cost Type |
|---------|------------|---------------|-----------|
| OrderRevenue | `getOrders` → order total, `getItem` → listing price | `total_amount`, `price` | Derives `grossRevenue` (not a cost component — feeds snapshot input) |
| MarketplaceFee | `getListingPrices(siteId, price, categoryId)` → `sale_fee_amount` | `sale_fee_amount` in minor units | `marketplace_fee` |
| ShippingCost | `getOrders` → shipment IDs, `getShipmentStatus` | Shipping cost from order | `shipping` |
| SellerDiscount | `getItemPromotions` → `seller_percentage` | Price reduction funded by seller | `seller_discount` |
| RefundReturn | `getClaimReturnCost` → `total_cost` | Sum of charges in minor units | `refund` / `return` |
| AdvertisingCost | `getProductAdsInsights` → `cost` metric per campaign | Aggregated ad spend | `advertising` |
| ProductCost | Stub (Supplier Mirror needed) | N/A | `product_cost` — empty + missing declaration |
| LandedCost | Stub (customs data needed) | N/A | `landed_cost` — empty + missing declaration |
| Packaging | Stub | N/A | `packaging` — empty + missing declaration |
| Financing | Stub | N/A | `financing` — empty + missing declaration |
| Tax | Stub | N/A | `tax` — empty + missing declaration |

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/domain/src/normalizedCommerceTransaction.ts` | Create | Internal type: line-item commerce record, PII-stripped, Money-typed |
| `packages/domain/src/economicEvidenceReference.ts` | Create | Provenance chain: evidenceId, sourceSystem, checksum, confidence |
| `packages/domain/src/economicIngestionRun.ts` | Create | Run tracking: runId, sellerId, startedAt, status, checkpoint |
| `packages/domain/src/economicDataCoverage.ts` | Create | Coverage report type per seller across cost categories |
| `packages/domain/src/index.ts` | Modify | Export new types |
| `packages/memory/src/economicOutcomeStore.ts` | Modify | Add `insertCostComponent`, `listCostComponents`, `listBySourceRecord`, `reverseCostComponent`, `upsertCostComponent` |
| `packages/agent/src/economics/normalization.ts` | Create | ML order → `NormalizedCommerceTransaction[]` (one per line item) |
| `packages/agent/src/economics/adapters/*.ts` | Create | 11 pure adapter functions (5 real, 6 stubs) |
| `packages/agent/src/economics/EconomicIngestionPipeline.ts` | Create | Orchestrates Layer A→E for a seller |
| `packages/agent/src/economics/EconomicReconciliationService.ts` | Create | Source total vs computed total comparison |
| `packages/agent/src/economics/EconomicIngestionRun.ts` | Create | Run-level state machine (pending → fetching → normalizing → adapting → computing → persisting → completed) |
| `packages/agent/src/workers/economicIngestionDaemon.ts` | Create | New daemon: checkpoint-based, seller-scoped, feature-gated |
| `packages/agent/src/conversation/tools/economicTools.ts` | Modify | Add `inspect_cost_components`, `inspect_evidence_references`, `inspect_coverage` tools |
| `packages/agent/src/readiness/productionConfig.ts` | Modify | Add `MSL_ECONOMIC_INGESTION_ENABLED` env var |
| `packages/domain/src/productionReadiness.ts` | Modify | Add `real-economic-ingestion` to `ProductionCapability` union |

## EconomicOutcomeStore Changes

Extend the store interface with cost component methods matching the spec requirements:
- `insertCostComponent()` — validates idempotency key, inserts or no-ops
- `upsertCostComponent()` — supersedes prior version, inserts new
- `listCostComponents()` — seller-scoped, excludes reversed by default
- `listBySourceRecord()` — all components for a source entity
- `reverseCostComponent()` — audited soft-delete with `reversedAt` + `reversedReason`

The `economic_cost_components` table already exists (L212-226 of store). New SQLite migration adds `source_version`, `economic_meaning`, `superseded_at`, `reversed_at`, `reversed_reason` columns and a composite unique index.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Each adapter with ML mock data | Pure functions — given input, assert `EconomicCostComponent[]` output |
| Unit | `normalization.ts` → `NormalizedCommerceTransaction` | Multi-item orders, PII stripping, edge cases from spec |
| Unit | Cost component CRUD | SQLite in-memory, idempotency, supersede, reverse |
| Unit | `EconomicReconciliationService` | Balanced vs mismatched verdicts |
| Integration | Pipeline end-to-end | Mock `MlcApiClient` → pipeline → store query. Verify snapshot + cost components |
| Integration | Feature gate disabled | Daemon no-ops when `MSL_ECONOMIC_INGESTION_ENABLED=false` |
| E2E | CLI commands | `npm run economic:ingest -- --seller X --dry-run` produces valid JSON output |

## Migration / Rollout

No data migration — `economic_cost_components` table is new, `unit_economics_snapshots` already exists. Feature-gated: daemon does nothing unless `MSL_ECONOMIC_INGESTION_ENABLED=true`. Rollback: set env var to `false`, daemon freezes. No FK cascades.

## Open Questions

- Should stub adapters declare `missing` as a `MissingCostLabel` or emit a separate `MissingInputDeclaration` type? Leaning toward `MissingInputDeclaration` for granularity.
- Should the daemon use the existing `OperationalReadModel` checkpoint pattern or a new `economic_ingestion_checkpoints` table? Existing pattern preferred for consistency.

## CLI

```
npm run economic:ingest -- --seller source [--dry-run] [--max-pages N]
npm run economic:status -- --seller
npm run economic:coverage -- --seller
npm run economic:reconcile -- --seller
npm run economic:missing -- --seller
```
JSON output via `--json` flag.
