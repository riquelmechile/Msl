# Design: Product Ads Profitability Control

## Technical Approach

Add a separate read-only `productAdsProfitabilityDaemon` that reuses Product Ads snapshot loading patterns from `productAdsMonitorDaemon` but evaluates CFO economics per advertised product inside each campaign. The daemon measures daily on every scheduler cycle, emits daily data-quality notices when evidence is incomplete, and emits seller-impacting recommendations only when the same seller/campaign/item/signal identity has not emitted in the previous rolling 7 days. Product Ads mutations stay outside the daemon and remain approval-gated through CEO/Telegram tooling.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|----------|--------|-------------------------|-----------|
| Daemon shape | Create `packages/agent/src/workers/productAdsProfitabilityDaemon.ts` | Extend `productAdsMonitorDaemon.ts` | v1 monitor is already 429 lines and mixes alarm signals; CFO economics need separate cadence, payloads, and tests without regression risk. |
| Shared loading | Create `packages/agent/src/workers/productAdsShared.ts` for ads, campaigns, listing prices, and cost snapshots | Duplicate loaders in v2 | Current Product Ads, listing, and cost loading is embedded in v1; extracting small helpers keeps both daemons reviewable and preserves existing storage APIs. |
| Granularity | Analyze `campaignId + adId + itemId` records independently | Use campaign ROAS/ACOS summaries | Specs require products in the same campaign to preserve different price, cost, margin, CPC, CVR, units, and contribution. |
| Recommendation cadence | Use product-level recommendation identity plus a rolling 7-day bus lookback; daily keys only for data gaps | Calendar ISO week buckets or campaign-level keys | Exact identity preserves seller/campaign/item/tier granularity and avoids week-boundary duplicates. |
| Approval boundary | Daemon only enqueues CEO proposals with `noMutationExecuted: true`; CEO later prepares Product Ads actions | Direct MCP Product Ads mutation | `msl_prepare_product_ads_action` persists pending prepared actions with `requiresApproval: true`; daemon must not bypass it. |

## Data Flow

```
scheduler task → productAdsProfitabilityDaemon
  → productAdsShared.loadProductAdsContext(reader, cortex, sellerIds)
  → per campaign → per ad/product economics
  → grouped CEO proposal(s) on AgentMessageBus
  → CEO/Telegram approval tooling prepares/executes actions later
```

`productAdsShared` reads ORM `product-ads-insights` and `listing_snapshot`, plus Cortex `cost_snapshot`. Missing evidence produces a data-quality finding, not a profitability recommendation.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/workers/productAdsShared.ts` | Create | Shared flattening/loading helpers; do not use ISO-week helpers for profitability cadence. |
| `packages/agent/src/workers/productAdsProfitabilityDaemon.ts` | Create | Computes CFO signals, data completeness, grouped CEO payloads, rolling-window recommendation identities, and daily data-quality dedupe keys. |
| `packages/agent/src/conversation/agentMessageBusStore.ts` | Modify | Add a read-only recent-message lookup by dedupe key prefix or payload identity so the daemon can suppress seller-impacting recommendations emitted in the prior rolling 7 days before enqueue. |
| `packages/agent/src/workers/productAdsMonitorDaemon.ts` | Modify | Replace duplicated local loading helpers with shared helpers only where low-risk. |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Import and map `product-ads-profitability`. |
| `packages/agent/src/conversation/lanes.ts` | Modify | Add lane type and contract. |
| `packages/agent/src/conversation/companyAgents.ts` | Modify | Add lane department `commercial`. |
| `packages/agent/src/index.ts` | Modify | Export the new daemon. |
| `packages/agent/tests/workers/productAdsProfitabilityDaemon.test.ts` | Create | CFO behavior coverage. |
| `packages/agent/tests/workers/daemonScheduler.test.ts` | Modify | Verify dispatch mapping through an enqueued lane task. |

## Interfaces / Contracts

```ts
type ProductAdEconomics = {
  sellerId: string; campaignId: string; adId: string; itemId: string;
  price?: number; costPerUnit?: number; unitsFromAds?: number;
  adSpend: number; revenue: number; clicks?: number; cpc?: number;
  cvr?: number; roas?: number; acos?: number; sov?: number;
  grossContribution?: number; netContribution?: number;
  contributionMarginPct?: number; breakEvenCpc?: number; breakEvenCpa?: number;
  dataCompleteness: "full" | "partial" | "insufficient";
};
```

Formulas: `adSpend = investment ?? cost`; `unitsFromAds = total_units ?? direct_units + indirect_units`; `grossContribution = (price - costPerUnit) * unitsFromAds`; `netContribution = grossContribution - adSpend`; `contributionMarginPct = netContribution / revenue`; `cpc = metric.cpc ?? adSpend / clicks`; `cvr = metric.cvr`; `roas = metric.roas ?? revenue / adSpend`; `acos = metric.acos ?? adSpend / revenue`; `breakEvenCpa = price - costPerUnit`; `breakEvenCpc = breakEvenCpa * cvr` when CVR is known.

CEO payloads include `type`, `tier`, `findings[]`, `actionability: "seller-impacting" | "data-quality"`, `recommendationWindowDays: 7`, `recommendationIdentity`, `capturedAt`, and `noMutationExecuted: true`.

Seller-impacting recommendation identity: `product-ads-cfo:{sellerId}:{campaignId}:{itemId}:{signalTierOrType}`. Before enqueue, the daemon checks for this identity in messages created during `(capturedAt - 7 days, capturedAt]`; if present, it MUST NOT emit a seller-impacting recommendation. The insert dedupe key MAY append the capture date for same-run idempotency, but cadence MUST be enforced by the rolling lookback, not ISO week. Data-quality key: `product-ads-data-gap:{sellerId}:{campaignId}:{itemId}:{YYYY-MM-DD}` and those notices SHALL NOT include seller-impacting action proposals.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Formula helpers and completeness labels | Vitest pure function tests. |
| Worker | Margin-consuming, scale, waste, underinvested, mixed products in one campaign, missing cost | In-memory SQLite operational model + GraphEngine, matching existing daemon tests. |
| Integration | Scheduler maps lane and CEO payloads are deduped | Extend scheduler/message-bus tests. |

## Migration / Rollout

No data migration required. Roll out by adding the lane and handler; removing those registrations cleanly rolls back to existing Product Ads monitor behavior.

## Open Questions

- [ ] None blocking.
