import {
  createProductionReadinessReport,
  createSellerReadinessReport,
  worstStatus,
} from "./types.js";
import type {
  ProductionReadinessReport,
  ProductionCapability,
  ReadinessStatus,
  ReadinessCheckResult,
  SellerReadinessReport,
} from "./types.js";
import type { ReadinessContext } from "./types.js";
import { checkEnvironmentReadiness } from "./EnvironmentReadinessChecker.js";
import { checkSellerAccountReadiness } from "./SellerAccountReadinessChecker.js";
import { checkDatabaseReadiness } from "./DatabaseReadinessChecker.js";
import { checkProviderReadiness } from "./ProviderReadinessChecker.js";
import { checkRuntimeReadiness } from "./RuntimeReadinessChecker.js";
import { checkFeatureGateReadiness } from "./FeatureGateReadinessChecker.js";
import { checkSecurityReadiness } from "./SecurityReadinessChecker.js";

// ── Feature flag extraction ─────────────────────────────────────────

function isTruthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function resolveFeatures(env: Record<string, string | undefined>): ReadinessContext["features"] {
  return {
    creativeStudioEnabled: isTruthy(env.MSL_CREATIVE_STUDIO_ENABLED),
    supplierMirrorEnabled: isTruthy(env.MSL_SUPPLIER_MIRROR_WORKER_ENABLED),
    companyAgentAdminEnabled: isTruthy(env.MSL_COMPANY_AGENT_ADMIN_ENABLED),
    databaseIntegrityEnabled: isTruthy(env.MSL_DURABILITY_ENABLED),
    walHealthEnabled: isTruthy(env.MSL_DURABILITY_ENABLED),
    productLaunchEnabled:
      env.MSL_PRODUCT_LAUNCH_ENABLED === undefined
        ? true
        : isTruthy(env.MSL_PRODUCT_LAUNCH_ENABLED),
  };
}

// ── Capability defaults ─────────────────────────────────────────────

const ALL_CAPABILITIES: ProductionCapability[] = [
  "deepseek-reasoning",
  "telegram-ceo",
  "mercadolibre-read-plasticov",
  "mercadolibre-read-maustian",
  "mercadolibre-write-plasticov",
  "mercadolibre-write-maustian",
  "operational-ingestion",
  "economic-truth",
  "economic-learning",
  "creative-studio",
  "supplier-mirror",
  "owned-ecommerce",
  "mcp-server",
  "web-chat",
  "background-workers",
  "daemon-scheduler",
  "real-economic-ingestion",
  "product-launch",
  "product-recognition",
];

// ── Service ─────────────────────────────────────────────────────────

export type AssessReadinessInput = {
  runtimeMode: string;
  sellers: { plasticov: string; maustian: string };
  env: Record<string, string | undefined>;
};

