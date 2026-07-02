# Delta for Operational Lane Evidence

## MODIFIED Requirements

### Requirement: Lane-to-Signal Evidence Mapping

The system MUST maintain a hardcoded mapping from `LaneContract.requiredEvidenceKinds` to `BusinessSignalKind[]`. `OperationalEvidenceProvider.getEvidenceForLane(laneId, sellerId)` SHALL query `OperationalReadModelReader.findEvidence` per signal kind and return formatted context with evidence IDs and `captured_at` timestamps. The `market` and `campaign` lanes MUST retrieve durable `product-ads-insights` evidence when it exists. The `market` and `margin` lanes MUST retrieve durable `pricing` catalog competition evidence when present and MUST omit missing pricing evidence without failing.
(Previously: market/campaign Product Ads retrieval was guaranteed, but durable `pricing` competition retrieval for market and margin lanes was not.)

#### Scenario: Cost lane evidence retrieval
- GIVEN lane "cost" requires listing and order signal kinds
- WHEN `getEvidenceForLane("cost", sellerId)` is called
- THEN it MUST return formatted context for listing and order evidence with IDs and timestamps

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
- WHEN `getEvidenceForLane("market", sellerId)` is called
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
