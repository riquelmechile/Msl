# Delta for ml-api-integration

## ADDED Requirements

### Requirement: Telegram Bot Runtime Integration

The Telegram bot runtime MUST create its ML API clients through the multi-seller OAuth infrastructure (`createOAuthMlcApiClient`, `createMlClient`) instead of `createMlcApiClient({tokenState})`. The bot MUST wire `mlClient` into agent tool registration so write tools (publish, update, sync) are available from chat.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Bot reads via OAuth MLC client | OAuth tokens valid for both sellers | Bot queries MercadoLibre | `mlcClient.getItem()` uses per-seller token resolution |
| Bot registers write tools | `mlClient` created via `createMlClient` | Agent loop initializes | Publish, update, and sync tools available in chat |
| Write respects seller context | User says "publicá en Maustian" | Write tool called | `sellerId` resolved to Maustian; API call uses correct token |
| Legacy static token bypassed | OAuth env vars configured | Bot starts | `createMlcApiClient({tokenState})` NOT called; zero legacy token usage |
