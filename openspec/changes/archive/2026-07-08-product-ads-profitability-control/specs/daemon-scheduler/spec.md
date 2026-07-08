# Delta for daemon-scheduler

## MODIFIED Requirements

### Requirement: Agent-to-Daemon Handler Map

The scheduler MUST maintain a static mapping from `LaneId` to daemon handler functions. Only lanes `cost-supplier`, `market-catalog`, `creative-assets`, `creative-commercial`, `operations-manager`, `product-ads-monitor`, `product-ads-profitability`, and `supplier-manager` SHALL have handlers. Unknown lanes MUST be skipped.
(Previously: handler map did not include `product-ads-profitability` lane)

#### Scenario: Known lane

- GIVEN an agent with laneId "market-catalog"
- WHEN the scheduler routes
- THEN dispatched to marketCatalogDaemon

#### Scenario: Creative assets lane

- GIVEN an agent with laneId "creative-assets"
- WHEN the scheduler routes
- THEN dispatched to creativeAssetsDaemon

#### Scenario: Product Ads Monitor lane

- GIVEN an agent with laneId "product-ads-monitor"
- WHEN the scheduler routes
- THEN dispatched to productAdsMonitorDaemon

#### Scenario: Product Ads Profitability lane

- GIVEN an agent with laneId "product-ads-profitability"
- WHEN the scheduler routes
- THEN dispatched to productAdsProfitabilityDaemon

#### Scenario: Supplier Manager lane

- GIVEN an agent with laneId "supplier-manager"
- WHEN the scheduler routes
- THEN dispatched to supplierManagerDaemon

#### Scenario: CEO lane

- GIVEN an agent with laneId "ceo"
- WHEN the scheduler routes
- THEN skipped — no daemon handler

#### Scenario: Unknown lane

- GIVEN an agent with unmapped laneId
- WHEN the scheduler routes
- THEN skipped — no error
