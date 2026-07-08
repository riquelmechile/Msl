# Proposal: Product Ads Monitor Daemon

## Intent

Add a sixth specialist daemon (`product-ads-monitor`) that reads Product Ads snapshots and applies business intelligence — profitability, visit trends, cross-account monopoly — before recommending ad spend. The current ingestion pipeline captures campaign/ROAS data but has no automated signal detection. This daemon closes that gap, preventing wasteful spend on unprofitable or monopolized products.

## Scope

### In Scope
- New daemon: `productAdsMonitorDaemon.ts` detecting 4 signal types
- Lane registration: `product-ads-monitor` lane in Lanes, companyAgents, daemonHandlerMap, index exports
- Profitability gate: cross-reference cost_snapshot (Cortex/ORM) against advertised products
- Visit trend check: week-over-week visit decline → alert before advertising
- Monopoly detection: if product only exists on Plasticov + Maustian, advertising is wasteful
- Per-product ROAS: compute ROAS per ad (not just campaign-level) from ads[] metrics
- CEO proposal enqueue with hourly dedupe keys

### Out of Scope
- Auto-pausing campaigns/ads (proposal-only, `noMutationExecuted: true`)
- Real-time Product Ads polling (reuses 24h snapshot cycle)
- Budget allocation suggestions (future phase)

## Capabilities

### New Capabilities
- `product-ads-monitor-daemon`: Product Ads business-intelligence signal detection

### Modified Capabilities
- `specialist-daemons`: Add product-ads-monitor to the shared daemon contract spec
- `daemon-scheduler`: Extend handler map with the new lane

## Approach

Follow the existing daemon pattern: `reader.searchSnapshots({kind: "product-ads-insights"})` → Cortex fallback for cost/visit data → detect signals → group by severity → `bus.enqueue()` with `dedupeKey: product-ads-{kind}-{capturedAt.slice(0,13)}`.

### Signal Detection Rules

| Signal | Severity | Rule |
|--------|----------|------|
| Advertised product is unprofitable | critical | `price - cost < 0` via cost_snapshot |
| Declining visits + active ad | warning | visits ↓ 30%+ WoW for 2+ weeks |
| Cross-account monopoly | info | product exists only on Plasticov + Maustian listings |
| Low per-product ROAS | warning | ad ROAS < 1.0 within a campaign |
| Profitable product with no ad | opportunity | ROAS > 3.0 campaign, product not in ads[] |

### Data Sources
- **Cost data**: Cortex `cost_snapshot` nodes and ORM costSupplier data (same pattern as `costSupplierDaemon`)
- **Visit data**: Cortex `visit_snapshot` with week-over-week delta. Also ORM `listing_snapshot` for cross-account monopoly (check itemId presence across sellerIds)
- **Product Ads**: ORM `product-ads-insights` snapshots (no Cortex fallback yet — that's a future concern)
- **Cross-account**: `searchSnapshots` for `listing_snapshot` across all sellerIds to detect if product is exclusive to owned accounts

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/lanes.ts` | Modified | Add `product-ads-monitor` LaneId + LaneContract |
| `packages/agent/src/workers/daemonScheduler.ts` | Modified | Add to `daemonHandlerMap` |
| `packages/agent/src/conversation/companyAgents.ts` | Modified | Add `laneDepartments` entry (commercial) |
| `packages/agent/src/index.ts` | Modified | Export handler |
| `packages/agent/src/workers/productAdsMonitorDaemon.ts` | New | Daemon implementation |
| `openspec/specs/specialist-daemons/spec.md` | Modified | Add productAdsMonitorDaemon requirement |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cross-account monopoly false positives (product on non-owned seller) | Low | Check ALL sellerIds against listing_snapshot, not just Plasticov/Maustian |
| Cost data missing for advertised product | Med | Default to "skip" (no signal) when cost unknown — never false-critical |
| ROAS metrics zero/N/A in snapshot data | Low | Guard against division by zero; skip if metrics undefined |
| ORM-only product-ads data (no Cortex fallback) | Low | Graceful empty result when snapshot unavailable |

## Rollback Plan

Remove the daemon handler from `daemonHandlerMap`, lane from `LaneId`, and entry from `companyAgents.ts`. The daemon file can remain unused. No database migrations — the lane simply stops being polled.

## Dependencies

- Product Ads snapshot ingestion already running (24h cycle via `processSellerProductAds`)
- Cost data available in Cortex (same source as `costSupplierDaemon`)
- Visit data available in Cortex/ORM (same source as other daemons)

## Success Criteria

- [ ] Daemon detects and enqueues CEO proposal when an unprofitable product is advertised
- [ ] Daemon flags declining-visit products (warning) without false positives on normal fluctuation
- [ ] Cross-account monopoly check correctly identifies exclusive products across Plasticov + Maustian
- [ ] Per-product ROAS signal fires when ad ROAS < 1.0 within a campaign
- [ ] No mutations executed — all `noMutationExecuted: true`
- [ ] Hourly dedupe prevents duplicate CEO proposals within same window
