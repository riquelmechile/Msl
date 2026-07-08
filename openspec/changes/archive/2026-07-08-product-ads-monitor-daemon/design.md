# Design: Product Ads Monitor Daemon

## Technical Approach

New daemon `productAdsMonitorDaemon.ts` following the exact `DaemonHandler` signature pattern of the 4 existing daemons. Reads `product-ads-insights` ORM snapshots via `searchSnapshots()`, cross-references Cortex `cost_snapshot`/`visit_snapshot` and ORM `listing_snapshot` for cross-account checks, applies 5 signal-detection rules, and enqueues grouped CEO proposals with hourly dedupe keys. No ML write APIs called — `noMutationExecuted: true` everywhere.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|-----------|
| Data source for Product Ads | ORM `searchSnapshots({kind: "product-ads-insights"})` only | Cortex fallback | Spec explicitly says "no Cortex fallback yet"; Cortex lacks product-ads nodes |
| Cost data | `cortex.queryByMetadata({type: "cost_snapshot"})` — same pattern as `costSupplierDaemon` | ORM cost_snapshot | Cost data lives in Cortex across all daemons; consistent |
| Visit trend engine | `cortex.queryByMetadata({type: "visit_snapshot", after, before})` with week-bucket grouping | Pre-aggregated visit metrics | Cortex supports `after`/`before` date filters natively; no new infrastructure |
| Monopoly check | `searchSnapshots({kind: "listing_snapshot"})` across ALL `sellerIds` + one broader seller scan | Only Plasticov + Maustian | Proposal's mitigation table calls out false-positive risk if we don't check beyond owned sellers |
| Per-product ROAS | `ad.metrics.revenue / ad.metrics.investment` direct computation | Campaign-level ROAS | Spec: "per-product ROAS from ads[] metrics"; `MlcProductAdsEntitySummary.metrics` is `Record<string, number>` |

## Data Flow

```
searchSnapshots("product-ads-insights") ──→ campaigns[] + ads[]
                                                  │
                                     ┌────────────┼────────────┐
                                     ▼            ▼            ▼
                              cost_snapshot  visit_snapshot  listing_snapshot
                              (Cortex)       (Cortex, WoW)   (ORM, cross-seller)
                                     │            │            │
                                     ▼            ▼            ▼
                              profitability  visit trend   monopoly check
                                     │            │            │
                                     └────────────┴─────┬──────┘
                                                        │  + ROAS (from ads metrics)
                                                        │  + opportunity (campaign ROAS gap)
                                                        ▼
                                              findings[] grouped by severity
                                                        │
                                                        ▼
                                              bus.enqueue() × per severity
                                              dedupeKey: product-ads-{severity}-{hour}
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/workers/productAdsMonitorDaemon.ts` | Create | Daemon handler: read → detect 5 signals → enqueue per tier |
| `packages/agent/src/conversation/lanes.ts` | Modify | Add `"product-ads-monitor"` to `LaneId` union; add `PRODUCT_ADS_MONITOR_LANE` contract + `LANE_CONTRACTS` entry |
| `packages/agent/src/conversation/companyAgents.ts` | Modify | Add `"product-ads-monitor": "commercial"` to `laneDepartments` |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Import + register in `daemonHandlerMap` |
| `packages/agent/src/index.ts` | Modify | Export `productAdsMonitorDaemon` |

No new PM2 process — single map entry in the existing `daemonHandlerMap`.

## Signal Detection Algorithm

### Profitability (critical)
For each `ad` with `itemId`, match against `costMap` (built from Cortex `cost_snapshot`): `price - cost < 0`. Cost unknown → skip. Price sourced from ad's context or from listing_snapshot fallback.

### Visit Decline (warning)
For each advertised `itemId`, query Cortex `visit_snapshot` for the last 3 weeks (after/before date windows). Bucket by ISO week number. Compute WoW % for last 2 consecutive weeks. Signal fires iff BOTH weeks show 30%+ decline AND ad is active.

