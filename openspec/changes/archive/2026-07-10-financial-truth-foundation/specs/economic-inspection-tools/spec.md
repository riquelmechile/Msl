# Economic Inspection Tools Specification

## Purpose

Three CEO read-only tools for inspecting unit economics, economic outcomes, and missing inputs. All tools declare `noMutationExecuted: true` and respect account isolation.

## Requirements

### Requirement: Tool Registration Contract

Three tools MUST be registered: `inspect_unit_economics`, `inspect_economic_outcome`, `list_missing_economic_inputs`. Each MUST declare `noMutationExecuted: true` in its tool definition. All MUST require `sellerId` as a mandatory parameter.

### Requirement: inspect_unit_economics

MUST accept `sellerId` and optional filters (`orderId`, `itemId`, `channel`, time range). MUST return `UnitEconomicsSnapshot` records scoped to the seller. MUST return bounded results — max page size enforced.

#### Scenario: Successful snapshot query

- **GIVEN** snapshots exist for seller "plasticov"
- **WHEN** `inspect_unit_economics(sellerId="plasticov")` is called
- **THEN** matching snapshots returned with `noMutationExecuted: true`

#### Scenario: Seller isolation enforced

- **GIVEN** the caller provides `sellerId = "plasticov"`
- **WHEN** tool executes
- **THEN** only plasticov snapshots returned — Maustian data excluded

#### Scenario: Missing record

- **GIVEN** no snapshots exist for the given filters
- **WHEN** tool is called
- **THEN** empty result returned — no error

### Requirement: inspect_economic_outcome

MUST accept `sellerId` and optional filters (`status`, `correlationId`, `orderId`, `proposalId`, time range). MUST return `EconomicOutcome` records scoped to the seller. MUST support filtering by lifecycle status and observation window.

#### Scenario: Filter by status and seller

- **GIVEN** outcomes for plasticov in multiple statuses
- **WHEN** `inspect_economic_outcome(sellerId="plasticov", status="observed")` is called
- **THEN** only observed plasticov outcomes returned

#### Scenario: Invalid input rejected

- **GIVEN** an invalid `status` value (e.g., "unknown")
- **WHEN** tool is called with that value
- **THEN** validation error returned — no mutation, `noMutationExecuted: true`

### Requirement: list_missing_economic_inputs

MUST accept `sellerId` as the only required parameter. MUST return all unique missing input labels from `UnitEconomicsSnapshot` records for that seller. MUST NOT mutate any state.

#### Scenario: Missing inputs identified

- **GIVEN** snapshots for plasticov with `missingInputs = ["shipping", "landed_cost"]` and `["shipping", "packaging"]`
- **WHEN** `list_missing_economic_inputs(sellerId="plasticov")` is called
- **THEN** deduplicated result: `["shipping", "landed_cost", "packaging"]`

#### Scenario: No missing inputs

- **GIVEN** all snapshots are `calculationStatus: "complete"`
- **WHEN** tool is called
- **THEN** empty array returned — no error
