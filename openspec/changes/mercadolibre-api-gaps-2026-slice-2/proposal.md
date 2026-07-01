# Proposal: MercadoLibre API Gaps 2026 — Slice 2

## Intent

Complete the remaining safe-read gaps (claims, shipping) from the 2026 exploration, wire Slice 1 capabilities as MCP tools, and define the image orchestration flow. This is the "dale con todo" slice — implement everything that isn't blocked by approval pipeline maturity.

## Scope

### In Scope (~410 lines)

| Gap | Classification | Description | Est. Lines |
|-----|---------------|-------------|------------|
| Claims search + detail | `safe-read` | 6 GET endpoints: search, detail, messages, expected_resolutions, affects-reputation, status_history | ~200 |
| Shipping status | `safe-read` | `GET /marketplace/shipments/{id}` with `x-format-new: true` | ~100 |
| MCP tool wiring (Slice 1) | Infrastructure | `read_mercadolibre_moderation_status`, `read_mercadolibre_notices`, wire `prepareAnswer` as docs-only | ~50 |
| Image orchestration flow | `prepare-only` | Spec + type definition for 4-step flow (diagnose → upload → associate → check) | ~60 |

### Out of Scope (deferred)

- Claims mutation actions (send message, attachments, expected_resolutions POST/PUT) — `prepare-only`, deferred to execution slice
- Shipping label generation, tracking updates, status mutation — `prepare-only`, deferred
- Image orchestration implementation (the actual sequenced flow execution) — deferred to approval pipeline maturation
- `prepareAnswer` MCP execution tool — deferred; client-level type exists but no approval pipeline yet
- `MlcReadTools` extension (adding moderation/notices/claims/shipping to tools package) — deferred refactor

## Capabilities

### New Capabilities
- `ml-claims`: Safe-read claims search, detail, messages, resolutions, reputation-impact check, and status history
- `ml-shipping-status`: Safe-read shipment detail with status, tracking, logistics mode, dimensions
- `ml-image-orchestration`: Prepare-only spec for the 4-step image flow

### Modified Capabilities
- `ml-api-integration`: Add 2 new matrix entries (claims, shipping)
- `custom-business-mcp-tools`: Add MCP tool specs for moderation status, notices, and claims reads

## Approach

Per-endpoint pattern from Slice 1: summary types → normalizers using `pushOptional`/`asArray`/`asRecord`/`stringValue` → optional methods on `MlcApiClient` → implementations in `createMlcReadMethods`. 

MCP wiring uses custom `server.registerTool()` registrations (like `read_product_ads_insights`), not the simpler `registerMlcReadTool` pattern, because the new read tools need additional input fields (itemId for moderation, claimId for claim detail, etc.).

