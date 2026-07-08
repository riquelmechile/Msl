# product-ads-profitability-daemon Specification

## Purpose

Daily CFO control loop. Measurement runs every scheduler cycle; seller-impacting recommendations (budget, pause, scale) emit only after a true rolling 7-day lookback for the same seller/campaign/item/signal identity. Read-only — never mutates MercadoLibre Product Ads.

## Requirements

### Requirement: Data Loading and Cross-Referencing

The daemon MUST read `product-ads-insights` snapshots and cross-reference Cortex `cost_snapshot` and ORM `listing_snapshot`. It SHALL extract per-ad metrics: `roas`, `cvr`, `investment`, `revenue`, `total_units`, `sov`, and `acos`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Data available | Snapshots, cost, and listing data present | investigate() | All ads enriched with cost/unit data |
| Cost missing | Some ads lack cost_snapshot | investigate() | Affected ads labeled `dataCompleteness: insufficient` |
| Empty snapshots | No product-ads-insights data | investigate() | Empty findings; no error |

### Requirement: Profitability Signal Detection

The daemon SHALL compute five CFO-grade signals per product within each campaign. Every product's individual price, cost/margin, CPC, units, conversion, and ad spend drive evaluation — products inside the same campaign MUST be analyzed independently. Campaign-level aggregates (ROAS, ACOS) SHALL NOT substitute for per-product economics. Missing cost/unit data SHALL cause individual checks to skip without blocking others.

| Signal | Severity | Rule |
|--------|----------|------|
| Margin-consuming ad | critical | `netContribution <= 0` where netContribution = (price × unitsFromAds) − (costPerUnit × unitsFromAds) − totalAdSpend |
| High-ROAS scale candidate | opportunity | Per-product ROAS > 2.0 AND net margin > 20% AND CVR > 2% |
| Budget waste | warning | Ad investment > cost × 0.5 AND CVR < 1% |
| Underinvested | info | Net margin > 30% AND SoV < 10% |
| Unit economics | info | `contributionMargin` and `breakEvenCPA` per advertised product |

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Ad consumes margin | price=10000, cost=8000, units=2, adSpend=12000 | investigate() | critical (netContribution=-8000) |
| Scale candidate | ROAS=3.5, margin=30%, CVR=4% | investigate() | opportunity |
| Budget waste | investment=5000, cost=8000, CVR=0.5% | investigate() | warning |
| Cost unknown | Ad active, no cost_snapshot | investigate() | signal skip; routed to missing-data |

### Requirement: Data Completeness Labeling

Every finding MUST include `dataCompleteness`: `full`, `partial`, or `insufficient` (cost or CVR missing). `insufficient` findings MUST route to the CEO as **data-quality notices** (daily allowed) — not as seller-impacting recommendations. Data-quality notices SHALL NOT carry action proposals.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Full completeness | All cost, CVR, units, and revenue data present | finding created | `dataCompleteness: full` |
| Insufficient completeness | Cost data missing for product | finding created | `dataCompleteness: insufficient`; CEO receives data-gap notice (daily, non-actionable) |

### Requirement: Recommendation Cadence

The daemon SHALL measure and analyze on every scheduler cycle (daily). Seller-impacting recommendations (budget, pause, scale) MUST emit only when the exact recommendation identity has no seller-impacting recommendation in the previous 7 days. The recommendation identity MUST be `sellerId + campaignId + itemId + signal tier/type`. The 7-day cadence MUST use a true rolling lookback from `capturedAt`; it MUST NOT use ISO week, calendar week, or any other calendar bucket. Data-quality notices MAY emit daily and SHALL be distinguishable from seller-impacting recommendations.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Within 7-day window | Last seller-impacting rec for seller/campaign/item/tier was 3 days ago | investigate() | No seller-impacting rec emitted; measurement recorded |
| Different product identity | Last seller-impacting rec was for the same seller/tier but a different campaign or item 3 days ago | investigate() | Seller-impacting rec emitted for the current product identity if thresholds met |
| Window expired | Last seller-impacting rec for seller/campaign/item/tier was 8 days ago | investigate() | Seller-impacting rec emitted if thresholds met |
| Data-quality notice daily | Cost missing, last gap notice yesterday | investigate() | Data-quality notice emitted (daily allowed) |
| First cycle | No prior rec exists | investigate() | Seller-impacting rec emitted if thresholds met |

