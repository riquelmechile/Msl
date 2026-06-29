# Design: Persist MCP Approval Proposals

## Technical Approach

Add a SQLite implementation behind the existing `ApprovalQueueRepository` in `@msl/tools`, then make MCP runtime choose it only when `MSL_APPROVAL_QUEUE_DB_PATH` is configured. The MCP tool surface remains prepare-only: `sync_product` still creates pending `listing-edit` proposals and never imports sync execution code, exposes approval/execution tools, calculates previews, or persists credentials.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Repository-level SQLite store | Reuses existing approval helpers, but requires JSON/date restore tests | Use `createSqliteApprovalQueueRepository()` in `packages/tools/src/index.ts` or a small sibling module exported from `index.ts`. |
| MCP-specific proposal table | Smaller first diff, but duplicates approval semantics | Reject; durability belongs behind `ApprovalQueueRepository`. |
| Runtime metadata flag | Avoids widening repository contract for all callers | Add MCP-owned `approvalStorage: "memory" | "sqlite"` config metadata rather than repository introspection. |
| Persist approvals/audits too | Matches repository contract but may look like execution enablement | Implement all repository methods for contract completeness; MCP still exposes no approval/execution path. |

## Data Flow

```text
env MSL_APPROVAL_QUEUE_DB_PATH
  -> createMcpRuntimeDependencies
  -> createSqliteApprovalQueueRepository(dbPath)
  -> createMcpServer prepareWrite.repository
  -> sync_product validation
  -> createPreparedActionTool.save(entry)
  -> SQLite approval_queue_entries
```

On restart, a new repository opened with the same DB path restores the prepared entry by `action.id`; `expiresAt` and `requestedAt` are `Date` instances again.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/tools/package.json` | Modify | Add `better-sqlite3` and `@types/better-sqlite3` where needed by the tools package. |
| `packages/tools/src/index.ts` | Modify | Export SQLite repository factory and closeable type. |
| `packages/tools/src/index.test.ts` | Modify | Add repository contract/reopen tests. |
| `packages/mcp/src/runtimeDependencies.ts` | Modify | Read env, select durable repo, close repo and OAuth runtime safely. |
| `packages/mcp/src/index.ts` | Modify | Accept approval storage metadata and report durable storage only when configured. |
| `packages/mcp/src/mcp.test.ts` | Modify | Cover runtime env selection, close lifecycle, metadata, and no mutation tools/imports. |
| `packages/mcp/src/mcp.integration.test.ts` | Modify | Cover SDK metadata with durable storage. |

## Interfaces / Contracts

```ts
export type CloseableApprovalQueueRepository = ApprovalQueueRepository & { close(): void };
export function createSqliteApprovalQueueRepository(dbPath?: string): CloseableApprovalQueueRepository;
```

Schema:
- `approval_queue_entries(action_id TEXT PRIMARY KEY, action_json TEXT NOT NULL, requested_at TEXT NOT NULL, highlighted_risk TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')))`
- `approval_records(action_id TEXT PRIMARY KEY, approval_json TEXT NOT NULL, approved_at TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')))`
- `audit_records(id TEXT PRIMARY KEY, action_id TEXT NOT NULL, audit_json TEXT NOT NULL, recorded_at TEXT NOT NULL)`

Serialization stores domain payloads as JSON, converts `action.expiresAt`, `requestedAt`, `approvedAt`, and `recordedAt` to ISO strings, and restores those fields to `Date`. Invalid/missing JSON should throw internally; MCP catches save failures and returns the existing redacted `prepare-write-failed` response.

Runtime config:
- `MSL_APPROVAL_QUEUE_DB_PATH` absent/blank: in-memory queue, `approvalPersistence: "in-memory-only"`, `persistentApprovalStorage: false`.
- Present: SQLite queue, `approvalPersistence: "sqlite"`, `persistentApprovalStorage: true`.

`RuntimeDependencies.close()` must close both OAuth runtime and SQLite repository; closing should be idempotent or guarded so tests can safely call once.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | SQLite save/find, approval, audit, Date restoration, reopen durability | Vitest repository contract with temp DB path. |
| Unit | Runtime env selection and close | Stub env; assert default memory and configured SQLite. |
| Integration | `sync_product` metadata through MCP SDK | Existing in-memory transport, configured durable runtime. |
| Regression | No mutation boundary | Assert no `sync_all`, no execution tools, no `ProductSyncEngine`, no preview, no raw secret leakage. |

## Migration / Rollout

No data migration required. Roll out by setting `MSL_APPROVAL_QUEUE_DB_PATH`; rollback by unsetting it to return to in-memory proposals. Existing SQLite proposals remain non-executing records.

## Review / Split Strategy

This may exceed 400 changed lines once tests are added. If forecast rises, split PR 1 as SQLite repository plus tests, and PR 2 as MCP runtime wiring, response metadata, and specs.

## Open Questions

None.
