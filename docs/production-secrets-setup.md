# Production Secrets Setup

How to configure production secrets for MSL deployment on GitHub Actions and VPS.

## GitHub Secrets (Required)

Secrets are set via the GitHub repository UI:

**Settings → Secrets and variables → Actions → New repository secret**

> ⚠️ **WARNING**: Never commit `.env`, never paste secrets in issues, PRs, or chat.
> Secrets are encrypted at rest and only exposed to workflow runs.

## Complete Secrets Table

| Secret                             | Required | Where Used                             | Secure Example                                    |
| ---------------------------------- | -------- | -------------------------------------- | ------------------------------------------------- |
| `DEEPSEEK_API_KEY`                 | ✅       | LLM inference (DeepSeek)               | `sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`             |
| `DEEPSEEK_BASE_URL`                | —        | DeepSeek API endpoint override         | `https://api.deepseek.com` (default)              |
| `DEEPSEEK_MODEL`                   | —        | Model selection for inference          | `deepseek-v4-flash`                               |
| `MINIMAX_API_KEY`                  | ✅¹      | Creative Studio image/video generation | `eyJhbG...`                                       |
| `MINIMAX_API_HOST`                 | —        | MiniMax API host override              | `https://api.minimaxi.com` (default)              |
| `MERCADOLIBRE_CLIENT_ID`           | ✅¹      | MercadoLibre OAuth application         | `1234567890123456`                                |
| `MERCADOLIBRE_CLIENT_SECRET`       | ✅¹      | MercadoLibre OAuth secret              | `aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789`            |
| `MERCADOLIBRE_REDIRECT_URI`        | ✅¹      | OAuth callback URL                     | `https://yourdomain.com/oauth/callback`           |
| `MERCADOLIBRE_SOURCE_CLIENT_ID`    | ✅²      | Plasticov OAuth app ID (dual-account)  | `1234567890123456`                                |
| `MERCADOLIBRE_SOURCE_CLIENT_SECRET`| ✅²      | Plasticov OAuth app secret             | `aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789`            |
| `MERCADOLIBRE_SOURCE_REDIRECT_URI` | ✅²      | Plasticov OAuth callback URL           | `https://yourdomain.com/oauth/callback`           |
| `MERCADOLIBRE_TARGET_CLIENT_ID`    | ✅²      | Maustian OAuth app ID (dual-account)   | `1234567890123456`                                |
| `MERCADOLIBRE_TARGET_CLIENT_SECRET`| ✅²      | Maustian OAuth app secret              | `aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789`            |
| `MERCADOLIBRE_TARGET_REDIRECT_URI` | ✅²      | Maustian OAuth callback URL            | `https://yourdomain.com/oauth/callback`           |
| `MERCADOLIBRE_SOURCE_SELLER_ID`    | ✅²      | Plasticov MercadoLibre user ID         | `123456789`                                       |
| `MERCADOLIBRE_TARGET_SELLER_ID`    | ✅²      | Maustian MercadoLibre user ID          | `987654321`                                       |
| `MERCADOLIBRE_ACCESS_TOKEN`        | —        | Legacy single-seller access token      | `APP_USR-1234567890-abcdef`                       |
| `BOT_TOKEN`                        | ✅       | Telegram bot authentication            | `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`           |
| `MSL_TELEGRAM_ADMIN_CHAT_IDS`      | ✅       | Telegram admin chat allowlist          | `12345678,87654321`                               |
| `MSL_APPROVAL_QUEUE_DB_PATH`       | ✅       | SQLite path for MCP approval queue     | `/home/sebastian/msl-data/approval-queue.db`      |
| `MSL_CHAT_SQLITE_PATH`             | —        | SQLite path for chat persistence       | `/home/sebastian/msl-data/chat.db`                |
| `MSL_CREATIVE_STUDIO_STORAGE_PATH` | ✅¹      | Creative asset download path           | `/home/sebastian/msl-data/creative-studio/assets` |
| `MSL_RUNTIME_MODE`                 | ✅       | Runtime mode selector                  | `production`                                      |
| `MSL_CREATIVE_STUDIO_ENABLED`      | ✅       | Enable Creative Studio agent           | `true`                                            |

