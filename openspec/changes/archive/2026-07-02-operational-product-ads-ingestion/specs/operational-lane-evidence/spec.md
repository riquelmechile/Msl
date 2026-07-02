# Delta for Operational Lane Evidence

## MODIFIED Requirements

### Requirement: Lane-to-Signal Evidence Mapping

The system MUST maintain a hardcoded mapping from `LaneContract.requiredEvidenceKinds` to `BusinessSignalKind[]`. `OperationalEvidenceProvider.getEvidenceForLane(laneId, sellerId)` SHALL query `OperationalReadModelReader.findEvidence` per signal kind and return formatted context with evidence IDs and `captured_at` timestamps. The `market` and `campaign` lanes MUST be able to retrieve durable `product-ads-insights` evidence when that evidence exists in the operational DB.
(Previously: lane evidence mapping existed, but the requirement did not guarantee durable Product Ads evidence retrieval for market and campaign lanes.)

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
