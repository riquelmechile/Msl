# Economic Reconciliation Specification

## Purpose

Compares ingested economic data against source records to detect discrepancies, with explicit tolerances and honest status reporting.

## Requirements

### Requirement: EconomicReconciliationService

The service MUST compare: orders total, gross revenue, approved payments, refunds, fees, shipping, ads, snapshots generated, source records. Results SHALL be one of: `balanced`, `balanced-with-tolerance`, `incomplete`, `mismatched`, `disputed`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Balanced | ML orders match snapshots exactly | Reconcile | Status `balanced` |
| Within tolerance | ML total 50000, snapshot total 50010 | Reconcile with tolerance=20 | Status `balanced-with-tolerance` |
| Mismatched | ML total 50000, snapshot total 35000 | Reconcile | Status `mismatched`, discrepancy 15000 documented |
| Incomplete | 40 ML orders, 25 snapshots | Reconcile | Status `incomplete`, 15 gaps documented |

### Requirement: Reconciliation Record

Each reconciliation MUST record: expected amount, observed amount, difference, tolerance, currency, source IDs, reason codes. All amounts in integer minor units.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Revenue discrepancy | Expected 100000, observed 95000 | Record discrepancy | `difference: 5000`, `reasonCodes: ["payment-unmatched"]` |
| Fee mismatch | Expected fee 5500, observed 4800 | Record mismatch | `difference: 700`, `sourceIds: ["pay-777"]` |

### Requirement: Tolerance Policy

Tolerances MUST be explicit, documented, and in integer minor units. MUST NEVER be used to hide large differences or force "complete" status on mismatched data.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Tight tolerance | tolerance=10, difference=5 | Reconcile | `balanced-with-tolerance` |
| Wide tolerance abuse | tolerance=50000, difference=45000 | Validation | Flagged — tolerance proportionally unreasonable |

### Requirement: Honest Completion

The system MUST NEVER mark data as `complete` when reconciliation fails, regardless of how many components exist.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Reconciliation fails | service returns `mismatched` | Snapshot status evaluated | Snapshot remains `disputed`, NOT `complete` |
