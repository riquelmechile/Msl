# Confirmed Findings: finalize-economic-ingestion-durability

Maps the 7 findings from the task to concrete code evidence.

---

## Finding 1: Run ID collisions across restarts

**Severity**: 🔴 HIGH

**Problem**: `runCounter` is a module-level `let` in `packages/domain/src/economicIngestionRun.ts`.

**Evidence**:
```typescript
// File: packages/domain/src/economicIngestionRun.ts
// Line 76:
let runCounter = 0;

// Lines 170-171:
runCounter++;
const runId = `ingestion-run-${runCounter}`;
```

**Impact**: On process restart, `runCounter` resets to 0. The next run gets `ingestion-run-1`, which may already exist in the DB. The store's `createRun` would throw a primary key violation.

**But the throw is silently swallowed** — see Finding 2.

**Same pattern** for evidence IDs (`evidenceCounter` in `economicEvidenceReference.ts:61`) and cost component IDs (`costComponentIdCounter` in `economicOutcomeStore.ts:248`).

---

## Finding 2: Best-effort persistence swallows store errors

**Severity**: 🔴 HIGH

**Problem**: Both write operations to the run store are wrapped in `catch { }` with a comment saying "best-effort".

**Evidence**:

**Location 1** — Initial create (line 196-209):
```typescript
// File: packages/agent/src/economics/EconomicIngestionPipeline.ts
if (runStore && !config.dryRun && !config.noPersist) {
  try {
    await runStore.createRun({
      runId: run.runId,
      sellerId: run.sellerId,
      status: run.status,
      mode: run.mode,
      startedAt: run.startedAt,
      params: { maxPages: config.maxPages, mode: config.mode },
    });
  } catch {
    // Run persistence is best-effort; don't block the pipeline
  }
}
```

**Location 2** — Final update (line 452-483):
```typescript
if (runStore && !config.dryRun && !config.noPersist) {
  try {
    await runStore.updateRun(run.runId, {
      status: run.status,
      completedAt: run.completedAt ?? endTime,
      result: { transactions, components, snapshots, ... }
    });
    if (run.status === "completed") {
      await runStore.updateCheckpoint(run.sellerId, checkpointData);
    }
  } catch {
    // Run persistence is best-effort
  }
}
```

**Impact**: If the SQLite DB is locked, disk full, or schema mismatch, the run proceeds with zero indication that the record was lost. No logging, no metrics, no alert.

---

## Finding 3: Reconciliation failure leaves run in persisting forever

**Severity**: 🟡 MEDIUM

**Problem**: The run only transitions to `completed` when reconciliation is `balanced` or `balanced-with-tolerance`.

**Evidence**:
```typescript
// File: packages/agent/src/economics/EconomicIngestionPipeline.ts
// Lines 443-449:
if (
  reconciliation.status === "balanced" ||
  reconciliation.status === "balanced-with-tolerance"
) {
  run = transitionRun(run, "completed");
}
```

**Impact**: For `mismatched`, `disputed`, or `incomplete` reconciliations, the run stays in `persisting`. The `getActiveRun` query includes `persisting` in its active statuses, meaning subsequent runs would see it as active. The `recoverAbandonedRun` method would eventually mark it as `failed`, but only if explicitly called.

**Evidence from getActiveRun** (economicIngestionRunStore.ts:229-234):
```sql
SELECT * FROM economic_ingestion_runs
WHERE seller_id = ? AND status IN ('pending', 'fetching', 'normalizing', 'adapting', 'computing', 'persisting')
```

---

## Finding 4: Cost components and snapshots lack ingestionRunId

**Severity**: 🔴 HIGH

**Problem**: Neither the `economic_cost_components` nor `unit_economics_snapshots` tables have an `ingestion_run_id` column.

**Evidence**:

Cost components schema (`economicOutcomeStore.ts:314-327`):
```sql
CREATE TABLE IF NOT EXISTS economic_cost_components (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  -- ... other columns ...
  -- NO ingestion_run_id column
);
```

Snapshots schema (`economicOutcomeStore.ts:331-347`):
```sql
CREATE TABLE IF NOT EXISTS unit_economics_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  -- ... other columns ...
  snapshot_json TEXT NOT NULL,
  calculated_at INTEGER NOT NULL
  -- NO ingestion_run_id column
);
```

**Impact**: There is no way to trace which cost component or snapshot was produced by which ingestion run. Provenance is lost the moment the pipeline call ends. You cannot:
- List all components created in a specific run
- Roll back or mark all data from a failed run
- Audit: "which run produced this shipping cost?"

---

## Finding 5: Evidence references are never persisted

**Severity**: 🟡 MEDIUM

