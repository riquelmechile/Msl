# Design: Record sync_product Approval

## Technical Approach

Add one MCP tool, `approve_sync_product_proposal`, beside `read_sync_product_status` in `packages/mcp/src/index.ts`. The handler authenticates first, accepts only one exact `actionId`, loads that action, validates it with the existing sync-only predicate plus pending/unexpired checks, then records approval state and an `ApprovalRecord` with an explicit persisted execution marker: `executionStatus: "not-executed"`. It never calls MercadoLibre clients, audit APIs, `ProductSyncEngine`, `sync_all`, or execution helpers.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Reuse `approvePreparedAction` | Existing domain behavior, but generic, lookup-first, approves non-sync actions, writes expired state | Do not use it from MCP; implement a narrow local record-only helper after sync validation |
| Add generic MCP approval tool | More reusable, but violates non-sync approval boundary | Register only `approve_sync_product_proposal` |
| Add separate preview-only or execution wiring | Larger feature surface and mutation risk | Keep preview/status unchanged and record only approval metadata |
| Prove non-execution by absent audits only | Avoids type changes, but absence can be ambiguous and fails the spec invariant | Extend `ApprovalRecord` with `executionStatus: "not-executed"` and keep audit absence as corroborating evidence |
| Add SQL columns | Easier SQL querying, but unnecessary migration because approvals are stored as JSON blobs | Store the marker inside `approval_json`; no table migration |

## Data Flow

```text
MCP client
  └─ approve_sync_product_proposal(actionId, msl_api_key)
       ├─ validateApiKey()              # before lookup
       ├─ repository.findAction(actionId)
       ├─ isSupportedSyncProductProposal(entry)
       ├─ pending + unexpired check
       ├─ repository.save(approved entry)
       └─ repository.saveApproval(record { executionStatus: "not-executed" })
```

All missing, malformed, non-sync, expired, rejected, approved/finalized, or repository-error cases return the same unavailable response and perform no writes.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/domain/src/approval.ts` | Modify | Add `executionStatus: "not-executed"` to `ApprovalRecord`. `canExecutePreparedAction` still treats a matching approval as consent eligibility only; it must not interpret the marker as completion. |
| `packages/domain/src/domain.test.ts` | Modify | Update approval fixtures and assert the marker is required/preserved for approval records. |
| `packages/tools/src/index.ts` | Modify | Populate `executionStatus: "not-executed"` in `approvePreparedAction` and the new MCP approval helper payload. Existing SQLite JSON serialization/deserialization already preserves the field. |
| `packages/tools/src/index.test.ts` | Modify | Update approval persistence fixtures and verify reopened SQLite approvals retain `executionStatus: "not-executed"`. |
| `packages/mcp/src/index.ts` | Modify | Add input/response types, local approval helper, sanitized unavailable response, and `approve_sync_product_proposal` registration. Extend `SyncProductBlockedReason` only if a blocked auth response is reused. |
| `packages/mcp/src/runtimeDependencies.ts` | Modify | No new external service; keep existing repository and clock injection. Add no MercadoLibre or execution dependency. |
| `packages/mcp/src/mcp.test.ts` | Modify | Unit coverage for schema, auth-before-lookup, pending approval recording, redacted failures, repository-error redaction, and forbidden execution surfaces/imports. |
| `packages/mcp/src/mcp.integration.test.ts` | Modify | SDK-level approval recording through `approve_sync_product_proposal` without mutation, audit replay, or execution. |

## Interfaces / Contracts

```ts
type ApproveSyncProductProposalInput = {
  actionId?: unknown;
  msl_api_key?: string;
};

type ApproveSyncProductProposalResponse =
  | { status: "approved"; actionId: "redacted"; noMutationExecuted: true; executionStatus: "not-executed" }
  | { status: "unavailable"; reason: "not-found-or-unsupported"; noMutationExecuted: true };

type ApprovalRecord = {
  id: string;
  actionId: string;
  sellerId: string;
  approvedBy: "seller";
  approvedAt: Date;
  exactChangeAccepted: ExactChange[];
  riskAccepted: "low" | "medium" | "high" | "critical";
  executionStatus: "not-executed";
};
```

Success writes:
- `ApprovalQueueEntry.action.approvalStatus = "approved"` and `status = "approved"`.
- `ApprovalRecord` with `actionId`, `sellerId`, `approvedBy: "seller"`, `approvedAt`, `exactChangeAccepted`, `riskAccepted`, and `executionStatus: "not-executed"`.
- Approval ID generated locally as `approval:${actionId}:${clock.now().toISOString()}` unless implementation chooses an equivalent deterministic local generator.

Failure never calls `save`, `saveApproval`, `saveAudit`, `listAudits`, MercadoLibre clients, or execution helpers.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Tool schema and auth-before-lookup | Inspect registered schema and assert invalid API key skips `findAction` |
| Unit | Sync-only pending approval | Mock repository entry and assert `save` + `saveApproval` payloads preserve exact changes/risk plus `executionStatus: "not-executed"` |
| Unit | Redacted failures | Table-test missing, blank, non-sync, expired, rejected, approved, and repository errors produce identical unavailable response and no writes |
| Unit | Approval persistence | Persist/reopen approval records and assert the non-executed marker survives JSON serialization |
| Integration | SDK tool call | Use `InMemoryTransport` to call `approve_sync_product_proposal` and assert no audit/execution/mutation behavior |

## Migration / Rollout

No SQL migration required because approvals are stored as JSON in `approval_records.approval_json`. Existing historical approvals, if any, lack `executionStatus`; this change only requires the new `approve_sync_product_proposal` path to write the explicit marker. Future execution work can decide whether legacy records are rejected or backfilled.

## Open Questions

None.
