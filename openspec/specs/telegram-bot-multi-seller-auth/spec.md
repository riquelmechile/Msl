# telegram-bot-multi-seller-auth Specification

## Purpose

OAuth-backed multi-seller API client for the Telegram bot. Replaces the legacy single-seller static `MERCADOLIBRE_ACCESS_TOKEN` with per-seller OAuth token resolution, registers write tools via `createMlClient`, and adds migration warnings for legacy configurations.

## Requirements

### Requirement: Multi-Seller OAuth Client

`createTelegramBotFromEnv()` MUST use `resolveOAuthConfigs`, `createMultiAppOAuthManager`, and `createOAuthMlcApiClient` instead of `createMlcApiClient({tokenState})`. The bot MUST pass `MERCADOLIBRE_SOURCE_SELLER_ID` and `MERCADOLIBRE_TARGET_SELLER_ID` as `allowedSellerIds`. It MUST create `mlClient` via `createMlClient({oauthManager, now})` and wire it to `agentConfig`. `oauthManager.close()` MUST be called during cleanup and bot stop.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| OAuth client created | OAuth configs resolved for both sellers | `createTelegramBotFromEnv()` runs | `mlcClient` and `mlClient` created with multi-seller OAuth manager |
| Both sellers allowed | SOURCE_SELLER_ID=123, TARGET_SELLER_ID=456 | Client created | `allowedSellerIds` passes both 123 and 456 |
| Cleanup closes manager | Bot receives stop signal | Shutdown runs | `oauthManager.close()` called before process exits |

### Requirement: Natural Language Multi-Seller UX

The agent MUST understand seller names from natural language without commands. When the user says "Plasticov" or "Maustian", the LLM MUST route tool calls to the correct `sellerId`. The system prompt MUST include both seller names and their IDs.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Seller resolved by name | System prompt includes Plasticov→id mapping | User says "¿cómo va Plasticov?" | LLM routes to Plasticov's sellerId |
| Second seller resolved | System prompt includes Maustian→id mapping | User says "revisá Maustian" | LLM routes to Maustian's sellerId |
| No seller mentioned | User asks generic question | LLM handles normally | No forced sellerId selection |

### Requirement: Background Ingestion for Both Sellers

Background ingestion MUST use the same multi-seller `mlcClient`. Ingestion MUST run for both source and target seller IDs.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Both sellers ingested | Multi-seller client active | Ingestion job runs | Both Plasticov and Maustian data fetched via same OAuth client |
| Ingestion scoped per seller | Ingestion fetches listings | API call made | Each call passes correct sellerId |

### Requirement: Migration Warning

If `MERCADOLIBRE_ACCESS_TOKEN` is set but `MSL_MERCADOLIBRE_OAUTH_DB_PATH` is NOT set, the bot MUST log a migration warning. The warning MUST guide ops to configure OAuth env vars.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Legacy token, no OAuth DB | ACCESS_TOKEN set, OAUTH_DB_PATH unset | Bot starts | Migration warning logged; bot continues in demo/mock mode |
| OAuth configured | OAUTH_DB_PATH set | Bot starts | No migration warning; OAuth client created normally |
| Neither configured | No ACCESS_TOKEN, no OAUTH_DB_PATH | Bot starts | No warning; demo/mock mode active |

### Requirement: Backward Compatibility

The bot MUST still work in demo/mock mode without OAuth configuration. Existing test infrastructure MUST not break.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| No OAuth, no API keys | OAuth env vars absent | Bot starts | Demo/mock mode active without errors |
| Tests pass unchanged | Existing test suite | `npm test` runs | All tests pass; no OAuth client required in test paths |
