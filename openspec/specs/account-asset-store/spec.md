# account-asset-store Specification

## Purpose

SQLite-persisted store for `AccountAsset` strategic state: capabilities, health snapshots, profit goals, strategy notes, risks, and opportunities — scoped per `seller_id`.

## Requirements

### Requirement: Schema Migration

The system MUST create the following tables idempotently (`CREATE TABLE IF NOT EXISTS`): `account_assets`, `account_capabilities`, `account_health_snapshots`, `account_profit_goals`, `account_strategy_notes`, `account_risks`, `account_opportunities`. Each table MUST include `seller_id TEXT NOT NULL` and `created_at TEXT NOT NULL DEFAULT (datetime('now'))`.

#### Scenario: Migration runs on empty database

- GIVEN a new SQLite `:memory:` database
- WHEN `createAccountAssetStore(db)` runs
- THEN all 7 tables MUST exist and be queryable

#### Scenario: Migration is idempotent

- GIVEN tables already exist from a prior run
- WHEN `createAccountAssetStore(db)` runs again
- THEN no error is thrown and existing rows are preserved

### Requirement: Per-Account Record Creation

The system MUST create separate records for each `seller_id`. Inserting a record for one account MUST NOT affect another account's records.

#### Scenario: Plasticov and Maustian have separate records

- GIVEN `account_assets` table is empty
- WHEN `upsertAccountAsset({ sellerId: "plasticov", ... })` and `upsertAccountAsset({ sellerId: "maustian", ... })` are called
- THEN two distinct rows exist with different `seller_id` values
- AND querying by `seller_id = "plasticov"` returns only Plasticov's row

#### Scenario: Plasticov memory does not leak into Maustian

- GIVEN capabilities, risks, and strategies are stored for Plasticov
- WHEN querying all tables with `seller_id = "maustian"`
- THEN no Plasticov data is returned from any table

### Requirement: Global Memory Visibility

The system SHALL support querying records with `seller_id IS NULL` for global-scoped strategic data visible to both accounts. Account-scoped records MUST only be visible to their specific `seller_id`.

#### Scenario: Global strategy visible to both

- GIVEN a strategy note with `seller_id = NULL`
- WHEN queried for `seller_id = "plasticov"` or `seller_id = "maustian"`
- THEN the global strategy note MUST appear for both queries (via UNION or separate query)

### Requirement: Account Comparison Query

The system MUST expose a `compareAccounts()` method returning `AccountAsset` records for all sellers side-by-side, enabling the CEO to evaluate product placement decisions.

#### Scenario: CEO compares two accounts

- GIVEN Plasticov has profit goal 40% and Maustian has profit goal 50%
- WHEN `compareAccounts()` is called
- THEN both records MUST be returned with their respective `sellerId`, `profitGoal`, and `riskLevel`

### Requirement: Account Health Snapshot History

The system MUST store `AccountHealthSnapshot` records per `seller_id` with timestamps, supporting a time-series query of account health degradation.

#### Scenario: Health degrades over time

- GIVEN three health snapshots for Plasticov: 1.0, 0.8, 0.6
- WHEN `getHealthHistory("plasticov")` is called
- THEN all three snapshots MUST be returned in chronological order

### Requirement: Store Factory Contract

The system MUST expose `createAccountAssetStore(db: Database): AccountAssetStore` returning an object with methods: `upsertAccountAsset`, `getAccountAsset`, `compareAccounts`, `upsertCapability`, `getCapabilities`, `recordHealthSnapshot`, `getHealthHistory`, `upsertProfitGoal`, `getProfitGoal`, `addStrategyNote`, `getStrategyNotes`, `addRisk`, `getRisks`, `addOpportunity`, `getOpportunities`.