### Requirement: Per-Product Campaign Granularity

Products within the same campaign MUST be evaluated independently using their individual price, cost/margin, CPC, units, conversion, and ad spend. Campaign-level ROAS, ACOS, or other aggregate averages SHALL NOT determine individual product recommendations. A campaign containing both scaling candidates and unprofitable waste products MUST produce independent per-product findings for each. Product-level economics SHALL NOT be averaged or merged into campaign-level summaries that suppress individual signals.

#### Scenario: Profitable and unprofitable products in same campaign

- GIVEN a campaign contains product A (ROAS=5.0, margin=35%) and product B (ROAS=0.4, negative net contribution)
- WHEN the daemon evaluates the campaign
- THEN product A SHALL generate an independent scale-opportunity finding
- AND product B SHALL generate an independent margin-consuming finding
- AND no campaign-level average SHALL suppress either signal

#### Scenario: Campaign-level metrics ignored for product decisions

- GIVEN campaign-level ROAS is 2.5 (acceptable) but product X inside it has ROAS=0.7
- WHEN the daemon evaluates product X
- THEN product X SHALL be flagged individually based on its own economics
- AND the acceptable campaign average SHALL NOT mask the product-level signal

#### Scenario: Per-product CPC and margin differ significantly within campaign

- GIVEN product Y has CPC=200 and margin=40%, product Z has CPC=800 and margin=8%
- WHEN both are in the same campaign
- THEN product Y and product Z SHALL receive independent contribution and scaling evaluations
- AND their differing CPC and margin profiles SHALL NOT be blended into a single campaign-level verdict

### Requirement: Proposal Enqueue

The daemon MUST group findings by severity tier while preserving each finding's product-level recommendation identity. Seller-impacting proposals MUST carry `recommendationIdentity: product-ads-cfo:{sellerId}:{campaignId}:{itemId}:{signalTierOrType}` and MUST NOT be enqueued when that same identity had a seller-impacting recommendation in the previous rolling 7 days. Any insert-level `dedupeKey` MUST preserve the same seller/campaign/item/tier identity and MUST NOT collapse across campaigns, items, sellers, or tiers. Data-quality notices SHALL use daily dedupe identity `product-ads-data-gap:{sellerId}:{campaignId}:{itemId}:{YYYY-MM-DD}` and MUST NOT carry action proposals. All payloads SHALL carry `noMutationExecuted: true`.

### Requirement: Lane Registration

A `product-ads-profitability` lane MUST be added to `LaneId`, `LANE_CONTRACTS`, `laneDepartments` (department "commercial"), `daemonHandlerMap`, and `index.ts` exports.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Handler mapped | laneId in daemonHandlerMap | Scheduler polls | Daemon dispatched |
| Agent listed | lane in LANE_CONTRACTS | listCompanyAgents() | Agent in "commercial" department |

### Requirement: CEO Consumption Pipeline Targeting

The daemon MUST enqueue profitability proposals with `receiverAgentId` set to `product-ads-ceo-profitability` so the CEO profitability handler can claim them. Proposals SHALL carry the full payload: `{ type: "proposal", summary, findings[], recommendedAction }`. The `dedupeKey` MUST match the daemon's recommendation identity `product-ads-cfo:{sellerId}:{campaignId}:{itemId}:{signalTierOrType}` to prevent duplicate enqueues.

#### Scenario: Proposal enqueued for CEO profitability lane
- GIVEN the daemon generates findings for seller S
- WHEN enqueue is called
- THEN `receiverAgentId` SHALL be `product-ads-ceo-profitability`

#### Scenario: Dedupe prevents duplicate enqueue
- GIVEN a proposal with the same recommendation identity was already enqueued
- WHEN enqueue is called again with the same dedupeKey
- THEN the message bus SHALL return the existing message without creating a duplicate