export function assessProductionReadiness(input: AssessReadinessInput): ProductionReadinessReport {
  const { runtimeMode, sellers, env } = input;

  const ctx: ReadinessContext = {
    runtimeMode,
    env,
    sellers,
    features: resolveFeatures(env),
  };

  // ── Run all checkers with isolation ─────────────────────────────
  function safeCheck(
    fn: (c: ReadinessContext) => ReadinessCheckResult[],
    checkerName: string,
  ): ReadinessCheckResult[] {
    try {
      return fn(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      return [
        {
          checkId: `checker-failure-${checkerName}`,
          capability: "background-workers",
          status: "degraded",
          severity: "warning",
          safeMessage: `Checker "${checkerName}" failed: ${message}`,
          remediation: `Investigate checker "${checkerName}" failure.`,
          checkedAt: new Date().toISOString(),
          metadata: {},
          reasonCode: `checker-${checkerName}-failure`,
          noMutationExecuted: true,
        },
      ];
    }
  }

  const allCheckerResults: ReadinessCheckResult[] = [
    ...safeCheck(checkEnvironmentReadiness, "environment"),
    ...safeCheck(checkSellerAccountReadiness, "seller-account"),
    ...safeCheck(checkDatabaseReadiness, "database"),
    ...safeCheck(checkProviderReadiness, "provider"),
    ...safeCheck(checkRuntimeReadiness, "runtime"),
    ...safeCheck(checkFeatureGateReadiness, "feature-gate"),
    ...safeCheck(checkSecurityReadiness, "security"),
  ];

  // ── Aggregate by capability ─────────────────────────────────────
  const capabilityStatus = new Map<ProductionCapability, ReadinessStatus>();
  const capabilityChecks = new Map<ProductionCapability, ReadinessCheckResult[]>();

  // Initialize all capabilities as not-applicable
  for (const cap of ALL_CAPABILITIES) {
    capabilityStatus.set(cap, "not-applicable");
    capabilityChecks.set(cap, []);
  }

  // Aggregate from results
  const uniqueCheckIds = new Set<string>();
  for (const result of allCheckerResults) {
    uniqueCheckIds.add(result.checkId);
    const cap = result.capability;
    const current = capabilityStatus.get(cap) ?? "not-applicable";
    const next = worstStatus(current, result.status);
    capabilityStatus.set(cap, next);

    const checks = capabilityChecks.get(cap) ?? [];
    checks.push(result);
    capabilityChecks.set(cap, checks);
  }

  // ── Classify blockers and warnings ──────────────────────────────
  const blockers: ReadinessCheckResult[] = [];
  const warnings: ReadinessCheckResult[] = [];
  const readyCapabilities: ProductionCapability[] = [];
  const disabledCapabilities: ProductionCapability[] = [];
  const remediationPlan: string[] = [];

  for (const cap of ALL_CAPABILITIES) {
    const status = capabilityStatus.get(cap) ?? "not-applicable";
    if (status === "blocked") {
      const capChecks = capabilityChecks.get(cap) ?? [];
      for (const c of capChecks) {
        if (c.status === "blocked" && c.remediation) {
          blockers.push(c);
          remediationPlan.push(c.remediation);
        }
      }
    } else if (status === "degraded") {
      const capChecks = capabilityChecks.get(cap) ?? [];
      for (const c of capChecks) {
        if (c.status === "degraded") {
          warnings.push(c);
        }
      }
      readyCapabilities.push(cap);
    } else if (status === "ready") {
      readyCapabilities.push(cap);
    } else {
      disabledCapabilities.push(cap);
    }
  }

  // ── Compute overall status ──────────────────────────────────────
  let overallStatus: ReadinessStatus = "not-applicable";
  for (const status of capabilityStatus.values()) {
    overallStatus = worstStatus(overallStatus, status);
  }

  // ── Per-seller reports ──────────────────────────────────────────
  const sellerReports = buildSellerReports(ctx, allCheckerResults);

  // ── Assemble report ─────────────────────────────────────────────
  const capabilitiesObj = {} as Record<ProductionCapability, ReadinessStatus>;
  for (const [cap, status] of capabilityStatus) {
    capabilitiesObj[cap] = status;
  }

  return createProductionReadinessReport({
    runtimeMode,
    overallStatus,
    capabilities: capabilitiesObj,
    sellerReports,
    blockers,
    warnings,
    readyCapabilities,
    disabledCapabilities,
    remediationPlan: [...new Set(remediationPlan)],
  });
}

// ── Per-seller report builder ───────────────────────────────────────

function buildSellerReports(
  ctx: ReadinessContext,
  allResults: ReadinessCheckResult[],
): SellerReadinessReport[] {
  const { env } = ctx;
  const reports: SellerReadinessReport[] = [];

  for (const sellerId of ["plasticov", "maustian"] as const) {
    const accountName = sellerId === "plasticov" ? "Plasticov" : "Maustian";
    const prefix = sellerId === "plasticov" ? "SOURCE" : "TARGET";

    // Gather per-seller checks or checks relevant to this seller
    const sellerResults = allResults.filter(
      (r) => r.sellerId === sellerId || (!r.sellerId && isRelevantToSeller(r.capability, sellerId)),
    );

    // Build oauth readiness
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

    // Build encryption readiness
    const encKey = env.MSL_ENCRYPTION_KEY;
    const hasEncKey = !!(encKey && encKey.trim() !== "");
    const isEncPlaceholder =
      hasEncKey && /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(encKey.trim());
    const isInsecureFb =
      !!env.MSL_ALLOW_INSECURE_DEV_SECRETS &&
      env.MSL_ALLOW_INSECURE_DEV_SECRETS.trim().toLowerCase() === "true";

    // Compute seller overall status
    let sellerOverall: ReadinessStatus = "not-applicable";
    const sellerCaps: Record<string, ReadinessStatus> = {};
    for (const r of sellerResults) {
      const capKey = r.capability;
      const current = sellerCaps[capKey] ?? "not-applicable";
      sellerCaps[capKey] = worstStatus(current, r.status);
      sellerOverall = worstStatus(sellerOverall, r.status);
    }

    const tokenStoreRaw = env.MSL_MERCADOLIBRE_OAUTH_DB_PATH?.trim();

    reports.push(
      createSellerReadinessReport({
        sellerId,
        accountName,
        overallStatus: sellerOverall,
        capabilities: sellerCaps,
        oauthBinding: {
          configured,
          hasClientId,
          hasClientSecret,
          hasRedirectUri,
          isPlaceholder:
            (hasClientId &&
              /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(clientId.trim())) ||
            (hasClientSecret &&
              /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(clientSecret.trim())),
          ...(tokenStoreRaw ? { tokenStorePath: tokenStoreRaw } : {}),
        },
        encryptionReadiness: {
          keyPresent: hasEncKey && !isEncPlaceholder,
          isPlaceholder: isEncPlaceholder,
          isInsecureDevFallback: isInsecureFb,
        },
        checks: sellerResults,
      }),
    );
  }

  return reports;
}

function isRelevantToSeller(capability: ProductionCapability, sellerId: string): boolean {
  if (sellerId === "plasticov" && capability.includes("plasticov")) return true;
  if (sellerId === "maustian" && capability.includes("maustian")) return true;
  if (
    capability === "mercadolibre-read-plasticov" ||
    capability === "mercadolibre-write-plasticov"
  ) {
    return sellerId === "plasticov";
  }
  if (capability === "mercadolibre-read-maustian" || capability === "mercadolibre-write-maustian") {
    return sellerId === "maustian";
  }
  return false;
}
