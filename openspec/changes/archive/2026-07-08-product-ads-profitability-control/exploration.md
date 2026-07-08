## Exploration: Product Ads v2 — per-product profitability control

### Current State

The `product-ads-monitor` daemon (v1, 429 lines, shipped 2026-07-08) reads Product Ads insights via ORM snapshots and cross-references Cortex `cost_snapshot`, `visit_snapshot`, and `listing_snapshot` data. It detects five signal types and enqueues CEO proposals with hourly dedupe keys (`noMutationExecuted: true`).

**v1 signals implemented:**
- Unprofitable ad (critical): `price - cost < 0` via `cost_snapshot`
- Declining visits + active ad (warning): WoW ↓30%+ for 2+ weeks
- Cross-account monopoly (info): product listed only on owned sellerIds
- Low per-product ROAS (warning): `revenue / investment < 1.0`
- Profitable no-ad gap (opportunity): campaign ROAS > 3.0 + profitable product not in `ads[]`

**v1 uses only `investment` and `revenue`** from the `metrics` Record on each ad entity, despite the MercadoLibre Product Ads API returning 15 metrics per ad/campaign: `clicks, prints, ctr, cost, cpc, acos, cvr, roas, sov, direct_amount, indirect_amount, total_amount, direct_units, indirect_units, total_units`.

**Data available but unused:**
- `cvr` (CVR / conversion rate from ad clicks to purchases) — already in snapshot metrics
- `direct_units / indirect_units / total_units` — units sold via ads
- `acos` (Advertising Cost of Sales) — inverse of ROAS, standard ML metric
- `sov` (Share of Voice) — competitive positioning
- `clicks / ctr / cpc` — efficiency signals
- `cost_snapshot` with commission and shipping from `costSupplierDaemon` (pricing_snapshot)
- `order_snapshot` Cortex nodes (used by `creativeCommercialDaemon` for conversion detection)

**v1 blind spots as a "commercial CFO":**
1. A product can be "profitable standalone" (price > cost) but **ad spend consumes the entire margin** → v1 only flags `price - cost < 0`, not margin erosion
2. A product with ROAS=6.0 but **low conversion** — wasting budget on traffic that doesn't convert → v1 has no CVR signal
3. A product with ROAS=0.8 but **high conversion** — might be fixable with creative/bid adjustments → v1 only says "low ROAS"
4. Unit economics: `(revenue - costOfGoods - adSpend) / adSpend` → v1 never computes net contribution
5. Competitive positioning: budget could be redirected from low-SoV winners to high-SoV niches

### Affected Areas

- `packages/agent/src/workers/productAdsMonitorDaemon.ts` — current v1 daemon; may need shared helpers extracted
- `packages/agent/src/workers/productAdsProfitabilityDaemon.ts` — **new** v2 daemon (recommended)
- `packages/agent/src/workers/productAdsShared.ts` — **new** shared data-loading module
- `packages/agent/src/workers/daemonScheduler.ts` — add new lane to `daemonHandlerMap`
- `packages/agent/src/conversation/lanes.ts` — add `product-ads-profitability` LaneId + LaneContract
- `packages/agent/src/conversation/companyAgents.ts` — add `laneDepartments` entry (commercial)
- `packages/agent/src/index.ts` — export new handler
- `packages/agent/tests/workers/productAdsMonitorDaemon.test.ts` — extract shared seed helpers
- `packages/agent/tests/workers/productAdsProfitabilityDaemon.test.ts` — **new**
- `openspec/specs/product-ads-monitor-daemon/spec.md` — unchanged unless shared helpers extracted
- `openspec/specs/product-ads-profitability-daemon/spec.md` — **new**

### Approaches

#### 1. Extend `productAdsMonitorDaemon` with v2 signals

Add 3-4 new signal detection blocks inside the existing daemon, reusing the same data loading pass. The daemon grows from ~430 to ~800+ lines.

| Pros | Cons | Complexity |
|------|------|------------|
| Single source of truth for Product Ads intelligence | Daemon exceeds cognitive review threshold (~800 lines) | Medium |
| No duplicate data loading | Mixing "alarm signals" (v1) with "CFO decisions" (v2) muddies purpose | |
| No new lane registration | One daemon failure blocks all Product Ads signals | |
| Simpler diff (one file changed) | Harder to schedule v1 and v2 at different cadences | |
| | Regression risk on stable v1 | |

#### 2. New `productAdsProfitabilityDaemon` with shared helpers

