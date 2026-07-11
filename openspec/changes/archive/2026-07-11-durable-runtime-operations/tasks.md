# Tasks: Durable Runtime Operations

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,300—1,500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Delivery strategy | auto-forecast |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base | Notes |
|------|------|-----------|------|-------|
| 1 | Migration Framework + DatabaseManager core | PR 1 | `feature/durable-runtime-operations` | Foundation — all later units depend on it |
| 2 | BackupScheduler + Health + Readiness | PR 2 | PR 1 branch | WAL-1, WAL-2, WAL-3, WAL-5 addressed |
| 3 | Observability Pipeline | PR 3 | PR 1 branch | WAL-4 addressed; parallelizable with PR 2 |
| 4 | Finance Validator + Economic Learning + Wiring | PR 4 | `feature/durable-runtime-operations` | Merge after PR 1-3; parallelizable with PR 2-3 |

## Phase 1: Migration Framework (Foundation)

- [x] 1.1 Create `packages/memory/src/migrationRegistry.ts` — `register(step)`, `apply(db)`, `expectedVersion()`. Track `schema_version` per `migration-framework/spec.md` L13-L16.
- [x] 1.2 Extract Cortex `migrate()` into registry-backed `apply()`. Cortex registers its 2 migrations; existing `schema_version` rows stay valid (`migration-framework/spec.md` L99-L103).
- [x] 1.3 Wire `MigrationRegistry` into `operationalReadModel.ts`. Gate behind `MSL_MIGRATION_ENABLED`; fallback to legacy (`migration-framework/spec.md` L78-L84).
- [x] 1.4 Wire `MigrationRegistry` into `agentMessageBusStore.ts`. Same flag-gating.
- [x] 1.5 Unit tests: idempotent re-run, transactional rollback, fresh DB, already-migrated (`migration-framework/spec.md` L18-L29, L42-L48, L55-L61). Vitest with `:memory:`.

## Phase 2: DatabaseManager Core (Foundation)

- [x] 2.1 Create `packages/memory/src/databaseManager.ts` — `backup()`, `verifyBackup()`, `restoreFrom()`, `checkIntegrity()`, `checkpointWAL()`, `migrate()`. Gate behind `MSL_DURABILITY_ENABLED`.
- [x] 2.2 Atomic `restoreFrom()` via `os.tmpdir()` staging + `fs.renameSync`. Coordinate with `closeSharedDb()`/reopen. WARNING-3 (`sqlite-durability/spec.md` L60-L76).
- [x] 2.3 Add `getSharedManager(path)` to `connectionPool.ts` returning `DatabaseManager` wrapping `getSharedDb()`.
- [x] 2.4 Integration tests: backup→verify→restore cycle, WAL checkpoint after writes, integrity check (`sqlite-durability/spec.md` L18-L23, L43-L55, L64-L76, L104-L116).

## Phase 3: Backup Scheduling + Health + Readiness

- [x] 3.1 Create `packages/memory/src/backupScheduler.ts` — scheduled backup (24h), verification, retention (7d). Exclude OAuth DB. Gate behind `MSL_DURABILITY_ENABLED` (`sqlite-durability/spec.md` L13-L35, L119-L148).
- [x] 3.2 WAL checkpoint scheduling: 1h interval `wal_checkpoint(TRUNCATE)` + 200MB threshold force-checkpoint. WARNING-1 (`sqlite-durability/spec.md` L99-L116).
- [x] 3.3 Integrity check scheduling on 6h interval, independent from health cadence. WARNING-2 (`sqlite-durability/spec.md` L79-L96).
- [x] 3.4 Add `freshnessWindow` (48h) to `BackupSchedulerConfig`. Persist timestamps via operational read model. WARNING-5 (`operational-health/spec.md` L71-L87).
- [x] 3.5 Modify `systemHealthDaemon.ts`: accept `DatabaseManager`, add integrity/WAL/migration-version/backup-freshness checks + consolidation (`operational-health/spec.md` L11-L28, L32-L48, L50-L68, L70-L87, L90-L107).
- [x] 3.6 Modify `runtimeGates.ts`: `degraded` → WARN log, no throw. `blocked` → throw preserved (`runtime-env-validator/spec.md` L8-L31).
- [x] 3.7 Modify `DatabaseReadinessChecker.ts`: add `PRAGMA integrity_check` + WAL size per managed DB; degrade on failure (`runtime-env-validator/spec.md` L34-L58).
- [x] 3.8 Modify `types.ts`: add `database-integrity`, `wal-health` to `ReadinessContext.features`.

## Phase 4: Observability Pipeline

- [x] 4.1 Create `packages/agent/src/workers/observabilityPipeline.ts` — `createDaemonLogger(name)`, `createStoreLogger(name)`, `sanitizeContext(obj)`. WARNING-4. JSON: `{ level, component, msg, ts, correlationId }`. Gate: `MSL_STRUCTURED_LOGGING_ENABLED` (`structured-observability/spec.md` L11-L23).
- [x] 4.2 Implement `sanitizeContext()`: redact tokens/keys to `"[REDACTED]"`, exclude prompt/content (`structured-observability/spec.md` L50-L68).
- [x] 4.3 Unit tests: secret redaction, correlation ID propagation daemon→store, distinct IDs per invocation (`structured-observability/spec.md` L36-L48, L63-L68).

## Phase 5: Finance + Economic Learning + Final Wiring

- [x] 5.1 Harden `FinanceDirectorValidator.checkInventedFigures()`: numeric extraction, evidence cross-ref, fabricated metric detection, precision check, currency attribution (`finance-director-validation/spec.md` L10-L137). Preserve existing confidence validation (L114-L124).
- [x] 5.2 Tests for `checkInventedFigures`: substantiated/unsubstantiated claims, fabricated metric, suspicious precision, undocumented amount, currency mismatch, no-numeric assessment, issue aggregation (all scenarios L18-L137).
- [x] 5.3 Add `"economic-learning"` to `daemonHandlerMap` in `daemonScheduler.ts`, gated by `MSL_ECONOMIC_LEARNING_ENABLED` (`daemon-scheduler/spec.md` L5-L52).
- [x] 5.4 Wire `BackupScheduler`, `observabilityPipeline`, `DatabaseManager`, and `runSystemHealthCheck` into `scripts/start-agent-daemons.mjs`. Replace 3 `createDatabase(cortexPath)` with single `getSharedDb(cortexPath)`.
- [x] 5.5 Integration tests: economic learning lane dispatch, 15-lane handler map, logger injection per `structured-observability/spec.md` L71-L85.
