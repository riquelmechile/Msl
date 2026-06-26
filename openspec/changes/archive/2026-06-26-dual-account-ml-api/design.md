# Design: Dual-Account ML API + Product Sync

## Technical Approach

Domain-driven: extend `packages/mercadolibre` (OAuth module, real transport, write methods), new `packages/sync` (sync engine), extend `packages/tools` (MCP sync tools), wire into agent. Phased delivery: OAuth → Write API → Sync Engine → Tools → Agent.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| OAuth storage | Internal `mercadolibre/src/oauth/` module, not new package | Still ML-specific; extract to package only when another platform needs OAuth |
| Token encryption | libsodium `crypto_secretbox` with key from `ML_TOKEN_KEY` env var | Industry standard, no npm dependency overhead vs `node:crypto` |
| Multi-account routing | `OAuthManager.getToken(sellerId)` → per-call resolution | Validates sellerId at every API boundary, prevents cross-publish |
| Sync engine location | New `packages/sync/` package | Complex logic (strategies, pricing math, diff tracking) deserves isolated test surface |
| Write pattern | Same `MlcApiClient` interface with added write methods | Preserves existing `createMlcApiClient({ tokenState, transport, now })` factory |
| Real HTTP transport | `node-fetch` with exponential backoff | Same ecosystem as existing code; retry pattern essential for ML rate limits |

## Data Flow

```
CEO Message → Agent Loop → Tool Dispatch → CustomBusinessTool
                                                  │
    ┌─────────────────────────────────────────────┘
    ▼
ProductSyncEngine
    │
    ├──(1) OAuthManager.getToken("plasticov")──→ MlcApiClient.getListings()
    │
    ├──(2) StrategyEngine.apply(ceoRules, listings) → TransformedListings
    │
    ├──(3) DiffEngine.detect(priorSync, current) → ChangedListings
    │
    └──(4) OAuthManager.getToken("maustian")──→ MlcApiClient.publishItem()
                   │
                   └──→ SyncStateStore.record(productMapping)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/oauth/token-store.ts` | Create | Encrypted SQLite-backed multi-account token CRUD |
| `packages/mercadolibre/src/oauth/oauth-manager.ts` | Create | Auth code exchange, refresh rotation, per-sellerId lookup |
| `packages/mercadolibre/src/transport.ts` | Create | Real `MercadoLibreApiTransport` with `node-fetch` + backoff |
| `packages/mercadolibre/src/index.ts` | Modify | Add write methods, categories, users/me to `MlcApiClient` |
| `packages/sync/src/engine.ts` | Create | `ProductSyncEngine`: extract → applyStrategies → diff → publish |
| `packages/sync/src/strategy-applier.ts` | Create | Pure-function CEO strategy → pricing transforms |
| `packages/sync/src/diff-engine.ts` | Create | Detect changed listings vs prior sync state |
| `packages/sync/src/sync-store.ts` | Create | SQLite tables: `sync_jobs`, `product_mappings` |
| `packages/tools/src/sync-tools.ts` | Create | 6 `CustomBusinessTool` instances for sync operations |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Register sync tools in agent loop |
| `packages/memory/src/schema.ts` | Modify | Add sync_jobs/product_mappings tables to GraphEngine |
| `packages/domain/src/seller.ts` | Modify | Add `accountRole`, `taxId`, `parentAccountId` to `SellerAccount` |

## Interfaces

```typescript
// OAuthManager — multi-account token resolution
type OAuthManager = {
  getToken(sellerId: string): Promise<AccessEvaluation>;
  storeTokens(sellerId: string, tokens: OAuthTokenPair): Promise<void>;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenPair>;
  refreshToken(sellerId: string): Promise<OAuthTokenState>;
};

// Extended MlcApiClient — write methods added
type MlcApiClient = {
  // ... existing read methods ...
  publishItem(sellerId: string, listing: MlcListingPayload): Promise<MlcWriteSnapshot>;
  updateItem(sellerId: string, itemId: string, changes: Partial<MlcListingPayload>): Promise<MlcWriteSnapshot>;
  changeItemStatus(sellerId: string, itemId: string, status: string): Promise<MlcWriteSnapshot>;
  getCategories(sellerId: string, categoryId?: string): Promise<MlcCategoriesSnapshot>;
  getMyUser(sellerId: string): Promise<MlcUserSnapshot>;
};

// ProductSyncEngine
type ProductSyncEngine = {
  sync(options: SyncOptions): Promise<SyncResult>;
  getStatus(jobId: string): Promise<SyncJob>;
};
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Token encryption/decryption, strategy math, diff detection | Pure functions, stub SQLite |
| Unit | Normalization for categories, users/me | Follow existing normalize* pattern |
| Integration | OAuth flow with real refresh cycle | In-memory SQLite, stub ML HTTP |
| Integration | Sync engine end-to-end with stubbed ML API | Stub both accounts, verify mappings |
| E2E | Agent invokes sync tool from conversation | Mock `agentLoop` with test strategies |

## Rollout

Feature-gated via config flag `ENABLE_ML_SYNC`. Disabled by default. No data migration required — sync tables are additive. Agent falls back to read-only mode when flag is off.
