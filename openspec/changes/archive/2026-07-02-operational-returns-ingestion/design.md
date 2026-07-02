# Design: Operational Returns Ingestion

## Technical Approach

Add a first read-only slice beside the existing post-purchase claim subresource pattern. `packages/mercadolibre/src/index.ts` will define typed return snapshots, normalize documented GET responses, and add `MlcApiClient` methods for return detail, return reviews, and return cost. `packages/mcp/src/index.ts` will register auth-gated MCP read tools that call those client methods and return snapshot metadata. No durable ingestion, lane evidence, approvals, uploads, return-review POST, refund/dispute/return actions, or AI image generation are introduced.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Extend existing `MlcApiClient` claim subresources | Keeps return reads co-located with claim reads; large file grows further | Choose this to follow current module structure and avoid a new package boundary |
| Direct MCP registrations vs. generic `createMlcReadTools` expansion | Direct registrations match existing claim tools; generic wrappers add more plumbing | Use direct registrations for this slice, matching `read_claim_messages` and related tools |
| Degraded snapshots for unconfirmed MLC support | May hide hard upstream failures from callers; preserves safe-read UX | Return partial/low-confidence snapshots with `siteSupport: "MLC-to-confirm"` and `noMutationExecuted: true` on unavailable/unauthorized/not-found/unsupported reads |

## Data Flow

```text
MCP client -> read_claim_return/read_return_reviews/read_claim_return_cost
  -> validateApiKey -> MlcApiClient GET method -> MercadoLibre transport
  -> normalizer -> typed snapshot with sellerScope/freshness/confidence/noMutationExecuted
```

Mutation-like return endpoints have no data path in this change.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/index.ts` | Modify | Add return summary/snapshot types, normalizers, `MlcApiClient` methods, GET paths, and degraded snapshot helper. |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Modify | Assert GET paths, metadata, no mutation execution, and degraded MLC-to-confirm behavior. |
| `packages/mcp/src/index.ts` | Modify | Register `read_claim_return`, `read_return_reviews`, and `read_claim_return_cost` with MCP API-key auth. |
| `packages/mcp/src/mcp.test.ts` | Modify | Assert tool registration, auth-before-client-call, read delegation, metadata, and absence of mutation/approval tools. |

## Interfaces / Contracts

```ts
type MlcReturnSnapshotBase<T> = MlcSingleReadSnapshot<T> & {
  siteSupport: "MLC-to-confirm";
  sellerScope: { sellerId: string; site: "MLC" };
  noMutationExecuted: true;
};

interface MlcApiClient {
  getClaimReturn?(sellerId: string, claimId: string): Promise<MlcClaimReturnSnapshot>;
  getReturnReviews?(sellerId: string, returnId: string): Promise<MlcReturnReviewsSnapshot>;
  getClaimReturnCost?(sellerId: string, claimId: string): Promise<MlcClaimReturnCostSnapshot>;
}
```

GET paths only:
- `/post-purchase/v2/claims/{claim_id}/returns`
- `/post-purchase/v1/returns/{return_id}/reviews`
- `/post-purchase/v1/claims/{claim_id}/charges/return-cost`

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Client normalization and GET-only path construction | Vitest transport spies in `mercadolibre.test.ts`. |
| Integration | MCP auth and delegation | Existing mocked MCP server pattern in `mcp.test.ts`. |
| E2E | Not required | No UI or end-to-end runtime flow changes. |

## Migration / Rollout

No migration required. Roll out by shipping client methods and MCP tools together. Roll back by reverting the four code/test changes and this OpenSpec change. No persisted return data exists to clean up.

## Open Questions

None.
