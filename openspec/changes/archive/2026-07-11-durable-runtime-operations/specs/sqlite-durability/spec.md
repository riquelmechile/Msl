# sqlite-durability Specification

## Purpose

Scheduled backup, verification, restoration, integrity checking, WAL management, and
retention policy for every SQLite database under MSL management — excluding the OAuth
token store. All durability features are gated behind `MSL_DURABILITY_ENABLED`.

## Requirements

### Requirement: Scheduled Backup

The durability runtime MUST execute a backup of every managed SQLite database on a
configurable interval (default 24 h). The OAuth token database (`MSL_MERCADOLIBRE_OAUTH_DB_PATH`)
SHALL be excluded from automated backups.

#### Scenario: Scheduled backup fires

- GIVEN `MSL_DURABILITY_ENABLED=true` and backup interval 86400000 ms
- WHEN the interval elapses
- THEN each managed database (excluding OAuth token DB) is backed up to the configured
  backup directory
- AND a backup timestamp is persisted in the operational read model

#### Scenario: Backup respects feature flag

- GIVEN `MSL_DURABILITY_ENABLED=false`
- WHEN the backup interval elapses
- THEN no backup is executed

#### Scenario: OAuth token DB excluded

- GIVEN the OAuth token database at `MSL_MERCADOLIBRE_OAUTH_DB_PATH` exists
- WHEN the scheduled backup cycle runs
- THEN the OAuth token database MUST NOT be backed up

### Requirement: Backup Verification

After each backup file is created, the durability runtime MUST verify the backup
by executing `PRAGMA integrity_check` on the backup copy.

#### Scenario: Backup passes verification

- GIVEN a backup file is written to disk
- WHEN verification opens the backup and runs `PRAGMA integrity_check`
- THEN the result MUST be "ok"
- AND the backup is marked as verified in the operational read model

#### Scenario: Backup fails verification

- GIVEN a backup file is corrupted on write
- WHEN verification runs `PRAGMA integrity_check`
- THEN the backup MUST be discarded
- AND an error MUST be logged at ERROR level
- AND a health alert MUST be emitted

### Requirement: Atomic Restoration

The durability runtime MUST support restoration of any managed database from a verified
backup. Restoration SHALL be atomic — the target database MUST NOT be left in a partial
state on failure. The restored database SHALL pass verification before being placed into
service.

#### Scenario: Successful restoration

- GIVEN a verified backup exists for the Cortex database
- WHEN restoration is triggered
- THEN the target database file is overwritten atomically with the backup contents
- AND a verification check on the restored file returns "ok"

#### Scenario: Restoration fails atomically

- GIVEN restoration is in progress for a database
- WHEN the write fails mid-stream
- THEN the original database file MUST remain intact
- AND an error MUST be logged with the failure reason

### Requirement: Integrity Checking

The durability runtime MUST execute `PRAGMA integrity_check` against every managed
database on a configurable interval (default 6 h). A failing integrity check SHALL
emit a health alert and MUST NOT be silent.

#### Scenario: All databases pass

- GIVEN all 25 managed databases are healthy
- WHEN the integrity check interval fires
- THEN every `PRAGMA integrity_check` returns "ok"
- AND the health snapshot is updated with a passing status

#### Scenario: A database fails integrity

- GIVEN the Cortex database has a corrupted page
- WHEN `PRAGMA integrity_check` is executed
- THEN the failure detail is emitted as a health alert
- AND the operational health endpoint reflects the degraded status

### Requirement: WAL Checkpoint Management

The durability runtime MUST execute `PRAGMA wal_checkpoint(TRUNCATE)` on every managed
database on a configurable interval (default 1 h). WAL size SHALL be monitored; when
WAL exceeds 200 MB the runtime SHALL force an immediate checkpoint.

#### Scenario: Periodic WAL checkpoint

- GIVEN a database has accumulated WAL pages from active writes
- WHEN the checkpoint interval fires
- THEN `PRAGMA wal_checkpoint(TRUNCATE)` is executed
- AND the WAL file size is reduced to zero pages

#### Scenario: WAL exceeds threshold

- GIVEN a database WAL file is 250 MB
- WHEN the WAL size monitor runs
- THEN an immediate `PRAGMA wal_checkpoint(TRUNCATE)` is forced
- AND a WARNING log entry is emitted

### Requirement: Backup Retention

The durability runtime MUST enforce a configurable retention policy. Backups older than
the configured retention period (default 7 days) SHALL be deleted. At least the most
recent verified backup MUST always be retained.

#### Scenario: Old backups pruned

- GIVEN backups exist for days 1 through 10 and retention is 7 days
- WHEN the retention enforcement runs
- THEN backups from days 1-3 are deleted
- AND backups from days 4-10 are retained

#### Scenario: Last verified backup preserved

- GIVEN the only verified backup is 10 days old and retention is 7 days
- WHEN retention enforcement runs
- THEN that backup MUST NOT be deleted regardless of age

### Requirement: Feature Flag Gating

All durability operations (backup scheduling, integrity checks, WAL checkpointing,
retention) MUST be gated behind the `MSL_DURABILITY_ENABLED` environment variable.
When disabled, the durability runtime SHALL perform no operations.

#### Scenario: Durability disabled at startup

- GIVEN `MSL_DURABILITY_ENABLED=false`
- WHEN the agent daemon process starts
- THEN the durability runtime is not initialized
- AND no backup, integrity, or checkpoint operations are scheduled
