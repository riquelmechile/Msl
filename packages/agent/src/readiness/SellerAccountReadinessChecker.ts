import { createReadinessCheckResult } from "./types.js";
import type { ReadinessCheckResult, OAuthReadiness, EncryptionReadiness } from "./types.js";
import type { ReadinessContext } from "./types.js";
import type {
  MercadoLibreConnectionHealthService,
  MercadoLibreAccountConnectionHealth,
} from "@msl/mercadolibre";

const CHECK_PREFIX = "seller";

export type SellerCheckResult = {
  sellerId: string;
  accountName: string;
  checks: ReadinessCheckResult[];
  oauth: OAuthReadiness;
  encryption: EncryptionReadiness;
};

/** Factory for creating a health service from env vars. Returns undefined if env is incomplete. */
export type HealthServiceFactory = (
  env: Record<string, string | undefined>,
) => MercadoLibreConnectionHealthService | undefined;

export function checkSellerAccountReadiness(ctx: ReadinessContext): ReadinessCheckResult[] {
  const results: ReadinessCheckResult[] = [];
  const { env } = ctx;

  const sellerIds = new Set(["plasticov", "maustian"]);

  for (const sellerId of sellerIds) {
    const accountName = sellerId === "plasticov" ? "Plasticov" : "Maustian";
    const prefix = sellerId === "plasticov" ? "SOURCE" : "TARGET";

    // ── Seller ID ──────────────────────────────────────────────────
    const sellerIdVar =
      sellerId === "plasticov" ? "MERCADOLIBRE_SOURCE_SELLER_ID" : "MERCADOLIBRE_TARGET_SELLER_ID";
    const sellerIdValue = env[sellerIdVar];

    if (!sellerIdValue || sellerIdValue.trim() === "") {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${sellerId}-id`,
          capability:
            sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
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
          capability:
            sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
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
      (hasClientId &&
        /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(clientId.trim())) ||
      (hasClientSecret &&
        /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(clientSecret.trim()));

    if (configured && !isPlaceholder) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${sellerId}-oauth`,
          capability:
            sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
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
          capability:
            sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
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
          capability:
            sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
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
          capability:
            sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
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
  const isEncPlaceholder =
    hasEncKey && /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(encKey.trim());
  const isInsecureFb =
    !!env.MSL_ALLOW_INSECURE_DEV_SECRETS &&
    env.MSL_ALLOW_INSECURE_DEV_SECRETS.trim().toLowerCase() === "true";

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

// ── Live connection readiness (async) ──────────────────────────────

function resolveSellerId(
  sellerKey: "plasticov" | "maustian",
  env: Record<string, string | undefined>,
): string | undefined {
  const varName =
    sellerKey === "plasticov" ? "MERCADOLIBRE_SOURCE_SELLER_ID" : "MERCADOLIBRE_TARGET_SELLER_ID";
  const value = env[varName]?.trim();
  return value || undefined;
}

function healthStatusToReadiness(
  health: MercadoLibreAccountConnectionHealth,
): "ready" | "degraded" | "blocked" {
  switch (health.status) {
    case "ready":
      return "ready";
    case "degraded":
      return "degraded";
    case "blocked":
    case "disconnected":
    case "reauthorization-required":
      return "blocked";
  }
}

/**
 * Runs live token validation via the MercadoLibre connection health service.
 *
 * When a health service factory is provided and the environment has OAuth
 * configs, this function inspects token validity for each configured seller
 * and maps health statuses to readiness results.
 *
 * When no factory is provided or OAuth configs are missing, it gracefully
 * falls back to returning no results (env-only checks run separately).
 */
export async function checkMercadoLibreLiveConnection(
  ctx: ReadinessContext,
  getHealthService?: HealthServiceFactory,
): Promise<ReadinessCheckResult[]> {
  const { env } = ctx;
  const results: ReadinessCheckResult[] = [];

  // Always report write capabilities as blocked
  for (const sellerId of ["plasticov", "maustian"] as const) {
    const accountName = sellerId === "plasticov" ? "Plasticov" : "Maustian";
    const writeCapability =
      sellerId === "plasticov" ? "mercadolibre-write-plasticov" : "mercadolibre-write-maustian";

    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-${sellerId}-write-disabled`,
        capability: writeCapability,
        status: "blocked",
        sellerId,
        safeMessage: `${accountName} write capability is not implemented.`,
        remediation: "MercadoLibre write operations are not yet available.",
        reasonCode: "write-capability-not-implemented",
      }),
    );
  }

  // Skip live checks if no health service factory
  if (!getHealthService) return results;

  const healthService = getHealthService(env);
  if (!healthService) {
    // No OAuth config available — gracefully skip live checks
    for (const sellerId of ["plasticov", "maustian"] as const) {
      const accountName = sellerId === "plasticov" ? "Plasticov" : "Maustian";
      const actualSellerId = resolveSellerId(sellerId, env);
      if (!actualSellerId) continue;

      const readCapability =
        sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian";
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${sellerId}-live-skip`,
          capability: readCapability,
          status: "degraded",
          sellerId,
          safeMessage: `${accountName} live token check skipped — no OAuth health service configured.`,
          remediation: "Configure OAuth environment variables to enable live token validation.",
          reasonCode: "live-check-skipped-no-oauth",
        }),
      );
    }
    return results;
  }

  // Run live health inspection for each configured seller
  for (const sellerId of ["plasticov", "maustian"] as const) {
    const accountName = sellerId === "plasticov" ? "Plasticov" : "Maustian";
    const actualSellerId = resolveSellerId(sellerId, env);
    const readCapability =
      sellerId === "plasticov" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian";

    if (!actualSellerId) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${sellerId}-live-no-id`,
          capability: readCapability,
          status: "blocked",
          sellerId,
          safeMessage: `${accountName} seller ID is not configured — cannot run live token check.`,
          remediation: `Set ${sellerId === "plasticov" ? "MERCADOLIBRE_SOURCE_SELLER_ID" : "MERCADOLIBRE_TARGET_SELLER_ID"}.`,
          reasonCode: "seller-id-missing",
        }),
      );
      continue;
    }

    try {
      const health = await healthService.inspect(actualSellerId);
      const status = healthStatusToReadiness(health);
      const checkId = `${CHECK_PREFIX}-${sellerId}-live-connection`;

      if (status === "ready") {
        results.push(
          createReadinessCheckResult({
            checkId,
            capability: readCapability,
            status: "ready",
            sellerId,
            safeMessage: `${accountName} live connection is healthy (token: ${health.tokenStatus}).`,
            remediation: "Connection is operational.",
            reasonCode: `live-${health.tokenStatus}`,
          }),
        );
      } else if (status === "degraded") {
        results.push(
          createReadinessCheckResult({
            checkId,
            capability: readCapability,
            status: "degraded",
            sellerId,
            safeMessage: `${accountName} live connection is degraded: ${health.reason ?? health.tokenStatus}.`,
            remediation: `Investigate ${accountName} connection: ${health.reasonCodes.join(", ")}.`,
            reasonCode: health.reasonCodes[0] ?? "degraded",
          }),
        );
      } else {
        results.push(
          createReadinessCheckResult({
            checkId,
            capability: readCapability,
            status: "blocked",
            sellerId,
            safeMessage: `${accountName} live connection is blocked: ${health.reason ?? health.tokenStatus}.`,
            remediation: `Resolve ${accountName} connection issue: ${health.reasonCodes.join(", ")}.`,
            reasonCode: health.reasonCodes[0] ?? "blocked",
          }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${sellerId}-live-error`,
          capability: readCapability,
          status: "blocked",
          sellerId,
          safeMessage: `${accountName} live connection check failed: ${message}.`,
          remediation: `Investigate ${accountName} health service error.`,
          reasonCode: "live-check-error",
        }),
      );
    }
  }

  return results;
}
