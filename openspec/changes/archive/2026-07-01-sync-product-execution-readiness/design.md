# Design: Sync Product Execution Readiness

## Technical Approach

Add a readiness-only MCP tool beside the existing prepare/status/approval tools in `packages/mcp/src/index.ts`. The tool evaluates one exact `sync_product` action ID through existing approval storage, read-only preview dependencies, account-role checks, and sanitized evidence. It must not import or call `ProductSyncEngine`, `sync_all`, `executePreparedAction`, audit replay, rollback automation, bulk sync, or MercadoLibre mutation methods.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Implement in MCP boundary | Keeps LLM/tool entrypoint close to auth, approval storage, and redaction; grows `index.ts` further. | Use MCP boundary now to match existing `sync_product`, `read_sync_product_status`, and `approve_sync_product_proposal` patterns. |
| Reuse execution approval helpers | Existing helpers may write blocked audits or imply execution semantics. | Use read-only `findAction`/`findApproval` checks and local binding validation only. |
| Claim API mutation readiness | Would require current MercadoLibre mutation docs/evidence. Generic MCP resource list exposed no resources in this session. | Return `api-capability-evidence-missing` until MercadoLibre MCP/API docs are consulted before any future mutation-execution design. |
| Persist readiness audit | Extra traceability but risks implying execution. | No execution audit writes; only response metadata. Future review metadata must be non-execution-only. |

## Data Flow

```text
MCP request
  -> validateApiKey(msl_api_key)
  -> exact actionId lookup via prepareWrite.repository.findAction
  -> findApproval(actionId)
  -> validate sync_product shape, approved status, expiry, approval binding
  -> read-only source preview revalidation via syncPreview.getSourceItem/getStrategies
  -> compare stored preview exactChange to fresh preview
  -> account role and target availability checks
  -> derive stable idempotency candidate and rollback/API evidence presence
  -> map storage/read/rate/upstream/reconnect failures to allowed reason codes
  -> return sanitized readiness with noMutationExecuted: true
```

`eligible` is possible only when approval binding, fresh preview, seller/account scope, target availability, stable idempotency candidate evidence, rollback strategy evidence, and API capability evidence are present. Current exact `findAction(actionId)` semantics provide candidate evidence only; no idempotency conflict source is reachable in this readiness slice. Missing API evidence blocks/degrades safely. Raw errors, credentials, DB paths, and upstream detail are never returned.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/mcp/src/index.ts` | Modify | Register `read_sync_product_execution_readiness`; add readiness types, schema, local binding/preview/idempotency/redaction helpers. |
| `packages/mcp/src/runtimeDependencies.ts` | Modify | Optionally pass read-only capability/rollback evidence providers when available; default missing evidence. No mutation clients. |
| `packages/mcp/src/mcp.test.ts` | Modify | Unit coverage for statuses, reasons, redaction, auth, exact lookup, no audit/execution calls. Update registered tool count. |
| `packages/mcp/src/mcp.integration.test.ts` | Modify | SDK tests for approved eligible/degraded/blocked paths and no-mutation invariants. |
| `packages/tools/src/index.ts` | No change | Existing `ApprovalQueueRepository.findAction/findApproval` is sufficient; avoid execution helpers. |
| `packages/mercadolibre/src/sync/syncEngine.ts` | No change | Explicitly forbidden import/call surface. |

## Interfaces / Contracts

```ts
type SyncProductReadinessStatus = "eligible" | "blocked" | "degraded";
type SyncProductReadinessReason =
  | "approval-unavailable" | "approval-expired" | "approval-binding-mismatch"
  | "proposal-not-sync-product" | "source-read-failed" | "source-evidence-incomplete"
  | "preview-drift-detected" | "seller-scope-mismatch" | "target-account-unavailable"
  | "api-capability-evidence-missing" | "rollback-strategy-missing"
  | "rate-limited" | "upstream-temporary-failure"
  | "reconnect-required" | "storage-unavailable";

type ReadSyncProductExecutionReadinessResponse = {
  status: SyncProductReadinessStatus;
  actionId: "redacted";
  reasons: SyncProductReadinessReason[];
  evidence: {
    approvalBound: boolean;
    preview: "matched" | "drifted" | "unavailable";
    idempotencyCandidate?: string;
    rollbackStrategyPresent: boolean;
    apiCapabilityEvidence: "missing" | "present";
  };
  noMutationExecuted: true;
};
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Auth failure, exact lookup, proposal type, expiry, approval mismatch, preview drift, idempotency candidate evidence, rollback/API missing, allowed reason codes, redaction. | Vitest against registered MCP callback in `mcp.test.ts` with mocked repository and preview dependency. |
| Integration | SDK call returns sanitized readiness and never calls `saveAudit`, `listAudits`, mutation APIs, or execution helpers. | Extend `mcp.integration.test.ts` using `InMemoryTransport`. |
| E2E | Not required for readiness-only MCP contract. | Covered by `npm test`; existing broader verify remains `npm test && npm run test:e2e`. |

## Migration / Rollout

No migration required. Existing pending/approved proposals remain valid inputs. Rollout is additive and non-mutating; rollback is removing the new MCP tool/helpers/tests.

## Open Questions

- [ ] Which future source will provide authoritative MercadoLibre mutation capability evidence? Do not design execution until connected MercadoLibre MCP/API docs are available and consulted.
