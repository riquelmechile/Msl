# workforce-cost-rollups Specification

## Purpose

Dual-table cost ledger with auto-rollup aggregation that survives raw entry pruning, plus richer Block C cost context with 7-day trends, per-department totals, and cache efficiency ratios.

## Requirements

### Requirement: Dual-Table Cost Ledger
The system SHALL maintain `workforce_cost_cache_ledger_entries` (raw, pruned at 5,000 entries) and `workforce_cost_cache_ledger_rollups` (daily aggregation per agent/model, never pruned). The raw table SHALL include a `department_id TEXT` column.

#### Scenario: Raw entries accumulate with department metadata
- GIVEN a cost record with `department_id`
- WHEN `insertEntry` is called
- THEN the entry SHALL be persisted with all token counts, cost estimates, and department identifier

#### Scenario: Raw table prunes at 5,000 entries
- GIVEN the raw table has 5,000 entries
- WHEN a new entry is inserted
- THEN oldest entries SHALL be pruned and rollup data SHALL survive independently

### Requirement: Auto-Rollup on Insert
The system SHALL upsert a row in `workforce_cost_cache_ledger_rollups` on every `insertEntry` call, aggregated by `(day, agent_id, model)`. Counters SHALL increment idempotently via `INSERT … ON CONFLICT DO UPDATE`.

#### Scenario: First insert of the day creates rollup row
- GIVEN no rollup exists for today's `(agent_id, model)` pair
- WHEN `insertEntry` is called
- THEN a new rollup row SHALL be created with initial token and cost counters

#### Scenario: Subsequent inserts update existing rollup
- GIVEN a rollup row already exists for today's `(agent_id, model)` pair
- WHEN `insertEntry` is called again
- THEN the existing row SHALL be upserted with incremented counters

#### Scenario: Concurrent inserts are idempotent
- GIVEN multiple concurrent inserts target the same `(day, agent_id, model)` combination
- WHEN inserts complete
- THEN the idempotent upsert pattern SHALL prevent data loss or duplication

### Requirement: Time-Range Filter on ListEntries
The system SHALL accept `from` and `to` ISO date parameters on `ListWorkforceCostCacheLedgerEntriesFilter` to filter raw entries by time range.

#### Scenario: Entries filtered by date range
- GIVEN entries exist from July 1–10
- WHEN `listEntries` is called with `{ from: "2026-07-01", to: "2026-07-05" }`
- THEN only entries within that range SHALL be returned

#### Scenario: Missing filter returns all entries
- GIVEN entries exist in the raw table
- WHEN `listEntries` is called without `from` or `to`
- THEN all entries up to the pruning limit SHALL be returned

### Requirement: Richer Cost Context in Block C
The system SHALL replace `buildWorkforceCostCacheContext` with rollup-backed aggregation providing 7-day trends, per-department totals, and cache efficiency ratio. All context SHALL remain in Block C only via `buildBlockCContext`.

#### Scenario: Cost context includes 7-day trend
- GIVEN rollup data exists for the past 7 days
- WHEN `buildBlockCContext` assembles cost context
- THEN it SHALL include input/output token trends over the 7-day window

#### Scenario: Cache efficiency ratio computed
- GIVEN rollup data includes `cache_hit_tokens_agg` and `cache_miss_tokens_agg`
- WHEN cost context is built
- THEN the context SHALL include a cache efficiency ratio

#### Scenario: Cold start — no rollup data
- GIVEN no rollup data exists (first day of operation)
- WHEN cost context is built
- THEN a minimal summary SHALL render without error
