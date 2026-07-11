# Source Mapping — ML Endpoints → Economic Meaning

## Overview

This document maps every MercadoLibre API endpoint used by the economic ingestion pipeline to its economic meaning, cost component type, currency, and seller scope.

## Mapping Table

| ML Endpoint | Field | Economic Meaning | Cost Component Type | Currency | Notes |
|------------|-------|------------------|--------------------| ------- |-------|
| `getOrders` | `total_amount` | Gross revenue per order | _(not a cost — feeds snapshot input)_ | Order currency | Paid orders only; cancelled → null |
| `getItem` | `price` | Listing price per item | _(not a cost — feeds snapshot input)_ | Listing currency | Per line item |
| `getItemPrices(siteId, price, categoryId)` | `sale_fee_amount` | Marketplace commission (real fee) | `marketplace_fee` | CLP (minor units) | Real ML fee calculation |
| `getShipmentStatus` | shipping cost | Shipping cost paid by seller | `shipping` | Order currency | Seller-paid only; buyer-paid → excluded |
| `getItemPromotions` | `seller_percentage` | Discount funded by seller | `seller_discount` | Order currency | ML-funded discounts excluded |
| `getClaimReturnCost` | `total_cost` | Refund/return charges | `refund` / `return` | CLP (minor units) | Linked to specific item |
| `getProductAdsInsights` | `cost` metric | Advertising spend per campaign | `advertising` | CLP (minor units) | Campaign-level; allocated to orders |

## Fields NOT Used

| Field | Reason |
|-------|--------|
| Buyer name | PII — not stored |
| Buyer email | PII — not stored |
| Buyer phone | PII — not stored |
| Buyer address | PII — not stored |
| Card/bank info | Never fetched |
| Item description HTML | Not economic data |

## Currency Rules

- All amounts are stored in minor units (integer): CLP = pesos, USD = cents
- Currency is derived from the order/listing context
- Cross-currency orders are flagged for review
- The `Money` domain type (`amountMinor: number, currency: Currency`) is used throughout

## Seller Scope

Every mapping is seller-scoped — data is fetched through per-seller OAuth tokens. A Plasticov order's economic data is never mixed with Maustian's.

## Future Sources

| Source | Economic Meaning | Status |
|--------|-----------------|--------|
| Supplier Mirror (Jinpeng) | `product_cost` | Stub — not yet connected |
| Customs/aduanas | `landed_cost` | Stub — not yet connected |
| Carrier APIs | `shipping` (carrier-verified) | Enhancement opportunity |
