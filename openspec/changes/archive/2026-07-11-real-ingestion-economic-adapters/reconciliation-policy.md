# Reconciliation Policy — Tolerance Rules, States, Dispute Handling

## Reconciliation States

The `EconomicReconciliationService` compares source totals (from cost components in the store) against computed totals (from `UnitEconomicsSnapshot` cost arrays):

| State | Condition | Meaning |
|-------|-----------|---------|
| `balanced` | `|snapshotTotal − storeTotal| === 0` | Perfect match. Data is consistent. |
| `balanced-with-tolerance` | `0 < |diff| ≤ tolerance` | Minor discrepancy within acceptable bounds. |
| `incomplete` | One side has data, the other doesn't | Ingestion incomplete — run it again. |
| `mismatched` | `|diff| > tolerance` | Significant discrepancy — investigation required. |
| `disputed` | Manual dispute flag set | Override: human has flagged a conflict. |

## Tolerance Rules

Default tolerance: **1 minor unit** (e.g., 1 CLP peso, 1 USD cent).

This accounts for rounding differences between:
- Cost components stored individually (each has `amountMinor`)
- Snapshot totals computed by summing them at calculation time

When the difference exceeds tolerance:
1. The reconciliation result shows `verdict: "mismatched"`
2. The difference in minor units is reported
3. A recommendation to re-ingest is included
4. The coverage report may show `reconciliation: "partial"`

## Reconciliation Procedure

### Automated (via tool)
```
reconcile_seller_economics(sellerId, tolerance?)
  → { verdict, snapshotCostsTotal, storeCostsTotal, difference, ... }
```

### Manual (via CLI)
```
npm run economic:reconcile -- --seller <id>
```

## What Reconciliation Does NOT Do

- **Does NOT correct data.** It only compares and reports.
- **Does NOT delete or reverse components.** Soft-delete only via explicit `reverseCostComponent`.
- **Does NOT change snapshot data.** Snapshots are immutable once calculated.
- **Does NOT mutate MercadoLibre.** Pipeline is read-only.

## Dispute Handling Flow

1. Reconciliation detects `mismatched` → flags to CEO
2. CEO investigates via `inspect_cost_components` and `inspect_unit_economics`
3. If data error confirmed → `reverseCostComponent(id, reason)` soft-deletes the wrong component
4. Re-ingestion recalculates with corrected data
5. Re-reconciliation should return `balanced` or `balanced-with-tolerance`

## Reconcilable vs Non-Reconcilable

| Reconcilable | Non-Reconcilable |
|-------------|-----------------|
| Cost component totals vs snapshot totals | Stub adapter data (no real source to compare) |
| Store-level aggregate vs snapshot-level aggregate | Per-order revenue (no independent source beyond ML) |
| Currency consistency within same seller | Cross-currency totals (different minor units) |
