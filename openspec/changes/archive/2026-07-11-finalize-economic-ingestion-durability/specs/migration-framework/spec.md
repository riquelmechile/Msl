# Delta for migration-framework

## ADDED Requirements

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
