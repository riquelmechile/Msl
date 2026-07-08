# Delta for specialist-daemons

## ADDED Requirements

### Requirement: supplierManagerDaemon

`supplierManagerDaemon` MUST read `SupplierMirrorStore` (supplier items, stock observations, item mappings, sync ledger) and cross-reference Cortex `listing_snapshot` data. It SHALL detect three signals: cross-account stock discrepancy (`critical`), supplier price changes >5% (`warning`), and unpublished mirror items (`warning`). It MUST enqueue CEO proposals with `noMutationExecuted: true` and deduplicate via `sync_ledger` idempotency keys. Absent `supplierMirrorStore` SHALL return empty findings without error.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Stock discrepancy | Same item has stock >0 on seller A, stock=0 on seller B | Daemon investigates | Finding severity "critical" |
| Supplier price change | Supplier item price changed >5% from last known | Daemon investigates | Finding severity "warning" |
| Unfilled mirror item | Supplier item with no ml_item_id and no mappings | Daemon investigates | Finding severity "warning" |
| No signals | All checks pass or store absent | Daemon investigates | Empty findings, proposalEnqueued: false |
| Missing Cortex data | Listing snapshot absent for one seller | Daemon investigates | Signal skipped for that seller; others unaffected |
