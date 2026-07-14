# Delta for migration-framework

## MODIFIED Requirements

### Requirement: Economic tables registered in MigrationRegistry

The registry registers through implemented 1010; this is not evidence of an applied production version. It MUST add 1011 `economic_database_write_admission_receipts` after 1010. 1011 stores only receipt digests and binding fields; it MUST NOT contain delivery, transport, `run_failure_intent`, or restore schema. R7 reserves 1012 for delivery state and 1013 for restore-journal state. R2 owns a separate later migration for `run_failure_intent`. No migration SHALL reference a future dependency.

Receipt rows bind seller, owner, writer kind, database/fence/lease generations, expiry, digest-only token material, and issued/consumed/rejected lifecycle timestamps. Migration execution requires `MaintenanceWriteAdmission`: no active database fence or seller lease may exist; only a brand-new database may use bootstrap before metadata/fence creation.

#### Scenario: Verified upgrade baseline
- GIVEN a database recorded through 1006
- WHEN the plan runs
- THEN only 1007–1010 MUST be pending.

#### Scenario: 1010 ownership boundary
- GIVEN a recorded-1009 database is upgraded through implemented migration 1010
- WHEN the registry applies 1010
- THEN only `economic_operational_alert_intents` and its seller/backlog integrity and intent indexes MAY be added
- AND no inbox, delivery, dispatcher, transport, acknowledgement/resolution, dead-letter, SLO, run-failure, or restore-journal table MAY be added
- AND planned R7 1012/1013 and the later R2 run-failure migration remain pending work, not applied schema.

### Requirement: Epoch-fenced restore

Every successful final economic transaction changing durable state MUST increment `write_epoch` once. Fence coordination, admission, leases, failed/rolled-back work, and alert delivery attempts MUST NOT increment it. Before automatic swap, restore MUST require equal immutable database ID, tenant/deployment identity, generation, and manifest hash; Plasticov/Maustian or install mismatch SHALL block. Restore MUST journal durable-before-irreversible CAS transitions, reject writers, close/checkpoint/remove WAL/SHM sidecars, reject handles/new writes, validate a fresh sidecar-free staging file, token-recheck rename, reopen/validate health, and retain rollback candidate. Post-swap failure MUST close new handles, remove sidecars, journal rollback, restore/reopen/validate the candidate; any handle/WAL/rename/reopen/health failure MUST enter manual reconciliation.

#### Scenario: Handle during restore
- GIVEN a live open handle or a new writer
- WHEN restore quiescence is checked
- THEN swap MUST not occur.

### Requirement: Truthful native review evidence

R8 MUST require four executed review lenses consolidated with lens labels in a native v4 ledger. A native refuter batch is required only when genuine pending inferential severe candidates exist. The existing v4 lineage has one genuine native batch, satisfying any recorded historical positive counter; no universal mandatory-empty-batch rule exists. Mirrors are not authoritative; Gentle AI 1.49's inability to persist separate lens identities MUST be disclosed.
