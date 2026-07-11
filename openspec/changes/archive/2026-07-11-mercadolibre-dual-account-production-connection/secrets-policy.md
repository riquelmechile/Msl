# Secrets Policy — MercadoLibre Dual-Account Production Connection

## Classification

### Category 1: Cryptographic Secrets
- `MSL_ENCRYPTION_KEY` — AES-256-GCM key for token encryption
- `MSL_OAUTH_STATE_SECRET` — HMAC key for OAuth state signing

**Handling**: Set once, never rotated without re-authorization. Stored as env var. Never in code, never in logs, never in version control.

### Category 2: OAuth Credentials
- `MERCADOLIBRE_SOURCE_CLIENT_ID` / `MERCADOLIBRE_SOURCE_CLIENT_SECRET`
- `MERCADOLIBRE_TARGET_CLIENT_ID` / `MERCADOLIBRE_TARGET_CLIENT_SECRET`
- `MERCADOLIBRE_SOURCE_REDIRECT_URI` / `MERCADOLIBRE_TARGET_REDIRECT_URI`

**Handling**: Registered in MercadoLibre Developer Dashboard. Stored as env vars. Client IDs are low-sensitivity (public in OAuth URLs). Client secrets are high-sensitivity — never exposed.

### Category 3: Account Identifiers
- `MERCADOLIBRE_SOURCE_SELLER_ID` / `MERCADOLIBRE_TARGET_SELLER_ID`

**Handling**: Low-sensitivity. Used for routing, not authentication. Can appear in structured output for operational visibility.

### Category 4: Derived Tokens
- Access tokens (in-memory only, never persisted in plaintext)
- Refresh tokens (encrypted in SQLite, decrypted on demand)

**Handling**: Never logged. Never serialized. Sanitized from all structured output. `noExternalMutationExecuted: true` enforced on all health and inspection tools.

## Rules

1. **Never commit secrets**: `.env.local` is `.gitignore`d. `.env.example` contains only placeholder names, never real values.
2. **Sanitize all output**: `connectionTools.ts` defense-in-depth sanitization layer strips token-related fields. `sanitizeContext()` in observability pipeline redacts credential-like patterns.
3. **Encrypt at rest**: All tokens in SQLite are AES-256-GCM encrypted. Without `MSL_ENCRYPTION_KEY`, the DB file is ciphertext.
4. **Minimize in-memory exposure**: Tokens are decrypted per-request, used, and discarded. Not cached in global state.
5. **Fail closed**: If `MSL_ENCRYPTION_KEY` is missing in production, startup fails with a clear error. `MSL_ALLOW_INSECURE_DEV_SECRETS` is for local development only.
6. **Rotate on breach**: If a secret is compromised, rotate the corresponding MercadoLibre OAuth app credentials and generate new `MSL_ENCRYPTION_KEY`. Re-authorize all accounts.

## Environment Injection

Secrets are injected via:
- **VPS**: `.env.local` file in monorepo root, loaded by `loadRepositoryEnvironment()`
- **CI**: GitHub Actions secrets → workflow env vars, `MSL_SKIP_ENV_FILE=true`
- **Docker**: `--env-file` or orchestrator secret injection

Pre-existing `process.env` values (from PM2, Docker, systemd) are never overwritten.
