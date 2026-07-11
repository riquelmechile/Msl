# Production Runbook — Operations, Recovery, Monitoring

## System Overview

| Component | Process | Schedule | Feature Gate |
|-----------|---------|----------|-------------|
| Economic ingestion daemon | `msl-agent-daemons` | 15-min cycles | `MSL_ECONOMIC_INGESTION_ENABLED=true` |
| CLI tools | Manual invocation | On-demand | Uses same flag |
| Finance Director tools | Via AgentLoop | On CEO query | Requires `economicStore` in config |
| Readiness check | `npm run production:readiness` | Startup / on-demand | Always runs |

## Startup Procedure

1. Ensure `.env.local` has:
   - `MSL_ECONOMIC_INGESTION_ENABLED=true`
   - All MercadoLibre OAuth variables configured
2. Run readiness check:
   ```
   npm run production:readiness
   ```
   Verify `real-economic-ingestion` capability shows `ready`
3. Start the daemon process:
   ```
   pm2 start ecosystem.config.cjs --only msl-agent-daemons
   ```
4. Verify daemon is running:
   ```
   pm2 logs msl-agent-daemons --lines 20
   ```
   Look for "Economic ingestion enabled" log line

## Shutdown Procedure

1. Set `MSL_ECONOMIC_INGESTION_ENABLED=false` in `.env.local`
2. Restart PM2:
   ```
   pm2 restart msl-agent-daemons
   ```
3. The daemon will no-op on next cycle
4. Existing data in SQLite is preserved (feature gate only controls execution, not data access)

## Monitoring

### Via CLI
```
npm run economic:status -- --seller plasticov --json
```
Returns last run status, checkpoint position, and counts.

### Via Health Check
The `systemHealthDaemon` emits an economic-ingestion health event:
- Feature gate off → `ok`: "Economic ingestion disabled"
- Feature gate on, no runs yet → `warning`: "last successful run: not yet tracked"
- Feature gate on, runs completed → (future) `ok` with run stats

### Via Readiness
```
npm run production:readiness -- --json | jq '.capabilities["real-economic-ingestion"]'
```

### Via Agent Tools
The Finance Director can use `reconcile_seller_economics` and `inspect_coverage` in conversation.

## Recovery Scenarios

### Stale Checkpoint (daemon stuck)
1. Identify the seller: check logs for "checkpoint" lines
2. Run manual ingestion: `npm run economic:ingest -- --seller <id> --max-pages 1`
3. This advances the checkpoint — daemon resumes normally

### Reconciliation Mismatch
1. `npm run economic:reconcile -- --seller <id>` — note the difference
2. Investigate specific cost components: use `inspect_cost_components` tool
3. If data error found: `reverseCostComponent(id, reason)` via store
4. Re-ingest: `npm run economic:ingest -- --seller <id>`
5. Re-reconcile — should be `balanced` or `balanced-with-tolerance`

### Database Corruption
- Economic databases are part of the SQLite durability system
- Use `DatabaseManager.restoreFrom(backupPath)` to restore from backup
- Then re-run ingestion to catch up since the backup

### OAuth Token Expired
1. Check: `npm run meli:connection:status -- --seller source`
2. Refresh: `npm run meli:refresh -- --seller source`
3. If refresh fails with `invalid_grant`: re-authorize via `npm run meli:connect:url`
4. After OAuth restored, the daemon resumes automatically

## Backup

Economic data is backed up as part of the SQLite durability system:
- `DatabaseManager.backup()` runs every 24h
- 7-day retention
- Backup verification included
- Restore tested periodically
