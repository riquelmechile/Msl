# Design: MercadoLibre Dual-Account Production Connection

## Technical Approach

Create `packages/mercadolibre/src/connection/` with a health service, registry, state model, and smoke service. Wire into `ProductionReadinessService` via a new checker, route `onTokenRefresh` → metrics, and expose CLI + MCP tools. Consolidate env loading across the monorepo with a shared `packages/mercadolibre/src/env.ts` loader.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| Env loader | Manual `.env` parser (no `dotenv` dep) | `dotenv` npm package, Node `--env-file-if-exists` | `dotenv` not in tree, Node 22 flag is CLI-only. Simple K=V parser suffices; `.env` has no interpolation. |
| Registry source | Derived from env vars + `resolveOAuthConfigs` + `createTokenStore` | Hardcoded account map | Env vars + token store are the canonical source. Hardcoding duplicates truth. |
| Health service mode | Single factory with `mode` enum: `inspect-only | refresh-if-needed | smoke-read | no-network` | Pure function per mode; simpler than wrapping decorators or sub-classes for each mode combination. |
| Smoke transport | DI-injected `MercadoLibreApiFetchTransport` via `createOAuthMlcApiClient` | Direct `fetch` | Reuses existing MLC client infrastructure; consistent error handling and 429 rate-limit backoff. |
| Refresh error typing | New `RefreshErrorCode` enum; typed `MercadoLibreRefreshError` extends `Error` | String matching on `error.message` | Callers (health service) need to branch on `invalid_grant` vs `network_error` — string parsing is fragile. Typed error is testable. |
| Connection lock | Advisory `TokenStore.withLock(sellerId)` already exists | New distributed lock (Redis) | TokenStore already serialises per-seller refresh. Adding a cross-process lock is premature at this scale; advisory guard is sufficient for single-refresher setup. |

## Data Flow

```
env loader ──→ registry ──→ healthService
                   │              │
 resolveOAuthConfigs          smokeService ──→ MLC API (read-only)
                   │              │
            createTokenStore   onTokenRefresh → metrics
                   │
            ensureValidToken (withLock)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/env.ts` | Create | `loadRepositoryEnvironment()` — detects repo root, loads `.env` + `.env.local`, skips if `MSL_SKIP_ENV_FILE=true` |
| `packages/mercadolibre/src/connection/registry.ts` | Create | `MercadoLibreAccountRegistry` — canonical dual-account map from env + oauth config |
| `packages/mercadolibre/src/connection/state.ts` | Create | Pure types: `MercadoLibreConnectionStatus`, `OAuthTokenStatus`, `MercadoLibreAccountConnectionHealth`, `RefreshErrorCode` |
| `packages/mercadolibre/src/connection/healthService.ts` | Create | `createMercadoLibreConnectionHealthService(registry, oauthManager, store, options)` — inspect/refresh/smoke modes |
| `packages/mercadolibre/src/connection/smokeService.ts` | Create | `createMercadoLibreReadOnlySmokeService(mlcClient)` — identity + orders + items with noNetwork option |
| `packages/mercadolibre/src/connection/cli.ts` | Create | `meli:connection:status`, `meli:refresh`, `meli:smoke`, `meli:connect:url` |
| `packages/mercadolibre/src/oauth/oauthManager.ts` | Modify | Add `MercadoLibreRefreshError` with `code: RefreshErrorCode`. Call `onTokenRefresh` on success. Preserve old token until new one persists. |
| `packages/mercadolibre/src/index.ts` | Modify | Export new connection module types and factories |
| `packages/agent/src/readiness/SellerAccountReadinessChecker.ts` | Modify | New checker: `checkMercadoLibreConnectionReadiness(ctx, healthServiceFactory)` — calls `inspect()` on both sellers |
| `packages/agent/src/readiness/runtimeGates.ts` | Modify | Add `assertMercadoLibreWriteDisabled(report, policy)` — fail-closed gate when write capabilities blocked |
| `packages/mcp/src/tools/` | Create `connectionTools.ts` | CEO tools: `inspect_mercadolibre_connections`, `inspect_mercadolibre_account_health`, `run_mercadolibre_read_smoke` |
| `package.json` | Modify | Add CLI scripts: `meli:connection:*` |

## Key Interfaces

```ts
// packages/mercadolibre/src/connection/registry.ts
type MlAccountEntry = {
  accountRole: "source" | "target";
  accountName: string;
  sellerId: string;
  oauthAppBinding: string;
  operationalScope: "mlc";
  readCapability: "mercadolibre-read-plasticov" | "mercadolibre-read-maustian";
  writeCapability: "mercadolibre-write-plasticov" | "mercadolibre-write-maustian";
  connectionPolicy: "read-only" | "full-access";
  enabled: boolean;
};

// packages/mercadolibre/src/connection/healthService.ts
function createMercadoLibreConnectionHealthService(input: {
  registry: MercadoLibreAccountRegistry;
  oauthManager: OAuthManager;
  store: TokenStore;
  smokeService: MercadoLibreReadOnlySmokeService;
  clock?: () => Date;
}): MercadoLibreConnectionHealthService;
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `loadRepositoryEnvironment()` — repo root detection, `.env` overlay, existing var protection | Temp dirs with real `.env` / `.git` / `package.json` |
| Unit | `healthService.inspect()` — token decrypt, expiry eval, config validation | In-memory token store, stub OAuthManager |
| Unit | `oauthManager` error classification — `invalid_grant` → typed error | Mock `fetch` returning 400 with `{"error":"invalid_grant"}` |
| Integration | Smoke service — identity + orders + items against stub server | MSW or `createOAuthMlcApiClient` with fake transport |
| Integration | CLI — `meli:connection:status` with `--json` | Spawn process, capture stdout, parse JSON |

## Migration / Rollout

No data migration. Deploy shared env loader, verify scripts still work, remove `apps/web/.env.local` symlink. Rollback: revert commit, restore symlink.

## Open Questions

- None — all design decisions resolved above.
