# specialist-daemons Specification

## Purpose

Five investigation-only daemon workers that read operational evidence, detect actionable business signals, and enqueue CEO proposals via the agent message bus — `noMutationExecuted: true` at all times.

## Requirements

### Requirement: Shared Daemon Contract

Every daemon MUST export `investigate(claim: AgentMessage): Promise<DaemonResult>`. `DaemonResult` MUST have `{ findings: DaemonFinding[]; proposalEnqueued: boolean }`. Each finding MUST include `{ kind: string; severity: "info"|"warning"|"critical"; summary: string; evidenceIds: string[] }`.

Daemons SHOULD use `searchSnapshots()` instead of `listSnapshots()` + manual filtering for status, price, and date conditions. Using `searchSnapshots()` SHALL produce identical findings: same detections, same severity levels, same `evidenceIds` references.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Findings returned | Daemon detects signals | investigate() completes | DaemonResult with findings array |
| No findings | No signals detected | investigate() completes | Empty findings, proposalEnqueued: false |
| Error during investigation | Evidence read fails | investigate() throws | Error propagated to scheduler for message fail |
| Migration preserves identical findings | Daemon refactored to use searchSnapshots() | investigate() completes | Same findings, same severities, same evidenceIds as before |

### Requirement: No Mutation Boundary

ALL daemons MUST set `noMutationExecuted: true`. Daemon functions SHALL NOT call MercadoLibre write APIs, modify seller listings, or execute external mutations. They SHALL only read evidence via `OperationalReadModelReader` and `GraphEngine`, and enqueue proposals.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Listing API not called | Daemon processes evidence | Any daemon runs | No ML write API invoked |
| Only enqueue | Daemon has findings | investigate() returns | Proposal enqueued on bus, no mutation executed |

### Requirement: marketCatalogDaemon

`marketCatalogDaemon` MUST read listing snapshots and pricing evidence using `searchSnapshots()` with composable status and price filters instead of client-side iteration. It SHALL detect at minimum: active listings with visit counts below a configurable threshold, listings priced above similar-category competition, and paused listings with sales history eligible for relist.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Low-visit active listing | Active listing, visits < threshold | Daemon investigates | Finding with severity "warning" |
| Above-market price | Listing price > median + buffer | Pricing evidence compared | Finding with severity "warning" |
| Paused-to-relist | Paused listing with salesCount > 0 | Daemon investigates | Finding with severity "info", recommendation to relist |

### Requirement: operationsManagerDaemon

`operationsManagerDaemon` MUST read claims, questions, messages, and order snapshots using `searchSnapshots()` with status and date-range filters. It SHALL detect: new open claims without response, unanswered buyer questions older than a deadline, and orders in "delayed" shipping status beyond SLA.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| New open claim | Claim status "open", no seller message | Daemon investigates | Finding with severity "critical" |
| Unanswered question | Question status "unanswered", age > deadline | Daemon investigates | Finding with severity "warning" |
| Delayed order | Order shipment delayed beyond SLA | Daemon investigates | Finding with severity "critical" |

### Requirement: costSupplierDaemon

`costSupplierDaemon` MUST read listing snapshots, supplier evidence, and cost data using `searchSnapshots()` with status and price-range filters. It SHALL detect: products where current price yields margin below target threshold, and items where stock is below restock watermark with positive visit trends.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Margin below threshold | (price - cost) / price < targetMargin | Daemon investigates | Finding with severity "critical" |
| Restock signal | Stock < restockWatermark, visits trending up | Daemon investigates | Finding with severity "info", restock recommendation |

### Requirement: creativeCommercialDaemon

`creativeCommercialDaemon` MUST read visit snapshots, order snapshots, and listing evidence using `searchSnapshots()` with date-range filters. It SHALL detect: listings with high visits and low conversion (orders/visits ratio below threshold), and active listings stagnant without sales over a configurable window.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| High-visits low-conversion | Visits > threshold, orders/visits < threshold | Daemon investigates | Finding with severity "warning" |
| Stagnant stock | Active listing, last order > window ago | Daemon investigates | Finding with severity "info" |

### Requirement: productAdsMonitorDaemon

`productAdsMonitorDaemon` MUST read `product-ads-insights` snapshots using `searchSnapshots()` and cross-reference Cortex `cost_snapshot` and `visit_snapshot` nodes and ORM `listing_snapshot` data. It SHALL detect at minimum: advertised unprofitable products (price - cost < 0, `critical`), declining visits with active ad (30%+ WoW over 2 weeks, `warning`), cross-account monopoly across Plasticov + Maustian (`info`), per-product ROAS below 1.0 (`warning`), and profitable products missing ads in high-ROAS campaigns (`opportunity`). It MUST enqueue CEO proposals with hourly dedupe keys and `noMutationExecuted: true`. Missing data SHALL cause individual signal checks to skip without error.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Unprofitable advertised product | Ad runs, price - cost < 0 via cost_snapshot | Daemon investigates | Finding with severity "critical", kind "alert" |
| Declining visits with active ad | WoW visits ↓ 30%+ for 2+ weeks, ad is active | Daemon investigates | Finding with severity "warning" |
| Cross-account monopoly | Product only on Plasticov + Maustian listing_snapshot | Daemon investigates | Finding with severity "info" |
| Low per-product ROAS | Ad ROAS < 1.0 within campaign metrics | Daemon investigates | Finding with severity "warning" |
| Profitable product with no ad | price - cost > 0, campaign ROAS > 3.0, product not in ads[] | Daemon investigates | Finding with severity "info", kind "opportunity" |
| No signals | All checks pass or data missing | Daemon investigates | Empty findings, proposalEnqueued: false |
| Cost data missing | Ad active, no cost_snapshot for item | Daemon investigates | Profitability signal skipped; no false-critical |
| Empty snapshots | No product-ads-insights data | Daemon investigates | Empty findings, no error |

### Requirement: creativeAssetsDaemon

`creativeAssetsDaemon` MUST read `creative_snapshot` ORM data, Cortex `visit_snapshot` nodes, and `product-ads-insights` snapshots. It SHALL detect 5 signals: low image count (< 2, `warning`), active moderation block (`warning`), poor PICTURES score (`warning`), high-traffic + poor creative composite (`warning`), and moderated-in-campaign (`critical`). Composite intelligence MUST evaluate multiple parameters (visit volume vs seller avg, visit trend, PICTURES score, image count, campaign membership) — no single threshold. It MUST enqueue proposals with hourly dedupe keys and `noMutationExecuted: true`. Missing data SHALL cause individual signals to skip without error.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Low image count | creative_snapshot: pictureCount < 2 | Daemon investigates | Finding severity "warning", kind "low-image-count" |
| Moderation blocked | Moderation status blocked, listing active | Daemon investigates | Finding severity "warning", kind "moderation-blocked" |
| Poor PICTURES score | PICTURES score below threshold | Daemon investigates | Finding severity "warning", kind "poor-pictures-score" |
| High-traffic + poor creative | Visits > seller avg, pictureCount < 2 or blocked | Composite evaluation | Finding severity "warning", kind "high-traffic-poor-creative" |
| Moderated-in-campaign | Blocked AND in active ads campaign | Daemon cross-references | Finding severity "critical", kind "moderated-in-campaign" |
| No signals | All checks pass or data missing | Daemon investigates | Empty findings, proposalEnqueued: false |
| Missing visit data | No visit_snapshot for item | Daemon investigates | R4 skipped; other signals unaffected |
| All data missing | No snapshots available | Daemon investigates | Empty findings, no error |
