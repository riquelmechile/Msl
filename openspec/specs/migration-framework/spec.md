# migration-framework Specification

## Purpose

A shared, versioned, transactional, idempotent migration framework extracted from the
Cortex `migrate()` pattern. Any SQLite store SHALL be able to register its schema
version and apply incremental migrations. Gated behind `MSL_MIGRATION_ENABLED`.

## Requirements

### Requirement: Versioned Migration Tracking

Every database managed by the migration framework MUST maintain a `schema_version`
table with `(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`.
The framework SHALL read the current version before applying any migration.

#### Scenario: Fresh database migration

- GIVEN a new database with no `schema_version` table
- WHEN the framework runs migrations
- THEN the `schema_version` table is created (version 0)
- AND all pending migrations are applied in order

#### Scenario: Already-migrated database

- GIVEN a database at version 3 and migrations up to version 5 exist
- WHEN the framework runs migrations
- THEN only migrations 4 and 5 are applied
- AND the `schema_version` row reflects version 5

### Requirement: Transactional Migrations

Each migration step MUST execute within a SQLite transaction. If any DDL or DML
statement within a migration fails, the entire migration step SHALL be rolled back.

#### Scenario: Migration succeeds atomically

- GIVEN migration version 2 contains CREATE TABLE and INSERT statements
- WHEN the migration runs
- THEN all statements are committed together or none are applied

#### Scenario: Migration fails and rolls back

- GIVEN migration version 3 fails on ALTER TABLE due to a syntax error
- WHEN the migration runs
- THEN all changes from version 3 are rolled back
- AND the database remains at the previous version
- AND an ERROR is logged with the migration failure detail

### Requirement: Idempotent Migrations

Each migration step MUST be safe to re-run. The framework SHALL NOT re-apply a
version that already exists in `schema_version`.

#### Scenario: Migration re-run is safe

- GIVEN version 2 is already recorded in `schema_version`
- WHEN the framework runs migrations again
- THEN version 2 is skipped entirely
- AND no duplicate schema objects are created

### Requirement: Migration Registration

Stores SHALL register migrations via a `MigrationRegistry` that accepts `(version, name, up)` tuples. The `up` function MUST receive the `better-sqlite3` Database instance and execute within the framework-managed transaction.

#### Scenario: Store registers migrations

- GIVEN the Economic Outcome Store needs migrations
- WHEN it calls `registry.register({ version: 1, name: 'create_outcomes', up: (db) => { ... } })`
- THEN the migration is queued for the Economic Outcome database
- AND the store's init path calls `registry.apply(db)` instead of raw `CREATE IF NOT EXISTS`

### Requirement: Feature Flag Gating

The migration framework MUST be gated behind `MSL_MIGRATION_ENABLED`. When disabled,
stores SHALL fall back to their existing `CREATE TABLE IF NOT EXISTS` initialization.

#### Scenario: Migration framework disabled

- GIVEN `MSL_MIGRATION_ENABLED=false`
- WHEN a store initializes
- THEN the store uses its legacy `CREATE IF NOT EXISTS` path
- AND the `MigrationRegistry.apply()` is never called

#### Scenario: Migration framework enabled

- GIVEN `MSL_MIGRATION_ENABLED=true`
- WHEN a store initializes that has registered migrations
- THEN the framework applies all pending migrations
- AND the store's tables are created via the migration path

### Requirement: Cortex Migration Extraction

The existing Cortex `migrate()` function SHALL be refactored to use the shared
migration framework without changing its behavior. All 2 existing Cortex migrations
MUST remain idempotent and preserve their `schema_version` compatibility.

#### Scenario: Cortex adopts shared framework

- GIVEN an existing Cortex database at schema version 2
- WHEN the shared migration framework is wired into Cortex's `createDatabase()`
- THEN `migrate()` behavior is unchanged
- AND existing `schema_version` rows remain valid

### Requirement: Economic Tables Registered in MigrationRegistry

The following economic tables SHALL register their schemas via `MigrationRegistry` instead of `CREATE TABLE IF NOT EXISTS`: `economic_ingestion_runs`, `economic_cost_components`, `unit_economics_snapshots`, and `economic_evidence_references`.

#### Scenario: Economic tables use MigrationRegistry

- GIVEN `MSL_MIGRATION_ENABLED=true`
- WHEN `EconomicIngestionRunStore`, `EconomicOutcomeStore`, or `EconomicEvidenceStore` initializes
- THEN each store MUST call `registry.register()` with its schema versions AND `registry.apply(db)` instead of inline DDL

#### Scenario: Upgrade path preserves existing data

- GIVEN an existing database with economic tables created via `CREATE TABLE IF NOT EXISTS` (pre-migration pattern)
- WHEN the MigrationRegistry applies the first economic migration version
- THEN the upgrade MUST detect existing tables AND add missing columns (e.g., `ingestion_run_id`) via `ALTER TABLE ADD COLUMN` AND existing rows MUST NOT be lost

#### Scenario: Idempotent migration re-run

- GIVEN economic tables at migration version 3
- WHEN the MigrationRegistry runs again
- THEN version 3 SHALL be skipped AND no duplicate columns or indexes SHALL be created

#### Scenario: New database gets full DDL from migrations

- GIVEN a fresh SQLite database with no economic tables
- WHEN the MigrationRegistry applies economic migrations
- THEN all tables, columns, and indexes MUST be created in version order AND the final schema MUST match the spec

#### Scenario: Feature flag disabled falls back to legacy

- GIVEN `MSL_MIGRATION_ENABLED=false`
- WHEN any economic store initializes
- THEN the store SHALL use its legacy `CREATE TABLE IF NOT EXISTS` path AND `MigrationRegistry.apply()` SHALL NOT be called
