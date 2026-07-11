# Proposal: Durable Runtime Operations

## Status: Implemented / Archived (2026-07-11)

**Delivered:** 25/25 tasks, 3045 tests, 67/67 scenarios, 5 commits pushed to `main` (`73e7b67`–`90efd8d`). All 11 capabilities behind 4 feature flags (default `false`). See `archive-report.md` for full detail.

## Intent

MSL's 26 SQLite stores run without backups, integrity checks, or unified migrations. 4 of 40+ components use structured logging. The economic learning daemon is dead code. This hardens the operational base for safe production.

## Scope

**In:** Backup scheduling, verification, and restoration | Unified versioned/idempotent migration framework (incremental adoption) | Structured observability (JSON logger + correlation IDs) across daemons and stores | Operational health with `PRAGMA integrity_check`, WAL status, migration versions | Explicit `degraded` capability policy | `checkInventedFigures` hardened with evidence cross-referencing | Economic learning daemon registered in `daemonHandlerMap`

**Out:** Credential wiring, OAuth, MercadoLibre calls, real ingestion, commercial mutations, P0 PRs 3/4 and 4/4, full migration of all 26 stores

## Capabilities

### New
- `sqlite-durability`: backup scheduling, verification, restoration, `integrity_check`, WAL management, retention
- `migration-framework`: versioned, transactional, idempotent migrations extracted from Cortex `migrate()`
- `structured-observability`: JSON logger with correlation IDs, sanitization, wired into daemons/stores
- `operational-health`: health checks covering DB integrity, WAL, migration versions, backup freshness
- `finance-director-validation`: hardened `checkInventedFigures` with numeric-claim extraction and evidence cross-ref

### Modified
- `daemon-scheduler`: register economic learning daemon
- `runtime-env-validator`: `degraded` capability policy + DB integrity/WAL checks

## Approach

**Hybrid — Shared Framework + Incremental Adoption.** Build `DatabaseManager` wrapping `better-sqlite3` with durability capabilities, wire via connection pool singleton, consolidate 3 separate connections to `MSL_CORTEX_SQLITE_PATH`. Phases: Durability Core → Observability Core → Operational Health → FinanceDirectorValidator Hardening → Economic Learning Daemon Wiring.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| OAuth token backups carry encrypted secrets in raw pages | Medium | Exclude token DB from automated backup |
| WAL contention consolidating 3 connections to same file | Low | Test with long-running daemon simulation |
| Migration framework breaks `CREATE IF NOT EXISTS` stores | Medium | Integration tests per store; incremental roll-out |
| Economic learning daemon surfaces dead-code bugs | Medium | Shadow mode before enabling reinforcement writes |

## Rollback Plan

Phases behind feature flags (`MSL_DURABILITY_ENABLED`, `MSL_STRUCTURED_LOGGING_ENABLED`). Migration framework wraps init path — flag toggle reverts. Backup disabled via env var. Learning daemon behind `MSL_ECONOMIC_LEARNING_ENABLED`.

## Dependencies

- P0 PR 1/4 (runtime gates, readiness checkers)
- Existing `backupDatabase()` and Cortex `migrate()` as foundations

## Success Criteria

- [ ] All 26 stores pass `integrity_check` on health poll
- [ ] Backup runs on schedule, verifies, restores successfully
- [ ] Migration framework adopted by Cortex + ≥5 stores
- [ ] Structured logs from all 15 daemons with correlation IDs
- [ ] `checkInventedFigures` detects fabricated claims in ≥3 test scenarios
- [ ] Economic learning daemon stable under 24h soak
- [ ] WAL ≤200MB after 72h runtime
- [ ] No silent DB corruption over 30-day run
