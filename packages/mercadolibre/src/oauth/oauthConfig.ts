import type { OAuthManagerConfig } from "./oauthManager.js";

/**
 * Resolves per-seller OAuth app configurations from environment variables.
 *
 * Hierarchy per seller:
 * 1. `MERCADOLIBRE_{ROLE}_CLIENT_ID/SECRET/REDIRECT_URI` (per-seller)
 * 2. `MERCADOLIBRE_CLIENT_ID/SECRET/REDIRECT_URI` (legacy fallback)
 *
 * Seller IDs come from `MERCADOLIBRE_SOURCE_SELLER_ID` and
 * `MERCADOLIBRE_TARGET_SELLER_ID`.
 *
 * @returns a Map keyed by sellerId where each value is the resolved
 *   OAuthManagerConfig, or an empty Map when no credentials can be resolved.
 */
export function resolveOAuthConfigs(
  env: NodeJS.ProcessEnv,
): ReadonlyMap<string, OAuthManagerConfig> {
  const dbPath = env.MSL_MERCADOLIBRE_OAUTH_DB_PATH;

  const legacyClientId = nonEmpty(env.MERCADOLIBRE_CLIENT_ID);
  const legacyClientSecret = nonEmpty(env.MERCADOLIBRE_CLIENT_SECRET);
  const legacyRedirectUri = nonEmpty(env.MERCADOLIBRE_REDIRECT_URI);

  const sourceSellerId = nonEmpty(env.MERCADOLIBRE_SOURCE_SELLER_ID);
  const targetSellerId = nonEmpty(env.MERCADOLIBRE_TARGET_SELLER_ID);

  const configs = new Map<string, OAuthManagerConfig>();

  function resolveCredential(
    perSeller: string | undefined,
    legacy: string | undefined,
  ): string | undefined {
    return perSeller ?? legacy;
  }

  function tryAddConfig(sellerId: string | undefined, role: string): void {
    if (!sellerId) return;

    const clientId = resolveCredential(
      nonEmpty(env[`MERCADOLIBRE_${role}_CLIENT_ID`]),
      legacyClientId,
    );
    const clientSecret = resolveCredential(
      nonEmpty(env[`MERCADOLIBRE_${role}_CLIENT_SECRET`]),
      legacyClientSecret,
    );
    const redirectUri = resolveCredential(
      nonEmpty(env[`MERCADOLIBRE_${role}_REDIRECT_URI`]),
      legacyRedirectUri,
    );

    if (!clientId || !clientSecret || !redirectUri) return;

    configs.set(sellerId, {
      clientId,
      clientSecret,
      redirectUri,
      ...(dbPath ? { dbPath } : {}),
    });
  }

  tryAddConfig(sourceSellerId, "SOURCE");
  tryAddConfig(targetSellerId, "TARGET");

  return configs;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
