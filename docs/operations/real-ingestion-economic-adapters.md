# Real Ingestion & Economic Adapters — Operational Runbook

> **SDD Change:** `real-ingestion-economic-adapters`
> **SDD Hardening:** `finalize-economic-ingestion-durability`
> **P0 PR 4/4:** Tools + Readiness + Documentation
> **Status:** Complete — infrastructure ready, hardened with durability (UUID IDs, fail-closed, atomic tx, Evidence Store), product cost and landed cost remain partial (stub adapters)

---

## Overview

The Real Ingestion & Economic Adapters pipeline transforms raw MercadoLibre order data into structured economic cost components and unit economics snapshots. It is a **six-layer read-only pipeline** that never mutates MercadoLibre data.

```
Layer A: ML API (read-only)       → MlOrder[], MlItem[], MlPayment[], etc.
Layer B: Normalization            → NormalizedCommerceTransaction[] (PII-stripped)
Layer C: Economic Adapters        → EconomicCostComponent[] (11 adapters)
Layer D: Calculation              → UnitEconomicsSnapshot (deterministic)
Layer E: Persistence              → EconomicOutcomeStore (SQLite, seller-isolated)
Layer F: Consumption              → Finance Director tools, CLI, daemon
```

---

## Command Reference

| Command | Description |
|---------|-------------|
| `npm run economic:ingest -- --seller <id>` | Run full ingestion pipeline for a seller |
| `npm run economic:ingest -- --seller <id> --dry-run` | Dry-run: compute without persisting |
| `npm run economic:ingest -- --seller <id> --no-persist` | Compute and report, skip storage |
| `npm run economic:ingest -- --seller <id> --max-pages 3` | Limit pages fetched from ML API |
| `npm run economic:status -- --seller <id>` | Status of the last ingestion run |
| `npm run economic:coverage -- --seller <id>` | Economic data coverage per dimension |
| `npm run economic:reconcile -- --seller <id>` | Reconcile cost components vs snapshots |
| `npm run economic:missing -- --seller <id>` | List missing economic inputs per seller |

