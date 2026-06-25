# Design: MLC Read Tools Foundation

## Technical Approach

Add a small package-level read foundation that keeps seller operations inside project-owned direct API tooling. `@msl/mercadolibre` remains the access-protected API boundary, `@msl/domain` owns shared snapshot/freshness contracts, `@msl/memory` exposes only fresh-enough snapshot decisions, and `@msl/tools` exposes concrete read tools returning `BusinessToolResponse<T>` metadata. No UI, OAuth callback, persistence, write execution, or official MCP execution is added.

## Architecture Decisions

| Topic | Choice | Tradeoff / Rationale |
|------|--------|-----------------------|
| Tool surface | Add one read-tool factory with listing/order/message/reputation methods in `@msl/tools` | Keeps the review slice focused and reuses existing `CustomBusinessTool`/`BusinessToolResponse` conventions instead of introducing a new tool runtime. |
| Snapshot vocabulary | Put shared `ReadSnapshot<T>` and metadata types in `@msl/domain` | Avoids coupling domain consumers to `@msl/tools`; slightly expands domain, but source/freshness/confidence is cross-package vocabulary. |
| API normalization | Normalize conservative payload shapes in `@msl/mercadolibre` | Prevents raw API drift from leaking into tools. Unknown or missing evidence becomes partial/low confidence instead of fake precision. |
| Access failures | Convert rejected client access errors into blocked read responses | Preserves existing protected-read behavior while giving agents reconnect/mismatch guidance without returning seller data. |
| Official MCP | Keep official MercadoLibre MCP as docs adapter only | Tests continue to prove it has no seller-operation executor; direct API tools are the only protected-read path. |

## Data Flow

```text
Agent request
  -> @msl/tools read tool
  -> @msl/mercadolibre MlcApiClient
       -> evaluateOAuthAccess + seller match
       -> injected test/live transport
  -> normalize payload snapshot
  -> @msl/domain freshness/confidence metadata
  -> BusinessToolResponse<T> (requiresApproval: false)
```

Blocked path: revoked/expired/mismatched access short-circuits before transport and returns reconnect or mismatch guidance with no seller business data.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/domain/src/readSnapshot.ts` | Create | Shared read snapshot, completeness, confidence, and fresh-enough contracts. |
| `packages/domain/src/index.ts` | Modify | Export read snapshot contracts. |
| `packages/domain/src/domain.test.ts` | Modify | Unit tests for snapshot metadata and fresh-enough decisions. |
| `packages/memory/src/index.ts` | Modify | Add small helper/type for evaluating whether a snapshot can satisfy immediate analysis. |
| `packages/memory/src/memory.test.ts` | Modify | Cover fresh, stale, and partial snapshot decisions. |
| `packages/mercadolibre/src/index.ts` | Modify | Add normalized read methods/results for listings, orders, messages, and reputation while preserving protected access checks. |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Modify | Cover normalization, partial evidence, revoked access, and seller mismatch. |
| `packages/tools/src/index.ts` | Modify | Add project-owned read tool factory and blocked-read result handling; reads bypass approval. |
| `packages/tools/package.json` | Modify | Add `@msl/mercadolibre` dependency for read-tool client typing/factory input. |
| `tests/tools/tools.integration.test.ts` | Modify | Integration tests for authorized reads, metadata, no approval creation, and docs-only MCP boundary. |

## Interfaces / Contracts

```ts
export type SnapshotCompleteness = "complete" | "partial";
export type ReadSnapshot<TData> = {
  sellerId: SellerId;
  kind: "listing" | "order" | "message" | "reputation";
  data: ReadonlyArray<TData> | TData;
  completeness: SnapshotCompleteness;
  freshness: CacheFreshness;
  confidence: "low" | "medium" | "high";
};

export type ReadToolBlocked =
  | { status: "blocked"; reason: "reconnect-required"; message: string }
  | { status: "blocked"; reason: "seller-access-mismatch"; message: string };

export type MlcReadTools = {
  listings: CustomBusinessTool<{ sellerId: SellerId }, ReadSnapshot<MlcListingSummary> | ReadToolBlocked>;
  orders: CustomBusinessTool<{ sellerId: SellerId }, ReadSnapshot<MlcOrderSummary> | ReadToolBlocked>;
  messages: CustomBusinessTool<{ sellerId: SellerId }, ReadSnapshot<MlcMessageSummary> | ReadToolBlocked>;
  reputation: CustomBusinessTool<{ sellerId: SellerId }, ReadSnapshot<MlcReputationSummary> | ReadToolBlocked>;
};
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Snapshot metadata, freshness, conservative normalization, access blocking | Vitest package tests with injected clocks and transports. |
| Integration | Read tools return metadata and never create approvals or use official MCP execution | Extend `tests/tools/tools.integration.test.ts` with in-memory clients/repositories. |
| E2E | None in this slice | UI wiring is explicitly out of scope. |

## Migration / Rollout

No migration required. Roll out as package APIs and tests only; future slices can wire the tools into agent orchestration or UI.

## Open Questions

None.