### Monopoly (info)
For each ad `itemId`, call `searchSnapshots({kind: "listing_snapshot", itemId})` with a broad seller filter. If `itemId` appears ONLY on `sellerIds` (owned accounts), signal fires. Any external seller → suppressed.

### Per-product ROAS (warning)
From ad `metrics` map: `(metrics["revenue"] ?? 0) / (metrics["investment"] ?? 0)`. Skip if investment is 0 or undefined. Signal on ROAS < 1.0.

### Profitable No-Ad Gap (opportunity)
For each campaign where ROAS > 3.0 and the campaign has profitable products (price - cost > 0) NOT present in `ads[]`, signal fires.

## Dedupe Key Design

```typescript
// Hourly dedupe — same hour suppresses, next hour fires new
dedupeKey: `product-ads-${severityGroup}-${capturedAt.slice(0, 13)}`
// severityGroup: "critical" | "warning" | "info" | "opportunity"
```

One enqueue per non-empty severity group. Same pattern as `marketCatalogDaemon` L304-341.

## Error Handling & Graceful Degradation

| Failure | Behavior |
|---------|----------|
| `searchSnapshots("product-ads-insights")` returns empty | `findings = []`, `proposalEnqueued = false` — no error |
| Cortex `cost_snapshot` empty | Profitability + opportunity checks skip; ROAS + visit + monopoly still run |
| Cortex `visit_snapshot` empty | Visit decline check skipped; other signals unaffected |
| `searchSnapshots("listing_snapshot")` fails for cross-seller | Monopoly check skipped; no false-positive |
| `ad.metrics` undefined or `investment=0` | ROAS check skipped per product |

Every check is an independent try/catch — single failure never blocks others.

## Lane Registration

### Lanes.ts additions
- `"product-ads-monitor"` appended to `LaneId` union
- `PRODUCT_ADS_MONITOR_LANE: LaneContract` with: label "Product Ads Monitor", stablePrefix with phase-one boundary, inputs `["product-ads-insights", "cost-snapshot", "visit-snapshot", "listing-snapshot"]`, departmentId `"commercial"`.
- Appended to `LANE_CONTRACTS` array after `OWNED_ECOMMERCE_LANE`.

### CompanyAgents.ts
- `laneDepartments` entry: `"product-ads-monitor": "commercial"` — same department as `creative-commercial` and `owned-ecommerce`.

### DaemonScheduler.ts
- Import `productAdsMonitorDaemon`
- `daemonHandlerMap` entry: `"product-ads-monitor": productAdsMonitorDaemon`

### Index.ts
- Export `productAdsMonitorDaemon` after the existing daemon exports.

## Test Design

Follow `marketCatalogDaemon.test.ts` pattern (in `packages/agent/tests/workers/`):
- `beforeEach`: `new Database(":memory:")` + `createAgentMessageBusStore` + `createGraphEngine(":memory:")`
- Mock ORM via `createSqliteOperationalReadModel(db)` — seed product-ads snapshots directly
- Seed Cortex nodes: `engine.getOrCreateNode()` for cost_snapshot, visit_snapshot, listing_snapshot
- **Profitability**: seed cost=8000, ad with price=5000 → critical finding
- **Cost unknown**: ad active, no cost node → no profitability finding
- **WoW decline**: seed visit nodes at -35% last week, -40% week before → warning; single-week dip → no signal
- **Monopoly**: seed listing_snapshot only on owned sellerIds → info; add external → no signal
- **ROAS < 1.0**: metrics `{revenue: 5000, investment: 8000}` → warning
- **Zero investment**: metrics `{investment: 0}` → skip, no div-by-zero
- **Opportunity**: campaign ROAS=4.2, profitable product not in ads[] → opportunity
- **Empty snapshots**: no data → `{findings: [], proposalEnqueued: false}`
- **Proposal enqueue**: verify `noMutationExecuted: true` on all payloads, correct sender/receiver, dedupeKey format
