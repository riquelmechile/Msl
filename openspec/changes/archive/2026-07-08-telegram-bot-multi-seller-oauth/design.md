# Design: Telegram Bot Multi-Seller OAuth

## Technical Approach

Replace the legacy single-seller static `MERCADOLIBRE_ACCESS_TOKEN` block (lines 203-225) with the MCP'proven OAuth pattern from `packages/mcp/src/runtimeDependencies.ts:158-192`. The bot creates `resolveOAuthConfigs` → `createMultiAppOAuthManager` → `createOAuthMlcApiClient` + `createMlClient`, then wires both into `AgentLoopConfig`. Multi-seller context is appended to the system prompt so the LLM routes tools to the correct seller ID.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Copy MCP OAuth pattern directly | Same code, no new abstraction | ✅ Chosen — proven, identical behavior |
| Wrap in `BotOAuthFactory` helper | Reuse across bot init paths, added abstraction layer | ❌ YAGNI — bot has single init path |
| Keep `buildSystemPrompt` and extend signature | Cleaner API but changes shared package | ❌ Overkill — append block in bot is minimal |

## Data Flow

```
  env vars ──→ resolveOAuthConfigs ──→ createMultiAppOAuthManager
                                              │
                            ┌─────────────────┤
                            ▼                 ▼
                 createOAuthMlcApiClient   createMlClient
                   (read: fees, catalog)   (write: publish, update)
                            │                 │
                            ▼                 ▼
                      AgentLoopConfig (tools auto-register)
                            │
                            ▼
                    agentLoop.converse()
                            │
              ┌─────────────┤
              ▼             ▼
      mlcClient.getItem  mlClient.publishItem
      (sellerId, ...)    (sellerId, ...)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/bot/src/index.ts` | Modify | Replace import of `createMlcApiClient`/`OAuthTokenState` with OAuth imports; replace client creation block; add multi-seller system prompt block; add migration warning; wire `oauthManager.close()` in cleanup |
| `packages/bot/src/index.ts` | Modify | Remove `mlcSellerId` gate from background ingestion; derive `sellerIds` from `getMlAccountRoleConfig` |

## Key Code Blocks

### 1. OAuth client creation (replaces lines 203-225)

```ts
// ── Multi-seller OAuth clients ─────────────────────────
const oauthDbPath = env.MSL_MERCADOLIBRE_OAUTH_DB_PATH?.trim();

let mlcClient: ReturnType<typeof createOAuthMlcApiClient> | undefined;
let mlClient: ReturnType<typeof createMlClient> | undefined;
let oauthManager: OAuthManager | undefined;

// Migration warning: legacy token present but OAuth not configured
if (env.MERCADOLIBRE_ACCESS_TOKEN?.trim() && !oauthDbPath) {
  console.warn(
    "⚠️  Legacy MERCADOLIBRE_ACCESS_TOKEN is set but MSL_MERCADOLIBRE_OAUTH_DB_PATH is not.\n" +
    "   The bot now uses multi-seller OAuth. Configure MSL_MERCADOLIBRE_OAUTH_DB_PATH,\n" +
    "   MERCADOLIBRE_CLIENT_ID, MERCADOLIBRE_CLIENT_SECRET, MERCADOLIBRE_REDIRECT_URI,\n" +
    "   and MSL_ENCRYPTION_KEY to enable multi-seller OAuth.",
  );
}

if (oauthDbPath) {
  const configs = resolveOAuthConfigs(env);
  oauthManager = createMultiAppOAuthManager(configs);
  const roleConfig = getMlAccountRoleConfig(env);
  const now = () => new Date();

  mlcClient = createOAuthMlcApiClient({
    oauthManager,
    transport: createMercadoLibreApiFetchTransport(),
    now,
    allowedSellerIds: [roleConfig.sourceSellerId, roleConfig.targetSellerId],
  });

  mlClient = createMlClient({ oauthManager, now: new Date() });
}
```

### 2. System prompt — multi-seller context (before `agentConfig`)