Create a separate daemon for v2 profitability/decision signals. Extract shared data-loading code into `productAdsShared.ts`. Each daemon stays focused and < 400 lines.

| Pros | Cons | Complexity |
|------|------|------------|
| Clear separation: v1 = detection, v2 = CFO decisions | Data loading duplicated unless shared helpers extracted | Low/Medium |
| Each daemon stays independently reviewable | Extra lane registration (~30 lines boilerplate) | |
| Independent scheduling cadences (monitor 15min, profitability hourly) | Two daemons querying the same snapshot data | |
| No regression risk on v1 | | |
| Future-proof: v2 can evolve toward mutation proposals (budget adjustments) | | |
| Lane contract tailored to profitability inputs/outputs | | |

#### 3. Shared data-loading context provider + two specialized daemons

Add a context-provider layer that loads all Product Ads + cost + visit data once, then passes structured results to both daemons.

| Pros | Cons | Complexity |
|------|------|------------|
| Zero duplicate data loading | New abstraction layer adds complexity | High |
| Maximum efficiency (single ORM/DB pass) | Couples daemons to shared interface | |
| Clean separation of signal domains | Over-engineering for current scale (2 daemons) | |
| | Refactors both daemon signatures | |

### Recommendation

**Approach 2: new `productAdsProfitabilityDaemon` with shared helpers.**

Rationale:
1. v1 is stable and well-tested — touching it introduces unnecessary regression risk
2. v2 signals are qualitatively different: **CFO financial decisions** vs. **alarm detection**
3. The daemon pattern is well-established (7 existing daemons follow the same structure)
4. Shared helpers keep code DRY without coupling daemons
5. Separate lanes allow different scheduling cadences and independent evolution
6. A dedicated lane contract declares profitability-specific evidence requirements
7. First slice remains reviewable (~300-400 lines for the daemon itself)

**Recommended v2 signal set (CFO decisions):**

| Signal | Severity | Rule | Data required |
|--------|----------|------|---------------|
| Ad-consuming margin | critical | `netContribution <= 0` where `netContribution = (price * unitsFromAds) - (costPerUnit * unitsFromAds) - totalAdSpend` | cost_snapshot, ad metrics (revenue, units, investment) |
| High ROAS, scale candidate | opportunity | Per-ad ROAS > 2.0 AND net margin > 20% AND CVR > 2% | cost_snapshot, ad metrics (roas, cvr, investment) |
| Budget waste (high spend, low conversion) | warning | Ad investment > cost * 0.5 AND CVR < 1% | cost_snapshot, ad metrics (cvr, investment) |
| Underinvested (profitable, low SoV) | info | Net margin > 30% AND SoV < 10% | cost_snapshot, ad metrics (sov, revenue) |
| Per-product unit economics | info | Computed `contributionMargin` and `breakEvenCPA` per advertised product | cost_snapshot, ad metrics (cpc, investment, units) |

### Risks

- **Cost data absence**: `cost_snapshot` data is populated by `costSupplierDaemon` from Cortex — if not ingested, all profitability signals silently skip. Mitigation: publish an info finding when cost data is available for < 50% of advertised products.
- **CVR metric reliability**: ML Product Ads CVR is based on ad-attributed conversions, not total conversions. May diverge from ground truth. Mitigation: use `order_snapshot` Cortex data as a secondary correlation check (advertised item sales / ad clicks).
- **Duplicate signal overlap**: v1 "low ROAS" and v2 "budget waste" could fire for the same ad. Mitigation: v2 should suppress signals already covered by v1 at the same severity, or use dedupe keys that prevent double-proposal.
- **False CFO confidence**: Presenting unit economics without complete cost data could create overconfidence. Mitigation: every finding MUST include a `dataCompleteness` field (full/partial/insufficient) and the CEO proposal MUST label findings with missing data.

### Ready for Proposal

**Yes — with one required clarification.**

The orchestrator should ask the user:

> The Product Ads API returns CVR (conversion rate), units sold, ACOS, and Share of Voice metrics that v1 never uses. v2 can expose these as CFO-grade signals (net margin after ads, budget waste detection, scale candidates). Should the first slice focus on: **(A)** margin-protection signals only (detect when ads consume margin), **(B)** full unit economics per advertised product (cost, revenue, ad spend, units, CVR), or **(C)** both margin protection + opportunity signals (scaling profitable ads, cutting waste)?
>
> Also: is there an existing process for updating per-product `cost_snapshot` data, or should v2 also surface a "cost data gaps" signal to remind the operator to keep costs current?
