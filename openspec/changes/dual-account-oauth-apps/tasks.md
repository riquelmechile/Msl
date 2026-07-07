# Tasks: Dual-Account OAuth Apps

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~550 new + ~100 modified = ~650 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (packages/mercadolibre: oauthConfig + multiAppMgr + oauthState + tests) → PR 2 (routes + wiring + env + integration) |
| Delivery strategy | auto-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

| Unit | Goal | PR | Notes |
|------|------|-----|-------|
| 1 | Multi-app routing + HMAC state (packages/mercadolibre) | 1 | oauthConfig, multiAppOAuthManager, oauthState, tests, exports |
| 2 | Web routes + runtime wiring + integration | 2 | apps/web routes, DI, runtimeDeps, .env.example, integration tests |

## Phase 1: Core Multi-App OAuth (packages/mercadolibre)

- [x] 1.1 `packages/mercadolibre/src/oauth/oauthConfig.ts` — `resolveOAuthConfigs(env)` → `ReadonlyMap<string, OAuthManagerConfig>`. Per-seller `MERCADOLIBRE_{SOURCE,TARGET}_{CLIENT_ID,SECRET,REDIRECT_URI}` → legacy fallback. SellerId from `_SELLER_ID` vars.
- [x] 1.2 `packages/mercadolibre/src/oauth/multiAppOAuthManager.ts` — `createMultiAppOAuthManager(configs)` → `OAuthManager`. Delegates auth/refresh/token-exchange by sellerId. `isStubMode(sellerId)` is **internal** (NOT added to `OAuthManager` interface). No-arg variant returns true only if ALL inner managers are stub.
- [x] 1.3 `packages/mercadolibre/src/oauth/oauthState.ts` — HMAC-SHA256: `generateState(payload, secret)` and `validateState(state, secret, ttlMs?)`. Throws on expiry (10 min), tampering, malformed format.
- [x] 1.4 `packages/mercadolibre/src/index.ts` — export `createMultiAppOAuthManager`, `resolveOAuthConfigs`, `generateState`, `validateState`, `OAuthStatePayload`.
- [x] 1.5 `packages/mercadolibre/src/oauth/oauthConfig.test.ts` — per-seller priority, legacy fallback, empty when no vars, both sellers share single legacy config.
- [x] 1.6 `packages/mercadolibre/src/oauth/multiAppOAuthManager.test.ts` — delegation per sellerId, unknown sellerId throws, single-entry passthrough, stub per-seller vs all.
- [x] 1.7 `packages/mercadolibre/src/oauth/oauthState.test.ts` — round-trip, expiry, tampered signature, malformed.

## Phase 2: API Routes (apps/web)

- [ ] 2.1 `apps/web/app/api/meli/oauth.ts` — lazy singleton: `resolveOAuthConfigs` + `createMultiAppOAuthManager`, cached on first access.
- [ ] 2.2 `apps/web/app/api/meli/connect/route.ts` — GET: read `role` (`source`|`target`), resolve sellerId, generate HMAC state, 302 redirect. 400 on unknown role.
- [ ] 2.3 `apps/web/app/api/meli/callback/route.ts` — GET: read `code`+`state`, validate HMAC, extract sellerId, **validate role/sellerId match** (role from state must match seller's configured role), exchange code, 200 HTML with `user_id`+`nickname` (NO tokens). 400/500 on errors.
- [ ] 2.4 `apps/web/app/callback/route.ts` — re-export callback handler for ngrok compat.
- [ ] 2.5 `apps/web/app/api/meli/connect.test.ts` — correct redirect URL per role, 400 unknown role.
- [ ] 2.6 `apps/web/app/api/meli/callback.test.ts` — valid flow returns user_id/nickname, no tokens in body, expired/tampered role-mismatch/missing-code → 400.

## Phase 3: Runtime Wiring

- [ ] 3.1 `packages/mcp/src/runtimeDependencies.ts` — replace `createOAuthManager(...)` with `createMultiAppOAuthManager(resolveOAuthConfigs(env))`. Extend `OAUTH_ENV_KEYS` to check legacy OR per-seller vars. Return type unchanged.
- [ ] 3.2 `.env.example` — add `MERCADOLIBRE_{SOURCE,TARGET}_CLIENT_ID/SECRET/REDIRECT_URI` + `MSL_OAUTH_STATE_SECRET` entries.
- [ ] 3.3 Integration test: full stub-mode flow — connect→redirect→callback→token per seller, two rows coexist, single-app fallback works.

## Phase 4: Quality Gates

- [x] 4.1 TypeScript typecheck: `tsc -b --pretty false` (packages/mercadolibre) + `tsc --noEmit --pretty false` (apps/web).
- [x] 4.2 All tests pass: `vitest run`.
- [ ] 4.3 Lint + format check.
