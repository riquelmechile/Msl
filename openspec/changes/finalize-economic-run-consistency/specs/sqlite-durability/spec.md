# Delta for sqlite-durability

## MODIFIED Requirements

### Requirement: Atomic Restoration

The durability runtime MUST support restoration of any managed database from a verified backup. Restoration SHALL be atomic — the target database MUST NOT be left in a partial state on failure. The restored database SHALL pass verification before being placed into service.

For the economic database, restoration MUST use a durable journal bound immutably to the target database identity, target generation, and backup identity. It MUST exclusively own a live economic fence and validate owner, fence generation, token, and database generation before every destructive boundary; a stale, expired, concurrent, or mismatched writer MUST be rejected without mutation. The journal MUST durably record transition intent before each destructive boundary and actual phases for fencing, prior preservation, verified staging, promotion, and final verification. The runtime MUST checkpoint and close managed SQLite access before promotion; it MUST NOT carry an uncheckpointed WAL/SHM state into the promoted database.

Economic staging MUST be independently verified. Promotion MUST be atomic and retain a recoverable prior database until final SQLite integrity and the economic identity, fence/generation, admission, and relational constraints defined through migration 1011 pass. On restart or rerun, a nonterminal journal MUST deterministically either complete the verified restore or roll back to the preserved prior database; identity ambiguity MUST fail closed. A journal MUST finish as `completed`, `rolled-back`, or `failed` with failure detail; only `completed` permits the restored database into service.

(Previously: Restoration required verified, atomic replacement and post-restore verification, without economic fencing, journaling, or interruption recovery.)

#### Scenario: Successful restoration

- GIVEN a verified backup exists for the Cortex database
- WHEN restoration is triggered
- THEN the target database file is atomically overwritten with the backup contents
- AND verification on the restored file returns "ok"

#### Scenario: Restoration fails atomically

- GIVEN restoration is in progress for a database
- WHEN the write fails mid-stream
- THEN the original database MUST remain intact
- AND an error MUST be logged with the failure reason

#### Scenario: Economic restore is fenced and identified

- GIVEN an economic backup and target have matching immutable identities
- WHEN a restore owns the live fence with matching owner, generation, token, and database generation
- THEN its journal records the binding before destructive work
- AND another or stale writer is rejected without writing

#### Scenario: Staging and SQLite sidecars are safe

- GIVEN an economic restore holds its valid fence
- WHEN it reaches staging and promotion
- THEN the staged backup passes independent SQLite verification before promotion
- AND managed connections are checkpointed and closed with no prior WAL/SHM state promoted

#### Scenario: Promotion preserves and verifies the prior state

- GIVEN verified staging and a durably recorded prior database
- WHEN atomic promotion succeeds
- THEN the prior database remains recoverable until final verification passes
- AND SQLite integrity and economic constraints defined through migration 1011 pass before service resumes

#### Scenario: Crash recovery is deterministic

- GIVEN a process crashes after any nonterminal phase, including after rename
- WHEN the restore is restarted or rerun
- THEN recovery completes the verified promotion or restores the preserved prior database
- AND it records exactly one terminal outcome without duplicate destructive work

#### Scenario: Identity or final verification fails closed

- GIVEN the journal, target, backup, fence, or generation identity mismatches, or final verification fails
- WHEN recovery or restoration evaluates that state
- THEN it MUST NOT promote or admit economic writes
- AND it records `rolled-back` or `failed` with failure detail
