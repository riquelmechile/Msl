# Tasks: Product Ads Profitability Control

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 600–700 |
| 400-line budget risk | Medium |
| 800-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Medium

> 800-line project override; estimated 600–700 fits within budget. If daemon logic expands past 350 lines, auto-chain slices phase 2 into a second PR.

## Phase 1: Foundation — Types, Lane, Bus Store, Shared Helpers

- [x] 1.1 Create `packages/agent/src/workers/productAdsShared.ts` with shared helpers: `loadProductAdsContext()` (reads `product-ads-insights`, Cortex `cost_snapshot`, ORM `listing_snapshot` per sellerId), `flattenProductAds()`, `enrichWithEconomics()`, and `ProductAdEconomics` type (per design §Interfaces). Do NOT include ISO-week helpers.
- [x] 1.2 Add `"product-ads-profitability"` to `LaneId` union in `packages/agent/src/conversation/lanes.ts`. Add `PRODUCT_ADS_PROFITABILITY_LANE` contract in `LANE_CONTRACTS` with label "Product Ads Profitability", department "commercial", and proposal-only boundaries.
- [x] 1.3 Add `"product-ads-profitability": "commercial"` to `laneDepartments` in `packages/agent/src/conversation/companyAgents.ts`.
- [x] 1.4 Add `lookupRecentByDedupePrefix(prefix, since)` to `AgentMessageBusStore` interface and `createAgentMessageBusStore` in `packages/agent/src/conversation/agentMessageBusStore.ts`; query `agent_message_bus` for messages where `dedupe_key LIKE prefix%` and `created_at > since`.

## Phase 2: Core Daemon — CFO Profitability Control

- [x] 2.1 Create `packages/agent/src/workers/productAdsProfitabilityDaemon.ts` skeleton: `DaemonHandler` signature, call `loadProductAdsContext()`, iterate per campaign→per ad/product, compute `ProductAdEconomics`. Return empty findings if no ads.
- [x] 2.2 Implement five CFO signals per product (spec §Profitability Signal Detection): margin-consuming (netContribution ≤ 0, critical), scale candidate (ROAS > 2.0 AND margin > 20% AND CVR > 2%, opportunity), budget waste (adSpend > cost×0.5 AND CVR < 1%, warning), underinvested (margin > 30% AND SoV < 10%, info), unit economics (contributionMargin, breakEvenCpa, info). Each product evaluated independently; campaign averages skipped.
- [x] 2.3 Implement data completeness labeling: `full` when cost+CVR+units+revenue present; `insufficient` when cost missing; `partial` otherwise. Route insufficient to data-quality notices (no action proposals).
- [x] 2.4 Implement rolling 7-day recommendation cadence: seller-impacting rec identity `product-ads-cfo:{sellerId}:{campaignId}:{itemId}:{tier}`. Before enqueue, call `bus.lookupRecentByDedupePrefix(identity, capturedAt - 7d)`. Suppress if found. Data-quality key: `product-ads-data-gap:{sellerId}:{campaignId}:{itemId}:{YYYY-MM-DD}` (daily allowed, no action proposals).
- [x] 2.5 Group findings by severity tier into CEO proposals with `noMutationExecuted: true`, `recommendationIdentity`, `actionability`, `recommendationWindowDays: 7`. Enqueue via `bus.enqueue` to "ceo".

## Phase 3: Integration & Wiring

- [x] 3.1 Import and add `product-ads-profitability` to `daemonHandlerMap` in `packages/agent/src/workers/daemonScheduler.ts`.
- [x] 3.2 Export `productAdsProfitabilityDaemon` from `packages/agent/src/index.ts`.
- [x] 3.3 Extract shared loading calls from `packages/agent/src/workers/productAdsMonitorDaemon.ts` to use `productAdsShared.ts` helpers where low-risk (only where the extraction is a drop-in replacement). Keep v1 signal logic unchanged.

## Phase 4: Testing & Quality Gate

- [x] 4.1 Create `packages/agent/tests/workers/productAdsProfitabilityDaemon.test.ts`. Unit tests: formula helpers (netContribution, breakEvenCpa), `dataCompleteness` label states, margin-consuming/scaling/waste/underinvested signals, mixed-campaign products preserved independently.
- [x] 4.2 Write worker-level tests using in-memory SQLite + GraphEngine: full-cycle investigate→enqueue, insufficient-cost CEOrouting, within-7-day suppression, different product identity emission, window-expiry emission, daily data-quality notice dedup.
- [x] 4.3 Extend `packages/agent/tests/workers/daemonScheduler.test.ts`: verify `product-ads-profitability` lane dispatches to `productAdsProfitabilityDaemon` when a matching message is claimed.
- [x] 4.4 Run full quality gate: `npm test && npm run lint && npm run typecheck`. Fix all failures.

## Gate-Review Fix (2026-07-08)

- [x] CRITICAL-1 Fix dedupe key mismatch: `bus.enqueue()` dedupe keys now use the same identity prefix as `lookupRecentByDedupePrefix()` so rolling 7-day cadence works in production
- [x] CRITICAL-1 Data-quality dedupe keys now use `product-ads-data-gap:{sellerId}:{campaignId}:{itemId}:{YYYY-MM-DD}` format
- [x] CRITICAL-1 Added regression test: daemon-written dedupe keys validated against lookup prefix, second-run suppression proven
- [x] Lint: removed unused `AdFlat`/`CampaignFlat` from `productAdsMonitorDaemon.ts`
- [x] Lint: removed unused `msg`, `vi`, `afterEach`, `claimFixture` from `daemonScheduler.test.ts`
- [x] Lint: removed unnecessary `as never` assertions from `productAdsProfitabilityDaemon.test.ts`
