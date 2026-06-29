# Apply Progress: Persist MCP Approval Proposals

## Mode

Standard apply mode. Strict TDD is disabled in `openspec/config.yaml`.

## Workload / PR Boundary

- Mode: stacked PR slice
- Chain strategy: stacked-to-main
- Current work unit: PR 2 / Work Unit 2 — MCP runtime wiring and metadata using the SQLite repository from PR 1
- Boundary: PR 1 implemented only `@msl/tools` repository durability and tests. PR 2 wires `MSL_APPROVAL_QUEUE_DB_PATH` into MCP runtime dependency selection, reports memory vs SQLite metadata, guards runtime close, and preserves the prepare-only/no-mutation MCP boundary. ProductSyncEngine, `sync_all`, approval/execution MCP tools, sync preview, arbitrary seller IDs, and credential persistence remain out of scope.
- Estimated review budget impact: PR 2 MCP slice is approximately 189 changed implementation/test lines before SDD artifacts, under the 400-line review budget. The full uncommitted diff also includes the already-verified PR 1 slice.

### Post-Archive Pre-PR Blocker Boundary

- Mode: stacked PR follow-up slice
- Chain strategy: stacked-to-main
- Current work unit: PR 3 / Pre-PR blocker remediation — generic prepared-write credential rejection, generic save-failure redaction, and degraded startup recovery for unavailable SQLite approval storage.
- Boundary: This remediation stays within MCP runtime/tool safety and SDD artifact truthfulness. It does not add ProductSyncEngine, `sync_all`, approval/execution MCP tools, sync preview, mutation execution, or arbitrary seller IDs.
- Packaging recommendation: final delivery must be split into stacked PRs. Do not package the full uncommitted change as one oversized PR.

## Completed Tasks

- [x] 1.1 Update `packages/tools/package.json` with `better-sqlite3` runtime and type dependencies needed by `@msl/tools`.
- [x] 1.2 Add `CloseableApprovalQueueRepository` and `createSqliteApprovalQueueRepository(dbPath?)` export in `packages/tools/src/index.ts`.
- [x] 1.3 Implement SQLite tables for queue entries, approval records, and audit records in `packages/tools/src/index.ts` without storing credentials.
- [x] 1.4 Serialize proposal JSON and restore `expiresAt`, `requestedAt`, `approvedAt`, and `recordedAt` as `Date` instances in `packages/tools/src/index.ts`.
- [x] 2.1 Update `packages/mcp/src/runtimeDependencies.ts` to read `MSL_APPROVAL_QUEUE_DB_PATH`, default blank values to memory, and create SQLite storage only when configured.
- [x] 2.2 Guard `RuntimeDependencies.close()` in `packages/mcp/src/runtimeDependencies.ts` so OAuth runtime and SQLite repository close safely once.
- [x] 2.3 Update `packages/mcp/src/index.ts` config metadata to return `approvalPersistence` and `persistentApprovalStorage` for memory vs SQLite.
- [x] 2.4 Keep `packages/mcp/src/index.ts` prepare-only: no `ProductSyncEngine`, no `sync_all`, no approval/execution tools, no preview calculation, no mutation execution.
- [x] 3.1 Extend `packages/tools/src/index.test.ts` to verify save/find after repository reopen with equivalent proposal metadata and restored dates.
- [x] 3.2 Extend `packages/tools/src/index.test.ts` to cover approval and audit repository methods without credential fields.
- [x] 3.3 Extend `packages/mcp/src/mcp.test.ts` for env selection, default in-memory behavior, configured SQLite behavior, and close lifecycle.
- [x] 3.4 Extend `packages/mcp/src/mcp.test.ts` to assert MCP API keys, OAuth tokens, client secrets, DB paths, and raw credential-like errors are not persisted or exposed.
- [x] 3.5 Extend `packages/mcp/src/mcp.integration.test.ts` to verify SDK `sync_product` metadata reports durable storage only when configured.
- [x] 3.6 Add regression assertions in `packages/mcp/src/mcp.test.ts` that durable storage still exposes no execution tools, `sync_all`, previews, audits, or MercadoLibre mutations.
- [x] 4.1 Run `npm test -- packages/tools/src packages/mcp/src` or targeted Vitest equivalents for repository and MCP coverage.
- [x] 4.2 Run `npm run typecheck` to verify package exports and runtime dependency types.
- [x] 4.3 Run `npm run lint` and `npm run format:check`; fix only issues introduced by this change.
- [x] 5.1 Reject credential-like generic `prepare_mercadolibre_write` payloads before repository save so API keys, OAuth tokens, client secrets, raw credentials, and database paths are not persisted in memory or SQLite storage.
- [x] 5.2 Return controlled redacted blocked responses when generic prepared-write repository save fails.
- [x] 5.3 Recover from env-configured SQLite approval storage startup failures with degraded in-memory proposal storage metadata instead of crashing or falsely reporting persistence.
- [x] 5.4 Preserve the packaging recommendation that final delivery must be stacked PRs, not one oversized PR.

## Verification

PR 1 carried forward:

- `npm test -- packages/tools/src` — passed
- `npm run typecheck --workspace @msl/tools` — passed
- `npm run typecheck` — passed
- `npm run lint` — passed
- `npm run format:check` — passed

PR 2:

- `npm test -- packages/mcp/src` — passed, 2 files / 61 tests
- `npm run typecheck` — passed
- `npm run lint` — passed
- `npm run format:check` — passed after formatting `packages/mcp/src/mcp.test.ts`

Post-archive pre-PR blocker remediation:

- `npm test -- packages/mcp/src` — passed, 2 files / 68 tests
- `npm test -- packages/tools/src packages/mcp/src` — passed, 3 files / 77 tests
- `npm run typecheck` — passed
- `npm run lint` — passed
- `npm run format:check` — passed
- `npm test` — passed, 36 files / 749 tests

## Deviations

None — implementation matches the PR 2 slice of the design. The post-archive remediation extends safety behavior to generic prepared writes and degraded SQLite startup recovery based on pre-PR blocker findings.

## Issues

Pre-PR review found four blockers after archive: generic prepared writes could persist credential-like payloads, generic save failures could expose raw storage details, env-configured SQLite startup failure could crash runtime construction, and final delivery packaging must remain stacked PRs. These blockers are now tracked in the archived task and progress artifacts.
