# Proposal: Process Separation — Extract Ingestion & Daemons from Bot

## Intent

MSL currently bundles background ingestion into the Telegram bot process, violating separation of concerns. The daemon scheduler has no dedicated process entry point. Both need standalone PM2-managed processes.

Also fix missing `busy_timeout` SQLite pragma preventing concurrent reads.

## Scope

### In Scope
- Add `busy_timeout = 5000` to shared connection pool
- Create `msl-worker-ingestion` PM2 process (standalone background ingestion)
- Create `msl-agent-daemons` PM2 process (daemon scheduler)
- Create entry point scripts for both new processes
- Remove background ingestion startup from bot process

### Out of Scope
- Changing ingestion logic or daemon behavior
- Adding new environment variables
- Modifying Web process

## Capabilities

### New Capabilities
None — infrastructure/deployment change only.

### Modified Capabilities
None — no spec-level requirement changes.

## Approach

Add `busy_timeout` pragma to shared connection pool. Create two new PM2 process definitions in `ecosystem.config.cjs` following existing patterns. Create standalone entry scripts that replicate the bot's infrastructure setup (OAuth, Cortex, operational store) independently. Remove the ingestion `startBackgroundIngestion()` call from `createTelegramBotFromEnv()` so the bot process only runs Telegram interface + agent loop.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/memory/src/connectionPool.ts` | Modified | +1 line for `busy_timeout = 5000` |
| `ecosystem.config.cjs` | Modified | +2 process definitions |
| `scripts/start-worker-ingestion.mjs` | New | Worker entry point |
| `scripts/start-agent-daemons.mjs` | New | Daemon entry point |
| `packages/bot/src/index.ts` | Modified | Remove ingestion startup |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Worker and bot share same Cortex DB causing WAL contention | Low | `busy_timeout` added; WAL already enabled |
| Missing env vars in standalone worker | Low | Same env loading pattern as bot script |

## Rollback Plan

Revert commit. Restart PM2 with previous `ecosystem.config.cjs`.

## Dependencies

None.

## Success Criteria

- [ ] `msl-worker-ingestion` starts via PM2 and runs ingestion independently
- [ ] `msl-agent-daemons` starts via PM2 and runs daemon scheduler independently
- [ ] `msl-telegram-bot` starts via PM2 without background ingestion
- [ ] `busy_timeout = 5000` applied to all shared DB connections
