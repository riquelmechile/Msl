# Tasks: Telegram Bot Multi-Seller OAuth

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 120–160 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full OAuth wiring + tests | Single PR | Under 200 lines; no split needed |

## Phase 1: Core Bot OAuth Wiring

- [x] 1.1 Replace legacy `createMlcApiClient` with multi-seller OAuth in `packages/bot/src/index.ts`
  - Add imports: `resolveOAuthConfigs`, `createMultiAppOAuthManager`, `createOAuthMlcApiClient`, `createMlClient`, `getMlAccountRoleConfig`, `OAuthManager` from `@msl/mercadolibre`; remove `createMlcApiClient`, `OAuthTokenState`
  - Add `MSL_MERCADOLIBRE_OAUTH_DB_PATH`, `MSL_ENCRYPTION_KEY` to `TelegramBotEnv` type
  - Replace lines 203–225 (legacy token block) with OAuth client creation: `resolveOAuthConfigs(env)` → `createMultiAppOAuthManager` → `createOAuthMlcApiClient` + `createMlClient`
  - Wire `mlClient` into `agentConfig`: `if (mlClient) agentConfig.mlClient = mlClient;`

- [x] 1.2 Update system prompt to include multi-seller context in `packages/bot/src/index.ts`
  - Append `## Multi-seller context` block with `sourceSellerId`/`targetSellerId` and names from `getMlAccountRoleConfig` when OAuth manager is active

- [x] 1.3 Add migration warning for legacy env vars in `packages/bot/src/index.ts`
  - Log `console.warn` when `MERCADOLIBRE_ACCESS_TOKEN` is set but `MSL_MERCADOLIBRE_OAUTH_DB_PATH` is not

- [x] 1.4 Wire `oauthManager.close()` in cleanup and stop in `packages/bot/src/index.ts`
  - Add to `botConfig.cleanup` closure
  - Add to `stop()` handler with idempotent `?.close()` guard

- [x] 1.5 Update background ingestion to use `getMlAccountRoleConfig` for sellerIds in `packages/bot/src/index.ts`
  - Remove `mlcSellerId` gate; derive `sellerIds` + `sellerNames` from `roleConfig.sourceSellerId`/`targetSellerId`

## Phase 2: Tests

- [x] 2.1 Update bot integration tests in `packages/bot/src/bot.test.ts` for OAuth wiring
  - Test demo/mock mode still works without OAuth config
  - Note: `@msl/mercadolibre` is not mocked in the test suite; real functions handle missing OAuth config gracefully (oauthManager stays undefined, system prompt falls back to base, background ingestion skipped)

- [x] 2.2 Test migration warning output in `packages/bot/src/bot.test.ts`
  - Assert `console.warn` called when `MERCADOLIBRE_ACCESS_TOKEN` is set but OAuth DB path absent
  - Demo mode test confirms no warning when neither is configured

## Phase 3: Quality Gates

- [x] 3.1 Run `npm run typecheck && npm test` — all green before marking complete
