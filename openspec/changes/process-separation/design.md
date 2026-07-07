# Design: Process Separation

## Architecture Decision

Four independent PM2 processes replacing two:

```
Before:                          After:
msl-telegram-bot                 msl-telegram-bot
  ├─ Telegram long polling         └─ Telegram long polling + agent loop
  ├─ Agent loop (conversation)
  └─ Background ingestion         msl-worker-ingestion
                                    └─ Background ingestion (standalone)
msl-web
  └─ Next.js app                  msl-agent-daemons
                                    └─ Daemon scheduler (standalone)
                                  msl-web
                                    └─ Next.js app
```

## Design Decisions

### 1. Standalone infrastructure per process
Each new process replicates OAuth, Cortex, and operational store setup independently. Rationale: processes are isolated at OS level — sharing in-memory state is impossible. Each process opens its own SQLite connection (protected by WAL + busy_timeout).

### 2. No-op Telegram callbacks in worker
Worker provides `sendProactiveMessage: async () => {}` and `listActiveChats: async () => []` to satisfy `BackgroundIngestionConfig` type. Alerts are logged but not pushed to Telegram when running standalone. Tradeoff: alert delivery moves to a future cross-process channel.

### 3. busy_timeout placement
Added to `getSharedDb()` (connectionPool.ts), which is the singleton path used by all non-Cortex SQLite connections. Cortex uses `createDatabase()` independently but already has WAL + foreign_keys.

### 4. Entry script pattern
Both new scripts follow `scripts/start-bot.mjs` conventions: .env.local loading, async imports from workspace packages, graceful SIGINT/SIGTERM shutdown.

## Process-to-DB Mapping

| Process | Cortex DB | Bus DB | OAuth DB |
|---------|-----------|--------|----------|
| msl-telegram-bot | Read/Write (conversations) | — | Read (tokens) |
| msl-worker-ingestion | Read/Write (data snapshots) | — | Read (tokens) |
| msl-agent-daemons | Read/Write (daemon context) | Read/Write (messages) | — |
