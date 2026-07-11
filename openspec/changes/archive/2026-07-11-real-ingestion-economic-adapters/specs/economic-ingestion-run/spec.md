# Economic Ingestion Run Specification

## Purpose

Models each execution of the ingestion pipeline as an auditable `EconomicIngestionRun` record, reusing existing checkpoint infrastructure.

## Requirements

### Requirement: EconomicIngestionRun Model

The system MUST define `EconomicIngestionRun` with: `runId`, `sellerId`, `mode` (dry-run|backfill|incremental|reconcile|repair), `sourceKinds`, `startedAt`, `completedAt`, `checkpointBefore`, `checkpointAfter`, `recordsFetched`, `recordsNormalized`, `componentsCreated`, `snapshotsCreated`, `duplicatesIgnored`, `partialSnapshots`, `disputedSnapshots`, `errors`, `status`, `noExternalMutationExecuted: true`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Successful run | Pipeline processes 30 orders, 25 snapshots (3 partial) | Run completes | `status: "completed"`, `recordsFetched: 30`, `snapshotsCreated: 25`, `partialSnapshots: 3`, `errors: []` |
| Failed run | Pipeline crashes on page 3 | Run ends | `status: "failed"`, `errors` populated with crash details, `checkpointAfter` unset |
| Dry run | `mode: "dry-run"`, 10 orders processed | Run completes | `status: "completed"`, `noExternalMutationExecuted: true`, nothing persisted |

### Requirement: Checkpoint Integration

The system MUST reuse existing checkpoints from the operational read model / background ingestion infrastructure. Checkpoint SHALL only advance after successfully persisting the entire corresponding unit.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Atomic checkpoint | Page 5 fully persisted | Checkpoint advanced | `checkpointAfter` reflects page 5 boundary |
| Partial page | Page 5: 8 of 10 orders persisted, crash on 9th | Checkpoint | `checkpointAfter` unchanged (still page 4), page 5 reprocessed next run |
| Resume | Run interrupted at checkpoint page 4 | New run starts | Pipeline reads checkpoint and begins at page 5 |

### Requirement: Run Modes

| Mode | Behavior |
|------|----------|
| `incremental` | Process records since last checkpoint |
| `backfill` | Process historical range, respect limits |
| `dry-run` | Compute, validate, do not persist |
| `reconcile` | Compare stored snapshots against current ML data |
| `repair` | Fix specific snapshots identified as incomplete/disputed |

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Incremental | 5 new orders since last run | `mode: "incremental"` | Only new orders processed |
| Backfill with limit | `mode: "backfill"`, `maxPages: 3` | Run executes | Stops after 3 pages regardless of remaining data |
