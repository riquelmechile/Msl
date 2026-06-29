# Tasks: Persist MCP Approval Proposals

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 500-750 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: tools SQLite repository; PR 2: MCP wiring and metadata |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add durable `ApprovalQueueRepository` and contract tests | PR 1 | Independent tools package slice; includes dependency update and reopen verification. |
| 2 | Wire MCP runtime to durable storage metadata safely | PR 2 | Depends on PR 1; includes close lifecycle and no-leak/no-mutation tests. |

## Phase 1: Tools Repository Foundation

- [x] 1.1 Update `packages/tools/package.json` with `better-sqlite3` runtime and type dependencies needed by `@msl/tools`.
- [x] 1.2 Add `CloseableApprovalQueueRepository` and `createSqliteApprovalQueueRepository(dbPath?)` export in `packages/tools/src/index.ts`.
- [x] 1.3 Implement SQLite tables for queue entries, approval records, and audit records in `packages/tools/src/index.ts` without storing credentials.
- [x] 1.4 Serialize proposal JSON and restore `expiresAt`, `requestedAt`, `approvedAt`, and `recordedAt` as `Date` instances in `packages/tools/src/index.ts`.

## Phase 2: MCP Runtime Wiring

- [x] 2.1 Update `packages/mcp/src/runtimeDependencies.ts` to read `MSL_APPROVAL_QUEUE_DB_PATH`, default blank values to memory, and create SQLite storage only when configured.
- [x] 2.2 Guard `RuntimeDependencies.close()` in `packages/mcp/src/runtimeDependencies.ts` so OAuth runtime and SQLite repository close safely once.
- [x] 2.3 Update `packages/mcp/src/index.ts` config metadata to return `approvalPersistence` and `persistentApprovalStorage` for memory vs SQLite.
- [x] 2.4 Keep `packages/mcp/src/index.ts` prepare-only: no `ProductSyncEngine`, no `sync_all`, no approval/execution tools, no preview calculation, no mutation execution.

## Phase 3: Tests and Regression Coverage

- [x] 3.1 Extend `packages/tools/src/index.test.ts` to verify save/find after repository reopen with equivalent proposal metadata and restored dates.
- [x] 3.2 Extend `packages/tools/src/index.test.ts` to cover approval and audit repository methods without credential fields.
- [x] 3.3 Extend `packages/mcp/src/mcp.test.ts` for env selection, default in-memory behavior, configured SQLite behavior, and close lifecycle.
- [x] 3.4 Extend `packages/mcp/src/mcp.test.ts` to assert MCP API keys, OAuth tokens, client secrets, DB paths, and raw credential-like errors are not persisted or exposed.
- [x] 3.5 Extend `packages/mcp/src/mcp.integration.test.ts` to verify SDK `sync_product` metadata reports durable storage only when configured.
- [x] 3.6 Add regression assertions in `packages/mcp/src/mcp.test.ts` that durable storage still exposes no execution tools, `sync_all`, previews, audits, or MercadoLibre mutations.

## Phase 4: Verification

- [x] 4.1 Run `npm test -- packages/tools/src packages/mcp/src` or targeted Vitest equivalents for repository and MCP coverage.
- [x] 4.2 Run `npm run typecheck` to verify package exports and runtime dependency types.
- [x] 4.3 Run `npm run lint` and `npm run format:check`; fix only issues introduced by this change.

## Post-Archive Pre-PR Blocker Remediation

- [x] 5.1 Reject credential-like generic `prepare_mercadolibre_write` payloads before repository save so API keys, OAuth tokens, client secrets, raw credentials, and database paths are not persisted in memory or SQLite storage.
- [x] 5.2 Return controlled redacted blocked responses when generic prepared-write repository save fails.
- [x] 5.3 Recover from env-configured SQLite approval storage startup failures with degraded in-memory proposal storage metadata instead of crashing or falsely reporting persistence.
- [x] 5.4 Preserve the packaging recommendation that final delivery must be stacked PRs, not one oversized PR.