**Problem**: `EconomicEvidenceReference` objects are created in-memory during the pipeline but never written to any persistence layer.

**Evidence**:

Creation (pipeline lines 241-258):
```typescript
const evidenceRefs: EconomicEvidenceReference[] = [];
for (const order of fetched.orders) {
  const evidenceResult = createEconomicEvidenceReference({
    sellerId: config.sellerId,
    sourceSystem: "mercadolibre",
    sourceEntityType: "order",
    sourceRecordId: order.id,
    // ...
    ingestionRunId: run.runId,
  });
  if (evidenceResult.success) {
    evidenceRefs.push(evidenceResult.evidence);
  }
}
// evidenceRefs is never passed to any store or persisted
// It goes out of scope and is garbage-collected
```

**Search for persistence**: `grep "EconomicEvidenceReference|evidenceReference"` in packages/memory returns ZERO matches. No insert/upsert exists.

**Also**: The generic `evidence_request_store.ts` is a completely different system (agent-to-agent evidence exchange, not economic data provenance).

**Impact**: The evidence chain of custody exists only during pipeline execution. After the call returns, there is no record of what source data was used, no checksums preserved, no audit trail. If data is disputed later, there is no evidence to verify against.

---

## Finding 6: In-process lock, no distributed coordination

**Severity**: 🟢 LOW

**Problem**: The lock is a `Map` local to the Node.js process.

**Evidence**:
```typescript
// File: packages/agent/src/economics/EconomicIngestionPipeline.ts
// Lines 121-131:
const sellerLocks = new Map<string, boolean>();

function acquireLock(sellerId: string): boolean {
  if (sellerLocks.get(sellerId)) return false;
  sellerLocks.set(sellerId, true);
  return true;
}
```

**Impact**: Two separate `npx tsx economicCli.ts ingest` processes can both ingest the same seller simultaneously. The `recoverAbandonedRun` method partially mitigates this, but one of the two runs would have its data persisted while the other would be marked as `failed` — potentially losing valid data.

---

## Finding 7: Final run return value vs DB row divergence

**Severity**: 🟢 LOW

**Problem**: The pipeline creates TWO `EconomicIngestionRun` objects. The first is persisted to the DB (at line 455 with transition-based status). The second is created later (line 507-529) with actual counts and returned to the caller.

**Evidence**:

**DB update** (line 455-464) — uses the status from `transitionRun()` which may or may not be `completed`:
```typescript
await runStore.updateRun(run.runId, {
  status: run.status,  // ← could be "persisting" if reconciliation failed
  completedAt: run.completedAt ?? endTime,
  result: {
    transactions: transactions.length,
    components: allComponents.length,
    snapshots: snapshots.length,
    // ...
  },
});
```

**Return value** (line 507-531) — creates a fresh `EconomicIngestionRun` with complete counts:
```typescript
const finalRunResult = createEconomicIngestionRun({
  sellerId: config.sellerId,
  mode: config.mode,
  // ... actual counts:
  recordsFetched: fetched.orders.length + fetched.ads.length,
  recordsNormalized: transactions.length,
  componentsCreated: allComponents.length,
  snapshotsCreated: snapshots.length,
  // ...
  status: run.status,
});

const finalRun = finalRunResult.success ? finalRunResult.run : run;
return { run: finalRun, snapshots, reconciliation };
```

**Impact**: The counts in the DB and the returned object should match (they use the same `transactions.length`, `allComponents.length`, `snapshots.length`), but the timestamps (`completedAt`) and checkpoint fields (`checkpointAfter`) can diverge because two separate calls to `createEconomicIngestionRun` increment `runCounter` twice and use different timestamps.

---

## Summary Table

| # | Finding | Confirmed | Code Location | Urgency |
|---|---|---|---|---|
| 1 | Run ID collisions | CONFIRMED | `economicIngestionRun.ts:76,170-171` | Fix before any production run |
| 2 | Silent DB errors | CONFIRMED | `EconomicIngestionPipeline.ts:207,481` | Fix before any production run |
| 3 | Run stuck in persisting | CONFIRMED | `EconomicIngestionPipeline.ts:444-449` | Fix before any production run |
| 4 | Missing ingestionRunId FK | CONFIRMED | `economicOutcomeStore.ts:314,331` | Schema change — coordinate carefully |
| 5 | Evidence not persisted | CONFIRMED | `EconomicIngestionPipeline.ts:241-258` | Medium — needed for audit/provenance |
| 6 | No distributed lock | CONFIRMED | `EconomicIngestionPipeline.ts:121-127` | Low — mitigated by recovery |
| 7 | DB/return divergence | CONFIRMED | `EconomicIngestionPipeline.ts:455 vs 507` | Low — cosmetic unless counts differ |
