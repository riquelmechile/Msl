# supplier-manager-daemon Specification

## Purpose

Daemon that reads `SupplierMirrorStore` and Cortex snapshots to detect cross-account stock gaps, supplier price shifts, and unfilled mirror items. Enqueues CEO proposals only — `noMutationExecuted: true`.

## Requirements

### Requirement: Cross-Account Stock Discrepancy Detection

The daemon MUST detect supplier items mapped to multiple target sellers where stock observations differ by a significant gap (one seller has stock > 0, another has 0). Detections SHALL have severity `critical` and kind `alert`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Stock gap detected | Supplier item S001 mapped to sellers A and B; A stock=12, B stock=0 via Cortex listing_snapshot | Daemon investigates | Finding severity "critical", evidence references both seller listing IDs |
| No stock gap | Both mapped sellers show stock > 0 | Daemon investigates | No finding for this item |
| Missing Cortex data | Seller listing has no listing_snapshot in Cortex | Daemon investigates | Signal skipped for that seller; other sellers still evaluated |

### Requirement: Supplier Price Change Detection

The daemon MUST detect supplier items where the current purchase price differs from the last known price by more than 5% (configurable threshold). Detections SHALL have severity `warning`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Price increase >5% | Supplier item price changed from 1000 to 1100 | Daemon compares supplier_items.price vs stored prior | Finding severity "warning", summary includes old/new price and delta |
| Change ≤5% | Supplier item price changed from 1000 to 1040 | Daemon compares | No finding — below threshold |
| Single observation | Item has only one price record | Daemon investigates | No finding — no baseline for comparison |

### Requirement: Unfilled Mirror Item Detection

The daemon MUST detect supplier items that have never been published to any MercadoLibre seller (`ml_item_id` is null AND no `item_mappings` exist). Detections SHALL have severity `warning`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Unpublished mirror item | Supplier item has ml_item_id=null, no mappings | Daemon queries store | Finding severity "warning", item identified by supplier_item_id |
| Published item | Supplier item has ml_item_id set OR has active mapping | Daemon queries | No finding |

### Requirement: Daemon Contract

The daemon MUST export an `investigate` function conforming to `DaemonHandler`. It SHALL accept `supplierMirrorStore` via the extended handler input. Findings MUST use `{ kind, severity, summary, evidenceIds }`. Proposals SHALL be enqueued to the `ceo` lane via the message bus.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Findings enqueued | One or more signals detected | investigate() completes | `proposalEnqueued: true`, messageIds populated |
| No findings | All signals pass or data missing | investigate() completes | Empty findings, `proposalEnqueued: false` |

### Requirement: Deduplication via Sync Ledger

The daemon MUST use `sync_ledger` idempotency keys per detection cycle to prevent duplicate proposals. Idempotency keys SHALL encode `{signal_kind}_{supplier_id}_{supplier_item_id}_{detection_timestamp_truncated_to_hour}`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Duplicate signal same cycle | Signal already recorded in sync_ledger with matching idempotency key | Daemon detects same condition again | Signal skipped — no duplicate proposal |
| New signal | No matching idempotency key in sync_ledger | Daemon detects condition | Finding enqueued, ledger record appended |

### Requirement: No-Mutation Boundary

The daemon MUST set `noMutationExecuted: true`. It SHALL NOT call MercadoLibre write APIs, modify seller listings, or update sync_product proposals. It SHALL only read from `SupplierMirrorStore`, Cortex, and the ORM reader, and enqueue findings.

### Requirement: Graceful Degradation

The daemon SHALL return empty findings with no errors when `supplierMirrorStore` is absent or unavailable. Missing Cortex or ORM data for individual sellers SHALL skip affected signals without failing other detections.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Store absent | supplierMirrorStore is undefined | investigate() runs | Empty findings, `proposalEnqueued: false`, no error |
| Partial Cortex missing | One seller has no Cortex data, another has full data | investigate() runs | Seller without data skipped; signals evaluated for remaining seller |
