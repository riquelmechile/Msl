# Design: Complete Real Economic Ingestion Wiring

## Architecture Decision: Shared Factory Pattern

### Problem
CLI, daemon, and CEO tools all need the same dependency graph (store, pipeline, data fetcher, OAuth). Duplicating construction logic across three surfaces creates drift and makes testing harder.

### Decision
Create a single factory function `createEconomicIngestionRuntime(seller: SellerSlug)` that constructs and returns the complete economic ingestion runtime. All three surfaces (CLI, daemon, tools) consume this factory.

### Factory Dependency Graph
```
createEconomicIngestionRuntime(seller)
  ├── loadRepositoryEnvironment()
  ├── MercadoLibreAccountRegistry.getAccount(seller)
  ├── createOAuthManager(account)
  ├── TokenStore (encrypted, existing)
  ├── createDataFetcher(oauthManager) — read-only ML client
  ├── EconomicOutcomeStore (SQLite, existing)
  ├── EconomicIngestionRunStore (SQLite, NEW)
  ├── EconomicReconciliationService (existing)
  ├── EconomicIngestionPipeline(fetcher, store, runStore, reconciliation) — existing, just wired
  ├── StructuredLogger (existing)
  ├── MetricsCollector (existing)
  └── RuntimeHealthDependencies (existing)
```

### Why Not Per-Command Construction?
- CLI commands share 90% of dependencies
- Daemon needs identical setup
- Testing requires deterministic injection — factory accepts optional overrides

## Architecture Decision: EconomicIngestionRunStore

### Problem
The pipeline needs to persist run state (created, running, completed, failed) and checkpoints for incremental/resume. Currently no persistence exists — runs are ephemeral.

### Decision
Create `EconomicIngestionRunStore` using the existing SQLite migration framework. Same database as `EconomicOutcomeStore`, separate tables.

### Schema
```sql
CREATE TABLE economic_ingestion_runs (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  status TEXT NOT NULL,  -- created|running|completed|failed|partial
  mode TEXT NOT NULL,     -- full|incremental|backfill|reconcile
  started_at TEXT,
  completed_at TEXT,
  params TEXT,            -- JSON: from, to, limit, maxPages, dryRun
  result TEXT,            -- JSON: fetched, snapshots, errors
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE economic_ingestion_checkpoints (
  seller_id TEXT PRIMARY KEY,
  last_order_date TEXT,
  last_order_id TEXT,
  last_run_id TEXT,
  updated_at TEXT NOT NULL
);
```

### Why Not In-Memory?
- Runs must survive process restarts
- Checkpoints enable incremental ingestion across sessions
- CLI status/coverage commands need historical run data

## Architecture Decision: CLI as Thin Wrapper

### Decision
CLI handlers become thin wrappers: parse args → call factory → delegate to pipeline/store. Zero business logic in CLI.

```typescript
async function handleIngest(args: IngestArgs): Promise<CliResult> {
  const runtime = createEconomicIngestionRuntime(args.seller);
  const pipeline = runtime.pipeline;
  const result = await pipeline.run({...args});
  return { exitCode: result.success ? 0 : 1, data: result };
}
```

### Why Not CLI-Specific Logic?
- Business logic belongs in pipeline/store
- Testing: mock factory, verify pipeline called correctly
- Consistency: daemon and CLI produce identical results

## Architecture Decision: DataFetcher Production Wiring

### Decision
The `DataFetcher` interface already exists. Create a production implementation that uses the existing ML API client (read-only), pagination, rate limiting, and PII sanitization via the existing normalization layer.

### Existing Interface
```typescript
interface DataFetcher {
  fetchOrders(seller, params): Promise<NormalizedOrder[]>;
  fetchOrderItems(seller, orderIds): Promise<NormalizedOrderItem[]>;
  fetchPayments(seller, orderIds): Promise<NormalizedPayment[]>;
  fetchShipping(seller, orderIds): Promise<NormalizedShipping[]>;
  fetchClaims(seller, params): Promise<NormalizedClaim[]>;
  fetchProductAdsCosts(seller, params): Promise<NormalizedAdsCost[]>;
}
```

The production implementation fetches from ML API, then passes through the existing normalization layer. PII is stripped at the normalization boundary.

## Non-Decisions (Deferred)

- **Product cost adapter** — Remains `missingInput`. Requires external supplier data.
- **Landed cost adapter** — Remains `missingInput`. Requires customs/freight data.
- **Write operations** — Remain blocked. No ML mutations.
- **Full historical backfill** — Out of scope. Limited smoke test only.
