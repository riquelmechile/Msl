# Deploy MSL on a Single Vultr VPS

This is the minimal production path for running the Telegram bot and Next.js web app on one
Vultr São Paulo VPS without committing secrets.

## Quick path

1. Provision Ubuntu 22.04 or 24.04 on Vultr São Paulo.
2. Install Node.js 22+, npm 10+, Git, and PM2.
3. Clone the repo, run `npm ci`, then `npm run build`.
4. Copy production secrets into `.env.local` on the VPS only.
5. Create `/home/sebastian/msl-data/logs`, copy the local SQLite databases into
   `/home/sebastian/msl-data`, then start PM2 with `npm run pm2:start`.
6. Point Cloudflare DNS for `plasticov.cl` to the VPS and place a reverse proxy in front of
   `127.0.0.1:3000`.

## Runtime layout

| Path                                              | Purpose                                                      |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `/home/sebastian/code/Msl` or `$MSL_APP_DIR`      | Repository checkout.                                         |
| `/home/sebastian/msl-data` or `$MSL_DATA_DIR`     | Durable SQLite databases and operational data.               |
| `/home/sebastian/msl-data/logs` or `$MSL_LOG_DIR` | PM2 stdout/stderr logs.                                      |
| `.env.local`                                      | VPS-only secrets. Never commit or paste this file into chat. |

## PM2 processes

`ecosystem.config.cjs` defines two production processes:

| Process            | Command                      | Notes                                                |
| ------------------ | ---------------------------- | ---------------------------------------------------- |
| `msl-telegram-bot` | `node scripts/start-bot.mjs` | Long-polling Telegram runtime. Requires `BOT_TOKEN`. |
| `msl-web`          | `next start` via PM2         | Next.js app bound to `127.0.0.1:3000` by default.    |

MCP remains a local stdio tool. Do not daemonize it unless a real remote MCP client needs it.

## Secrets checklist

- [ ] Copy `.env.example` to `.env.local` on the VPS.
- [ ] Set `BOT_TOKEN` from BotFather.
- [ ] Set `DEEPSEEK_API_KEY` if the bot should use the real LLM client.
- [ ] Set `MSL_ENCRYPTION_KEY` to a long random value before using OAuth tokens.
- [ ] Set MercadoLibre OAuth app credentials and seller ids for Plasticov/Maustian.
- [ ] Point SQLite env paths to `/home/sebastian/msl-data/*.sqlite`.
- [ ] Keep `MSL_ALLOW_INSECURE_DEV_SECRETS` and `MSL_ALLOW_UNAUTHENTICATED_LOCAL` disabled in
      production.

## Database copy checklist

- [ ] Stop local writes before copying SQLite files.
- [ ] Copy only database files needed by the runtime into `/home/sebastian/msl-data`.
- [ ] Preserve file ownership for the VPS user that runs PM2.
- [ ] Confirm `.env.local` paths match the copied filenames.
- [ ] Keep a backup copy before the first PM2 start.

## Start and verify

```bash
npm ci
npm run build
mkdir -p /home/sebastian/msl-data/logs
npm run pm2:start
pm2 status
pm2 logs msl-telegram-bot --lines 50
pm2 logs msl-web --lines 50
curl -I http://127.0.0.1:3000
```

Expected result: PM2 shows both processes online, the bot logs do not report missing `BOT_TOKEN`,
and the web app returns an HTTP response locally.

## Cloudflare checklist

- [ ] Create an `A` record for `plasticov.cl` pointing to the Vultr IPv4 address.
- [ ] Create `www` as `CNAME plasticov.cl` if needed.
- [ ] Enable proxy only after the local reverse proxy is serving HTTP/HTTPS correctly.
- [ ] Keep TLS mode compatible with the VPS reverse proxy certificate.

## Rollback

1. Run `pm2 stop msl-telegram-bot msl-web`.
2. Restore the previous repo checkout or deployment directory.
3. Restore the previous SQLite backup if the new runtime wrote bad state.
4. Run `npm ci && npm run build && npm run pm2:start` from the restored checkout.
5. If DNS was changed, revert the Cloudflare records to the previous target.
