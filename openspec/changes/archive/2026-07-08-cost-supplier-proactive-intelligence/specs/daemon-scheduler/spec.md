# Delta for daemon-scheduler

## MODIFIED Requirements

### Requirement: Agent-to-Daemon Handler Map

The scheduler MUST maintain a static mapping from `LaneId` to daemon handler functions. Only lanes `cost-supplier`, `market-catalog`, `creative-assets`, `creative-commercial`, `operations-manager`, `product-ads-monitor`, `product-ads-profitability`, `product-ads-ceo-profitability`, and `supplier-manager` SHALL have handlers. Unknown lanes MUST be skipped.
(Previously: handler map already existed; no lane changes)

The scheduler config SHALL accept an optional `costSupplierAdvisor` parameter typed as `CostSupplierDeepSeekAdvisor`. When present, the scheduler MUST pass it to the costSupplierDaemon handler via the `advisor` field in the handler input. When absent, the handler receives `undefined`.
