# Operational Lane Evidence Specification

## Purpose

Provide per-lane operational evidence for CEO/specialist conversations by mapping lane contracts to business signals and formatting operational DB snapshots into LLM-readable context strings.

## Requirements

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

### Requirement: Lane-to-Signal Evidence Mapping

The system MUST maintain a hardcoded mapping from `LaneContract.requiredEvidenceKinds` to `BusinessSignalKind[]`. `OperationalEvidenceProvider.getEvidenceForLane(laneId, sellerId)` SHALL query `OperationalReadModelReader.findEvidence` per signal kind and return formatted context with evidence IDs and `captured_at` timestamps. The `morning-report` lane SHALL map to `listing`, `order`, `claim`, and `question` signal kinds. The `eod-summary` lane SHALL map to `order`, `claim`, `question`, and `shipping` signal kinds. The `market` and `campaign` lanes MUST retrieve durable `product-ads-insights` evidence when it exists. The `market` and `margin` lanes MUST retrieve durable `pricing` catalog competition evidence when present and MUST omit missing pricing evidence without failing.
(Previously: morning-report and eod-summary lanes were not mapped; provider had no evidence mapping for these lanes.)

#### Scenario: Cost lane evidence retrieval

- GIVEN lane "cost" requires listing and order signal kinds
- WHEN `getEvidenceForLane("cost", sellerId)` is called
- THEN it MUST return formatted context for listing and order evidence with IDs and timestamps

#### Scenario: Morning report evidence retrieval

- GIVEN lane "morning-report" mapped
- WHEN `getEvidenceForLane("morning-report", sellerId)` is called
- THEN it MUST return formatted listing, order, claim, question context returned

#### Scenario: EOD summary evidence retrieval

- GIVEN lane "eod-summary" mapped
- WHEN `getEvidenceForLane("eod-summary", sellerId)` is called
- THEN it MUST return formatted order, claim, question, shipping context returned

#### Scenario: Unknown lane requested

- GIVEN a lane ID with no mapping entry
- WHEN `getEvidenceForLane` is called
- THEN it MUST return empty context without error

#### Scenario: Campaign lane retrieves Product Ads evidence

- GIVEN durable `product-ads-insights` evidence exists for a seller
- WHEN `getEvidenceForLane("campaign", sellerId)` is called
- THEN it MUST return formatted Product Ads evidence with evidence ID and timestamp

#### Scenario: Market lane retrieves Product Ads evidence

- GIVEN durable `product-ads-insights` evidence exists for a seller
- WHEN `getEvidenceForLane("market", sellerId)` is called
- THEN it MUST return formatted Product Ads evidence with evidence ID and timestamp

#### Scenario: Product Ads evidence missing

- GIVEN no durable `product-ads-insights` evidence exists for a seller
- WHEN campaign or market lane evidence is requested
- THEN the provider MUST omit Product Ads context without error

#### Scenario: Market lane retrieves pricing competition evidence

- GIVEN durable `pricing` price-to-win evidence exists for a seller
- WHEN `getEvidenceForLane("market", sellerId)"` is called
- THEN it MUST return formatted pricing evidence with evidence ID and timestamp

#### Scenario: Margin lane retrieves pricing competition evidence

- GIVEN durable `pricing` price-to-win evidence exists for a seller
- WHEN `getEvidenceForLane("margin", sellerId)` is called
- THEN it MUST return formatted pricing evidence with evidence ID and timestamp

#### Scenario: Pricing evidence missing or partial

- GIVEN no durable `pricing` evidence exists, or only partial pricing evidence exists
- WHEN market or margin lane evidence is requested
- THEN the provider MUST omit or label limited pricing context without error
- AND it MUST NOT perform price mutation or AI image generation

### Requirement: Operational Context Formatting

The system MUST format each evidence item as a compact line for LLM prompt injection, including evidence ID, signal kind, and `captured_at` timestamp. Each line SHALL be ≤ 80 chars, and `pricing` evidence lines MUST remain read-only evidence descriptions.
(Previously: formatting did not explicitly constrain `pricing` evidence to read-only prompt context.)

#### Scenario: Evidence formatted for prompt injection

- GIVEN listing evidence with ID "evt-42" and captured_at "2026-07-02T10:00:00Z"
- WHEN formatted
- THEN output MUST include both the ID and captured_at value

#### Scenario: Multiple evidence items

- GIVEN three evidence items for a lane
- WHEN formatted for prompt use
- THEN each item MUST appear on its own line with its ID and timestamp

#### Scenario: Pricing context is safe-read only

- GIVEN pricing evidence contains catalog competition values
- WHEN formatted for market or margin lane context
- THEN it MUST be described as evidence only
- AND it MUST NOT request price updates, promotion changes, or AI image generation

### Requirement: Structured Evidence Retrieval

`OperationalEvidenceProvider` MUST provide `getStructuredEvidenceForLane(laneId, sellerId)` returning typed data arrays instead of compact ID-only strings. Each result entry SHALL include the full snapshot data payload from `readSnapshot<TData>()`, evidence metadata, and parsed business fields.

The existing `getEvidenceForLane()` method MUST remain unchanged: same signature, same compact string output, same lane-to-signal mapping. No existing call site requires modification.

#### Scenario: Structured evidence includes full data

- GIVEN listing evidence exists for lane "cost"
- WHEN `getStructuredEvidenceForLane("cost", sellerId)` is called
- THEN results MUST be an array of structured objects containing the parsed `data` field from each snapshot
- AND each entry MUST include the evidence timestamp and signal kind

#### Scenario: Backward compatible string evidence

- GIVEN existing call sites invoke `getEvidenceForLane("market", sellerId)`
- WHEN the provider is updated
- THEN `getEvidenceForLane` MUST return the same compact string format as before
- AND no existing tests or agent prompts require changes

#### Scenario: Unknown lane returns empty result

- GIVEN a lane ID with no mapping entry
- WHEN `getStructuredEvidenceForLane(unknownLane, sellerId)` is called
- THEN it MUST return an empty array without error

#### Scenario: Structured evidence preserves completeness metadata

- GIVEN a snapshot with completeness "complete" and confidence "high"
- WHEN returned via `getStructuredEvidenceForLane`
- THEN the structured entry MUST carry completeness, confidence, and freshness metadata alongside the data payload
