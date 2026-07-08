# Tasks: Product Ads Monitor Daemon

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~475 (250 daemon + 200 tests + 25 wiring) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (infra) → PR 2 (daemon + tests) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes (resolved: stacked-to-main, PR 1 = ~100 LOC)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Lane registration + daemon skeleton + empty-state tests | PR 1 | Base: main. ~100 LOC. Independently mergible. |
| 2 | Full signal detection + proposal enqueue + all signal tests | PR 2 | Base: main (stacked) or PR 1 branch (feature-branch-chain). ~375 LOC. |

## Phase 1: Lane Registration + Wiring

- [x] 1.1 Add `"product-ads-monitor"` to `LaneId` union in `lanes.ts`
- [x] 1.2 Create `PRODUCT_ADS_MONITOR_LANE` contract with label, inputs, boundaries, `departmentId: "commercial"`
- [x] 1.3 Append to `LANE_CONTRACTS` array after `OWNED_ECOMMERCE_LANE`
- [x] 1.4 Add `"product-ads-monitor": "commercial"` to `laneDepartments` in `companyAgents.ts`
- [x] 1.5 Import `productAdsMonitorDaemon` + add to `daemonHandlerMap` in `daemonScheduler.ts`
- [x] 1.6 Export `productAdsMonitorDaemon` from `index.ts`

## Phase 2: Daemon Core Implementation

- [x] 2.1 Data fetching: `searchSnapshots("product-ads-insights")` across sellers + Cortex cost_snapshot, visit_snapshot, listing_snapshot reads
- [x] 2.2 Profitability check: `price - cost < 0` via cost_snapshot → critical; skip if cost unknown (scenarios 1-2, 12)
- [x] 2.3 Visit decline check: WoW 30%+ for 2+ consecutive weeks → warning; skip single-week dip (scenarios 3-4)
- [x] 2.4 Monopoly check: listing_snapshot only on owned sellerIds → info; suppress if external seller exists (scenarios 5-6)
- [x] 2.5 Per-product ROAS: `revenue / investment < 1.0` → warning; skip if investment=0 (scenarios 7-8)
- [x] 2.6 Opportunity check: campaign ROAS > 3.0 + profitable product not in ads[] → info (scenario 9-10)
- [x] 2.7 Grouped CEO proposal enqueue per severity tier with hourly dedupe + `noMutationExecuted: true`

## Phase 3: Tests

- [x] 3.1 Empty state: no data → `{findings: [], proposalEnqueued: false}` (scenario 11)
- [x] 3.2 Profitability critical finding + cost unknown skip (scenarios 1-2)
- [x] 3.3 Visit decline (2 consecutive weeks) + single-week dip excluded (scenarios 3-4)
- [x] 3.4 Cross-account monopoly detection + external seller exclusion (scenarios 5-6)
- [x] 3.5 ROAS < 1.0 finding + zero investment skip (scenarios 7-8)
- [x] 3.6 Opportunity gap detection + unprofitable excluded from opportunity (scenarios 9-10)
- [x] 3.7 Proposal enqueue: correct sender/receiver, dedupeKey format, noMutationExecuted (scenarios 13-16)
