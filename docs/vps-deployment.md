# Deploy MSL on a Single Vultr VPS

This is the minimal production path for running the Telegram bot and Next.js web app on one
Vultr São Paulo VPS without committing secrets.

## Current state

Only the domain has been purchased. There is no VPS host yet, so there is no production PM2 process
to restart and no server IP for final DNS records.

What can be done before buying the VPS:

- Keep the Telegram bot running from local/Termux for temporary testing. Long polling does not require
  the domain.
- Keep `plasticov.cl` parked at the registrar or Cloudflare.
- Prepare DNS records, environment variable names, and deployment steps without adding secret values to
  Git or chat.

What must wait until the VPS exists:

- The final `A` record target, because it needs the VPS IPv4 address.
- PM2 process startup/restart.
- Nginx reverse proxy validation.
- TLS certificate issuance for the origin server.

## Quick path

1. Put `plasticov.cl` under Cloudflare DNS or confirm where DNS will be managed.
2. Provision Ubuntu 22.04 or 24.04 on Vultr São Paulo.
3. Create a non-root deploy user and copy/run the bootstrap script to install system packages,
   Node.js 22, PM2, Nginx, and
   runtime directories.
4. Clone the repo, create `.env.local` on the VPS only, and copy SQLite databases securely.
   The shared `loadRepositoryEnvironment()` finds the repo root automatically — no symlink needed.
5. Run `npm ci`, `npm run build`, `npm run pm2:start`, `pm2 save`, and `pm2 startup`.
6. Point Cloudflare DNS for `plasticov.cl` to the VPS and place a reverse proxy in front of
   `127.0.0.1:3000`.

## Domain and DNS plan

Use the domain as the public entry point for the web app and OAuth callback. The Telegram bot can stay
on long polling behind PM2 and does not need a webhook or DNS record.

| Record         | Type    | Target before VPS       | Target after VPS exists  | Proxy          | Purpose                                    |
| -------------- | ------- | ----------------------- | ------------------------ | -------------- | ------------------------------------------ |
| `plasticov.cl` | `A`     | Parked/no final target  | Vultr public IPv4        | DNS-only first | Public web app and OAuth origin.           |
| `www`          | `CNAME` | `plasticov.cl` if ready | `plasticov.cl`           | DNS-only first | Optional browser-friendly alias.           |
| `api`          | `CNAME` | Do not create yet       | Optional: `plasticov.cl` | DNS-only first | Reserve only if API split is needed later. |

Start with Cloudflare proxy disabled while Nginx and TLS are being validated. After HTTPS works from
the VPS origin, enable the proxy and use a TLS mode that validates the origin certificate.

### Domain-only checklist

- [ ] Confirm the domain registrar points nameservers to Cloudflare, or keep DNS at the registrar until
      the VPS is purchased.
- [ ] Do not point the root domain to a random or temporary IP.
- [ ] Keep the Telegram bot on local/Termux if temporary testing is needed; domain DNS is not required
      for long polling.
- [ ] Decide the production hostname for MercadoLibre OAuth redirect URLs, for example
      `https://plasticov.cl/api/meli/callback` if that route is the deployed callback.
- [ ] Do not paste BotFather tokens, MercadoLibre credentials, OAuth tokens, or `.env.local` contents
      into DNS notes, docs, issues, or chat.

### First hour after buying the VPS

1. Create the VPS in São Paulo with Ubuntu 22.04 or 24.04.
2. Record the VPS IPv4 address in a private deployment note, not in Git unless intentionally documenting
   a public server address.
3. SSH in, create or use the non-root deploy user, and run `scripts/vps-bootstrap.sh`.
4. Clone the repository into `$MSL_APP_DIR`.
5. Create `.env.local` on the VPS only.
6. Copy SQLite databases into `$MSL_DATA_DIR` only after stopping local writers.
7. Run the build and PM2 start commands from this guide.
8. Add the Cloudflare `A` record to the VPS IPv4 with proxy disabled.
9. Configure Nginx, issue TLS, verify `https://plasticov.cl`, then enable Cloudflare proxy.

## Bootstrap a fresh VPS

