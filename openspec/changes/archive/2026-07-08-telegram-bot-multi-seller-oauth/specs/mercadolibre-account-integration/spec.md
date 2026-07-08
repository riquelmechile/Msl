# Delta for mercadolibre-account-integration

## ADDED Requirements

### Requirement: Bot Multi-App OAuth Routing

The Telegram bot MUST resolve per-seller OAuth configurations via `resolveOAuthConfigs(env)` and create a `MultiAppOAuthManager` via `createMultiAppOAuthManager(configs)`, replicating the MCP pattern. The bot MUST pass both `MERCADOLIBRE_SOURCE_SELLER_ID` and `MERCADOLIBRE_TARGET_SELLER_ID` so both Plasticov and Maustian accounts are usable from chat.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Bot resolves per-seller configs | SOURCE/TARGET_CLIENT_ID env vars set | `resolveOAuthConfigs(env)` called | Plasticov→App A, Maustian→App B configs returned |
| Bot creates multi-app manager | Both configs resolved | `createMultiAppOAuthManager` called | OAuth manager routes per sellerId to correct app credentials |
| Ingestion uses same manager | Bot background ingestion starts | MercadoLibre API calls made | Same `oauthManager` used for both sellers' data ingestion |
