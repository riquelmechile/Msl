# Economic Adapters Specification

## Purpose

Pure mapper functions transforming MercadoLibre data into `EconomicCostComponent[]` with source attribution. No LLM, no mutation, no estimation except where explicitly documented.

## Requirements

### Requirement: OrderRevenueAdapter

SHALL produce `type: "gross_revenue"` from real evidence. MUST use amounts effectively attributable to seller. MUST exclude cancelled-unpaid orders. MUST handle partial payments. MUST preserve currency.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Paid order | Order #100, paid 50000 CLP | Adapt | Component: 50000 CLP, type `gross_revenue` |
| Cancelled unpaid | Order #101, status `cancelled`, payment `null` | Adapt | No component produced |
| Partial payment | Order #102, total 40000, paid 15000 | Adapt | Component: 15000 CLP, evidence notes partial |
| Multi-item order | Order #103, 3 items, total 90000 | Adapt | Revenue split proportionally per item |
| Shipping not revenue | Shipping cost 5000 in order | Adapt | Shipping NOT added to gross_revenue |

### Requirement: MarketplaceFeeAdapter

SHALL produce `type: "marketplace_fee"`. MUST use real charges from ML. Correct sign (+) and currency. MUST mark as `missing` when endpoint lacks fee data — never estimate.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Fee available | Payment shows `sale_fee: 5500` | Adapt | Component: 5500 CLP, `source:mercadolibre`, `verification:verified` |
| Fee unavailable | Endpoint returns no fee field | Adapt | Component NOT created, `missingInputs` includes `marketplace_fee` |
| Estimated fee | No real fee, cost model estimated 5000 | Adapt | IF created, MUST use `source:derived`, `verification:unverified`, `confidence < 0.5` |

### Requirement: ShippingCostAdapter

SHALL produce `type: "shipping"`. MUST differentiate: buyer-paid, ML-subsidized, seller-funded, real logistic cost. Only `sellerShippingCost` enters as seller cost.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Seller-paid shipping | Order #200, seller cost 3500 | Adapt | Component: 3500 CLP, type `shipping` |
| Buyer-paid shipping | Order #201, buyer paid 5000 | Adapt | No seller cost component produced |
| Cancelled shipping | Order #202 cancelled, shipping unused | Adapt | No shipping cost component |

### Requirement: SellerDiscountAdapter

SHALL produce `type: "seller_discount"`. MUST distinguish seller-funded from ML-funded/coupon/shared. Only seller-funded portion enters as cost.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Seller discount | 10% seller-funded on 30000 item | Adapt | Component: 3000 CLP, type `seller_discount` |
| ML-funded promotion | 20% ML-funded, 0% seller | Adapt | No seller_discount component |
| Shared promotion | 15% split: 10% ML, 5% seller on 40000 | Adapt | Component: 2000 CLP (seller portion only) |

### Requirement: RefundReturnAdapter

SHALL produce refund/return components per real semantics. Handle: total, partial, specific item, partial quantity, claim, return-without-refund, refund-without-return, chargeback. MUST NOT double-count refund and revenue reversal. Policy: keep revenue gross, discount refund as component.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Full refund | Order #300 fully refunded 50000 | Adapt | `refund` component: 50000 CLP |
| Partial item refund | 1 of 3 items refunded 15000 | Adapt | `refund` component: 15000 CLP, linked to item |
| Return without refund | Buyer returned, no refund issued | Adapt | `return` component: 0 CLP, status documented |

### Requirement: AdvertisingCostAdapter

SHALL produce `type: "advertising"`. Uses real Product Ads costs. If only daily/campaign cost: do NOT arbitrarily assign to order; keep at item/period level with `source:derived`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Order-level ad cost | Order #400, ad cost 1200 CLP documented | Adapt | Component: 1200 CLP, `source:mercadolibre` |
| Campaign-level only | Campaign C cost 50000, 50 orders | Adapt | Distributed cost with `source:derived`, documented allocation policy |
| ROAS interpretation | ROAS 4.7 from ML | Adapt | ROAS noted in metadata but NOT treated as net profit |

### Requirement: ProductCostAdapter

SHALL produce `type: "product_cost"`. Valid sources: Supplier Mirror, cost catalog, verified manual data. NEVER use sale price as cost. Missing cost: `missingInputs` includes `product_cost`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Supplier Mirror cost | SKU X, cost 8000 from Supplier Mirror | Adapt | Component: 8000 CLP |
| No cost data | SKU Y, no cost source | Adapt | No component, `missingInputs` flags `product_cost` |
| Sale price as cost attempt | SKU Z, sale 15000, no cost data | Adapt | REJECTED — sale price never becomes cost |

### Requirement: LandedCostAdapter

SHALL produce `type: "landed_cost"` only when sufficient evidence of supplier price, freight, insurance, tariff, import VAT, port, agent, local transport exists. Incomplete: mark missing, don't declare productive.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Complete landed cost | All 8 cost elements documented | Adapt | Component with sum |
| Partial landed cost | Only 3 of 8 elements | Adapt | No component, `missingInputs` flags `landed_cost` |

### Requirement: Zero-Component Discipline

Other adapters (packaging, financing, tax, other) SHALL be implemented only when real sources exist. MUST NOT create zero components to "complete" snapshots.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| No packaging cost data | Order #500, no packaging source | Adapt | No packaging component created (not zero) |
