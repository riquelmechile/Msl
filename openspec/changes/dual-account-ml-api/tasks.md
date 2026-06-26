# Tasks: Dual-Account ML API + Product Sync

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 700–900 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Notes |
|------|------|----|-------|
| 1 | OAuth multi-account + encrypted store + real transport | PR 1 | ~200 lines; tests included |
| 2 | ML API write surface + categories + users/me | PR 2 | ~180 lines; tests included |
| 3 | Product Sync Engine: extract → apply → diff → publish | PR 3 | ~250 lines; tests included |
| 4 | MCP tools + agent wiring + Cortex sync nodes | PR 4 | ~220 lines; tests included |

---

## Phase 1: OAuth Foundation (PR 1)

- [x] 1.1 Create `packages/mercadolibre/src/oauth/token-store.ts` — encrypted SQLite CRUD using libsodium `crypto_secretbox`, key from `ML_TOKEN_KEY` env var
- [x] 1.2 Create `packages/mercadolibre/src/oauth/oauth-manager.ts` — multi-account `OAuthManager` with `getToken(sellerId)`, `exchangeCode()`, `refreshToken()`, per-sellerId routing
- [x] 1.3 Create `packages/mercadolibre/src/transport.ts` — real `MercadoLibreApiTransport` via `node-fetch` with exponential backoff (100ms→10s, max 3 retries)
- [x] 1.4 Write tests: token encrypt/decrypt roundtrip, refresh cycle with expired tokens, transport retry on 429

## Phase 2: ML API Write Surface (PR 2)

- [x] 2.1 Extend `MlcApiClient` type with `publishItem`, `updateItem`, `changeItemStatus`, `getCategories`, `getMyUser`
- [x] 2.2 Add normalization functions: `normalizeCategory()`, `normalizeUser()`, `normalizeWriteResponse()`
- [x] 2.3 Update `createMlcApiClient` factory to accept `OAuthManager` instead of single `tokenState`; write methods resolve token per call
- [x] 2.4 Write tests: publishItem returns id/permalink, sellerId mismatch blocked, category tree parsing

## Phase 3: Product Sync Engine (PR 3)

- [x] 3.1 Create `packages/sync/src/strategy-applier.ts` (implemented in `packages/mercadolibre/src/sync/strategyApplier.ts`) — pure function: `applyStrategies(item, strategies[])` → transformed NewItem with margin, category filter, stock, pricing rules
- [x] 3.2 Create `packages/sync/src/diff-engine.ts` (implemented in `packages/mercadolibre/src/sync/diffEngine.ts`) — compare current listings vs prior sync state, return changed/unchanged/new/removed subsets
- [x] 3.3 Create `packages/sync/src/sync-store.ts` (implemented in `packages/mercadolibre/src/sync/syncStore.ts`) — SQLite table `product_sync_state` with markSynced, getSyncState, isOutOfSync, listSynced
- [x] 3.4 Create `packages/sync/src/engine.ts` (implemented in `packages/mercadolibre/src/sync/syncEngine.ts`) — `ProductSyncEngine.syncProduct()` + `syncAll()` orchestrating: extract→apply→diff→publish→record
- [x] 3.5 Write tests: 39 tests covering strategy math, diff detection, sync store CRUD, full sync engine (publish, skip, unchanged, differential, limit, errors)

## Phase 4: MCP Tools + Agent Integration (PR 4)

- [x] 4.1 Create `packages/agent/src/conversation/syncTools.ts` — 3 MCP tools (`sync_product`, `sync_all`, `check_account`) wrapping sync engine + ML client, following existing `ToolDefinition` pattern
- [x] 4.2 Wire sync tools into `agentLoop.ts` with CEO-strategy safety gate (blocks sync without active strategies); register `syncEngine` + `mlClient` in `AgentLoopConfig`
- [x] 4.3 Add Cortex sync-outcome nodes: `ensureSellerNode()`, `storeSyncOutcome()` with Hebbian reinforcement on successful syncs (+0.1) and penalization on failures (−0.15)
- [x] 4.4 Typecheck passes; add `@msl/mercadolibre` to agent package dependencies + vitest alias; export sync tools from `index.ts`
- [x] 4.5 Write tests: 17 tests covering sync_product/sync_all/check_account tool execution, Cortex node creation, Hebbian reinforcement, idempotent seller nodes, strategy-gate blocking, error handling
