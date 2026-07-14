# Confirmed Findings

Source inspection confirms the exact gaps recorded in `exploration.md`:

1. `EconomicIngestionPipeline.ts` recreates the final and failed run, so identity can diverge; persisted result field names also differ from `runFromRow`.
2. Components and snapshots have incomplete `ingestion_run_id` data paths; evidence `countByRun` lacks seller scope.
3. Component IDs are process counters, snapshot IDs are non-deterministic, and pipeline persistence bypasses the component upsert path.
4. Reconciliation is post-commit, checkpoint follows fetched order, and cumulative metrics are invocation fallbacks.
5. Run/outcome inline DDL and independently registered v2–v5 migrations conflict on shared `schema_version`.
6. `inspect-evidence --run` filters evidence, but component/snapshot observability and daemon durable dependencies are incomplete.

No secrets, environment data, migrations, tests, or external services were inspected or executed.

## Authoritative Current State — Frozen 4R Remediation Map

Historical findings above are retained. The review transaction mirrors do not serialize their finding ledger; this map preserves the corroborated frozen finding references available to this change and assigns stable documentary IDs for the otherwise unrepresented prior-lineage findings. No entry is accepted or superseded by implementation.

| Frozen finding ID / lineage | Current finding | Work unit |
|---|---|---|
| `RESILIENCE-001` / original | Provider failures are swallowed into empty arrays. | R1–R2, R7 |
| `FETCH-001` / fetch-semantics | No typed success-empty/unavailable/error/abort source result. | R1, R7 |
| `FETCH-002` / fetch-semantics | Ads failure can be classified as observed zero. | R2, R7 |
| `FETCH-003` / fetch-semantics | Retry, pagination, waits, and requests lack one cancellable deadline. | R5 |
| `FETCH-004` / fetch-semantics | Fetch receives no source checkpoint for strict resume. | R3, R7 |
| `FETCH-005` / fetch-semantics | Evidence supersession is ID-only and cross-seller unsafe. | R6 |
| `PRIOR-001` / original | Run/component mutation and association boundaries are not consistently seller-scoped. | R6 |
| `PRIOR-002` / original | Duplicate metrics can count retained canonical rows as new. | R6 |
| `PRIOR-003` / original | Checkpoint write is not durable monotonic CAS. | R3 |
| `PRIOR-004` / original | Abandoned-run recovery is not lease-safe across processes. | R4 |
| `PRIOR-005` / original | Migration ownership/identity and required persistence stores can diverge. | R8 |

`RESILIENCE-001` is the recoverable native ID. `FETCH-*` and `PRIOR-*` are authoritative documentary aliases because the immutable review mirrors contain no serialized finding IDs; they are not claims that a missing ledger was inspected. None are duplicates or superseded: each maps to at least one unchecked remediation task.

## V2 Gate Blockers — V3 Documentary Remediation

The v2 findings remain unresolved in implementation and are mapped deterministically: global-vs-local abort/backlog is R1/R2/R5; short lease transactions and TTL are R4/R5; health/CAS are R3; epoch-fenced restore and alert operations are R7; 1009/1010 and native v3 four-lens/refuter evidence are R8. These entries are planning requirements only; R1–R8 stay unchecked until their RED, implementation, and gate evidence exists.

## V3 Incident Findings — V4 Documentary Resolution Map

| Finding | Resolution location | Acceptance |
|---|---|---|
| terminal cancelled backlog / NULL identity | fetch policy; 1008 | R1, R2, R4 |
| fence misses writers / fence changes epoch | reconciliation policy; 1007 | R3, R5, R7 |
| CAS failure not independently durable | reconciliation policy | R2 |
| alert lifecycle absent | operations policy; future R7 1012/1013 | R7 |
| 1006/1008 baseline contradiction | migration plan: 1007→1008→1009→1010 | R8 |
| WAL/handle restore gap | operations and rollback policy | R7 |
| v3 zero ledger/refuter contradiction | incident artifact and migration spec | R8 |

These are documentary resolutions only. They do not alter prior review mirrors, native events, code, test state, or the unchecked status of R1–R8.

## V4 Complete Correction — Frozen Finding Disposition

The following twelve frozen IDs are planned documentary corrections only; they are not test results, native events, or acceptance evidence. Each remains blocked on its unchecked task and the non-authoritative correction evidence artifact.

| Frozen ID | Documentary disposition | Planned task |
|---|---|---|
| RISK-001 | Topological 1007→1010 order; fence precedes dependents. | R3, R4, R7, R8 |
| RISK-002 | Journaled post-swap rollback closes/reopens safely. | R7 |
| RISK-003 | Immutable identity/generation/manifest equality blocks mismatches. | R3, R7 |
| RISK-004 | Failure intent and same-run stale-writer binding are mandatory. | R2 |
| RESILIENCE-001 | Concrete bounded TTL/cadence/recovery matrix is mandatory. | R4, R7 |
| RESILIENCE-002 | Pre-main durable failure intent and idempotent recovery are mandatory. | R2 |
| RESILIENCE-003 | Restore journal states and startup recovery are mandatory. | R7 |
| RESILIENCE-004 | Bounded alert inbox/dispatch/dead-letter/pager contract is mandatory. | R7 |
| READABILITY-001 | Genuine-candidate-only refuter policy; v4 historical batch satisfies its counter. | R8 |
| READABILITY-002 | Concrete acceptance cadence matrix is mandatory. | R4, R7 |
| RELIABILITY-001 | Hostile lease/fence release matrix and zero-row classification are mandatory. | R4, R5 |
| RELIABILITY-002 | Hostile Claims/alert recovery with deterministic clock and real SQLite is mandatory. | R4, R7 |

## R4b/R7 Alert Ownership Resolution

The repeated R4b gate identified a real ownership gap: cancellation required an alert, while the prior 1010 plan assigned all alert storage to R7. The approved resolution is deliberately narrow. R4b owns migration 1010 and the durable `economic_operational_alert_intents` producer/consumer marker for administrative Claims cancellation only. R7 remains unchecked and owns every dispatcher, delivery transport, inbox, retry, dead-letter, paging, HTTP, Telegram, restore journal, and delivery-readiness concern. Creating or consuming an R4b intent is never evidence of delivery.
