# Design: MercadoLibre API Gaps 2026 — Slice 2

## Architecture Decision

**Decision**: Follow the established per-endpoint pattern from Slice 1: summary types → normalizers → optional client methods → MCP tool registrations. All changes are additive, zero refactoring.

**Rationale**: The codebase has 30 endpoint implementations following this exact pattern. Introducing variation increases maintenance cost. The MCP wiring uses custom `server.registerTool()` (not `registerMlcReadTool`) because new tools need additional input fields (itemId, claimId, options) beyond the simple `{ sellerId }` shape.

**Tradeoffs**: Custom registrations mean slightly more boilerplate per tool (~20 lines instead of ~8), but avoid expanding `MlcReadTools` in the tools package — a refactor deferred to a later slice.

## Data Flow

```
ML API → MlcReadRequest (transport) → normalize*() → MlcReadSnapshot<T> → MCP tool → LLM
```

1. **ML API**: raw HTTP response from MercadoLibre
2. **MlcReadRequest**: transport abstraction with OAuth token injection
3. **normalize*()**: converts raw payload to typed summary using `asRecord`, `asArray`, `stringValue`, `numberValue`, `pushOptional` helpers
4. **MlcReadSnapshot<T>**: typed envelope with source, freshness, confidence, completeness
5. **MCP tool**: validates API key, resolves seller OAuth, calls client method, returns JSON via `jsonResult()`

## New Types — Claims

**File**: `packages/mercadolibre/src/index.ts`  
**Insert after**: `MlcNoticesSummary` (line ~214)  
**Estimated**: ~80 lines

```typescript
type MlcClaimPlayerAction = {
  action: string;
  dueDate?: string;
  mandatory?: boolean;
};

type MlcClaimPlayer = {
  role: "complainant" | "respondent" | "mediator";
  type: "buyer" | "seller" | "internal";
  userId: number;
  availableActions: ReadonlyArray<MlcClaimPlayerAction>;
};

type MlcClaimResolution = {
  reason?: string;
  dateCreated?: string;
  benefited?: ReadonlyArray<string>;
};

type MlcClaimSummary = {
  id: number;
  type?: string;
  stage?: string;
  status?: string;
  resource?: string;
  resourceId?: number;
  reasonId?: string;
  siteId?: string;
  players: ReadonlyArray<MlcClaimPlayer>;
  resolution?: MlcClaimResolution;
  dateCreated?: string;
  lastUpdated?: string;
};

type MlcClaimMessage = {
  senderRole?: string;
  receiverRole?: string;
  stage?: string;
  message?: string;
  dateCreated?: string;
  attachments: ReadonlyArray<{
    filename?: string;
    originalFilename?: string;
    size?: number;
  }>;
};
```

**Normalizer**: `normalizeClaimsSearch()` follows the `normalizeListings` pattern — extract `paging` and `data[]`, normalize each claim with `pushOptional`, flatten nested `players.available_actions`.

**Client methods** (added to `MlcApiClient` interface and `createMlcReadMethods`):
- `getClaims?(sellerId, options?)`: Promise<MlcReadSnapshot<ReadonlyArray<MlcClaimSummary>>>
- `getClaimDetail?(sellerId, claimId)`: Promise<MlcClaimSummary>
- `getClaimMessages?(sellerId, claimId)`: Promise<MlcReadSnapshot<ReadonlyArray<MlcClaimMessage>>>
- `getClaimExpectedResolutions?(sellerId, claimId)`: Promise<MlcReadSnapshot<ReadonlyArray<unknown>>>
- `getClaimAffectsReputation?(sellerId, claimId)`: Promise<MlcReadSnapshot<{ affects: boolean }>>
- `getClaimStatusHistory?(sellerId, claimId)`: Promise<MlcReadSnapshot<ReadonlyArray<unknown>>>

## New Types — Shipping Status

**File**: `packages/mercadolibre/src/index.ts`  
**Insert after**: claims types block  
**Estimated**: ~30 lines

