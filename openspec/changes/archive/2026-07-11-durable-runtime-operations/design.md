# Design: Durable Runtime Operations

## Technical Approach

**Hybrid — shared `DatabaseManager` wrapping `better-sqlite3` + incremental store adoption.** The existing `connectionPool.ts` singleton is the injection point: all durability features (backup, verify, restore, integrity, WAL checkpoint, migrations) live in a new `DatabaseManager` class that wraps the pool's `Database` instance. Stores get durability by going through the pool instead of raw `new Database()` or `createDatabase()`. Feature flags gate every new subsystem independently. Phases: Durability Core → Observability → Health → FinanceValidator hardening → Economic Learning wiring.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| **Connection Consolidation** | 1) Inline refactor 2) `getSharedDb()` + `DatabaseManager` wrapper | `getSharedDb()` + `DatabaseManager` | `connectionPool` already is the singleton per path. One call to `getSharedDb(cortexPath)` in `start-agent-daemons.mjs` replaces 3 `createDatabase()` calls. 3 WAL connections to same file → 1. |
| **Migration Framework** | 1) Keep Cortex `migrate()` separate 2) Extract shared `MigrationRegistry` | Extract shared `MigrationRegistry` | Cortex has the proven pattern. Extract it so other stores get versioned, transactional, idempotent migrations. Cortex stays backward-compatible. |
| **Degraded Policy** | 1) New `CapabilityStatus.degraded` 2) Use existing `ReadinessStatus.degraded` | Use existing `ReadinessStatus.degraded` | `@msl/domain` already defines `"degraded"` in `ReadinessStatus`. `runtimeGates.ts` just needs to handle it: log WARN instead of throw. No new type. |
| **Observability Wiring** | 1) Global singleton logger 2) Factory per-component + correlation ID propagation | Factory + correlation ID propagation | `createLogger()` already exists. Extend with `correlationId` parameter. `daemonScheduler` generates UUID, passes via handler input. Stores inherit from factory call. |
| **Backup Verification** | 1) In-memory after write 2) Open backup file, `PRAGMA integrity_check` | Open backup file, `integrity_check` | Disk-level verification catches write corruption. In-memory verification can't detect filesystem-level failures. |
| **OAuth Token DB** | 1) Encrypt backup 2) Exclude from auto-backup | Exclude from auto-backup | Encrypted tokens in raw page copies is a risk. Simpler and safer: skip it. Manual backup path remains. |

## Data Flow

```
                    DaemonScheduler (every 24h)
                          │
                          ▼
                 DatabaseManager.backupAll()
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    Cortex.wal       Bus.wal        Supplier.wal
          │               │               │
          ▼               ▼               ▼
    backupDatabase()  backupDatabase()  backupDatabase()
    (better-sqlite3    online backup API)
          │
          ▼
    verifyBackup(path)
      → open backup DB
      → PRAGMA integrity_check
      → compare page_count vs source
      → persist metadata to OperationalReadModel
          │
          ▼
    retention.cleanup()
      → list backups by age
      → delete if > 7d AND not last verified
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/memory/src/databaseManager.ts` | **Create** | Shared `DatabaseManager` class: `backup()`, `verifyBackup()`, `restoreFrom()`, `checkIntegrity()`, `checkpointWAL()`, `migrate()`. |
| `packages/memory/src/migrationRegistry.ts` | **Create** | `MigrationRegistry` extracted from Cortex `migrate()`. `register()`, `apply()`. Versioned, transactional, idempotent. |
| `packages/memory/src/backupScheduler.ts` | **Create** | `BackupScheduler`: reads DB paths from config, runs `DatabaseManager.backupAll()` on interval, verifies, retention cleanup. |
| `packages/agent/src/workers/observabilityPipeline.ts` | **Create** | Sanitized logger factory: `createDaemonLogger(name)`, `createStoreLogger(name)`, `sanitizeContext()`. Redacts tokens, keys, prompts. |
| `packages/memory/src/connectionPool.ts` | Modify | Add `getSharedManager(path)` returning `DatabaseManager` wrapping `getSharedDb()`. |
| `packages/memory/src/cortex/database.ts` | Modify | Extract `migrate()` to `MigrationRegistry`. Cortex registers its 2 migrations on the shared registry. |
| `packages/memory/src/operationalReadModel.ts` | Modify | `migrateOperationalStore()` → `MigrationRegistry` registration. |
| `packages/agent/src/conversation/agentMessageBusStore.ts` | Modify | `migrateBusSchema()` → `MigrationRegistry` registration. |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Add `"economic-learning"` to `daemonHandlerMap`. Inject `logger` into handler input. Add `DaemonSchedulerConfig.logger`. |
| `packages/agent/src/workers/systemHealthDaemon.ts` | Modify | Add DB integrity, WAL, migration version, backup freshness checks. Accept `DatabaseManager`. |
| `packages/agent/src/finance/FinanceDirectorValidator.ts` | Modify | Harden `checkInventedFigures`: numeric extraction, evidence cross-ref, fabricated metric detection, precision check, currency attribution. |
| `packages/agent/src/readiness/runtimeGates.ts` | Modify | `degraded` → WARN log, no throw. Keep `blocked` → throw. |
| `packages/agent/src/readiness/DatabaseReadinessChecker.ts` | Modify | Add `PRAGMA integrity_check` and WAL size check. Degrade instead of block when these fail. |
| `packages/agent/src/readiness/types.ts` | Modify | Add `database-integrity`, `wal-health` to `ReadinessContext.features`. |
| `scripts/start-agent-daemons.mjs` | Modify | Replace 3 `createDatabase(cortexPath)` with single `getSharedDb(cortexPath)`. Wire `BackupScheduler`, `observabilityPipeline`, `runSystemHealthCheck` with `DatabaseManager`. |

