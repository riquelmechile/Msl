# Delta for specialist-daemons

## MODIFIED Requirements

### Requirement: costSupplierDaemon

`costSupplierDaemon` MUST read listing snapshots, supplier evidence, and cost data using `searchSnapshots()` with status and price-range filters. It SHALL detect: products where current price yields margin below target threshold, and items where stock is below restock watermark with positive visit trends.
(Previously: rule-only detection without AI enrichment)

When `costSupplierAdvisor` is present and the daemon has findings with severity "critical" or "warning", the daemon MUST call `costSupplierAdvisor.analyze()` with margin, cost, and restock signals. The resulting enrichment SHALL be appended as `aiEnrichment` on the CEO proposal payload. When `costSupplierAdvisor` is absent or enrichment fails, the daemon SHALL fall back to rule-only proposals.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Margin below threshold | (price - cost) / price < targetMargin | Daemon investigates | Finding with severity "critical" |
| Restock signal | Stock < restockWatermark, visits trending up | Daemon investigates | Finding with severity "info", restock recommendation |
| AI enrichment on critical | Advisor present, critical findings exist | Daemon investigates | Proposal payload includes `aiEnrichment` block |
| AI enrichment on warning | Advisor present, warning findings exist | Daemon investigates | Proposal payload includes `aiEnrichment` block |
| Enrichment skipped on info | Advisor present, only info findings | Daemon investigates | No `aiEnrichment` on proposal |
| Advisor absent | Advisor not configured | Daemon investigates | Rule-only proposal, no `aiEnrichment` |
| Advisor failure | Advisor throws | Daemon investigates | Rule-only fallback, error logged |
