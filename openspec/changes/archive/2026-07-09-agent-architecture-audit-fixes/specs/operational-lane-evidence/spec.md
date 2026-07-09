# Delta for operational-lane-evidence

## ADDED Requirements

### Requirement: Morning Report Lane Evidence

`getEvidenceForLane("morning-report", sellerId)` MUST return formatted operational context including: active listing count, new orders since last report, pending claims, unanswered questions count, and shipping status summary. Each evidence entry SHALL include its evidence ID and `captured_at` timestamp. The lane SHALL be mapped in `LaneEvidenceMapping`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Morning report with data | Seller has active listings, pending orders, open claims | getEvidenceForLane("morning-report") | Formatted context with listing count, order summary, claim alert, question count |
| No data available | Seller has no snapshots yet | getEvidenceForLane("morning-report") | Empty context; no error |
| Evidence includes timestamps | Listings snapshot captured at T0 | Formatted for prompt | Each entry includes evidence ID and captured_at |
| Morning report lane mapped | LaneContracts includes morning-report | EvidenceProvider initialized | "morning-report" → listing + order + claim + question signal kinds |

### Requirement: End-of-Day Summary Lane Evidence

`getEvidenceForLane("eod-summary", sellerId)` MUST return formatted operational context including: total orders today, total sales value, claims resolved vs pending, questions answered vs unanswered, and shipping completions. The lane SHALL aggregate across all seller IDs when the CEO lane queries without seller scope.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| EOD summary with data | Seller had 5 orders, 2 claims resolved today | getEvidenceForLane("eod-summary") | Formatted context with order count, sales total, claim resolution ratio, shipping status |
| Multi-seller aggregation | CEO lane requests "eod-summary" without seller scope | getEvidenceForLane("eod-summary") | Aggregated context across all configured sellers |
| Partial data | Orders exist but no claims today | getEvidenceForLane("eod-summary") | Order/shipping data present; claims section empty or omitted |
| No data available | No snapshots for today | getEvidenceForLane("eod-summary") | Empty context; no error |

## MODIFIED Requirements

### Requirement: Lane-to-Signal Evidence Mapping

The system MUST maintain a hardcoded mapping from `LaneContract.requiredEvidenceKinds` to `BusinessSignalKind[]`. `OperationalEvidenceProvider.getEvidenceForLane(laneId, sellerId)` SHALL query `OperationalReadModelReader.findEvidence` per signal kind and return formatted context with evidence IDs and `captured_at` timestamps. The `morning-report` lane SHALL map to `listing`, `order`, `claim`, and `question` signal kinds. The `eod-summary` lane SHALL map to `order`, `claim`, `question`, and `shipping` signal kinds. The `market` and `campaign` lanes MUST retrieve durable `product-ads-insights` evidence when it exists.
(Previously: morning-report and eod-summary lanes were not mapped; provider had no evidence mapping for these lanes.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Morning report evidence retrieval | Lane "morning-report" mapped | getEvidenceForLane("morning-report", sellerId) | Formatted listing, order, claim, question context returned |
| EOD summary evidence retrieval | Lane "eod-summary" mapped | getEvidenceForLane("eod-summary", sellerId) | Formatted order, claim, question, shipping context returned |
| Unknown lane requested | Lane ID with no mapping entry | getEvidenceForLane called | Empty context without error |
| Campaign lane retrieves Product Ads evidence | Durable product-ads-insights evidence exists | getEvidenceForLane("campaign", sellerId) | Formatted Product Ads evidence with evidence ID and timestamp |
| Market lane retrieves pricing evidence | Durable pricing evidence exists | getEvidenceForLane("market", sellerId) | Formatted pricing evidence with evidence ID and timestamp |
