# Proposal: Operational Returns Ingestion

## Intent

Add safe-read MercadoLibre return evidence for post-purchase claims so sellers can inspect return detail, reviews, and return-cost signals without executing refunds, disputes, review posts, uploads, or other state-changing return actions.

## Scope

### In Scope
- Typed safe-read client support for return detail, return reviews, and return-cost snapshots.
- Project-owned MCP read tools for those return reads with auth, seller scope, freshness, confidence, and `noMutationExecuted: true` metadata.
- Spec updates classifying return GET endpoints as `safe-read` and mutation-like review/upload/action endpoints as out of scope.

### Out of Scope
- Return-review POST, attachment upload, refund/dispute/return actions, and any mutation execution.
- Durable operational ingestion, business-memory-cache snapshots, and operational-lane evidence for returns.
- AI image generation or unrelated image orchestration changes.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `ml-claims`: Extend claims/post-purchase reads with return detail, return reviews, and return-cost snapshots.
- `custom-business-mcp-tools`: Expose return read tools as project-owned, auth-gated read tools that never create approvals or mutate seller state.
- `ml-api-integration`: Add capability-matrix entries for return safe reads and classify return review/attachment/action endpoints as non-executable in this slice.

## Approach

Follow the exploration recommendation: first slice only adds direct API client reads and MCP read tools for documented GET endpoints: `/post-purchase/v2/claims/{claim_id}/returns`, `/post-purchase/v1/returns/{return_id}/reviews`, and `/post-purchase/v1/claims/{claim_id}/charges/return-cost`. Mark MLC support as `MLC-to-confirm` and degrade gracefully on upstream unavailable/unauthorized/not-found responses.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/index.ts` | Modified | Add return types and safe-read methods. |
| `packages/mcp/src/index.ts` | Modified | Register return read tools. |
| `openspec/specs/ml-claims/spec.md` | Modified | Claims return read contract. |
| `openspec/specs/custom-business-mcp-tools/spec.md` | Modified | MCP read-tool surface. |
| `openspec/specs/ml-api-integration/spec.md` | Modified | Capability matrix classifications. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| MLC availability is not explicit | Med | Use `MLC-to-confirm`; return controlled degraded responses. |
| Docs mix GET reads with mutation-like flows | Med | Specs/tests assert only GET tools and no approval/mutation execution. |
| Review budget overrun | Med | Exclude durable ingestion and lane evidence from this slice. |

## Rollback Plan

Revert the proposal/spec deltas and remove the added client methods, types, MCP registrations, and tests. No data migration is needed because this slice does not persist return evidence.

## Dependencies

- Valid seller OAuth and existing project-owned MercadoLibre/MCP auth patterns.
- Official MercadoLibre post-purchase docs for return GET endpoint contracts.

## Success Criteria

- [ ] Return detail, reviews, and return-cost reads expose typed safe-read snapshots.
- [ ] MCP tools disclose seller scope, freshness, confidence, and `noMutationExecuted: true`.
- [ ] No return mutation, upload, refund, dispute, durable ingestion, or lane-evidence behavior is introduced.
