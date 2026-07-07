# specialist-daemons Specification

## Purpose

Four investigation-only daemon workers that read operational evidence, detect actionable business signals, and enqueue CEO proposals via the agent message bus — `noMutationExecuted: true` at all times.

## Requirements

### Requirement: Shared Daemon Contract

Every daemon MUST export `investigate(claim: AgentMessage): Promise<DaemonResult>`. `DaemonResult` MUST have `{ findings: DaemonFinding[]; proposalEnqueued: boolean }`. Each finding MUST include `{ kind: string; severity: "info"|"warning"|"critical"; summary: string; evidenceIds: string[] }`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Findings returned | Daemon detects signals | investigate() completes | DaemonResult with findings array |
| No findings | No signals detected | investigate() completes | Empty findings, proposalEnqueued: false |
| Error during investigation | Evidence read fails | investigate() throws | Error propagated to scheduler for message fail |

### Requirement: No Mutation Boundary

ALL daemons MUST set `noMutationExecuted: true`. Daemon functions SHALL NOT call MercadoLibre write APIs, modify seller listings, or execute external mutations. They SHALL only read evidence via `OperationalReadModelReader` and `GraphEngine`, and enqueue proposals.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Listing API not called | Daemon processes evidence | Any daemon runs | No ML write API invoked |
| Only enqueue | Daemon has findings | investigate() returns | Proposal enqueued on bus, no mutation executed |

### Requirement: marketCatalogDaemon

`marketCatalogDaemon` MUST read listing snapshots and pricing evidence. It SHALL detect at minimum: active listings with visit counts below a configurable threshold, listings priced above similar-category competition, and paused listings with sales history eligible for relist. It SHALL absorb the detection logic currently in `runQualityChecks()` and `runRelistChecks()`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Low-visit active listing | Active listing, visits < threshold | Daemon investigates | Finding with severity "warning" |
| Above-market price | Listing price > median + buffer | Pricing evidence compared | Finding with severity "warning" |
| Paused-to-relist | Paused listing with salesCount > 0 | Daemon investigates | Finding with severity "info", recommendation to relist |

### Requirement: operationsManagerDaemon

`operationsManagerDaemon` MUST read claims, questions, messages, and order snapshots. It SHALL detect: new open claims without response, unanswered buyer questions older than a deadline, and orders in "delayed" shipping status beyond SLA.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| New open claim | Claim status "open", no seller message | Daemon investigates | Finding with severity "critical" |
| Unanswered question | Question status "unanswered", age > deadline | Daemon investigates | Finding with severity "warning" |
| Delayed order | Order shipment delayed beyond SLA | Daemon investigates | Finding with severity "critical" |

### Requirement: costSupplierDaemon

`costSupplierDaemon` MUST read listing snapshots, supplier evidence, and cost data. It SHALL detect: products where current price yields margin below target threshold, and items where stock is below restock watermark with positive visit trends.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Margin below threshold | (price - cost) / price < targetMargin | Daemon investigates | Finding with severity "critical" |
| Restock signal | Stock < restockWatermark, visits trending up | Daemon investigates | Finding with severity "info", restock recommendation |

### Requirement: creativeCommercialDaemon

`creativeCommercialDaemon` MUST read visit snapshots, order snapshots, and listing evidence. It SHALL detect: listings with high visits and low conversion (orders/visits ratio below threshold), and active listings stagnant without sales over a configurable window.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| High-visits low-conversion | Visits > threshold, orders/visits < threshold | Daemon investigates | Finding with severity "warning" |
| Stagnant stock | Active listing, last order > window ago | Daemon investigates | Finding with severity "info" |