```typescript
type MlcShipmentStatusSummary = {
  id: number;
  orderId?: number;
  status?: string;
  substatus?: string;
  trackingNumber?: string;
  trackingMethod?: string;
  logisticMode?: string;
  logisticType?: string;
  dateCreated?: string;
  lastUpdated?: string;
  dimensions?: {
    height?: number;
    length?: number;
    weight?: number;
    width?: number;
  };
};
```

**Snapshot export**: `export type MlcShipmentStatusSnapshot = MlcReadSnapshot<MlcShipmentStatusSummary>;`

**Normalizer**: `normalizeShipmentStatus()` — flat record normalization with optional `dimensions` sub-object. Uses `pushOptional` for all fields.

**Client method**:
- `getShipment?(sellerId, shipmentId)`: Promise<MlcShipmentStatusSnapshot>

Uses `x-format-new: true` header on the `GET /marketplace/shipments/{shipmentId}` request.

## MCP Tool Wiring

**File**: `packages/mcp/src/index.ts`  
**Insert**: inside `createMcpServer()` after existing `registerMlcListingPricesReadTool` call (~line 1671)  
**Estimated**: ~80 lines

```
if (config.mlcClient) {
  // 1. read_moderation_status
  server.registerTool("read_moderation_status", { inputSchema: { sellerId, itemId, msl_api_key } },
    async ({ sellerId, itemId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) return unauthorizedResult();
      return jsonResult(await config.mlcClient.getModerationStatus!(sellerId, itemId));
    });

  // 2. read_notices
  server.registerTool("read_notices", { inputSchema: { sellerId, limit, offset, msl_api_key } },
    async ({ sellerId, limit, offset, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) return unauthorizedResult();
      return jsonResult(await config.mlcClient.getNotices!(sellerId, { limit, offset }));
    });

  // 3. prepare_answer
  server.registerTool("prepare_answer", { inputSchema: { sellerId, questionId, text, msl_api_key } },
    async ({ sellerId, questionId, text, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) return unauthorizedResult();
      return jsonResult(await config.mlcClient.prepareAnswer!(sellerId, { questionId, text }));
    });
}
```

**Naming**: Flat tool names (`read_moderation_status`, not `read_mercadolibre_moderation_status`) to match the existing project convention where tools with custom registrations use shorter names (e.g., `read_product_ads_insights`).

## File Changes Table

| File | Action | Lines | Description |
|------|--------|-------|-------------|
| `packages/mercadolibre/src/index.ts` | Modified | +250 | 2 new types (`MlcClaimSummary`, `MlcShipmentStatusSummary`) + 2 normalizers + 7 client methods |
| `packages/mcp/src/index.ts` | Modified | +80 | 3 new MCP tool registrations |
| `openspec/specs/ml-api-integration/spec.md` | Modified (delta) | +30 | 4 new matrix entries |
| `openspec/specs/custom-business-mcp-tools/spec.md` | Modified (delta) | +50 | 3 new MCP tool requirements |
| `openspec/specs/ml-claims/spec.md` | Created | +60 | New domain spec |
| `openspec/specs/ml-shipping-status/spec.md` | Created | +50 | New domain spec |
| `openspec/specs/ml-image-orchestration/spec.md` | Created | +55 | New domain spec |
| **Total code** | | **~330** | Under 400-line budget |
| **Total specs** | | **~195** | Spec-only, not counted in diff budget |

## Testing Strategy

### Unit Tests (Vitest `packages/mercadolibre/tests/`)

- **`normalizeClaimsSearch`**: Test with real ML response shape — verify players.available_actions flattening, paging extraction, partial completeness
- **`normalizeShipmentStatus`**: Test with delivered, in-transit, cancelled statuses — verify dimensions sub-object normalization
- **Edge cases**: Empty results, malformed responses, missing nested fields

### Integration Tests (Vitest `packages/mcp/tests/`)

- **Tool registration**: Verify 3 new tools appear in server tool list
- **Auth gate**: Unauthenticated requests return `unauthorized` for each tool
- **OAuth flow**: Mock client methods — verify token resolution and snapshot shape
- **`prepare_answer`**: Verify `noMutationExecuted: true` and `requiresApproval: true` in response

### Quality Gates

```bash
npm run typecheck  # All types compile
npm test           # All unit + integration tests pass
npm run lint       # ESLint clean
```
