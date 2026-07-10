# Money Type Specification

## Purpose

Safe monetary representation. Integer-only `amountMinor` with explicit CLP/USD currency. No floating point used in any financial calculation path.

## Requirements

### Requirement: Money Value Representation

The `Money` type MUST store amounts as integer minor units (`amountMinor: number`, whole CLP pesos or USD cents). `currency` MUST be `"CLP"` or `"USD"`. No `number` fields that could accumulate floating-point error in financial code paths.

#### Scenario: Valid CLP money creation

- **GIVEN** `amountMinor = 150000`, `currency = "CLP"`
- **WHEN** a Money value is constructed
- **THEN** it MUST be accepted — 150000 represents CLP 150,000

#### Scenario: Valid USD money creation

- **GIVEN** `amountMinor = 4999`, `currency = "USD"`
- **WHEN** a Money value is constructed
- **THEN** it MUST be accepted — 4999 represents USD 49.99

### Requirement: Floating-Point Rejection

The system MUST reject any `amountMinor` that is not a finite integer. `NaN`, `Infinity`, `-Infinity`, and non-integer `number` values MUST cause a validation error.

| Scenario | amountMinor | Result |
|----------|-------------|--------|
| NaN rejected | `NaN` | Validation error |
| Infinity rejected | `Infinity` | Validation error |
| Decimal rejected | `1500.75` | Validation error |
| Negative accepted | `-5000` | Valid (represents loss/refund) |
| Zero accepted | `0` | Valid (explicit zero, not missing) |

### Requirement: Currency Safety

Operations combining two `Money` values MUST require matching `currency`. Mismatched currencies (e.g., CLP + USD) MUST throw a `CurrencyMismatchError`.

#### Scenario: Matching currencies allowed

- **GIVEN** two Money values both with `currency = "CLP"`
- **WHEN** they are combined in an operation
- **THEN** the operation MUST proceed normally

#### Scenario: Mismatched currencies rejected

- **GIVEN** one Money with `currency = "CLP"` and another with `currency = "USD"`
- **WHEN** they are combined in any arithmetic operation
- **THEN** a `CurrencyMismatchError` MUST be thrown
