# Design: MercadoLibre API Gaps 2026 — Slice 3

## Architecture Decision

**Decision**: Follow the per-endpoint pattern from Slice 1-2. Add types + normalizers + optional client methods + implementations. No refactoring.

**Rationale**: 30+ endpoints use this pattern. Claims sub-resources are the last remaining GET endpoints on the post-purchase API. Image orchestration adds one client read + one prepared action.

## New Types

### Claim Sub-Resources

```typescript
// Insert after MlcClaimDetailSummary (line ~272)
type MlcClaimMessagesSummary = { messages: ReadonlyArray<MlcClaimMessage> };

type MlcClaimResolutionProposal = {
  id?: string; status?: string; reason?: string;
  description?: string; dateCreated?: string;
};

type MlcClaimResolutionsSummary = {
  expected_resolutions: ReadonlyArray<MlcClaimResolutionProposal>;
};

type MlcClaimReputationSummary = {
  affects_reputation: boolean;
  reason?: string;
};

type MlcClaimStatusHistoryEntry = { status: string; date: string };

type MlcClaimStatusHistorySummary = {
  history: ReadonlyArray<MlcClaimStatusHistoryEntry>;
};
```

Snapshots: `MlcClaimMessagesSnapshot`, etc. — each wraps in `MlcReadSnapshot<T>`.

### Image Orchestration

```typescript
type MlcImageAssociateInput = { itemId: string; pictureId: string };
type MlcImageAssociateSummary = { itemId: string; pictureId: string; status: string };

type MlcImageOrchestrationStep = {
  kind: "diagnose" | "upload" | "associate" | "check";
  status: "pending" | "requires-approval" | "ready";
  requiresApproval: boolean;
};

type MlcImageOrchestrationInput = {
  itemId: string; pictureUrl: string; categoryId: string; title?: string;
};

type MlcImageOrchestrationSummary = {
  itemId: string;
  steps: ReadonlyArray<MlcImageOrchestrationStep>;
  requiresApproval: true;
  noMutationExecuted: true;
};
```

## Normalizers

4 claim sub-resource normalizers follow `normalizeNotices` pattern — `asRecord` + `asArray` + `pushOptional`. Use existing `normalizeClaimMessages()` helper for messages sub-resource. Each returns `MlcReadSnapshot<T>` with `kind: "business-signal"`.

## Client Methods

### `MlcApiClient` additions (4 optional claim sub-resources + 1 image associate):

```typescript
getClaimMessages?(sellerId, claimId): Promise<MlcClaimMessagesSnapshot>;
getClaimExpectedResolutions?(sellerId, claimId): Promise<MlcClaimResolutionsSnapshot>;
getClaimAffectsReputation?(sellerId, claimId): Promise<MlcClaimReputationSnapshot>;
getClaimStatusHistory?(sellerId, claimId): Promise<MlcClaimStatusHistorySnapshot>;
associateImageToItem?(sellerId, input: MlcImageAssociateInput): Promise<MlcReadSnapshot<MlcImageAssociateSummary>>;
```

### MCP Tool Registrations

All claim sub-resources registered as `server.registerTool()` inside `if (config.mlcClient)` block, matching the pattern used for `read_claim_detail` and `read_claims`. Each tool: auth gate → call client method → `jsonResult()`.

Image orchestration: registered as `prepare_image_orchestration` — `prepare-only` tool that returns typed `MlcImageOrchestrationSummary` with `requiresApproval: true`, `noMutationExecuted: true`. Does NOT execute mutations.

## File Changes

| File | Action | Lines |
|------|--------|-------|
| `packages/mercadolibre/src/index.ts` | Modified | +100 (types + normalizers + client methods) |
| `packages/mcp/src/index.ts` | Modified | +50 (MCP tool registrations) |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Modified | +80 |
| `packages/mcp/src/mcp.test.ts` | Modified | +20 |
| **Total code** | | **~150** |
| **Total tests** | | **~100** |
| **Grand total** | | **~250** |
