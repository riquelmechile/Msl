# Economic Outcome Store Specification

## Purpose

SQLite persistence for `EconomicOutcome` records with seller isolation, idempotent writes, controlled state transitions, and read-only profit summaries.

## Requirements

### Requirement: Seller Isolation

All tables MUST carry a `seller_id` column. Every query MUST filter `WHERE seller_id = ?`. Cross-seller data exposure MUST be impossible at the query layer.

#### Scenario: Plasticov queries only Plasticov outcomes

- **GIVEN** outcomes exist for seller "plasticov" and seller "maustian"
- **WHEN** store queries with `seller_id = "plasticov"`
- **THEN** only plasticov outcomes MUST be returned

#### Scenario: Maustian cannot see Plasticov data

- **GIVEN** same multi-seller data
- **WHEN** store queries with `seller_id = "maustian"`
- **THEN** zero plasticov outcomes MUST appear

### Requirement: Idempotent Persistence

Inserting a duplicate outcome (same `outcomeId`) MUST return the existing record without error. Table creation MUST use `CREATE TABLE IF NOT EXISTS` and MUST be idempotent across multiple calls.

#### Scenario: Duplicate insert returns existing

- **GIVEN** an outcome with `outcomeId = "out-1"` already persisted
- **WHEN** the same outcome is inserted again
- **THEN** the existing record MUST be returned — no duplicate row, no error

### Requirement: Controlled State Transitions

The store MUST enforce valid lifecycle transitions. Invalid transitions (e.g., `verified → observed`) MUST reject with `EconomicOutcomeStateError`. Multi-table writes MUST wrap in `db.transaction`.

#### Scenario: Valid transition persisted

- **GIVEN** outcome at `observed` state
- **WHEN** transitioned to `verified`
- **THEN** row updated, `updatedAt` refreshed — no error

#### Scenario: Invalid transition rejected atomically

- **GIVEN** outcome at `verified` state
- **WHEN** transition to `observed` attempted
- **THEN** `EconomicOutcomeStateError` thrown — row unchanged

### Requirement: Query Capabilities

The store MUST support queries by: `outcomeId`, `sellerId`, `proposalId`, `correlationId`, `orderId`, and `status`. It MUST support listing `missingInputs` across outcomes filtered by seller.

#### Scenario: Filter by status and time window

- **GIVEN** multiple outcomes across different statuses
- **WHEN** queried with `status = "observed"` and time range
- **THEN** only matching outcomes returned

#### Scenario: List missing inputs

- **GIVEN** outcomes with various `missingInputs` arrays
- **WHEN** `listMissingInputs(sellerId)` is called
- **THEN** all unique missing input labels across that seller's snapshots MUST be returned

### Requirement: Profit Summary

The store MUST provide profit summaries by seller, channel, and period WITHOUT mixing currencies. Summaries across different currencies MUST be grouped separately.

#### Scenario: CLP-only summary

- **GIVEN** all outcomes in CLP
- **WHEN** profit summary queried by seller
- **THEN** aggregate net profit in CLP returned

#### Scenario: Mixed currency separation

- **GIVEN** outcomes in both CLP and USD
- **WHEN** profit summary is requested
- **THEN** CLP and USD totals MUST be separate — no cross-currency sum
