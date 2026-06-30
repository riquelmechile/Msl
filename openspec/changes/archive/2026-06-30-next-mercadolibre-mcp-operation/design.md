# Design: Read-Only Product Sync Proposal Inspection

## Technical Approach

Add one authenticated MCP status tool, `read_sync_product_status`, beside existing prepare-only MCP tools. The tool accepts exactly one `actionId`, validates `MSL_MCP_API_KEY` before repository access, reads `prepareWrite.repository.findAction(actionId)`, verifies the stored entry is the supported `sync_product` proposal shape, and returns sanitized status metadata only. Status such as `expired` is derived from `entry.action.expiresAt <= clock.now()` in the response and never saved back.

This maps to the delta specs by reusing durable approval storage while keeping the existing no-mutation boundary: no approval recording, no execution, no audit replay, no MercadoLibre writes, no `ProductSyncEngine`, no `sync_all`, no multi-product sync, and no separate preview-only tool.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Register a dedicated read-only status MCP tool | Adds one tool but keeps inspection separate from proposal creation and avoids overloading `sync_product` inputs | Use `read_sync_product_status` with `actionId` and `msl_api_key` only |
| Implement status shaping in `packages/mcp/src/index.ts` vs. `@msl/tools` | MCP can enforce auth/redaction close to the tool surface; tools package already exposes repository read contract | Keep response shaping in MCP, reuse `ApprovalQueueRepository.findAction()` |
| Derive expired status in memory vs. update stored queue entry | In-memory derivation may leave stored `status: pending`, but preserves read-only retrieval | Derive `effectiveStatus` without `repository.save()` |
| Return generic missing/unsupported responses | Less diagnostic detail, but prevents enumeration across sellers/action kinds | Use one redacted unavailable response for unknown, malformed, non-sync, and unsupported IDs |

## Data Flow

```text
MCP client -> read_sync_product_status(actionId, msl_api_key)
  -> validateApiKey() [fail before lookup]
  -> prepareWrite.repository.findAction(actionId)
  -> verify supported sync_product proposal markers
  -> derive status/preview summary/storage metadata
  -> redacted JSON response, no writes
```

Unsupported path returns the same controlled response after lookup; unauthenticated requests return `unauthorized` before lookup.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/mcp/src/index.ts` | Modify | Register `read_sync_product_status`; add exact-ID input schema, sync-proposal detection, redacted response builders, and non-mutating status derivation. |
| `packages/mcp/src/runtimeDependencies.ts` | No code change expected | Existing `prepareWrite.repository` already exposes `findAction()` and runtime storage metadata. |
| `packages/tools/src/index.ts` | No code change expected | Existing `ApprovalQueueRepository.findAction()` returns persisted queue entries with Date restoration for SQLite. |
| `packages/mcp/src/mcp.test.ts` | Modify | Unit coverage for auth-before-lookup, exact-ID only, stored sync proposal response, redacted unknown/malformed/unsupported IDs, expired derivation without save/audit/approval calls, and no forbidden tool/imports. |
| `packages/mcp/src/mcp.integration.test.ts` | Modify | SDK-level coverage for successful durable status lookup and controlled missing/unsupported responses. |

## Interfaces / Contracts

```ts
type ReadSyncProductStatusInput = {
  actionId: string;
  msl_api_key?: string;
};

type ReadSyncProductStatusResponse =
  | {
      status: "available";
      actionId: string;
      effectiveStatus: "pending" | "approved" | "rejected" | "expired";
      expiresAt: string;
      risk: "high";
      target: { type: "listing"; listingId: string };
      rationale: string;
      preview: { status: "available" | "unavailable"; summary: string };
      metadata: { requiresApproval: true; noMutationExecuted: true; auditReplay: "not-available" };
    }
  | { status: "unavailable"; reason: "not-found-or-unsupported"; noMutationExecuted: true };
```

Supported sync proposals are identified from existing prepared `sync_product` markers: `kind: "listing-edit"`, listing target, high risk, and `exactChange` entries including `syncIntent` and `mutationExecuted: false`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Auth, redaction, no writes, expired derivation, unsupported IDs | Extend mocked MCP tests with repository spies. |
| Integration | SDK tool behavior with in-memory/SQLite-like repository | Extend `mcp.integration.test.ts`. |
| E2E | None | MCP status is covered at SDK integration; no UI flow changes. |

## Migration / Rollout

No migration required. Existing persisted proposals remain readable through `findAction()`.

## Open Questions

None.
