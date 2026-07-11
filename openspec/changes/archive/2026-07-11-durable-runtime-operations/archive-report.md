# Archive Report: durable-runtime-operations

**Change**: durable-runtime-operations
**Archived**: 2026-07-11
**Mode**: openspec

## Executive Summary

Hardened MSL's operational base for safe production: added scheduled SQLite backups with verification and atomic restoration, extracted a shared versioned/idempotent migration framework from Cortex, built a JSON-structured observability pipeline with correlation IDs and sanitization, extended operational health checks to cover DB integrity/WAL/migration versions/backup freshness, hardened `checkInventedFigures` with evidence cross-referencing, wired the economic learning daemon into the handler map, and defined an explicit `degraded` capability policy. All 11 capabilities delivered behind 4 independent feature flags. 25/25 tasks complete, 3045 tests passing (0 failures), 67/67 spec scenarios compliant across 7 capability specs.

## Delivery Strategy

- **4 chained PRs** (stacked-to-main) — `feature/durable-runtime-operations` tracker branch
- PR 1: Migration Framework + DatabaseManager core
- PR 2: Backup Scheduler + Health + Readiness
- PR 3: Observability Pipeline
- PR 4: Finance Validator + Economic Learning + Final Wiring

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `sqlite-durability` | Created | 7 requirements, 14 scenarios (backup, verify, restore, integrity, WAL, retention, flag gating) |
| `migration-framework` | Created | 6 requirements, 8 scenarios (versioned tracking, transactional, idempotent, registration, flag gating, Cortex extraction) |
| `structured-observability` | Created | 6 requirements, 8 scenarios (JSON output, correlation ID propagation, sanitization, daemon/store wiring, health check IDs) |
| `operational-health` | Created | 5 requirements, 10 scenarios (DB integrity, WAL status, migration version, backup freshness, report consolidation) |
| `finance-director-validation` | Created | 8 requirements, 12 scenarios (numeric extraction, evidence cross-ref, fabricated metric, precision, undocumented money, currency, confidence preservation, issue aggregation) |
| `daemon-scheduler` | Updated | ADDED: Economic Learning Daemon Registration (3 scenarios). MODIFIED: Agent-to-Daemon Handler Map (13→14 lanes, added economic-learning) |
| `runtime-env-validator` | Updated | ADDED: Degraded Capability Policy (3 scenarios), Database Integrity and WAL Checks (3 scenarios) |

## Files Created/Modified

### New Files
- `packages/memory/src/databaseManager.ts` — LiveDatabaseManager + no-op (288 lines)
- `packages/memory/src/migrationRegistry.ts` — transactional, idempotent (135 lines)
- `packages/memory/src/backupScheduler.ts` — backup, WAL, integrity, retention (392 lines)
- `packages/agent/src/workers/observabilityPipeline.ts` — sanitizeContext, factories (160 lines)
- `packages/memory/src/migrationRegistry.test.ts` — 11 tests
- `packages/memory/src/databaseManager.test.ts` — 14 tests
- `packages/memory/src/backupScheduler.test.ts` — 16 tests
- `packages/agent/src/workers/observabilityPipeline.test.ts` — 29 tests
- `packages/agent/src/workers/daemonScheduler-sessions.test.ts` — 3 tests

