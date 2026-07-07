# Tasks: Process Separation

## Phase 1: SQLite busy_timeout

- [ ] 1.1 Add `db.pragma("busy_timeout = 5000")` to `getSharedDb()` in `connectionPool.ts`

## Phase 2: Remove ingestion from bot

- [ ] 2.1 Remove `startBackgroundIngestion()` call from `createTelegramBotFromEnv()` in `packages/bot/src/index.ts`
- [ ] 2.2 Remove `ingestionHandle?.stop()` from bot's `stop()` handler

## Phase 3: Worker entry point

- [ ] 3.1 Create `scripts/start-worker-ingestion.mjs` — standalone ingestion process
  - Load .env.local, set up OAuth + MLC client, Cortex engine, operational store
  - Call `startBackgroundIngestion()` with no-op Telegram callbacks
  - Graceful shutdown on SIGINT/SIGTERM

## Phase 4: Daemon entry point

- [ ] 4.1 Create `scripts/start-agent-daemons.mjs` — standalone daemon scheduler
  - Load .env.local, set up bus DB + Cortex engine + operational reader
  - Call `startDaemonScheduler()`
  - Graceful shutdown on SIGINT/SIGTERM

## Phase 5: PM2 configuration

- [ ] 5.1 Add `msl-worker-ingestion` process definition to `ecosystem.config.cjs`
- [ ] 5.2 Add `msl-agent-daemons` process definition to `ecosystem.config.cjs`
