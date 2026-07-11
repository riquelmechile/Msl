# Backfill Plan — Historical Order Ingestion

## Goal

Backfill unit economics for all historical MercadoLibre orders (Plasticov and Maustian) without overwhelming the ML API, corrupting data, or causing downtime.

## Prerequisites

- [x] `MSL_ECONOMIC_INGESTION_ENABLED=true`
- [x] OAuth tokens configured and verified (`npm run meli:smoke -- --seller source`)
- [x] `EconomicOutcomeStore` SQLite database exists and is writable
- [x] Feature gate readiness check passes

## Backfill Strategy

### Phase 1: Small Batch (Validation)
```bash
npm run economic:ingest -- --seller plasticov --max-pages 1
```
- Fetches 1 page of orders (~50 orders)
- Verifies pipeline works end-to-end
- Check reconciliation: `npm run economic:reconcile -- --seller plasticov`
- Check coverage: `npm run economic:coverage -- --seller plasticov`
- Expected: `balanced` or `balanced-with-tolerance` for reconciled orders

### Phase 2: Medium Batch (Stress Test)
```bash
npm run economic:ingest -- --seller plasticov --max-pages 10
```
- Fetches ~500 orders
- Validates idempotency (re-running produces no duplicates)
- Validates supersede logic (same order, updated data)

### Phase 3: Full Backfill
```bash
npm run economic:ingest -- --seller plasticov --max-pages 100
npm run economic:ingest -- --seller maustian --max-pages 100
```
- Fetches all available historical orders per seller
- Pipeline uses checkpoint-based resume — can be interrupted and restarted

## Rate Limiting

ML API rate limits are respected through:
- `--max-pages` CLI flag to control batch size
- Checkpoint-based pagination (resumes from last fetched page)
- The daemon uses small page limits for incremental runs
- No parallel seller ingestion (sequential per seller to avoid rate limits)

## Checkpoint Strategy

The pipeline uses a checkpoint pattern:
```
Checkpoint: { sellerId, lastProcessedOrderId, lastProcessedAt, pageCount }
```
- On restart, the pipeline resumes from the last checkpoint
- Completed runs advance the checkpoint
- Failed runs keep the old checkpoint (no partial progress recorded)
- Checkpoints are stored with the ingestion run record

## Dry-Run First

Always dry-run before persisting:
```bash
npm run economic:ingest -- --seller plasticov --dry-run
```
- Dry-run processes everything but does NOT write to the store
- Use it to verify adapter output, normalization correctness
- Check for unexpected `missingInputs` declarations

## Verification After Backfill

After each phase:
1. `npm run economic:coverage -- --seller <id> --json` — verify dimensions are `complete` where expected
2. `npm run economic:reconcile -- --seller <id>` — verify `balanced` or `balanced-with-tolerance`
3. `npm run economic:missing -- --seller <id>` — verify only stub adapters show as missing
4. Run the Finance Director tool `reconcile_seller_economics` from the agent to double-check

## Recovery

If backfill fails:
- No data is corrupted — idempotent inserts prevent duplicates
- Superseded rows are preserved, not lost
- Re-run from the checkpoint (pipeline resumes)
- Use `--dry-run` to validate before persisting again

## Estimated Time

| Phase | Orders | Approximate Time | Rate Limit Risk |
|-------|--------|-----------------|----------------|
| Small batch | ~50 | < 1 minute | None |
| Medium batch | ~500 | 5-10 minutes | Low |
| Full backfill | ~5,000+ | 30-60 minutes | Moderate (spread across hours) |

For sellers with very large order histories, split the backfill across multiple days using incremental `--max-pages` runs.
