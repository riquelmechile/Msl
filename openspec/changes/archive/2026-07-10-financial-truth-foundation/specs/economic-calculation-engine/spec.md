# Economic Calculation Engine Specification

## Purpose

Pure deterministic functions for economic computation. No side effects, no NaN/Infinity, no silent zero-for-missing-data, no implicit currency mixing.

## Requirements

### Requirement: Deterministic Pure Functions

All calculation functions MUST be pure — same inputs produce same outputs, no side effects, no I/O. They MUST NOT throw for valid inputs; errors MUST be typed and intentional.

### Requirement: NaN and Infinity Protection

No calculation result MUST contain `NaN`, `Infinity`, or `-Infinity`. Division by zero or similar degenerate inputs MUST produce a defined error, not propagate NaN.

| Scenario | Input | Result |
|----------|-------|--------|
| Full positive profit | revenue=100000, costs=60000 | netProfit=40000, margin=40% |
| Negative profit | revenue=30000, costs=50000 | netProfit=−20000 (allowed) |
| Zero margin | revenue=50000, costs=50000 | netProfit=0, margin=0% |
| Refunds reduce revenue | revenue=50000, refunds=10000 | effectiveRevenue=40000 |
| Full return | revenue=50000, refunds=50000 | effectiveRevenue=0 |
| Missing cost | shipping cost undefined | status=partial, missingInputs=["shipping"] |
| Incompatible currency | revenue=CLP, cost=USD | CurrencyMismatchError |
| Overflow protection | amounts near Number.MAX_SAFE_INTEGER | result clamped or error — no silent overflow |

### Requirement: Currency Mixing Prevention

Any calculation combining values across different currencies MUST throw `CurrencyMismatchError` BEFORE producing a result. No implicit conversion is permitted.

#### Scenario: CLP revenue + USD cost rejected

- **GIVEN** revenue in CLP and a cost component in USD
- **WHEN** profit calculation is attempted
- **THEN** `CurrencyMismatchError` MUST be thrown — no result computed

### Requirement: Missing Data Handling

Missing cost data MUST NOT be treated as zero. Calculations with missing inputs MUST produce `calculationStatus: "partial"` and populate `missingInputs`. Only explicitly provided zero-cost components produce zero.

#### Scenario: Explicit zero vs missing

- **GIVEN** advertising cost explicitly set to `amountMinor=0` AND shipping cost absent
- **WHEN** snapshot is calculated
- **THEN** advertising=0 (explicit), shipping reported as missing — NOT zero

### Requirement: Contribution vs Net Profit

The engine MUST differentiate `contributionProfit` (grossRevenue − variable costs: cogs, fees, shipping, advertising, discounts, refunds, packaging) from `netProfit` (contributionProfit − fixed costs: taxes, financing, landed_cost, other).

#### Scenario: Contribution and net divergence

- **GIVEN** high variable costs but low fixed costs
- **WHEN** both profits calculated
- **THEN** contributionProfit SHALL reflect variable cost impact; netProfit SHALL include fixed overhead
