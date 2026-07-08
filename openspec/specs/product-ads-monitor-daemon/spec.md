# product-ads-monitor-daemon Specification

## Purpose

Read-only daemon that reads Product Ads snapshots, applies business-intelligence rules, and enqueues CEO proposals — `noMutationExecuted: true` always.

## Requirements

### Requirement: Signal Detection

The daemon MUST read `product-ads-insights` snapshots via `searchSnapshots()` and cross-reference Cortex `cost_snapshot`, `visit_snapshot`, and ORM `listing_snapshot`. It SHALL detect five signal types. Missing data SHALL cause individual checks to skip silently without blocking others.

| Signal | Severity | Rule |
|--------|----------|------|
| Unprofitable ad | critical | `price - cost < 0` via cost_snapshot; skip if cost unknown |
| Declining visits + ad | warning | WoW ↓ 30%+ for 2+ consecutive weeks |
| Cross-account monopoly | info | listing_snapshot only on Plasticov + Maustian (owned) |
| Low per-product ROAS | warning | `revenue / investment < 1.0` per ad; skip if undefined or div0 |
| Profitable no-ad gap | opportunity | `price - cost > 0`, campaign ROAS > 3.0, product not in ads[] |

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Unprofitable | price=5000, cost=8000, ad active | investigate() | Finding critical |
| Cost unknown | ad active, no cost_snapshot | investigate() | Profitability skip; no false-critical |
| Two-week visit decline | WoW -35%, -40%, ad active | investigate() | Finding warning |
| Single-week dip | WoW -35% then -5% | investigate() | No signal |
| Exclusive to owned | listing_snapshot only on Plasticov + Maustian | investigate() | Finding info |
| External seller | listing_snapshot on Plasticov, Maustian + third-party | investigate() | No monopoly signal |
| ROAS < 1.0 | revenue=5000, investment=8000 | investigate() | Finding warning |
| Zero investment | Ad investment=0 | investigate() | ROAS skip; no div-by-zero |
| Opportunity | Campaign ROAS=4.2, profitable product not in ads[] | investigate() | Finding info (opportunity) |
| Unprofitable excluded | price-cost<0, campaign ROAS>3.0 | investigate() | No opportunity |
| Empty snapshots | No product-ads-insights data | investigate() | Empty findings; no error |
| Cortex down | All cortex queries return empty | investigate() | Snapshot signals only; no crash |

### Requirement: Proposal Enqueue

The daemon MUST group findings by severity tier and enqueue one CEO proposal per tier with `dedupeKey: product-ads-{kind}-{capturedAt.slice(0,13)}`. All payloads MUST carry `noMutationExecuted: true`. The daemon SHALL NOT call ML write APIs.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Grouped enqueue | 3 critical + 2 warning | bus.enqueue() per tier | 2 messages; dedupeKeys contain hour segment |
| Same-hour dedupe | Same findings, same hour | bus.enqueue() | Duplicates suppressed |
| Next hour | Same findings, hour+1 | bus.enqueue() | New message (hour changed) |
| No mutations | Any findings | investigate() returns | noMutationExecuted:true in all payloads |

### Requirement: Lane Registration

A `product-ads-monitor` lane MUST be added to `LaneId`, `LANE_CONTRACTS`, `laneDepartments` (department "commercial"), `daemonHandlerMap`, and `index.ts` exports.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Handler mapped | laneId in daemonHandlerMap | Scheduler polls | Daemon dispatched |
| Agent listed | lane in LANE_CONTRACTS | listCompanyAgents() | Agent in "commercial" department |
| Exported | index.ts exports handler | Import from @msl/agent | Handler accessible |
