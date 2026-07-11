# operational-health Specification

## Purpose

Operational health checks covering SQLite database integrity, WAL status, migration
version consistency, and backup freshness. Runs on a schedule and exposes results
through the system health daemon and readiness checkers.

## Requirements

### Requirement: Database Integrity Health Check

The operational health check MUST execute `PRAGMA integrity_check` on every managed
database during each health cycle. A failing integrity check SHALL set the overall
health status to "degraded" and emit a health alert.

#### Scenario: All databases pass

- GIVEN all managed databases are free of corruption
- WHEN the health cycle runs
- THEN `integrity_check` returns "ok" for every database
- AND the health report shows `databaseIntegrity: "healthy"`

#### Scenario: Database corruption detected

- GIVEN the Economic Outcome database has a corrupted b-tree page
- WHEN the health cycle runs
- THEN the health report shows `databaseIntegrity: "degraded"`
- AND the specific failure (database name + error detail) is included in the report

### Requirement: WAL Status Health Check

The health check SHALL query the WAL file size and checkpoint status for every
WAL-mode database. Databases with WAL files exceeding 200 MB SHALL be reported
as "degraded".

#### Scenario: WAL files within limits

- GIVEN all WAL-mode databases have WAL files under 200 MB
- WHEN the health cycle runs
- THEN the health report shows `walStatus: "healthy"`

#### Scenario: WAL file exceeds threshold

- GIVEN the Cortex database WAL file is 350 MB
- WHEN the health cycle runs
- THEN the health report shows `walStatus: "degraded"`
- AND the offending database and WAL size are reported

### Requirement: Migration Version Health Check

The health check MUST verify that every database using the migration framework
has applied all registered migrations. A database running an outdated schema
version SHALL be reported as "degraded".

#### Scenario: All versions current

- GIVEN the migration registry defines version 3 for Cortex and the database is at 3
- WHEN the health cycle runs
- THEN the health report shows `migrationStatus: "healthy"`

#### Scenario: Outdated migration version

- GIVEN the migration registry defines version 3 for Cortex but the database is at 2
- WHEN the health cycle runs
- THEN the health report shows `migrationStatus: "degraded"`
- AND the pending migration number and name are included

### Requirement: Backup Freshness Health Check

The health check MUST verify that the most recent verified backup for each managed
database is within the configured freshness window (default 48 h). Stale backups
SHALL be reported as "degraded".

#### Scenario: Backup is fresh

- GIVEN the most recent verified Cortex backup is 6 hours old
- WHEN the health cycle runs
- THEN the health report shows `backupFreshness: "healthy"`

#### Scenario: Backup is stale

- GIVEN the most recent verified Cortex backup is 72 hours old and the freshness
  window is 48 hours
- WHEN the health cycle runs
- THEN the health report shows `backupFreshness: "degraded"`
- AND the last backup timestamp and age are reported

### Requirement: Health Report Consolidation

All health check results MUST be consolidated into a single health report with
an overall status: "healthy" if all checks pass, "degraded" if any check fails.
The report SHALL be persisted in the operational read model.

#### Scenario: All checks healthy

- GIVEN integrity, WAL, migration, and backup checks all pass
- WHEN the health cycle completes
- THEN the consolidated report status is "healthy"
- AND the report is stored in the operational read model with a timestamp

#### Scenario: Mixed health results

- GIVEN integrity passes but backup freshness fails
- WHEN the health cycle completes
- THEN the consolidated report status is "degraded"
- AND the report contains per-check results with the failed check highlighted