## Interfaces / Contracts

```typescript
// databaseManager.ts
interface DatabaseManager {
  backup(targetPath: string): Promise<number>; // page count
  verifyBackup(backupPath: string): { ok: boolean; error?: string; pages: number };
  restoreFrom(backupPath: string): Promise<void>;
  checkIntegrity(): { ok: boolean; errors: string[] };
  checkpointWAL(): { pagesBefore: number; pagesAfter: number };
  migrate(registry: MigrationRegistry): { applied: number; skipped: number };
}

// migrationRegistry.ts
interface MigrationStep { version: number; name: string; up: (db: Database) => void; }
interface MigrationRegistry {
  register(step: MigrationStep): void;
  apply(db: Database): { applied: number; skipped: number };
  expectedVersion(): number;
}

// backupScheduler.ts
interface BackupSchedulerConfig {
  manager: DatabaseManager;
  dbPaths: Map<string, string>; // name → path, excludes OAuth
  intervalMs?: number; // default 86400000 (24h)
  retentionDays?: number; // default 7
  backupDir: string;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `MigrationRegistry.apply()` idempotency, rollback | Vitest with `:memory:` DB |
| Unit | `FinanceDirectorValidator.checkInventedFigures()` numeric extraction, evidence cross-ref | Vitest with mock `FinancialAssessment` and `FinanceDirectorEvidence` |
| Unit | Log sanitizer (redact tokens, keys, prompts) | Vitest pure function |
| Integration | `DatabaseManager` backup/verify/restore cycle with real file | Vitest with temp file (`os.tmpdir()`) |
| Integration | WAL checkpoint after simulated writes | Vitest with `journal_mode=WAL` temp DB |
| Integration | 5+ stores adopt `MigrationRegistry` | Per-store Vitest with temp file: schema created, re-run idempotent |
| Integration | `daemonHandlerMap` includes `"economic-learning"` gated by `MSL_ECONOMIC_LEARNING_ENABLED` | Vitest with env var toggle |
| E2E | 24h daemon soak with backups, integrity, no corruption | Docker compose or PM2 local, skipped in CI |

## Migration / Rollout

**All features behind independent feature flags**: `MSL_DURABILITY_ENABLED`, `MSL_MIGRATION_ENABLED`, `MSL_STRUCTURED_LOGGING_ENABLED`, `MSL_ECONOMIC_LEARNING_ENABLED`. Each `false` = no-op, no mutations, no new connections. Migration framework wrap: stores check `MSL_MIGRATION_ENABLED` at init; disabled → legacy `CREATE IF NOT EXISTS`. Backup disabled → `BackupScheduler` never created. Rollback: set flag to `false`, restart.

**Connection consolidation**: `start-agent-daemons.mjs` changes from 3 `createDatabase()` to 1 `getSharedDb()`. WAL is set once in the pool. Backward-compatible because `createDatabase()` sets same PRAGMAs — just unnecessary duplication. Test with long-running daemon simulation before deploy.

## Open Questions

- [ ] Should `restoreFrom()` auto-close the shared connection pool and reopen? (Design says yes — atomic file replace + reopen)
- [ ] Backup directory: configurable via `MSL_BACKUP_DIR` env var, or subdirectory of each DB's parent?
- [ ] Economic learning daemon: shadow-mode first (log only, no writes) or direct enablement?
