# Real Smoke Plan: Economic Ingestion Wiring

## Safety Gates (ALL must pass before any ML call)

- [ ] `.env.local` in `.gitignore` — verified
- [ ] OAuth DB outside repo — verified
- [ ] Economic DB outside repo — verified  
- [ ] Working tree clean — verified
- [ ] No concurrent economic processes — verified
- [ ] Feature flag NOT required for manual CLI execution

## Phase A: Plasticov Dry-Run

```bash
npm run economic:ingest -- --seller source --dry-run --no-persist --max-pages 1 --limit 5 --json
```

**Expected:**
- Real ML API calls (read-only)
- Normalized transactions (PII stripped)
- Adapters executed (revenue, fees, shipping, etc.)
- Snapshots calculated (partial — product/landed cost missing)
- Missing inputs declared
- Reconciliation executed
- ZERO persistence
- Exit code reflects partial status
- `noExternalMutationExecuted: true`

## Phase B: Maustian Dry-Run

Same parameters, seller=target.

## Phase C: Controlled Persistence — Plasticov

```bash
# Backup economic DB first
cp $ECONOMIC_DB_PATH $ECONOMIC_DB_PATH.bak.$(date +%Y%m%d-%H%M%S)

npm run economic:ingest -- --seller source --max-pages 1 --limit 5 --json

# Verify
npm run economic:status -- --seller source --json
npm run economic:coverage -- --seller source --json
npm run economic:missing -- --seller source --json
npm run economic:reconcile -- --seller source --json
```

## Phase D: Controlled Persistence — Maustian

Same as Phase C, seller=target.

## Phase E: Idempotency Verification

```bash
# Re-run same ingestion
npm run economic:ingest -- --seller source --max-pages 1 --limit 5 --json

# Expected: zero new duplicates, same components, stable/advanced checkpoint
```

## Phase F: Evidence Table

After all phases, produce per-seller metrics table:

| Metric | Plasticov | Maustian |
|--------|-----------|----------|
| Orders fetched | | |
| Lines normalized | | |
| Evidence references | | |
| Components created | | |
| Snapshots created | | |
| Complete | | |
| Partial | | |
| Unverifiable | | |
| Disputed | | |
| Gross revenue known | | |
| Fees known | | |
| Shipping known | | |
| Refunds known | | |
| Discounts known | | |
| Ads known | | |
| Product cost missing | | |
| Landed cost missing | | |
| Reconciliation | | |
| Duplicate count | | |
| Checkpoint | | |
| Duration | | |

## Success Criteria

1. Real ML read-only calls succeed
2. No PII in any output
3. No secrets in any output
4. Snapshots contain real data (partial is expected)
5. Missing inputs correctly declared
6. Idempotent re-ingestion
7. Zero ML mutations
