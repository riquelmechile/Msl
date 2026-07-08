# Delta for daemon-scheduler

## MODIFIED Requirements

### Requirement: Agent-to-Daemon Handler Map

The scheduler MUST maintain a static mapping from `LaneId` to daemon handler functions. Only lanes `cost-supplier`, `market-catalog`, `creative-assets`, `creative-commercial`, `operations-manager`, `product-ads-monitor`, and `supplier-manager` SHALL have handlers. Unknown lanes MUST be skipped.
(Previously: handler map did not include `supplier-manager` lane)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Known lane | Agent with laneId "market-catalog" | Scheduler routes | Dispatched to marketCatalogDaemon |
| Creative assets lane | Agent with laneId "creative-assets" | Scheduler routes | Dispatched to creativeAssetsDaemon |
| Product Ads Monitor lane | Agent with laneId "product-ads-monitor" | Scheduler routes | Dispatched to productAdsMonitorDaemon |
| Supplier Manager lane | Agent with laneId "supplier-manager" | Scheduler routes | Dispatched to supplierManagerDaemon |
| CEO lane | Agent with laneId "ceo" | Scheduler routes | Skipped — no daemon handler |
| Unknown lane | Agent with unmapped laneId | Scheduler routes | Skipped — no error |
