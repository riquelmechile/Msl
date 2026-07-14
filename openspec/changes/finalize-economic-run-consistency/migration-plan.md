# Canonical Migration Plan

## Verified source baseline

`packages/memory/src/migrationRegistry.ts` currently registers exactly **1001–1006** in `createEconomicMigrationPlan()`: core tables; provenance columns; identity conflict report; indexes; durable checkpoint fields; and store provenance identities. This is a source baseline, not a claim about any applied production database. The prior “upgrade from verified 1008” statement was incorrect; **1008 is new** below.

| Version | Status | Purpose | Source file |
|---:|---|---|---|
| 1001–1006 | Existing, verified | current economic schema plan | `packages/memory/src/migrationRegistry.ts` |
| 1007 | New | immutable metadata and exclusive database fence | `migrationRegistry.ts` |
| 1008 | New | seller leases and source checkpoints | `migrationRegistry.ts` |
| 1009 | New | non-null Claims backlog and sole-truth health | `migrationRegistry.ts` |
| 1010 | New | R4b administrative-cancellation operational alert intents only | `migrationRegistry.ts` |
| 1011 | New | R5 database write admission receipts | `migrationRegistry.ts` |

All migrations use the existing registry transaction and are applied after 1006. Stores own no migration DDL. Tests must prove fresh, upgrade from a recorded 1006 schema, rerun, checksum conflict, and failure rollback.

## New schemas

1007 creates the singleton `economic_database_metadata(database_id TEXT NOT NULL, tenant_id TEXT NOT NULL, deployment_id TEXT NOT NULL, generation INTEGER NOT NULL, write_epoch INTEGER NOT NULL, updated_at INTEGER NOT NULL)` and `economic_database_fence(singleton,state,generation,fence_token_digest,owner_run_id,expires_at,updated_at)`. It inserts the singleton idempotently. This fence/metadata migration MUST precede every dependent writer.

1008 creates seller/source leases `(seller_id, source, owner_run_id, lease_token_digest, generation, expires_at, updated_at)` and source checkpoints. 1009 creates `economic_source_retry_backlog`, including `backlog_identity_key TEXT NOT NULL UNIQUE`, `claim_owner`, `claim_token_digest`, `claim_generation`, `claim_expires_at`, the six-state check, seller/source indexes, lease-expiry index, audit/replay records, and `economic_source_health` as readiness truth. 1010 creates only `economic_operational_alert_intents`: deterministic SHA-256 dedup/intent IDs, seller, exact cancellation alert type/severity/reason/source/related backlog fields, cancellation version, allowlisted metadata, `pending|consumed` state, seller-pending and backlog indexes, and seller/backlog foreign-key/trigger integrity. It contains no delivery state, transport, inbox, journal, dispatcher, HTTP, or Telegram schema.

R5 owns 1011 `economic_database_write_admission_receipts`: token digest, seller/writer/owner, database/fence/lease generations, issued/consumed/expired/rejected status, expiry, and binding/expiry indexes. No raw token is stored. R7 reserves 1012 for delivery state and 1013 for the restore journal; neither is implemented by R5.

```sql
CREATE TABLE economic_operational_alerts (
 alert_id TEXT PRIMARY KEY, dedup_key TEXT NOT NULL, state TEXT NOT NULL
 CHECK(state IN ('pending','claimed','dispatching','retrying','delivered','dead-letter','resolved','suppressed')),
 event TEXT NOT NULL, seller_id TEXT, source TEXT, reason_code TEXT, payload_json TEXT NOT NULL,
  claim_owner TEXT, claim_token_digest TEXT, claim_generation INTEGER,
  claim_expires_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL, cooldown_until INTEGER, last_error TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resolved_at INTEGER,
 UNIQUE(dedup_key)
);
```

1012 will add delivery-attempt, dispatcher-claim, transport, acknowledgement/resolution, dead-letter, and SLO schema. 1013 will add `restore_operation_journal` with durable CAS phases. R2 will add `run_failure_intent` in its own later migration. These are planned schemas and are not implemented by R5.

The current order is **1007 metadata+fence → 1008 leases+checkpoints → 1009 backlog+health → 1010 R4b operational alert intents → 1011 R5 admission receipts → 1012 R7 delivery → 1013 R7 restore journal → later R2 run-failure intent migration**. No migration may reference a future dependency.

`write_epoch` increments exactly once in each successful final economic transaction that changes durable economic business/operational state; it does not increment for fence coordination, admission checks, lease acquisition/renewal/release, failed/rolled-back work, migration registration, or alert delivery attempts. A successful migration that changes durable schema/data increments once only if its migration contract explicitly opens the metadata row; bootstrap does not.
