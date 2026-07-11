# Recovery Runbook — MercadoLibre Dual-Account Connection

## Quick Reference

| Symptom | Health Status | Recovery |
|---------|--------------|----------|
| Token expired | `degraded` (token_expired) | `npm run meli:refresh -- --seller <id>` |
| Token about to expire | `degraded` (token_expiring) | `npm run meli:refresh -- --seller <id>` |
| Refresh rejected | `reauthorization-required` | Re-authorize (see below) |
| Decryption failed | `blocked` (decryption_failed) | Check `MSL_ENCRYPTION_KEY`, re-authorize |
| Store unavailable | `blocked` (store_unavailable) | Check `MSL_MERCADOLIBRE_OAUTH_DB_PATH` |
| Network error | `degraded` (network_error) | Check connectivity, retry |
| Seller mismatch | `blocked` (seller_mismatch) | Verify `MERCADOLIBRE_*_SELLER_ID` env vars |
| Rate limited | `degraded` (rate_limited) | Wait, reduce request frequency |

## Procedure 1: Token Refresh

```bash
# Check current status
npm run meli:connection:status

# Refresh specific seller
npm run meli:refresh -- --seller source

# Verify
npm run meli:connection:status
npm run meli:smoke -- --seller source
```

If refresh fails with `invalid_grant`, proceed to Procedure 2.

## Procedure 2: Re-Authorization

When refresh tokens are rejected (status: `reauthorization-required`):

1. **Generate authorization URL**:
   ```bash
   npm run meli:connect:url -- --seller source
   ```

2. **Open the URL in a browser** and authorize the application. Ensure you're logged into the correct MercadoLibre account (Plasticov or Maustian).

3. **Complete the OAuth callback**: The callback endpoint (`/api/meli/callback`) exchanges the authorization code for new tokens and stores them encrypted.

4. **Verify the new tokens work**:
   ```bash
   npm run meli:smoke -- --seller source
   ```

5. **Repeat for the other seller** if needed:
   ```bash
   npm run meli:connect:url -- --seller target
   npm run meli:smoke -- --seller target
   ```

## Procedure 3: Encryption Key Issues

If tokens cannot be decrypted (status: `blocked`, reason: `decryption_failed`):

1. **Check the encryption key**:
   ```bash
   # Verify MSL_ENCRYPTION_KEY is set and matches what was used to encrypt
   echo $MSL_ENCRYPTION_KEY | head -c 8  # Show first 8 chars only
   ```

2. **If the key was changed**: The old tokens are permanently unreadable.
   - Delete the OAuth database: `rm $MSL_MERCADOLIBRE_OAUTH_DB_PATH`
   - Re-authorize both sellers (Procedure 2)

3. **If the key is correct but tokens still fail**: Database corruption. Restore from backup or delete and re-authorize.

## Procedure 4: Network Issues

1. **Check API reachability**:
   ```bash
   curl -I https://api.mercadolibre.com/
   ```

2. **Check DNS resolution**:
   ```bash
   nslookup api.mercadolibre.com
   ```

3. **Check firewall rules**: Ensure outbound HTTPS (port 443) is allowed.

4. **Retry**: Network errors are often transient. The health service reports `degraded` for network errors — retry after a few minutes.

## Procedure 5: Database Corruption

If the OAuth database is corrupted:

1. **Stop all MSL processes**: `pm2 stop all`
2. **Backup the corrupted file**: `cp $MSL_MERCADOLIBRE_OAUTH_DB_PATH /tmp/oauth.db.bak`
3. **Delete and re-create**: `rm $MSL_MERCADOLIBRE_OAUTH_DB_PATH`
4. **Restart processes**: `pm2 start all`
5. **Re-authorize both sellers** (Procedure 2)

## Monitoring

Run periodic health checks to catch issues before they become critical:

```bash
# Daily health check (add to crontab)
0 9 * * * cd /home/sebastian/code/Msl && npm run meli:connection:status -- --json >> /var/log/msl/health.log
```

## Escalation

If all recovery procedures fail:
1. Verify MercadoLibre API status at https://developers.mercadolibre.com/
2. Check MercadoLibre app registration in Developer Dashboard
3. Verify OAuth redirect URI is correctly configured (must match exactly)
4. Check `MSL_OAUTH_STATE_SECRET` is consistent across restarts
