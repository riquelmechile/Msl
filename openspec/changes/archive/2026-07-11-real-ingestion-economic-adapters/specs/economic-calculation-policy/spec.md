# Economic Calculation Policy Specification

## Purpose

Defines the unit economics formula, integer-only math rules, and currency consistency policy for snapshot computation.

## Requirements

### Requirement: Unit Economics Formula

The system MUST use the existing `computeUnitEconomics()` from `@msl/domain`. Formula: `grossRevenue - sellerFundedDiscounts - refunds - marketplaceFees - sellerShippingCost - advertisingCost - productCost - allocatedLandedCost - taxes - financingCost - packagingCost - otherCosts = netProfit`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Complete calculation | All 12 inputs present | `computeUnitEconomics()` | `netProfit` computed, `calculationStatus: "complete"` |
| Partial inputs | 7 of 12 inputs present | `computeUnitEconomics()` | `netProfit` computed with available inputs, `missingInputs` populated, `calculationStatus: "partial"` |
| Only revenue | Only `grossRevenue: 50000` | `computeUnitEconomics()` | `contributionProfit: 50000`, `netProfit: 50000`, `missingInputs` lists all 11 missing costs |

### Requirement: Contribution vs Net Profit

The system MUST distinguish `contributionProfit` (revenue minus direct costs: marketplace fees, discounts, refunds, shipping, advertising) from `netProfit` (contribution minus all costs including product, landed, packaging, financing, tax, other).

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Direct costs only known | Revenue 50000, fees 5000, ads 3000 | Compute | `contributionProfit: 42000`, `netProfit: 42000` (same, product cost missing) |
| All costs known | Revenue 50000, all 12 inputs | Compute | `netProfit` strictly less than `contributionProfit` |

### Requirement: No Double Counting

The system MUST NOT count the same economic event in two cost categories.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Refund vs revenue reversal | 5000 refund on 50000 order | Compute | Revenue stays 50000 gross, refund is separate cost component — never revenue=45000 AND refund=5000 |

### Requirement: Integer Minor Units

All amounts MUST use integer minor units. Floating-point arithmetic SHALL NOT appear in any calculation.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| CLP division | 10000 CLP split across 3 items | Compute | Each gets integer share, remainder allocated to first item |
| Float input detected | `amountMinor: 1234.56` | Validation | Rejected before computation |

### Requirement: Currency Consistency

CLP orders: all components MUST be CLP. USD costs MUST NOT be directly added to CLP — they MUST be flagged as missing or pending explicit FX. No automatic FX query in this PR.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| CLP order, USD cost | Order in CLP, supplier cost in USD | Compute | USD cost excluded, `missingInputs` flags `product_cost` with note "USD pending FX" |
| All CLP | Order and all components in CLP | Compute | Normal calculation |
| Mixed currency detection | Feeder tries CLP + USD addition | Validation | Rejected with `CurrencyMismatchError` |
