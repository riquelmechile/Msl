# Proposal: Telegram Bot Multi-Seller OAuth

## Intent

The Telegram bot hardcodes a single seller via `MERCADOLIBRE_ACCESS_TOKEN` env var. Plasticov and Maustian already have separate OAuth apps and tokens (see `dual-account-oauth-apps`), but the bot can't use them — it's stuck with legacy static tokens. The user has no way to write (publish, update, sync) from the bot. The fix copies the already-working MCP pattern to the bot runtime.

## Scope

### In Scope
- Replace `createMlcApiClient({tokenState})` with `createOAuthMlcApiClient({oauthManager, allowedSellerIds})`
- Add `createMlClient({oauthManager})` for write tools (publish, update, sync)
- Wire `oauthManager.close()` in cleanup and bot stop
- Background ingestion uses the same multi-seller OAuth client
- Add migration warning when legacy tokens are set but OAuth is not
- Update `BotConfig` to accept `oauthManager`-backed clients

### Out of Scope
- Conversational context persistence (already works via session store)
- Per-seller Cortex scoping (current behavior preserved)
- UI-based seller selection (by design — natural language only)

## Capabilities

### New Capabilities
- `telegram-bot-multi-seller-auth`: OAuth-backed multi-seller API client for Telegram bot, write tool registration via `createMlClient`, migration warning for legacy env vars

### Modified Capabilities
- `ml-api-integration`: Bot runtime switches from static access token to per-seller OAuth token resolution
- `mercadolibre-account-integration`: Bot respects multi-app OAuth routing from dual-account-oauth-apps

## Approach

Copy the MCP pattern (`packages/mcp/src/runtimeDependencies.ts:168-186`):
1. Call `resolveOAuthConfigs(env)` + `createMultiAppOAuthManager(configs)`
2. Create `mlcClient` via `createOAuthMlcApiClient({oauthManager, transport, now, allowedSellerIds})`
3. Create `mlClient` via `createMlClient({oauthManager, now})` — currently absent in bot
4. Pass both to `AgentLoopConfig`; tools auto-register when clients are present
5. Close `oauthManager` in cleanup + bot stop

Multi-seller UX is already supported: tools accept `sellerId`, LLM resolves it from context ("¿cómo va Plasticov?").

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/bot/src/index.ts` | Modified | Replace legacy token client with OAuth multi-seller client |
| `packages/bot/src/index.ts` | Modified | Add `createMlClient` wiring for write tools |
| `packages/bot/src/index.ts` | Modified | Add migration warning for legacy env vars |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| OAuth DB not shared with MCP | Low | Bot reads same `MSL_MERCADOLIBRE_OAUTH_DB_PATH` — tokens already stored |
| Missing `MSL_ENCRYPTION_KEY` in bot env | Low | Migration warning guides ops; fails clear with actionable error |
| Write tools expose mutations in chat | Low | Agent guardrails (rule #2: "dale" confirmation) unchanged |

## Rollback Plan

1. Restore `createMlcApiClient({tokenState})` block in `createTelegramBotFromEnv`
2. Remove `createMlClient` and `oauthManager` wiring
3. Revert `BotConfig` interface changes
4. Tokens in OAuth DB unaffected — zero data migration to undo

## Dependencies

- `dual-account-oauth-apps` (already delivered): `MultiAppOAuthManager`, per-seller OAuth configs, `MSL_ENCRYPTION_KEY`
- New env vars required: `MERCADOLIBRE_CLIENT_ID`, `MERCADOLIBRE_CLIENT_SECRET`, `MERCADOLIBRE_REDIRECT_URI`, `MSL_MERCADOLIBRE_OAUTH_DB_PATH`, `MSL_ENCRYPTION_KEY`

## Success Criteria

- [ ] Bot creates `mlcClient` via `createOAuthMlcApiClient` with both seller IDs
- [ ] Bot creates `mlClient` via `createMlClient` — write tools registered
- [ ] Legacy `MERCADOLIBRE_ACCESS_TOKEN` env var no longer required
- [ ] Migration warning logged when legacy vars present but OAuth vars missing
- [ ] `oauthManager.close()` called on bot stop and cleanup
- [ ] Background ingestion serves both sellers via same OAuth client
- [ ] Tests pass: `npm test`