Run the helper on the VPS as the user that will operate the app. If the repository is not cloned
yet, copy only `scripts/vps-bootstrap.sh` to the VPS first, run it, and then clone the full repo into
the app directory. The script is safe to re-run: it verifies Ubuntu, installs missing packages,
keeps secrets out of output, and recreates directories without deleting data.

Do not run the app as `root`. If the VPS starts with only root access, create a non-root deploy user
first and pass it through `MSL_DEPLOY_USER`.

```bash
# From a cloned checkout:
bash scripts/vps-bootstrap.sh

# Optional overrides:
MSL_DEPLOY_USER=deploy \
MSL_APP_DIR=/home/deploy/code/Msl \
MSL_DATA_DIR=/home/deploy/msl-data \
bash scripts/vps-bootstrap.sh
```

For safety, `MSL_APP_DIR`, `MSL_DATA_DIR`, and `MSL_LOG_DIR` must live under
`/home/<deploy-user>/`. The script refuses broad paths such as `/`, `/home`, or `/home/<user>`.

The script installs or verifies:

| Component                | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| Node.js 22.x and npm     | Runtime and package manager required by `package.json` engines.         |
| PM2                      | Process supervisor for the Telegram bot and Next.js web app.            |
| Git, build tools, SQLite | Repository checkout, native dependency builds, and database inspection. |
| Nginx and UFW            | Reverse proxy and firewall foundation. Configuration remains manual.    |

The script does not clone private repositories, copy `.env.local`, copy SQLite files, configure DNS,
or start PM2 processes.

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
  - `MERCADOLIBRE_SOURCE_CLIENT_ID`, `MERCADOLIBRE_SOURCE_CLIENT_SECRET`, `MERCADOLIBRE_SOURCE_REDIRECT_URI`
  - `MERCADOLIBRE_TARGET_CLIENT_ID`, `MERCADOLIBRE_TARGET_CLIENT_SECRET`, `MERCADOLIBRE_TARGET_REDIRECT_URI`
  - `MERCADOLIBRE_SOURCE_SELLER_ID`, `MERCADOLIBRE_TARGET_SELLER_ID`
  - `MSL_OAUTH_STATE_SECRET`
  - `MSL_MERCADOLIBRE_OAUTH_DB_PATH`
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
cd /home/sebastian/code/Msl
npm ci
npm run build
npm run pm2:start
pm2 status
pm2 logs msl-telegram-bot --lines 50
pm2 logs msl-web --lines 50
curl -I http://127.0.0.1:3000
pm2 save
pm2 startup systemd -u sebastian --hp /home/sebastian
```

Expected result: PM2 shows both processes online, the bot logs do not report missing `BOT_TOKEN`,
and the web app returns an HTTP response locally.

`pm2 startup` prints one final command that may require `sudo`; run that exact command on the VPS.

## Cloudflare checklist

- [ ] Create an `A` record for `plasticov.cl` pointing to the Vultr IPv4 address.
- [ ] Create `www` as `CNAME plasticov.cl` if needed.
- [ ] Enable proxy only after the local reverse proxy is serving HTTP/HTTPS correctly.
- [ ] Keep TLS mode compatible with the VPS reverse proxy certificate.

## Nginx and TLS notes

Before enabling UFW, explicitly allow SSH so the VPS does not lock you out:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

If the VPS uses a custom SSH port, allow that exact port before enabling UFW.

Keep Next.js bound to `127.0.0.1:3000` and let Nginx expose HTTP/HTTPS publicly. A minimal server
block should proxy `plasticov.cl` and `www.plasticov.cl` to `http://127.0.0.1:3000`, preserve the
`Host` header, and set `X-Forwarded-For` / `X-Forwarded-Proto`.

Recommended TLS path:

1. Create the Cloudflare DNS record with proxy disabled first.
2. Install a certificate on the VPS, for example with Certbot for Nginx.
3. Confirm `https://plasticov.cl` reaches the web app.
4. Enable Cloudflare proxy and use a TLS mode that validates the origin certificate.

## Rollback

1. Run `pm2 stop msl-telegram-bot msl-web`.
2. Restore the previous repo checkout or deployment directory.
3. Restore the previous SQLite backup if the new runtime wrote bad state.
4. Run `npm ci && npm run build && npm run pm2:start` from the restored checkout.
5. If DNS was changed, revert the Cloudflare records to the previous target.