```ts
const systemPrompt = (() => {
  const base = buildSystemPrompt(sellerName);
  const roleConfig = oauthManager
    ? getMlAccountRoleConfig(env)
    : undefined;
  if (!roleConfig) return base;

  const sourceName = env.MERCADOLIBRE_SOURCE_SELLER_NAME?.trim() || "Plasticov";
  const targetName = env.MERCADOLIBRE_TARGET_SELLER_NAME?.trim() || "Maustian";

  return (
    base +
    `\n\n## Multi-seller context — NUNCA inventes un sellerId. Usá solo estos:\n` +
    `- ${sourceName}: sellerId = "${roleConfig.sourceSellerId}"\n` +
    `- ${targetName}: sellerId = "${roleConfig.targetSellerId}"`
  );
})();

const agentConfig: BotConfig["agentConfig"] = {
  systemPrompt,
  mockClient: !env.DEEPSEEK_API_KEY?.trim(),
};
```

### 3. Wiring mlClient into agentConfig (after existing `mlcClient` wiring)

```ts
if (mlClient) agentConfig.mlClient = mlClient;
```

### 4. Cleanup chain (replaces the `cleanup` closure)

```ts
botConfig.cleanup = () => {
  db.close();
  operationalDb?.close();
  oauthManager?.close();
};
```

### 5. Background ingestion (replaces lines 272-307)

```ts
let ingestionHandle: { stop: () => void } | undefined;

if (mlcClient && engine) {
  const roleConfig = getMlAccountRoleConfig(env);
  const deepseekApiKey = env.DEEPSEEK_API_KEY?.trim();
  const sellerIds = [roleConfig.sourceSellerId, roleConfig.targetSellerId];
  const sellerNames: Record<string, string> = {
    [roleConfig.sourceSellerId]: env.MERCADOLIBRE_SOURCE_SELLER_NAME?.trim() || "Plasticov",
    [roleConfig.targetSellerId]: env.MERCADOLIBRE_TARGET_SELLER_NAME?.trim() || "Maustian",
  };

  const baseConfig = {
    mlcClient,
    engine,
    sendProactiveMessage: (chatId: number, text: string) =>
      botHandle.sendProactiveMessage(chatId, text),
    listActiveChats: () => botHandle.listActiveChats(),
    sellerIds,
    sellerNames,
    intervalMs: 6 * 60 * 60 * 1000,
    ...(operationalReadModel ? { operationalStore: operationalReadModel } : {}),
  };

  ingestionHandle = startBackgroundIngestion(
    deepseekApiKey ? { ...baseConfig, deepseekApiKey } : baseConfig,
  );
}
```

### 6. Bot stop handler (add `oauthManager?.close()`)

```ts
async stop(): Promise<void> {
  ingestionHandle?.stop();
  await bot.stop();
  config.cleanup?.();
  oauthManager?.close(); // idempotent guard — cleanup also calls it
  console.log("🛑 Bot detenido");
},
```

## Imports (net delta)

```diff
-  createMlcApiClient,
+  createOAuthMlcApiClient,
+  createMlClient,
+  createMultiAppOAuthManager,
+  getMlAccountRoleConfig,
+  resolveOAuthConfigs,
-  type OAuthTokenState,
+  type OAuthManager,
```

## Interfaces / Contracts

No new interfaces. Existing types reused:
- `OAuthManager` from `@msl/mercadolibre` — multi-seller token management
- `createOAuthMlcApiClient` — same signature used in MCP, no change
- `createMlClient` — single-arg `{ oauthManager, now }`, already matches
- `AgentLoopConfig` — already has optional `mlClient` and `mlcClient` fields; tools auto-register
- `BotConfig.cleanup` — already `() => void`, just adds `oauthManager?.close()`

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | OAuth config resolution path | Bot init with mock `resolveOAuthConfigs`; assert clients created with correct seller IDs |
| Unit | Migration warning | Assert `console.warn` called when legacy token set, OAuth DB absent |
| Unit | Demo/mock mode (no OAuth) | Assert bot creates with `mockClient: true`, no crash, no OAuth client |
| Integration | Background ingestion with both sellers | Verify `sellerIds` contains both from `getMlAccountRoleConfig` |

## Migration / Rollout

No data migration. OAuth DB is shared with MCP — tokens already exist at `MSL_MERCADOLIBRE_OAUTH_DB_PATH`.

## Open Questions

None — all wiring mirrors proven MCP patterns.
