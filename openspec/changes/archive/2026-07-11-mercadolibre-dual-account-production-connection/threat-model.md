# Threat Model — MercadoLibre Dual-Account Production Connection

## Assets

| Asset | Value | Exposure |
|-------|-------|----------|
| OAuth access tokens | Full read access to ML seller data | Encrypted at rest (AES-256-GCM), in-memory only during request |
| OAuth refresh tokens | Long-lived, enables token rotation | Encrypted at rest, same protection as access tokens |
| `MSL_ENCRYPTION_KEY` | Decrypts all stored tokens | Single env var, never persisted to disk unencrypted |
| OAuth client secrets | App identity for token exchange | Env vars only, never in code or logs |
| Seller IDs | Account identity (Plasticov, Maustian) | Low sensitivity but needed for account isolation |

## Threat Scenarios

### T1: Token exfiltration from SQLite database
- **Risk**: Attacker with filesystem access reads `MSL_MERCADOLIBRE_OAUTH_DB_PATH`
- **Mitigation**: AES-256-GCM encryption with `MSL_ENCRYPTION_KEY`. Without the key, tokens are ciphertext.
- **Residual**: If the attacker also has `MSL_ENCRYPTION_KEY` (e.g., env leak), tokens are decryptable. Defense in depth: restrict DB file permissions (0600).

### T2: Token logged accidentally
- **Risk**: Access token appears in structured logs or error messages
- **Mitigation**: `sanitizeContext()` in observability pipeline redacts credential-like patterns. Health service output excludes token fields explicitly (`noExternalMutationExecuted: true` enforces sanitized output).
- **Residual**: Raw API error responses could contain tokens in error bodies. All API clients use token in `Authorization` header only, never in URL params.

### T3: Cross-seller token confusion
- **Risk**: Plasticov's token used for Maustian API calls (or vice versa)
- **Mitigation**: `MercadoLibreRefreshError` with `seller_mismatch` reason code. `ensureValidToken()` validates `user_id` matches expected seller. Token store is keyed by seller ID binding.
- **Residual**: Manual DB corruption could swap tokens. Per-seller ID verification at API call time catches this.

### T4: Replay of OAuth authorization code
- **Risk**: Attacker replays captured authorization code to obtain tokens
- **Mitigation**: HMAC-signed OAuth state parameter (`MSL_OAUTH_STATE_SECRET`). One-time use. Short TTL (10 minutes).
- **Residual**: If `MSL_OAUTH_STATE_SECRET` is weak, state forgery is possible. Use strong random value.

### T5: Write mutation despite read-only policy
- **Risk**: Code path accidentally enables write operations
- **Mitigation**: `assertMercadoLibreWriteDisabled()` runtime gate throws `MercadoLibreWriteBlockedError` for all write operations. Gate is enforced at every write entry point.
- **Residual**: Manual bypass of the gate in code. Code review protects against this.

### T6: Denial of service via smoke test abuse
- **Risk**: `run_mercadolibre_read_smoke` called repeatedly, exhausting rate limits
- **Mitigation**: Tool description warns "DO NOT run automatically — only when explicitly requested by the CEO". Rate limits enforced by MercadoLibre API (per-app quotas).
- **Residual**: No client-side rate limiting. Rely on ML API quotas and CEO discipline.

## Accepted Risks

- **Per-process mutex only**: `withLock` in TokenStore is per-process. Multiple PM2 processes refreshing the same seller simultaneously is a race condition. Mitigation: coordinate refreshes operationally.
- **No HSM**: Encryption key is an env var, not a hardware security module. Acceptable for current scale.
- **No audit log for token access**: Token reads are not individually logged. Health events log statuses only.