All commands support `--json` for machine-readable output.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MSL_ECONOMIC_INGESTION_ENABLED` | `false` | Enable the economic ingestion pipeline and daemon |
| `MSL_ECONOMIC_INGESTION_DURABILITY` | `true` | Enable durability features: UUID IDs, fail-closed, atomic tx, Evidence Store |

When `MSL_ECONOMIC_INGESTION_DURABILITY=true` (default):
- `CryptoRunIdFactory` generates UUID-based run IDs (`economic-ingestion-{uuid}`)
- Persistence errors abort the pipeline (fail-closed) — no silent catch
- All final writes execute in a single `db.transaction()` — atomic commit
- `EconomicEvidenceStore` persists evidence references with provenance
- `ingestion_run_id` is written on every cost component and snapshot
- Run-scoped metrics track `normalizedLines`, `duplicatesIgnored` per ingestion
- Multi-dimensional reconciliation evaluates revenue, cost, and coverage independently
- Checkpoint advances only after successful commit

When `false` (legacy path):
- Sequential `runCounter`-based run IDs
- Silent catch on persistence errors
- No atomic transaction boundary (writes not grouped)
- No evidence store, no ingestion_run_id provenance
- Single-dimension reconciliation (balanced/mismatched)

When `false` (default):
- The daemon no-ops immediately
- CLI commands return `unavailable` status
- Finance Director tools return empty data with guidance

When `true`:
- The daemon runs incremental ingestion on schedule
- CLI commands execute the full pipeline
- Finance Director tools query real cost components

---

## Data Sources

| Layer | Source System | Data |
|-------|---------------|------|
| Orders | ML `getOrders` | Order status, totals, shipment IDs |
| Items | ML `getItem` | Line items, listing prices, categories |
| Payments | ML `getItemPrices` | Real sale fees (`sale_fee_amount`) |
| Shipping | ML `getShipmentStatus` | Shipping costs (seller-paid only) |
| Promotions | ML `getItemPromotions` | Seller-funded discounts |
| Claims | ML `getClaimReturnCost` | Refund/return charges |
| Advertising | ML `getProductAdsInsights` | Ad spend per campaign |

All data is fetched through the MercadoLibre OAuth connection with real credentials. The pipeline is **read-only** — mutations are blocked by `assertMercadoLibreWriteDisabled()`.

---

## Architecture: 6-Layer Pipeline

### Layer A: ML API (Data Fetch)
- Fetches orders, items, payments, shipments, claims, and ad insights
- Paginated with checkpoint-based resume
- Seller-scoped via OAuth tokens

### Layer B: Normalization
- `normalizeOrders(mlOrders, mlItems, mlPayments)` → `NormalizedCommerceTransaction[]`
- One transaction per line item (multi-item orders → multiple transactions)
- PII stripped: no buyer names, emails, phone numbers
- Cancelled orders flagged, not excluded
- Multi-pack → per-unit price

### Layer C: Economic Adapters (11 total)
5 real adapters:
- `OrderRevenue`: gross revenue from paid orders (feeds snapshot, not a cost)
- `MarketplaceFee`: real `sale_fee_amount` → `marketplace_fee`
- `ShippingCost`: seller-paid shipping only
- `SellerDiscount`: seller-funded portion only (ML-funded excluded)
- `RefundReturn`: refund/return charges linked to items
- `AdvertisingCost`: real ad spend per campaign

6 stub adapters (return empty + declare `missingInputs`):
- `ProductCost`, `LandedCost`, `Packaging`, `Financing`, `Tax`, `Other`

### Layer D: Calculation
- `computeUnitEconomics(transaction, costComponents)` → `UnitEconomicsSnapshot`
- Deterministic: gross revenue − sum of cost component amounts
- Never substitutes zero for missing data — declares `missingInputs`

### Layer E: Persistence (Durability-Hardened)
- `EconomicOutcomeStore` (SQLite) for cost components and snapshots
- `EconomicEvidenceStore` (SQLite) for evidence references with provenance
- `EconomicIngestionRunStore` (SQLite) for run lifecycle tracking
- Atomic transaction boundary: `db.transaction()` wraps evidence inserts, component inserts, snapshot inserts, run update, and checkpoint update
- Idempotent inserts: dedup key = `sellerId + source + sourceRecordId + economicMeaning + sourceVersion`
- Evidence composite key: `(seller_id, source_system, source_entity_type, source_record_id, source_version, checksum)`
- `ingestion_run_id` provenance on all components and snapshots
- Supersede mechanism for updated versions
- Soft-delete via `reversedAt` (never hard-delete)
- Fail-closed: any write failure inside the transaction rolls back all writes, run marked `failed`, CLI exit ≠ 0
- Checkpoint advances only after successful commit
- Seller isolation enforced at the query level

### Layer F: Consumption
- 8 Finance Director tools (inspect, reconcile, coverage, evidence)
- CLI for operational use
- Daemon for scheduled ingestion
- Health events in `systemHealthDaemon`

---

## Missing Inputs Handling

When a cost component type has no data (e.g., `product_cost` from stub adapters or missing ML data):
1. The adapter returns an empty array
2. It declares `missingInputs: ["product_cost"]`
3. The pipeline records this in the snapshot as `missingInputs`
4. `list_missing_economic_inputs` tool surfaces this to the CEO
5. Missing ≠ zero — calculations exclude missing types rather than substituting

---

## Seller Isolation

Every query and mutation is seller-scoped:
- `store.listCostComponents(sellerId, ...)` only returns that seller's data
- `store.listUnitEconomicsSnapshots(sellerId, ...)` same
- The daemon runs per-seller
- Seller A's economic data is never visible to Seller B through any tool or API

---

## Run IDs and Provenance

Every ingestion run is assigned a globally unique UUID-based identifier:

- `CryptoRunIdFactory` generates `economic-ingestion-{uuid}` using `crypto.randomUUID()`
- Collision detection: if PK conflict on `createRun`, retries with new UUID up to 3 attempts
- `DeterministicRunIdFactory` available for test injection (sequential, predictable IDs)
- `ingestion_run_id` is written on every `economic_cost_components` row and `unit_economics_snapshots` row
- Evidence IDs also use UUID: `evidence-{uuid}`, replacing the old sequential counter

### Run Provenance Query

```sql
-- All cost components produced by a specific run
SELECT * FROM economic_cost_components WHERE ingestion_run_id = 'economic-ingestion-abc-123';
```

## Evidence Store

The `EconomicEvidenceStore` persists metadata about economic evidence references with provenance:

- **Table**: `economic_evidence_references` — 15 columns, composite unique key, 3 scan indexes
- **Composite key**: `(seller_id, source_system, source_entity_type, source_record_id, source_version, checksum)`
- **Idempotency**: `upsertEvidence` uses `INSERT ON CONFLICT DO NOTHING` — re-ingestion never creates duplicates
- **Superseding**: `markSuperseded(evidenceId, supersededBy)` preserves old rows
- **Cross-seller isolation**: every query method scopes to `sellerId`
- **No PII**: stores only metadata (type, checksum, version, verification) — no raw payloads, buyer data, or amounts

### CLI: inspect-evidence

```bash
npm run economic:inspect-evidence -- --seller plasticov
npm run economic:inspect-evidence -- --seller plasticov --run economic-ingestion-abc-123
npm run economic:inspect-evidence -- --seller plasticov --source ML-ORDER-123
npm run economic:inspect-evidence -- --seller plasticov --limit 50
npm run economic:inspect-evidence -- --seller plasticov --json
```

## Migration Commands

The MigrationRegistry manages schema versions for economic tables:

```bash
# View current migration state
npm run economic:migration:status

