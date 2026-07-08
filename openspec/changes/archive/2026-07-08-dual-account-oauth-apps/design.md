# Design: Dual-Account OAuth Apps

## Architecture

```
apps/web/app/api/meli/oauth.ts  (lazy singleton)
  │ resolveOAuthConfigs(env) → Map<sellerId, OAuthManagerConfig>
  ▼
MultiAppOAuthManager       (implements OAuthManager — zero consumer changes)
  ├─ "plasticov" ──▶ OAuthManager(App A) ── TokenStore
  └─ "maustian"  ──▶ OAuthManager(App B) ── TokenStore (same DB file, WAL)
```

Both `TokenStore` instances share the same SQLite file (`MSL_MERCADOLIBRE_OAUTH_DB_PATH`). WAL mode supports concurrent connections; per-seller rows naturally isolate tokens.

## Component Designs

### 1. MultiAppOAuthManager (`packages/mercadolibre/src/oauth/multiAppOAuthManager.ts`)

```typescript
export function createMultiAppOAuthManager(
  configs: ReadonlyMap<string, OAuthManagerConfig>,
): OAuthManager
```

**Delegation**: Lookup inner manager by sellerId → delegate. Unknown sellerId throws `Unknown seller: {sellerId}`.

**Backward compat**: Single-entry Map → passthrough (identical to legacy single `OAuthManager`). Cross-seller methods (`getStoredToken`, `deleteToken`) do linear scan across inner managers.

**Stub mode per seller**: `isStubMode()` (no-arg) returns `true` only if ALL inner managers are stub → preserves existing `createMlClient` behavior. Per-seller: `isStubMode(sellerId: string)` for granular checks.

### 2. Env Var Resolution (`packages/mercadolibre/src/oauth/oauthConfig.ts`)

```typescript
export function resolveOAuthConfigs(
  env: NodeJS.ProcessEnv,
): ReadonlyMap<string, OAuthManagerConfig>
```

Hierarchy per role (`SOURCE`/`TARGET`):
1. `MERCADOLIBRE_{ROLE}_CLIENT_ID/SECRET/REDIRECT_URI`
2. Fallback: `MERCADOLIBRE_CLIENT_ID/SECRET/REDIRECT_URI`
3. SellerId: `MERCADOLIBRE_{ROLE}_SELLER_ID`
4. `dbPath` always from `MSL_MERCADOLIBRE_OAUTH_DB_PATH`

If per-role vars are missing but legacy vars exist → both sellers map to the same legacy config (single-app backward compat). If neither exists → empty Map; callers decide: fall back to legacy `createOAuthManager` or fail.

### 3. HMAC State (`packages/mercadolibre/src/oauth/oauthState.ts`)

```typescript
type OAuthStatePayload = { role: "source"|"target"; sellerId: string; nonce: string; createdAt: number; };

function generateState(payload: OAuthStatePayload, secret: string): string;
function validateState(state: string, secret: string, ttlMs?: number): OAuthStatePayload;
```

Format: `base64(JSON(payload)).base64(HMAC-SHA256)` using `node:crypto`. `validateState` throws on expiry (10 min default), tampered signature, or malformed format.

### 4. Next.js API Routes

**Dependency injection**: `apps/web/app/api/meli/oauth.ts` lazy-singleton — calls `resolveOAuthConfigs` + `createMultiAppOAuthManager` once on first access. Routes import this.

`apps/web/app/api/meli/connect/route.ts` — GET:
- Read `role` query param (`source`|`target`), 400 on unknown
- Resolve sellerId from env, generate HMAC state
- 302 redirect to `oauthManager.getAuthorizationUrl(sellerId, state)`

`apps/web/app/api/meli/callback/route.ts` — GET:
- Read `code`, `state` from query
- `validateState(state, MSL_OAUTH_STATE_SECRET)` → extract `sellerId`
- `oauthManager.exchangeCodeForToken(sellerId, code)`
- 200 HTML: `user_id`, `nickname` — NO `access_token` or `refresh_token` in body

`apps/web/app/callback/route.ts` — re-exports callback handler (Maustian ngrok compat).

### 5. runtimeDependencies.ts Changes

```typescript
// Before:
const oauthManager = createOAuthManager({ clientId, clientSecret, redirectUri, dbPath });

// After:
const oauthManager = createMultiAppOAuthManager(resolveOAuthConfigs(env));
```

Returned `OAuthManager` passes unchanged to `createOAuthMlcApiClient` and `createMlClient` — both already consume `OAuthManager` interface. No type changes needed in consumers.

## File Changes

| File | Action | Purpose |
|------|--------|---------|
| `packages/mercadolibre/src/oauth/multiAppOAuthManager.ts` | New | Wrapper factory |
| `packages/mercadolibre/src/oauth/oauthConfig.ts` | New | Per-seller env var resolution |
| `packages/mercadolibre/src/oauth/oauthState.ts` | New | HMAC state sign/validate |
| `apps/web/app/api/meli/oauth.ts` | New | Lazy singleton manager |
| `apps/web/app/api/meli/connect/route.ts` | New | Connect redirect |
| `apps/web/app/api/meli/callback/route.ts` | New | Callback handler |
| `apps/web/app/callback/route.ts` | New | ngrok redirect re-export |
| `packages/mercadolibre/src/index.ts` | Modify | Export new factories |
| `packages/mcp/src/runtimeDependencies.ts` | Modify | Wire MultiAppOAuthManager |

## Error Handling

| Layer | Error | Behavior |
|-------|-------|----------|
| `MultiAppOAuthManager` | Unknown sellerId | `Unknown seller: {sellerId}` |
| `MultiAppOAuthManager` | Token refresh/exchange failure | Propagates inner OAuthManager error |
| `oauthState.validateState` | Expired / invalid signature / malformed | Throws specific message |
| API: connect | Unknown `role` | 400 `Unknown role: {role}` |
| API: callback | Missing `code` | 400 `Missing code` |
| API: callback | `validateState` throws | 400 with error message |
| API: callback | `exchangeCodeForToken` throws | 500 internal error |

## Backward Compatibility

- Legacy `MERCADOLIBRE_CLIENT_ID/SECRET/REDIRECT_URI` serves as fallback when per-role vars are absent
- Single-entry config Map → `MultiAppOAuthManager` acts as transparent passthrough
- `OAuthManager` interface unchanged — no breaking changes in `MlcApiClient`, `MlClient`, or any consumer
- `TokenStore` schema unchanged — existing `oauth_tokens` table, no migration required
- `isStubMode()` no-arg variant preserved; per-seller variant adds new capability without breaking existing callers
