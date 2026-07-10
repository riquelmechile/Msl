# Unit Economics Snapshot Specification

## Purpose

Per-unit profitability snapshot from gross revenue through net profit, scoped to seller/channel/order/item/SKU. Flags missing inputs and calculation completeness.

## Requirements

### Requirement: Snapshot Structure

A `UnitEconomicsSnapshot` MUST contain: `sellerId`, `channel`, `orderId`, `itemId`, `sku`, `grossRevenue` (Money), an array of `EconomicCostComponent`, `contributionProfit`, `netProfit`, `contributionMargin`, `netMargin`, `missingInputs: string[]`, `calculationStatus`, `evidenceIds: string[]`, and `calculatedAt`.

#### Scenario: Complete economic snapshot

- **GIVEN** grossRevenue=50000 CLP, all 11 cost types present with amounts
- **WHEN** snapshot is calculated
- **THEN** `contributionProfit` = grossRevenue − variable costs
- **AND** `netProfit` = contributionProfit − fixed costs
- **AND** `calculationStatus = "complete"`
- **AND** `missingInputs` is empty

### Requirement: Calculation Status

`calculationStatus` MUST be one of: `"complete"`, `"partial"`, `"unverifiable"`, `"disputed"`. Status MUST reflect data completeness — missing costs produce `"partial"`, disputed evidence produces `"disputed"`.

| Scenario | Condition | Status |
|----------|-----------|--------|
| All costs present | Every expected component populated | `complete` |
| Missing shipping cost | Shipping component absent | `partial` |
| Conflicting cost evidence | Two sources disagree on same cost | `disputed` |
| All evidence from single unverified source | No independent verification | `unverifiable` |

### Requirement: Missing Inputs Tracking

`missingInputs` MUST list every expected cost component not present. It MUST NOT include costs that are explicitly zero. Missing data MUST NOT be silently treated as zero.

#### Scenario: Partial snapshot with missing costs

- **GIVEN** grossRevenue present but shipping and packaging costs missing
- **WHEN** snapshot is calculated
- **THEN** `calculationStatus = "partial"`
- **AND** `missingInputs = ["shipping", "packaging"]`
- **AND** netProfit reflects only available costs

#### Scenario: Negative profit tracked accurately

- **GIVEN** grossRevenue=20000 CLP, total costs=35000 CLP
- **WHEN** snapshot is calculated
- **THEN** `netProfit` MUST be −15000 (negative allowed)
- **AND** `netMargin` MUST be negative

#### Scenario: Refunds reduce gross revenue

- **GIVEN** grossRevenue=50000 CLP, refunds=5000 CLP
- **WHEN** snapshot is calculated
- **THEN** effective gross revenue MUST reflect 45000 CLP post-refund

#### Scenario: Explicit zero cost

- **GIVEN** advertising cost component with amountMinor=0
- **WHEN** snapshot is constructed
- **THEN** zero cost is valid — not reported as missing