# Apply pending migrations (v1 → v5)
# v1: base tables (existing)
# v2: indexes on economic_ingestion_runs
# v3: ALTER TABLE economic_cost_components ADD COLUMN ingestion_run_id
# v4: ALTER TABLE unit_economics_snapshots ADD COLUMN ingestion_run_id
# v5: CREATE TABLE economic_evidence_references

# Migrations are additive DDL — no destructive changes
# Idempotent: re-running applies only pending versions
```

## Feature Flags

| Flag | Default | Controls |
|------|---------|----------|
| `MSL_ECONOMIC_INGESTION_ENABLED` | `false` | Enable the ingestion pipeline and daemon |
| `MSL_ECONOMIC_INGESTION_DURABILITY` | `true` | UUID IDs, fail-closed, atomic tx, Evidence Store |
| `MSL_MIGRATION_ENABLED` | `false` | MigrationRegistry vs legacy `CREATE TABLE IF NOT EXISTS` |

The two economic flags are independent: durability can be enabled without the pipeline being enabled. `MSL_ECONOMIC_INGESTION_DURABILITY=true` requires the evidence table — if `MSL_MIGRATION_ENABLED=false`, the store falls back to `CREATE TABLE IF NOT EXISTS`.

## PII Protection

- Normalization strips all buyer PII before storage
- No buyer names, emails, phone numbers, or addresses are persisted
- Evidence references store SHA-256 hashes of selected economic fields, not raw payloads
- The `MSL_ENCRYPTION_KEY` variable manages OAuth token encryption separately

---

## Backfill Procedure

To backfill historical orders for a seller:

1. Ensure `MSL_ECONOMIC_INGESTION_ENABLED=true`
2. Run: `npm run economic:ingest -- --seller <id> --max-pages 50`
3. The pipeline uses checkpoint-based pagination — it resumes from the last fetched page
4. Monitor with: `npm run economic:status -- --seller <id>`
5. Verify with: `npm run economic:coverage -- --seller <id>`
6. Reconcile: `npm run economic:reconcile -- --seller <id>`

For large backfills, run in batches with increasing page limits to respect ML API rate limits.

---

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| `npm run economic:ingest` returns "unavailable" | Feature gate disabled | Set `MSL_ECONOMIC_INGESTION_ENABLED=true` |
| Pipeline fails on "OAuth not configured" | Missing ML credentials | Verify `MERCADOLIBRE_SOURCE_*` env vars |
| Reconciliation shows "mismatched" | Cost components and snapshots diverged | Re-run ingestion for that seller |
| Coverage shows "partial" for `product_cost` | Stub adapter — no real data source yet | Expected. Supplier Mirror integration needed for real data |
| Daemon returns empty result | Feature gate off or store unavailable | Check `MSL_ECONOMIC_INGESTION_ENABLED` and SQLite path |
| Rate-limit errors from ML API | Too many pages requested | Reduce `--max-pages`, wait for rate limit reset |

---

## Related Documentation

- `openspec/changes/real-ingestion-economic-adapters/source-mapping.md` — ML endpoint → economic meaning mapping
- `openspec/changes/real-ingestion-economic-adapters/economic-semantics.md` — Cost component type definitions
- `openspec/changes/real-ingestion-economic-adapters/reconciliation-policy.md` — Reconciliation tolerance rules
- `openspec/changes/real-ingestion-economic-adapters/backfill-plan.md` — Detailed backfill strategy
- `openspec/changes/real-ingestion-economic-adapters/production-runbook.md` — Production operations
- `openspec/changes/real-ingestion-economic-adapters/threat-model.md` — Security threats and mitigations
- `ARCHITECTURE.md` — Full system architecture
- `ROADMAP.md` — P0 completion status and P1 next steps
