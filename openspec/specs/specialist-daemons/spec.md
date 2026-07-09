# specialist-daemons Specification

## Purpose

Seven investigation-only daemon workers that read operational evidence, detect actionable business signals, and enqueue CEO proposals via the agent message bus — `noMutationExecuted: true` at all times.

## Requirements

### Requirement: Shared Daemon Contract

Every daemon MUST export `investigate(claim: AgentMessage): Promise<DaemonResult>`. `DaemonResult` MUST have `{ findings: DaemonFinding[]; proposalEnqueued: boolean }`. Each finding MUST include `{ kind: string; severity: "info"|"warning"|"critical"; summary: string; evidenceIds: string[] }`. Daemons SHOULD use `searchSnapshots()` instead of `listSnapshots()` + manual filtering. The daemon registry SHALL include `morningReportDaemon`, `eodSummaryDaemon`, `ownedEcommerceDaemon`, and `unansweredQuestionsDaemon` following this contract.
(Previously: Shared contract existed but only 9 daemons conformed; morning-report, eod-summary, owned-ecommerce, and unanswered-questions daemons did not exist or were not registered.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Findings returned | Daemon detects signals | investigate() completes | DaemonResult with findings array |
| No findings | No signals detected | investigate() completes | Empty findings, proposalEnqueued: false |
| Error during investigation | Evidence read fails | investigate() throws | Error propagated to scheduler for message fail |
| All 13 daemons conform | Each daemon in handler map | Contract checked | Every daemon exports investigate() → Promise<DaemonResult> |

### Requirement: No Mutation Boundary

ALL daemons MUST set `noMutationExecuted: true`. Daemon functions SHALL NOT call MercadoLibre write APIs, modify seller listings, execute external mutations, or publish to social media channels. They SHALL only read evidence via `OperationalReadModelReader` and `GraphEngine`, enqueue proposals, and — for creativeAssetsDaemon and creativeCommercialDaemon — enqueue creative asset requests to the creative-studio agent via the message bus.
(Previously: creative daemons only enqueued CEO proposals; they were not connected to a generation agent.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Listing API not called | Daemon processes evidence | Any daemon runs | No ML write API invoked |
| Only enqueue | Daemon has findings | investigate() returns | Proposal enqueued on bus, no mutation executed |
| Creative delegation is prepare-only | creativeAssetsDaemon enqueues to creative-studio | investigate() returns | `noMutationExecuted: true`; creative-studio handles generation separately |

### Requirement: creativeStudioDaemon

`creativeStudioDaemon` MUST export `investigate(claim: AgentMessage): Promise<DaemonResult>`. It SHALL poll messages where `receiverAgentId = "creative-studio"` and `status = "pending"`, claim them, route to MiniMax providers by `CreativeJobKind`, persist outputs locally, run ML pre-diagnosis for `mercadolibre` channel jobs, and respond with `CreativeExecutionResult`. It SHALL enforce budget via `canAfford()` before every generation call. It SHALL be disabled when `MSL_CREATIVE_STUDIO_ENABLED` is not `"true"`, returning empty findings.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Image job received | Bus message with `kind: "product-cover-i2i"` | Daemon processes | MiniMax image-01 called, asset persisted, result returned |
| Video job received | Bus message with `kind: "ml-clip-vertical-30s"` | Daemon processes | MiniMax Hailuo-2.3 called, async polling, asset persisted |
| Budget exceeded | Job cost > remaining daily budget | Daemon validates | Job rejected, message failed |
| Env gate disabled | `MSL_CREATIVE_STUDIO_ENABLED=false` | Daemon cycle starts | Empty findings, no bus polling |

### Requirement: creativeAssetsDaemon → Creative Studio Delegation

When `creativeAssetsDaemon` detects actionable visual remediation signals (low image count, moderation block, poor PICTURES score), it SHALL create a `CreativeAssetRequest` with `kind: "product-cover-i2i"` or `"product-gallery-i2i"` and enqueue it to `receiverAgentId = "creative-studio"` via the agent message bus, IN ADDITION to its existing CEO proposal. The delegation SHALL only trigger when `MSL_CREATIVE_STUDIO_ENABLED` is `"true"`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Low image count | creativeAssetsDaemon detects pictureCount < 2, env gate enabled | Daemon completes investigation | `CreativeAssetRequest` enqueued to creative-studio alongside CEO proposal |
| Moderation blocked | creativeAssetsDaemon detects moderation block | Daemon completes investigation | `CreativeAssetRequest` enqueued with product context |
| Env gate disabled | Detection triggers, `MSL_CREATIVE_STUDIO_ENABLED=false` | Daemon evaluates | Only CEO proposal enqueued; no creative-studio message |
| No actionable signals | All checks pass | Daemon completes | No creative-studio message enqueued |

### Requirement: creativeCommercialDaemon → Creative Studio Delegation

When `creativeCommercialDaemon` detects creative candidates (high-visit listings with creative opportunity), it MAY enqueue a `CreativeAssetRequest` with `kind: "social-pack"` to `receiverAgentId = "creative-studio"` via the agent message bus. This delegation SHALL be additive and SHALL NOT replace the existing CEO proposal flow.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| High-visit listing | Visits > threshold, social opportunity identified | Daemon completes investigation | `social-pack` request optionally enqueued to creative-studio |
| No creative candidate | Visits normal, no social opportunity | Daemon completes | No creative-studio message enqueued |
| CEO proposal preserved | Delegation triggered | Daemon returns | Existing CEO proposal still enqueued alongside creative-studio request |

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

### Requirement: ownedEcommerceDaemon

`ownedEcommerceDaemon` MUST export `investigate(claim: AgentMessage): Promise<DaemonResult>`. It SHALL read owned ecommerce evidence (storefront projections, catalog readiness, SEO/GEO positioning) via `OperationalReadModelReader`, detect actionable signals, and enqueue CEO proposals. It SHALL set `noMutationExecuted: true`. It SHALL be a proposal-only daemon under CEO orchestration.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Storefront candidate detected | Catalog items meet owned-ecommerce criteria | Daemon investigates | CEO proposal enqueued with ranked storefront recommendations |
| No candidates | No catalog items qualify | Daemon investigates | Empty findings, proposalEnqueued: false |
| Proposal includes evidence | Storefront recommendation generated | Proposal enqueued | Recommendation includes evidence IDs, risks, and approval needs |
| No direct user interaction | Daemon has findings | investigate() returns | Proposal routed to CEO lane only; no Telegram/user message |
| Error during evidence read | Read model fails | investigate() throws | Error propagated to scheduler for message fail |

### Requirement: unansweredQuestionsDaemon

`unansweredQuestionsDaemon` MUST export `investigate(claim: AgentMessage): Promise<DaemonResult>`. It SHALL scan buyer questions via `OperationalReadModelReader`, detect questions older than a configurable deadline without seller response, and enqueue CEO proposals. It SHALL set `noMutationExecuted: true`. It SHALL NOT answer questions directly.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Unanswered question older than deadline | Question age > 24h, no response | Daemon investigates | CEO proposal with question text and recommended response |
| All questions answered | All questions have seller responses | Daemon investigates | Empty findings, proposalEnqueued: false |
| Multiple unanswered | 3 questions overdue | Daemon investigates | Single CEO proposal with all 3 questions aggregated |
| Deadline is configurable | `MSL_UNANSWERED_QUESTIONS_DEADLINE_HOURS` set to 48 | Question age is 30h | Not yet flagged (below threshold) |
| No questions data | Read model has no question snapshots | Daemon investigates | Empty findings, no error |

### Requirement: supplierManagerDaemon

`supplierManagerDaemon` MUST read `SupplierMirrorStore` (supplier items, stock observations, item mappings, sync ledger) and cross-reference Cortex `listing_snapshot` data. It SHALL detect three signals: cross-account stock discrepancy (`critical`), supplier price changes >5% (`warning`), and unpublished mirror items (`warning`). It MUST enqueue CEO proposals with `noMutationExecuted: true` and deduplicate via `sync_ledger` idempotency keys. Absent `supplierMirrorStore` SHALL return empty findings without error.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Stock discrepancy | Same item has stock >0 on seller A, stock=0 on seller B | Daemon investigates | Finding severity "critical" |
| Supplier price change | Supplier item price changed >5% from last known | Daemon investigates | Finding severity "warning" |
| Unfilled mirror item | Supplier item with no ml_item_id and no mappings | Daemon investigates | Finding severity "warning" |
| No signals | All checks pass or store absent | Daemon investigates | Empty findings, proposalEnqueued: false |
| Missing Cortex data | Listing snapshot absent for one seller | Daemon investigates | Signal skipped for that seller; others unaffected |
