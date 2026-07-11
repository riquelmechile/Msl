# Data Quality Policy — Coverage States, Missing vs Zero, Confidence Rules

## Coverage States

Each dimension in `EconomicDataCoverage` receives one of four states:

| State | Meaning | Trigger |
|-------|---------|---------|
| `complete` | Data exists and is verified for this dimension | Cost components present, no disputes |
| `partial` | Some data exists but not all | Some cost types have data, some don't |
| `unverifiable` | Data exists but cannot be verified | No evidence references to trace provenance |
| `disputed` | Data exists but is under dispute | Any cost component in this dimension has `verification: "disputed"` |

## Coverage Dimensions

| Dimension | Cost Types Checked | Notes |
|-----------|-------------------|-------|
| `revenue` | Gross revenue availability | Always `complete` if any order processed |
| `marketplace_fee` | `marketplace_fee` | Real ML data |
| `shipping` | `shipping` | Seller-paid only |
| `seller_discount` | `seller_discount` | Seller-funded only |
| `refund_return` | `refund`, `return` | Combined dimension |
| `advertising` | `advertising` | Per campaign |
| `product_cost` | `product_cost` | Stub — always `partial` until Supplier Mirror |
| `landed_cost` | `landed_cost` | Stub — always `partial` until customs data |
| `currency_consistency` | Cross-currency check | `complete` if any data present |
| `evidence_current` | Evidence age | Currently `partial` (evidence store not yet built) |
| `evidence_disputed` | Disputed evidence count | Mirrors dispute state |
| `reconciliation` | Snapshot vs store totals | Determined by reconciliation service |

## Missing vs Zero

The pipeline NEVER substitutes zero for missing data:

- **Missing data**: The adapter declares `missingInputs: ["product_cost"]`. The snapshot records this. Profit calculations exclude this cost type.
- **Zero cost**: Only when real data confirms zero (e.g., free shipping promotion where seller actually paid nothing).
- **Default behavior**: If an adapter returns empty because data isn't available, it MUST also declare the dimension as missing.

## Confidence Rules

Confidence scores (0..1) are computed as:

```
confidence = min(0.95, (totalComponents - disputedCount) / max(totalComponents, 1))
```

Rules:
- 0 components → confidence 0.5 (unknown baseline)
- All components verified → confidence 0.95 (never 1.0 — epistemic humility)
- Disputed components reduce confidence proportionally
- Stub dimensions don't penalize confidence (they're expected to be partial)

## Dispute Handling

A cost component becomes `disputed` when:
1. Reconciliation between snapshots and store totals exceeds tolerance
2. Manual override marks it as disputed via tool
3. Source data changes after verification

Disputed dimensions appear in `disputedDimensions` on the coverage report. They remain queryable but are flagged.