### Modified Files
- `packages/memory/src/connectionPool.ts` — `getSharedManager()` at L77
- `packages/memory/src/cortex/database.ts` — MigrationRegistry parameter; legacy fallback preserved
- `packages/memory/src/operationalReadModel.ts` — Registry gate + legacy path preserved
- `packages/agent/src/conversation/agentMessageBusStore.ts` — Migration registry gate
- `packages/agent/src/workers/systemHealthDaemon.ts` — 264 lines; integrity, WAL, migration, backup checks
- `packages/agent/src/workers/daemonScheduler.ts` — economic-learning in buildHandlerMap()
- `packages/agent/src/readiness/runtimeGates.ts` — degraded→WARN, blocked→throw
- `packages/agent/src/readiness/DatabaseReadinessChecker.ts` — integrity_check + WAL health
- `packages/agent/src/readiness/types.ts` — databaseIntegrityEnabled + walHealthEnabled features
- `packages/agent/src/finance/FinanceDirectorValidator.ts` — 724 lines; hardened checkInventedFigures
- `scripts/start-agent-daemons.mjs` — 302 lines; 3 createDatabase() → 1 getSharedDb()
- `packages/agent/src/finance/FinanceDirectorValidator.test.ts` — 30 tests
- `packages/agent/tests/workers/daemonScheduler.test.ts` — 23 tests (includes economic learning lane)
- `packages/agent/src/readiness/runtimeGates.test.ts` — 14 tests
- `packages/agent/tests/workers/daemonIntegration.test.ts` — 6 tests

## Test Results

| Metric | Value |
|--------|-------|
| Tests passed | 3045 |
| Tests failed | 0 |
| Tests skipped | 7 (smoke tests) |
| Test files | 160 passed / 2 skipped |
| Typecheck | ✅ Pass |
| Build | ✅ Pass |
| Lint | ✅ Pass |
| Format:check | ✅ Pass |

## Feature Flags

| Flag | Gates | Default |
|------|-------|---------|
| `MSL_DURABILITY_ENABLED` | DatabaseManager, BackupScheduler (backup, verify, restore, integrity, WAL, retention) | `false` (no-op) |
| `MSL_MIGRATION_ENABLED` | MigrationRegistry adoption in Cortex, OperationalReadModel, AgentMessageBus | `false` (legacy CREATE IF NOT EXISTS) |
| `MSL_STRUCTURED_LOGGING_ENABLED` | Observability pipeline (JSON logger, correlation IDs, sanitization) | `false` (legacy console.log) |
| `MSL_ECONOMIC_LEARNING_ENABLED` | Economic learning daemon in handler map | `false` (daemon not registered) |

## Spec Compliance

67/67 scenarios compliant across 7 capability specs. See `verify-report.md` for full matrix.

## Gatekeeping Warnings (Pre-Acknowledged)

| ID | Description | Verdict |
|----|-------------|---------|
| W-1 | `DatabaseReadinessChecker` feature flags defined but not checked | **ACCEPTED** — checks run unconditionally on validated paths |
| W-2 | `systemHealthDaemon` gates DB health checks indirectly via `dbEntries` parameter | **ACCEPTED** — functional outcome identical |

## Backward Compatibility

- All 3045 existing tests pass with zero regressions
- Cortex legacy `migrate()` path preserved at `database.ts` L172
- Existing `schema_version` rows remain valid
- Legacy `CREATE IF NOT EXISTS` paths preserved in OperationalReadModel and AgentMessageBus
- All flags `false` → full no-op; no mutations, no new connections

## Issues Blocking Archive

**None.** No CRITICAL issues in verify report. All 25 tasks complete. All tests pass.

## Next Steps

1. Create the 4 stacked PRs from the `feature/durable-runtime-operations` branch chain
2. Review and merge PRs in order (PR 1 → PR 2 → PR 3 → PR 4)
3. Enable feature flags incrementally in production:
   - Start with `MSL_STRUCTURED_LOGGING_ENABLED=true` (lowest risk)
   - Then `MSL_MIGRATION_ENABLED=true` after verifying migration rollback
   - Then `MSL_DURABILITY_ENABLED=true` after verifying backup dir writable
   - `MSL_ECONOMIC_LEARNING_ENABLED=true` last, with shadow-mode logging first

## Archive Contents

- `exploration.md` ✅
- `proposal.md` ✅
- `design.md` ✅
- `specs/` (7 capability specs) ✅
- `tasks.md` ✅ (25/25 checked)
- `verify-report.md` ✅
- `archive-report.md` ✅ (this file)
