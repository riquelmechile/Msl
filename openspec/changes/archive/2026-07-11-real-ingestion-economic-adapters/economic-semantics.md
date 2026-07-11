# Economic Semantics — Cost Component Definitions

## What Each Cost Component Means (and Doesn't Mean)

### Real Adapters (5 — data from ML API)

| Component | What It IS | What It Is NOT |
|-----------|------------|----------------|
| `marketplace_fee` | Real MercadoLibre commission charged on this sale, as returned by `getItemPrices`. | NOT an estimate or percentage. NOT a theoretical fee. |
| `shipping` | Actual shipping cost the seller paid for this order (from `getShipmentStatus`). | NOT buyer-paid shipping. NOT carrier estimates. |
| `seller_discount` | Discount amount funded by the seller (from `getItemPromotions`). | NOT ML-funded promotions. NOT coupon discounts. |
| `refund` / `return` | Actual charges for refund/return processing (from `getClaimReturnCost`). | NOT a reduction of revenue — revenue stays gross, refund is a separate cost. |
| `advertising` | Real ad spend for this order's product campaigns (from `getProductAdsInsights`). | NOT budget or estimate. NOT per-impression cost. |

### Stub Adapters (6 — data not yet available)

| Component | What It IS | What It Is NOT | Status |
|-----------|------------|----------------|--------|
| `product_cost` | Supplier cost of goods sold. | NOT ML listing price. NOT estimated. | Stub — requires Supplier Mirror connection |
| `landed_cost` | Total landed cost (product + freight + customs + import taxes). | NOT shipping alone. | Stub — requires customs data |
| `packaging` | Packaging materials cost per unit. | NOT shipping box cost. | Stub |
| `financing` | Cost of capital / financing for inventory. | NOT ML credit line interest. | Stub |
| `tax` | Business taxes beyond ML fees. | NOT VAT (IVA) — that's ML-handled. | Stub |
| `other` | Catch-all for costs that don't fit other categories. | NOT a dumping ground for unanalyzed costs. | Stub |

## Key Principles

1. **Gross Revenue is NOT a cost component.** It feeds the `UnitEconomicsSnapshot.grossRevenue` field directly.
2. **Missing ≠ Zero.** If a stub adapter returns empty, the snapshot declares `missingInputs` — the cost is unknown, not zero.
3. **Revenue and refunds are separate.** A refund does not reduce gross revenue; it adds a `refund` cost component.
4. **All amounts are in minor units.** No floating point math anywhere in the pipeline.
5. **Currency is per-order.** Cross-currency orders are separate snapshots.

## Cost Classification

| Classification | Types | Used For |
|----------------|-------|----------|
| Variable costs | `marketplace_fee`, `shipping`, `seller_discount`, `refund`, `return`, `advertising` | Contribution margin |
| Fixed/stub costs | `product_cost`, `landed_cost`, `packaging`, `financing`, `tax`, `other` | Full-cost accounting (when data available) |
