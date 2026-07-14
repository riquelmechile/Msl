# Design: Finalize Economic Run Consistency

## Technical Approach

R1–R8 plan an epoch-neutral exclusive database fence before dependent writers, bounded Claims recovery, and future run-failure, delivery, and restore durability. Implemented migration 1010 is limited to R4b cancellation intents; R5 owns 1011 database-write admission receipts, while future R7 reserves 1012 delivery and 1013 restore-journal schema. R2 owns its later run-failure migration.

## Architecture Decisions

| Decision | Alternatives | Choice and rationale |
|---|---|---|
| Backlog identity | nullable compound SQL key | A non-null SHA-256 canonical identity over seller, source, range, normalized cursor, and purpose. It is stable across restart and excludes PII/order-variant JSON. |
| Global abort | terminal cancellation | Global abort releases owned backlog to `pending`; only a started request consumes an attempt. R4b administrative cancellation is separate, approved, audited, and creates one durable pending/consumed alert intent; R7 owns delivery. |
| Writer exclusion | leases alone | Migration 1007 creates metadata/fence first. Every dependent writer validates immutable database/tenant/deployment identity plus fence generation/token; coordination never increments `write_epoch`. |
| Failure durability | write failure state after rollback only | A durable `run_failure_intent` is inserted before the main transaction; its same-run CAS update after rollback binds admission fence, DB generation, observed epoch, lease owner, and a token digest. |
| Restore | overwrite live file | `restore_operation_journal` records durable-before-irreversible rename phases. Close/checkpoint/remove sidecars, stage and validate identity/manifest, swap, then close new handles and restore retained candidate on any post-swap failure. |
| Migration ownership | bundle all operational tables in 1010 | 1010 remains R4b intent-only; R5 receives 1011 admission receipts; R7 reserves 1012 delivery and 1013 restore schema; R2 retains its later run-failure migration. |
| Economic writes | public store mutation APIs | R5 uses `DatabaseWriteAdmissionService` to issue a one-time receipt and exposes an immutable `AdmittedEconomicWriteSession`; raw SQLite and synchronous transaction helpers moved to an internal factory/migration entry point. |

## Data Flow

```text
admission -> identity+fence validate -> lease -> fetch -> future R2 failure intent
                                |                 |
global abort -------------------+--> pending -----> final transaction
                                      |                 |
                                 R7 alert dispatcher <--- 1012 future delivery schema
restore: quiesce/fence -> 1013 future journal -> close/checkpoint -> stage/validate -> swap/reopen
```

The production pipeline owns one execution budget and abort signal, acquires the database fence then seller lease, renews both through cancellable loops, and uses bounded fanout only for independent Claims and Ads after Orders succeeds. Final persistence revalidates deadline, receipt, fence, and lease immediately before consuming the receipt and incrementing the epoch once.

## Contracts

`backlog_identity_key` is `sha256(canonical UTF-8 tuple)` and is `NOT NULL UNIQUE`; canonical fields are seller ID, `claims`, normalized range/cursor, and fixed purpose. States are only `pending`, `leased`, `retrying`, `resolved`, `dead-letter`, and `administratively-cancelled`.

`economic_database_metadata` stores immutable `database_id`, `tenant_id`, `deployment_id`, `write_epoch`, and `generation`. `economic_database_fence` stores state, generation, owner, token digest, expiry, and update time. Before automatic swap, database/tenant/deployment identity, generation, and manifest hash MUST all match; Plasticov/Maustian or install mismatch blocks and enters `manual-reconcile`. Successful final economic transactions increment `write_epoch` once; coordination does not.

## File Changes

| File | Action | Description |
|---|---|---|
| `fetch-data-quality-policy.md` | Modify | Canonical backlog identity/lifecycle and abort rules. |
| `migration-plan.md` | Modify | Verified 1006 baseline; 1007 fence/metadata, 1008 leases/checkpoints, 1009 backlog/health, 1010 R4b operational alert intents; future R7 delivery/journals/constraints. |
| `reconciliation-checkpoint-policy.md` | Modify | Fence checks and independent failure transaction. |
| `operations-restore-alert-policy.md` | Modify | Restore protocol, alert lifecycle, recovery matrix. |
| `specs/*/spec.md`, `tasks.md` | Modify | R1–R8 acceptance and RED proof. |
| `review-framework-incident.md` | Create | Non-authoritative v3 incident record and v4 recommendation. |

## Cross-document Matrix

| Concern | Design/Policy | Migration/Rollback | Specs/Tasks |
|---|---|---|---|
| Backlog and abort | this design; `fetch-data-quality-policy.md` | 1009 | durability R1, R2, R4 |
| Fence, CAS, epoch | `reconciliation-checkpoint-policy.md` | 1007; `rollback-plan.md` | durability R2, R3, R5; migration framework |
| Cancellation alert intent | `operations-restore-alert-policy.md` | 1010 | R4b/R4 |
| Alert delivery and restore | `operations-restore-alert-policy.md` | future R7 migration | R7; migration framework |
| Review evidence | `review-framework-incident.md` | N/A | R8; migration framework |

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Unit | canonical key, bounded cadence, token digest, transitions | deterministic clock |
| SQLite integration | hostile lease/claim/fence matrices, durable failure intent, migrations, WAL restore journal | independent file-backed handles |
| Runtime/ops | deadlines/retry budget/dead-letter, every rename recovery state | offline fault injection |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

Verified source baseline is registry versions 1001–1006 only; the design starts at 1007 and does not claim an applied production version. No migration or restore runs in this documentation update.

## Open Questions

- [ ] Gentle AI 1.49 cannot persist separate lens identities; v4 must truthfully use a consolidated ledger.
- [ ] None blocking: the v4 lineage has one genuine native refuter batch; that historical positive counter is satisfied, not a universal rule.
