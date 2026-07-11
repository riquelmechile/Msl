# Delta for runtime-env-validator

## ADDED Requirements

### Requirement: Degraded Capability Policy

The runtime environment validator MUST define and enforce a `degraded` capability
policy. A capability declared as `degraded` SHALL allow the process to start in
production but SHALL log at WARN level. This is distinct from `blocking` (fails
startup) and `optional` (silently skipped).

#### Scenario: Degraded capability allows startup

- GIVEN a required DB is unreachable but configured as capability `degraded`
- WHEN `validateRuntimeEnv()` runs
- THEN the validation result is `{ valid: true }` with a WARN-level degradation entry
- AND the process starts with the degraded capability noted

#### Scenario: Blocking capability still fails startup

- GIVEN a `blocking` capability check fails (e.g., missing critical API key)
- WHEN `validateRuntimeEnv()` runs
- THEN the validation result is `{ valid: false }` with an ERROR-level entry
- AND the process does not start

#### Scenario: Degraded capability documented in result

- GIVEN a DB integrity check is `degraded`
- WHEN `validateRuntimeEnv()` returns
- THEN the result includes `degradedCapabilities: ["database-integrity"]`
- AND each entry contains the degradation reason

### Requirement: Database Integrity and WAL Checks

`validateRuntimeEnv()` MUST include a database integrity section that verifies
every managed database passes `PRAGMA integrity_check` and that WAL files are
within acceptable limits (under 200 MB) at startup.

#### Scenario: DB integrity passes at startup

- GIVEN all managed databases are healthy
- WHEN `validateRuntimeEnv()` runs the database integrity section
- THEN the check result is `{ dbIntegrity: "ok" }`
- AND the overall validation result is valid

#### Scenario: DB integrity fails at startup

- GIVEN the Cortex database returns corruption from `PRAGMA integrity_check`
- WHEN `validateRuntimeEnv()` runs
- THEN the capability `database-integrity` is reported as `degraded`
- AND the specific database and error detail are included in the diagnostics

#### Scenario: WAL file exceeds threshold at startup

- GIVEN a database WAL file is 400 MB at process startup
- WHEN `validateRuntimeEnv()` runs
- THEN the capability `wal-health` is reported as `degraded`
- AND a WARN entry is logged with the WAL size and database name
