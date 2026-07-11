import { createReadinessCheckResult } from "./types.js";
import type { ReadinessCheckResult, OAuthReadiness, EncryptionReadiness } from "./types.js";
import type { ReadinessContext } from "./types.js";

const CHECK_PREFIX = "seller";

export type SellerCheckResult = {
  sellerId: string;
  accountName: string;
  checks: ReadinessCheckResult[];
  oauth: OAuthReadiness;
  encryption: EncryptionReadiness;
};

export function checkSellerAccountReadiness(ctx: ReadinessContext): ReadinessCheckResult[] {
  const results: ReadinessCheckResult[] = [];
  const { env } = ctx;

  const sellerIds = new Set(["plasticov", "maustian"]);

  for (const sellerId of sellerIds) {
    const accountName = sellerId === "plasticov" ? "Plasticov" : "Maustian";
    const prefix = sellerId === "plasticov" ? "SOURCE" : "TARGET";

    // ── Seller ID ──────────────────────────────────────────────────
    const sellerIdVar = sellerId === "plasticov" ? "MERCADOLIBRE_SOURCE_SELLER_ID" : "MERCADOLIBRE_TARGET_SELLER_ID";
    const sellerIdValue = env[sellerIdVar];

    if (!sellerIdValue || sellerIdValue.trim() === "") {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${sellerId}-id`,
          capability: sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
          status: "blocked",
          sellerId,
          safeMessage: `${sellerIdVar} is not set — ${accountName} identity is unknown.`,
          remediation: `Set ${sellerIdVar} to ${accountName}'s MercadoLibre user ID.`,
        }),
      );
    } else {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${sellerId}-id`,
          capability: sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
          status: "ready",
          sellerId,
          safeMessage: `${accountName} seller ID is configured.`,
          remediation: "Seller identity is present.",
        }),
      );
    }

    // ── OAuth check ───────────────────────────────────────────────
    const clientIdVar = `MERCADOLIBRE_${prefix}_CLIENT_ID`;
    const clientSecretVar = `MERCADOLIBRE_${prefix}_CLIENT_SECRET`;
    const redirectUriVar = `MERCADOLIBRE_${prefix}_REDIRECT_URI`;

    const clientId = env[clientIdVar];
    const clientSecret = env[clientSecretVar];
    const redirectUri = env[redirectUriVar];

    const hasClientId = !!(clientId && clientId.trim() !== "");
    const hasClientSecret = !!(clientSecret && clientSecret.trim() !== "");
    const hasRedirectUri = !!(redirectUri && redirectUri.trim() !== "");
    const configured = hasClientId && hasClientSecret && hasRedirectUri;
    const isPlaceholder =
      (hasClientId && /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(clientId.trim())) ||
      (hasClientSecret && /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(clientSecret.trim()));

    if (configured && !isPlaceholder) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${sellerId}-oauth`,
          capability: sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
          status: "ready",
          sellerId,
          safeMessage: `${accountName} OAuth is fully configured.`,
          remediation: "OAuth configuration complete.",
        }),
      );
    } else if (configured && isPlaceholder) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${sellerId}-oauth`,
          capability: sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
          status: "blocked",
          sellerId,
          safeMessage: `${accountName} OAuth credentials appear to be placeholders.`,
          remediation: `Replace placeholder values for ${clientIdVar}, ${clientSecretVar}.`,
        }),
      );
    } else {
      const missing: string[] = [];
      if (!hasClientId) missing.push(clientIdVar);
      if (!hasClientSecret) missing.push(clientSecretVar);
      if (!hasRedirectUri) missing.push(redirectUriVar);

      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${sellerId}-oauth`,
          capability: sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
          status: "blocked",
          sellerId,
          safeMessage: `${accountName} OAuth is incomplete: ${missing.join(", ")} not set.`,
          remediation: `Set ${missing.join(", ")} for ${accountName}'s OAuth application.`,
        }),
      );
    }

    // ── Cross-binding validation ───────────────────────────────────
    const sourceSellerId = env.MERCADOLIBRE_SOURCE_SELLER_ID;
    const targetSellerId = env.MERCADOLIBRE_TARGET_SELLER_ID;
    if (sourceSellerId && targetSellerId && sourceSellerId.trim() === targetSellerId.trim()) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${sellerId}-cross-binding`,
          capability: sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
          status: "blocked",
          sellerId,
          safeMessage: `MERCADOLIBRE_SOURCE_SELLER_ID and MERCADOLIBRE_TARGET_SELLER_ID are identical — cross-binding detected.`,
          remediation: "Source and target seller IDs must be different accounts.",
        }),
      );
    }
  }

  // ── Encryption readiness ────────────────────────────────────────
  const encKey = env.MSL_ENCRYPTION_KEY;
  const hasEncKey = !!(encKey && encKey.trim() !== "");
  const isEncPlaceholder = hasEncKey && /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(encKey.trim());
  const isInsecureFb = !!env.MSL_ALLOW_INSECURE_DEV_SECRETS && env.MSL_ALLOW_INSECURE_DEV_SECRETS.trim().toLowerCase() === "true";

  if (hasEncKey && !isEncPlaceholder) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-encryption`,
        capability: "mercadolibre-read-plasticov",
        status: "ready",
        safeMessage: "MSL_ENCRYPTION_KEY is present and not a placeholder.",
        remediation: "Encryption key configured.",
      }),
    );
  } else if (hasEncKey && isEncPlaceholder) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-encryption`,
        capability: "mercadolibre-read-plasticov",
        status: "blocked",
        safeMessage: "MSL_ENCRYPTION_KEY is a placeholder value.",
        remediation: "Set MSL_ENCRYPTION_KEY to a real random value.",
      }),
    );
  } else if (isInsecureFb) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-encryption`,
        capability: "mercadolibre-read-plasticov",
        status: "degraded",
        safeMessage: "MSL_ENCRYPTION_KEY is missing but MSL_ALLOW_INSECURE_DEV_SECRETS is enabled.",
        remediation: "This is acceptable for dev only. Set MSL_ENCRYPTION_KEY before production.",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-encryption`,
        capability: "mercadolibre-read-plasticov",
        status: "blocked",
        safeMessage: "MSL_ENCRYPTION_KEY is not set and insecure dev fallback is disabled.",
        remediation: "Set MSL_ENCRYPTION_KEY to a long random value.",
      }),
    );
  }

  return results;
}