**Classification contract**: All new API surfaces follow the capability matrix contract:
- `safe-read` entries: `siteSupport: "MLC-to-confirm"`, `runtime surface: "read-tool"`, confidence medium/high
- `prepare-only` entries: `requiresApproval: true`, no direct MCP execution

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/index.ts` | Modified | 2 types + 2 normalizers + 2 client methods (~250 lines) |
| `packages/mcp/src/index.ts` | Modified | 3-4 MCP tool registrations (~50 lines) |
| `openspec/specs/ml-api-integration/spec.md` | Modified | 2 new capability matrix entries |
| `openspec/specs/custom-business-mcp-tools/spec.md` | Modified | MCP tool specs for new tools |
| New: `openspec/changes/.../specs/ml-image-orchestration/spec.md` | Created | Image flow spec |

## Design Highlights

### Claims Type Design

```typescript
type MlcClaimPlayerAction = { action: string; dueDate?: string; mandatory?: boolean };
type MlcClaimPlayer = {
  role: "complainant" | "respondent" | "mediator";
  type: "buyer" | "seller" | "internal";
  userId: number;
  availableActions: ReadonlyArray<MlcClaimPlayerAction>;
};
type MlcClaimResolution = { reason?: string; dateCreated?: string; benefited?: ReadonlyArray<string> };
type MlcClaimCoverage = {
  type?: string; benefited?: string; amount?: number; resource?: string; resourceId?: number;
  dateCreated?: string; costs: ReadonlyArray<{ role?: string; amount?: number }>;
};
type MlcClaimLabel = { name?: string; value?: string; comments?: string; dateCreated?: string };
type MlcClaimSummary = {
  id: number; type?: string; stage?: string; status?: string; resource?: string;
  resourceId?: number; reasonId?: string; siteId?: string;
  players: ReadonlyArray<MlcClaimPlayer>; resolution?: MlcClaimResolution;
  coverages?: ReadonlyArray<MlcClaimCoverage>; labels?: ReadonlyArray<MlcClaimLabel>;
  dateCreated?: string; lastUpdated?: string;
};
type MlcClaimMessage = {
  senderRole?: string; receiverRole?: string; stage?: string; message?: string;
  dateCreated?: string; attachments: ReadonlyArray<{ filename?: string; originalFilename?: string; size?: number }>;
};
```

### Shipping Status Type Design

```typescript
type MlcShipmentStatusSummary = {
  id: number; orderId?: number; status?: string; substatus?: string;
  trackingNumber?: string; trackingMethod?: string;
  logisticMode?: string; logisticType?: string;
  dateCreated?: string; lastUpdated?: string;
  dimensions?: { height?: number; length?: number; weight?: number; width?: number };
};
```

### MCP Tool Naming Convention

Following existing patterns:
- `read_mercadolibre_claims` — search claims by stage/status
- `read_mercadolibre_claims_detail` — single claim detail
- `read_mercadolibre_shipping_status` — shipment status by ID
- `read_mercadolibre_moderation_status` — post-upload moderation check (Slice 1 client)
- `read_mercadolibre_notices` — seller notices (Slice 1 client)

### Image Orchestration Flow

```typescript
type MlcImageFlowInput = { pictureUrl: string; categoryId: string; itemId: string };
type MlcImageFlowResult = {
  diagnostic: { hasIssues: boolean; detections: ReadonlyArray<string> };
  upload: { pictureId: string; variationUrls: ReadonlyArray<string> };
  association: { status: "pending" };
  moderation: { blocked: boolean; wordings: ReadonlyArray<string> };
  noMutationExecuted: true;
  requiresApproval: true;
};
```

The flow is defined as a typed spec, not an executable method. Each step is individually typed; the orchestration spec defines the contract for a future agent to chain them with approval gates.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Claims `players.available_actions` nesting is deeper than expected | Low | Already documented; normalizer handles nested arrays |
| Shipping response shape varies by site/logistics provider | Medium | Model only essential status fields; optional everything else |
| `prepareAnswer` MCP wiring implies it executes | Low | Register as `prepare_mercadolibre_answer` with `requiresApproval: true`, matching `prepare_mercadolibre_write` pattern |
| 410 lines exceeds 400-line budget | High | Additive, no refactoring, mechanical MCP registrations. Acceptable overage |

## Rollback Plan

Revert commit. All safe-reads have no side effects. Prepare-only image flow has no execution path.

## Dependencies

- Slice 1 completed and archived ✅
- No new dependencies

## Success Criteria

- [ ] `getClaims(sellerId, filters)` returns typed `MlcReadSnapshot<ReadonlyArray<MlcClaimSummary>>`
- [ ] `getClaimDetail(sellerId, claimId)` returns typed `MlcClaimSummary`
- [ ] `getClaimMessages(sellerId, claimId)` returns typed claim messages
- [ ] `getShipment(sellerId, shipmentId)` returns typed `MlcShipmentStatusSummary`
- [ ] MCP tools registered for moderation status and notices
- [ ] Image orchestration flow spec written
- [ ] Pass `npm run typecheck` and `npm test`

## Delivery Strategy

**Single PR** (~410 lines). Marginal overage over 400-line budget. All changes are additive, follow established patterns, and require zero refactoring. The claims normalizer is the only non-trivial piece. If reviewer prefers split:
- PR #1: Claims + Shipping types and client methods (~300 lines)
- PR #2: MCP wiring + image orchestration spec (~110 lines)

---

## Proposal Question

None — all decisions resolved. Proceed to spec phase.
