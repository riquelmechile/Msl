# SDD Exploration: finalize-economic-ingestion-durability

## 1. Run ID Generation

**Location**: `packages/domain/src/economicIngestionRun.ts:76`

```typescript
let runCounter = 0;
// ...
runCounter++;
const runId = `ingestion-run-${runCounter}`;
```

**Pattern**: Module-level in-memory counter. Resets to 0 on process restart. Same pattern used in:

| Artifact | File | Counter | ID format |
|---|---|---|---|
| Ingestion runs | `packages/domain/src/economicIngestionRun.ts:76` | `runCounter` | `ingestion-run-{N}` |
| Evidence refs | `packages/domain/src/economicEvidenceReference.ts:61` | `evidenceCounter` | `evidence-{N}` |
| Cost components | `packages/memory/src/economicOutcomeStore.ts:248` | `costComponentIdCounter` | `costcomp-db-{N}` |
| Snapshots | `packages/domain/src/economicCalculation.ts:150` | (none) | `snapshot-{Date.now()}-{random}` |

**Problem**: If a run ID collides with a previously persisted run (process restart on same DB), `createRun` will throw because `id` is `TEXT PRIMARY KEY`. But the pipeline swallows the error silently (see §2).

## 2. Run Persistence (EconomicIngestionRunStore)

**Location**: `packages/memory/src/economicIngestionRunStore.ts`

### Store structure
- `createRun(input)` — INSERT into `economic_ingestion_runs`
- `updateRun(id, updates)` — UPDATE with COALESCE for partial updates
- `getRun(id)`, `getLastRunBySeller(sellerId)`, `listRunsBySeller(sellerId, limit)`
- `getActiveRun(sellerId)` — finds runs in transient statuses (`pending`, `fetching`, etc.)
- `recoverAbandonedRun(sellerId)` — marks transient runs as `failed`
- `getCheckpoint(sellerId)`, `updateCheckpoint(sellerId, data)`

### Error handling: best-effort
The pipeline calls `runStore` in two places, both wrapped in `try { ... } catch { /* silently swallow */ }`:

**Pipeline line 196-209** (initial create):
```typescript
if (runStore && !config.dryRun && !config.noPersist) {
  try { await runStore.createRun({...}); }
  catch { /* Run persistence is best-effort; don't block the pipeline */ }
}
```

**Pipeline line 452-483** (final update):
```typescript
if (runStore && !config.dryRun && !config.noPersist) {
  try {
    await runStore.updateRun(run.runId, { status, completedAt, result });
    // Update checkpoint on success
    if (run.status === "completed") { await runStore.updateCheckpoint(...); }
  }
  catch { /* Run persistence is best-effort */ }
}
```

**Problem: Silent data loss**. If the DB write fails (e.g., disk full, schema mismatch, unique constraint), the pipeline continues unblocked but the run record is never persisted. The return value still contains a valid `run` object with the correct `runId`, but nothing exists in the DB.

### Result column
The `result` column stores a JSON blob (pipeline line 459-464):
```json
{
  "transactions": <transactions.length>,
  "components": <allComponents.length>,
  "snapshots": <snapshots.length>,
  "reconciliation": <status>,
  "elapsedMs": <endTime - startTime>
}
```

Note: `transactions` here means **normalized commerce transactions (line items)**, not raw orders.

### Status transitions
The pipeline does NOT always transition the run to `completed`. At line 448:
```typescript
if (reconciliation.status === "balanced" || reconciliation.status === "balanced-with-tolerance") {
  run = transitionRun(run, "completed");
}
```

If reconciliation is `mismatched`, `disputed`, or `incomplete`, the run STAYS in `persisting` status forever. The DB row remains in `persisting`.

### Checkpoint
Checkpoint is only updated when `run.status === "completed"` (line 468). Checkpoint data: `lastOrderDate`, `lastOrderId`, `lastRunId`.

### Recovery mechanism
`recoverAbandonedRun` marks any run in a transient status for a seller as `failed` with reason "Recovered: previous run was abandoned (process restart)." But this is only called when explicitly invoked — there's no automatic recovery at pipeline start.

## 3. Database Schema

### `economic_ingestion_runs`
**Created in**: `packages/memory/src/economicIngestionRunStore.ts:154-185` via `migrateEconomicIngestionRunStore()`