**Notes:**

- ¹ At least one OAuth config is required: either the legacy `MERCADOLIBRE_CLIENT_ID`/`CLIENT_SECRET`/`REDIRECT_URI` triplet, or the per-seller dual-account vars.
- ² Required for dual-account OAuth (Plasticov and Maustian). Must be paired: source vars for Plasticov, target vars for Maustian. Per-seller OAuth takes priority over the legacy single-app config.

### Additional Secrets (Optional)

These provide enhanced functionality but are not required for production:

| Secret                           | Where Used                          |
| -------------------------------- | ----------------------------------- |
| `MSL_API_KEY`                    | Web `/api/chat` bearer auth         |
| `MSL_CONVERSATION_ACCESS_TOKEN`  | `/conversacion` browser access      |
| `MSL_ENCRYPTION_KEY`             | OAuth token encryption at rest      |
| `MSL_OAUTH_STATE_SECRET`         | HMAC signing for OAuth state        |
| `MSL_MERCADOLIBRE_OAUTH_DB_PATH` | OAuth token store for MCP runtime   |
| `MSL_TELEGRAM_SQLITE_PATH`       | Telegram session persistence        |
| `MSL_CORTEX_SQLITE_PATH`         | Cortex graph database               |
| `MSL_MCP_API_KEY`                | MCP server API key                  |
| `MSL_SUPPLIER_MIRROR_DB_PATH`    | Supplier Mirror SQLite              |
| `ML_API_TOKEN`                   | MercadoLibre ML diagnosis API token |
| `MINIMAX_IMAGE_MODEL`            | MiniMax image model override        |
| `MINIMAX_VIDEO_MODEL`            | MiniMax video model override        |

## Activation Order

Follow these steps in order to safely activate production:

1. **Add all secrets to GitHub** — Settings → Secrets and variables → Actions
2. **Run Production Readiness workflow** — Actions → Production Readiness → Run workflow
3. **Run Provider Smoke Tests (DeepSeek)**
   ```bash
   npm run smoke:deepseek:tool
   ```
4. **Run Provider Smoke Tests (MiniMax)** — verify Creative Studio generation works
5. **Run MercadoLibre Connection Health**
   ```bash
   npm run meli:connection:status
   npm run meli:smoke -- --seller source
   npm run meli:smoke -- --seller target
   ```
6. **Activate bot/daemon on VPS** — only after all checks pass
   ```bash
   npm run pm2:start
   ```

## Local Commands

Run these on your machine or VPS before deploying:

```bash
# 1. Create your local .env from the example
cp .env.example .env

# 2. Create .env.local with production secrets
#    (this file is gitignored — never commit it)
touch .env.local

# 3. Fill in real secret values in .env.local
#    The shared env loader loads .env then .env.local from the monorepo root.
#    No symlink for apps/web/.env.local is needed — instrumentation.ts
#    calls loadRepositoryEnvironment() at Next.js server startup.

# 4. Check production secrets
npm run check:production-secrets

# 5. Build the project
npm run build

# 6. Run end-to-end tests
npm run test:e2e
```

## Final Checklist

Before considering production ACTIVE:

- [ ] CI pipeline green (format, typecheck, lint, unit tests, build)
- [ ] Production Readiness workflow green (secrets present)
- [ ] Provider smoke tests pass (DeepSeek, MiniMax)
- [ ] Telegram bot starts without errors
- [ ] Daemon scheduler starts without errors
- [ ] No secrets appear in logs (all API keys masked)
- [ ] VPS firewall and SSH configured
- [ ] PM2 auto-start configured
