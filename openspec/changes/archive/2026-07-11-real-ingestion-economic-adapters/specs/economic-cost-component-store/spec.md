# Economic Cost Component Store Specification

## Purpose

SQLite persistence for `EconomicCostComponent` records using the existing `economic_cost_components` table. Seller-scoped, idempotent insertion, audited updates and deletions.

## Requirements

### Requirement: Cost Component CRUD

The store MUST provide `insertCostComponent`, `upsertCostComponent`, `listCostComponents`, `listBySourceRecord`, and `listBySeller` methods, all scoped to `sellerId`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Insert new component | Valid component with all fields | `insertCostComponent(component)` | Record persisted, retrievable by ID |
| List by seller | Seller A with 5 components, Seller B with 3 | `listBySeller("A")` | 5 records returned, none from B |
| List by source record | Component keyed to ML order 12345 | `listBySourceRecord("A", "12345")` | All components for that source record |

### Requirement: Idempotent Insertion

The store MUST prevent duplicates for the same `sourceRecordId + economicMeaning + sourceVersion` tuple. Duplicate insertion SHALL be a no-op.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Duplicate source+meaning+version | Existing component with (order-1, marketplace_fee, v3) | Insert same tuple again | No duplicate created, original returned |
| Same source, different meaning | Component for marketplace_fee on order-1 | Insert shipping_cost for order-1 | Both coexist |
| Same source+meaning, newer version | Component for (order-1, marketplace_fee, v3) | Insert (order-1, marketplace_fee, v5) | New version inserted, old superseded |

### Requirement: Source Update with Supersede

The store MUST support updating a component by marking the previous version as `superseded` and inserting a new version. MUST NOT use `INSERT OR REPLACE` that destroys history.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Supersede existing | Component v3 exists | Insert v4 with same source+meaning | v3 marked superseded, v4 is current |
| History preserved | v4 superseded v3 | Query all versions | Both v3 (superseded) and v4 (current) returned |

### Requirement: Audited Deletion

DELETE or reverse operations MUST be audited — never hard-delete. A reversed component SHALL carry `reversedAt` and `reversedReason`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Reverse component | Active component exists | `reverseCostComponent(id, reason)` | Component marked reversed, not deleted |
| List excludes reversed by default | 2 active, 1 reversed | `listBySeller("A")` | 2 active returned, reversed excluded |