```sql
CREATE TABLE IF NOT EXISTS economic_ingestion_runs (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  params TEXT,        -- JSON
  result TEXT,        -- JSON
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `economic_ingestion_checkpoints`
```sql
CREATE TABLE IF NOT EXISTS economic_ingestion_checkpoints (
  seller_id TEXT PRIMARY KEY,
  last_order_date TEXT,
  last_order_id TEXT,
  last_run_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_economic_ingestion_runs_seller
  ON economic_ingestion_runs(seller_id);
CREATE INDEX IF NOT EXISTS idx_economic_ingestion_runs_seller_status
  ON economic_ingestion_runs(seller_id, status);
```

### Migration framework
- The `economic_ingestion_runs` tables do **NOT** use the `MigrationRegistry` system
- They use `CREATE TABLE IF NOT EXISTS` — applied lazily when the store is first created
- The runtime calls `migrateEconomicOutcomeStore(db)` and `migrateEconomicIngestionRunStore(db)` in `factory.ts:122-123`
- The `MigrationRegistry` (`packages/memory/src/migrationRegistry.ts`) is a separate version-tracked system used by Cortex and other stores
- The cortex database has its own migration path independent of the economic stores

### Other tables (for context)
- `economic_cost_components` (`packages/memory/src/economicOutcomeStore.ts:314-327`) — has idempotent upsert via `superseded_at`/`reversed_at` columns
- `unit_economics_snapshots` (`packages/memory/src/economicOutcomeStore.ts:331-347`) — stores entire snapshot as JSON in `snapshot_json`
- `economic_outcomes` (`packages/memory/src/economicOutcomeStore.ts:277-307`) — agent-level economic outcomes

## 4. Evidence Store

### Evidence Reference Type
**Location**: `packages/domain/src/economicEvidenceReference.ts`

```typescript
type EconomicEvidenceReference = {
  readonly evidenceId: string;     // "evidence-{N}" from in-memory counter
  readonly sellerId: string;
  readonly sourceSystem: string;   // "mercadolibre" | "supplier" | "manual" | "derived"
  readonly sourceEntityType: string; // "order" | "payment" | "shipment" | "claim" | "ad" | "item"
  readonly sourceRecordId: string;
  readonly sourceField?: string;
  readonly observedAt: number;
  readonly occurredAt: number;
  readonly sourceVersion: string;
  readonly checksum: string;       // "sha256:order:{id}:{total_amount}"
  readonly verification: CostVerification;
  readonly confidence: number;     // 0..1
  readonly ingestionRunId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};
```

### Creation in pipeline
**Pipeline line 241-258**: Evidence refs are built per order during the `adapting` phase. Each order gets an evidence ref with `sourceEntityType: "order"`, `sourceRecordId: order.id`, a simple checksum of `sha256:order:{id}:{total_amount}`, and `verification: "verified"`.

### Persistence: NONE
- Evidence references are created in an in-memory array `evidenceRefs` (pipeline line 241)
- They are **never persisted** to any SQLite table
- There is no `insertEvidenceReference` method anywhere in the memory package
- The `evidence_request_store.ts` is for a completely different concept (agent-to-agent evidence requests, not economic cost evidence)
- The evidence refs exist only for the lifetime of the pipeline call, then are garbage-collected

### Relationship to cost components
- Cost components have `source` and `sourceRecordId` but **no `evidenceId` field**
- There is no foreign key or link between component records and evidence refs
- The evidence refs' `ingestionRunId` is the only provenance link — and even that is ephemeral

### ID counter
Uses module-level `evidenceCounter` (line 61) — same in-memory counter pattern as runCounter.

## 5. Pipeline Flow

**Location**: `packages/agent/src/economics/EconomicIngestionPipeline.ts`

### Overall flow
```
1. Validate seller (VALID_SELLERS Set)
2. Verify read readiness (placeholder — no-op)
3. Acquire in-process lock (sellerLocks Map)
4. Create domain run → persist run record (best-effort)
5. Fetch data via DataFetcher
6. Normalize orders → NormalizedCommerceTransaction[]
7. Strip PII (handled by normalization)
8. Build evidence refs (in-memory, not persisted)
9. Run adapters → EconomicCostComponent[]
10. Evaluate missing inputs (within computeUnitEconomics)
11. Compute snapshots → UnitEconomicsSnapshot[]
12. Persist cost components and snapshots
13. Reconcile source vs computed totals
14. Transition to completed (only if balanced)
15. Update run record (best-effort) + checkpoint
16. Release lock → return result
```

### Lock mechanism
- In-process `Map<string, boolean>` (`sellerLocks`, line 121)
- **Not distributed**: two processes can both ingest the same seller
- `acquireLock()` returns false if already locked → throws "already being ingested"
- `releaseLock()` in `finally` block (line 535) and in catch block (line 555)

### Error handling
- Outer `try/catch` (line 538): catches any unhandled error, creates a `failed` run, logs error JSON to stderr
- Inner `try/catch` for runStore persistence (lines 197-209, 452-483): silently swallows store errors
- `transitionRun` errors: will propagate up to outer catch (no specific try/catch around transitions)
- Reconciliation non-balanced: run stays in `persisting` — not treated as error but also not completed

### Counts
- `transactions.length` = number of normalized line items (not orders)
- `allComponents.length` = all cost components generated by adapters
- `snapshots.length` = one snapshot per line item (cancelled orders → 0 snapshots)
- `fetched.orders.length + fetched.ads.length` = records fetched

### Final run object
The pipeline creates a **second** `createEconomicIngestionRun` call (line 507-529) with the actual counts. This is the object returned to the caller but NOT used to update the DB row (the DB update happens earlier at line 455 with the in-progress run's status).

**This creates a divergence**: the DB `result` column stores the counts based on the in-progress run status, but the return value has complete counts computed after all processing.

## 6. Cost Component and Snapshot Stores

### Cost Components
**Table**: `economic_cost_components` (in `economicOutcomeStore.ts:314`)

Key fields: `id`, `seller_id`, `type`, `amount_minor`, `currency`, `source`, `source_record_id`, `occurred_at`, `observed_at`, `verification`, `confidence`, `metadata_json`

Additional columns via idempotent migration: `source_version`, `economic_meaning`, `superseded_at`, `reversed_at`, `reversed_reason`

**CRITICAL**: No `ingestion_run_id` column. Components cannot be traced back to the run that created them.

Idempotency: Uses `(seller_id, source, source_record_id, economic_meaning, source_version)` unique index with `WHERE reversed_at IS NULL AND superseded_at IS NULL`. On conflict, old versions are `superseded_at` and new one inserted.

### Snapshots
**Table**: `unit_economics_snapshots` (in `economicOutcomeStore.ts:331`)

Key fields: `snapshot_id`, `seller_id`, `order_id`, `item_id`, `sku`, `currency`, `snapshot_json` (full JSON of the UnitEconomicsSnapshot), `calculated_at`

**CRITICAL**: No `ingestion_run_id` column. Snapshots cannot be traced back to the run that created them.

### Link to ingestion
The `NormalizedCommerceTransaction` carries `ingestionRunId`, but:
- Transactions are ephemeral (in-memory during pipeline)
- Cost components don't carry `ingestionRunId`
- Snapshots don't carry `ingestionRunId`
- Only the run record itself knows its own ID — the data it produces is unlinked

## 7. The "transactions" vs "snapshots" Counts

### What "transactions" means
In `pipeline.test.ts`, the test `"completes a successful run for plasticov"` uses a single order with one line item:
- 1 order → 1 line item → 1 normalized transaction → `transactions: 1`
- The order has `sale_fee_amount`, `shipping_cost`, `seller_funded_discount` → 3 adapters produce components → `components: 3`
- 1 line item → 1 snapshot → `snapshots: 1`

### What creates the counts
- **transactions**: `normalizeOrders()` returns one `NormalizedCommerceTransaction` per line item (not per order). Name is misleading — should be "line items" or "normalized transactions".
- **components**: Sum of all components from all adapters per transaction. Stub adapters (productCost, landedCost, packaging, financing, tax, other) always return `[]` — they contribute zero.
- **snapshots**: `createUnitEconomicsSnapshot()` is called once per transaction (line 372-392). Cancelled orders skip snapshot creation (line 374: `if (revenueResult === null) continue`).

### The discrepancy pattern
For a real-world run with 101 orders averaging ~2.8 items each and ~3 components per item, you'd see:
- `transactions: ~279` (101 orders × ~2.8 line items)  
- `components: ~837` (279 × 3)
- `snapshots: ~279`

But the test expects `transactions: 1` for one single-item order — consistent with the line-item-count interpretation.

## 8. CLI Layer

**Location**: `packages/agent/src/cli/economicCli.ts`

### Ingest command (`handleIngest`, line 194)
- Creates `PipelineConfig` with sellerId, mode, maxPages, etc.
- Runs `runtime.pipeline(config)`
- Output includes: `runId`, `mode`, `status`, `snapshotsCreated`, `reconciliation`, `details`
- Does NOT display: `transactions`, `components`, `recordsFetched`, `elapsedMs` (these are only in the pipeline's console.log)
- On failure: exits with error, shows `reconciliation.details` as error
- Has PII sanitization layer (`sanitizeForOutput`)

### Other commands
- `status`: Shows last run (`runId`, `mode`, `status`, `startedAt`, `completedAt`, `snapshotsCreated`) and total run count
- `coverage`: Queries cost components per dimension, returns `complete`/`partial`/`unavailable`
- `reconcile`: Re-runs reconciliation from stored snapshots
- `missing`: Lists missing cost inputs by snapshot

### Error handling
- CLI wraps command in `try/catch` (line 440-443), always calls `runtime.close()` in `finally`
- Exit code 1 on error, 0 on success

## 9. Factory

**Location**: `packages/agent/src/economics/factory.ts`

### Wiring
```typescript
function createEconomicIngestionRuntime(seller, overrides?) {
  1. Load env → loadRepositoryEnvironment()
  2. Resolve seller → getMlAccountRoleConfig()
  3. Feature gate → MSL_ECONOMIC_INGESTION_ENABLED
  4. OAuth/ML client → createMultiAppOAuthManager() + createOAuthMlcApiClient()
  5. SQLite stores → getSharedDb() → createSqliteEconomicOutcomeStore(db), createSqliteEconomicIngestionRunStore(db)
  6. DataFetcher → createProductionDataFetcher()
  7. Observability → createLogger(), createMetrics()
  8. Pipeline → runEconomicIngestion(config, store, dataFetcher, runStore)
  9. Health → storeReady, runStoreReady, dataFetcherReady, featureGateEnabled
  10. Cleanup → close()
}
```

### Run ID generation
The factory does NOT generate run IDs. Run IDs are created by `createEconomicIngestionRun()` in the domain factory (`packages/domain/src/economicIngestionRun.ts:170-171`), called from the pipeline.

## 10. Other Related Files

### EconomicIngestionRun.ts (agent-side)
**Location**: `packages/agent/src/economics/EconomicIngestionRun.ts`

- `transitionRun()` — state machine: `pending → fetching → normalizing → adapting → computing → persisting → completed`
- Any status → `failed` (via `FAILABLE_STATUSES`)
- Creates new immutable run objects via `createEconomicIngestionRun()` (domain factory)
- Sets `checkpointAfter` on terminal states

### EconomicReconciliationService.ts
**Location**: `packages/agent/src/economics/EconomicReconciliationService.ts`

- Compares source totals (from fetched data) vs computed totals (from snapshots)
- Returns: `balanced`, `balanced-with-tolerance`, `incomplete`, `mismatched`, `disputed`
- Tolerance = 1 minor unit (1 centavo)
- Checks 5 dimensions: grossRevenue, fees, shipping, ads, refunds

### NormalizedCommerceTransaction
**Location**: `packages/domain/src/normalizedCommerceTransaction.ts`

- Created via `createNormalizedCommerceTransaction()` factory
- Field `ingestionRunId` links back to the run
- Contains `sourceEvidenceIds: string[]` (set to `["order:{orderId}"]`)
- No PII stored (by design)

## Summary of Critical Vulnerabilities

| # | Issue | Severity | Impact |
|---|---|---|---|
| 1 | In-memory `runCounter` resets on restart | HIGH | Duplicate run IDs on restart → primary key violation (silently swallowed) |
| 2 | Run persistence is best-effort (silent catch) | HIGH | Lost run records with no alerting |
| 3 | Reconciliation failure leaves run in `persisting` forever | MEDIUM | Orphaned DB rows, no recovery |
| 4 | No `ingestion_run_id` on cost components or snapshots | HIGH | Data provenance lost — can't trace back which run produced which data |
| 5 | Evidence references never persisted | MEDIUM | Evidence chain of custody is ephemeral; no audit trail |
| 6 | In-process lock only | LOW | Two processes can run concurrently; recovery handles this but with data loss |
| 7 | Final run return value and DB row can diverge | LOW | The DB says one thing, the return says another (counts may differ) |
