import { createReadinessCheckResult } from "./types.js";
import type { ReadinessCheckResult } from "./types.js";
import type { ReadinessContext } from "./types.js";

const CHECK_PREFIX = "runtime";

export function checkRuntimeReadiness(ctx: ReadinessContext): ReadinessCheckResult[] {
  const results: ReadinessCheckResult[] = [];
  const { features } = ctx;

  // ── Creative Studio feature flag ────────────────────────────────
  if (features.creativeStudioEnabled) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-creative-studio-flag`,
        capability: "creative-studio",
        status: "ready",
        safeMessage: "Creative Studio feature flag is enabled.",
        remediation: "Creative Studio is active.",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-creative-studio-flag`,
        capability: "creative-studio",
        status: "not-applicable",
        safeMessage: "Creative Studio is disabled.",
        remediation: "Set MSL_CREATIVE_STUDIO_ENABLED=true to enable Creative Studio.",
      }),
    );
  }

  // ── Supplier Mirror feature flag ────────────────────────────────
  if (features.supplierMirrorEnabled) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-supplier-mirror-flag`,
        capability: "supplier-mirror",
        status: "ready",
        safeMessage: "Supplier Mirror feature flag is enabled.",
        remediation: "Supplier Mirror worker is active.",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-supplier-mirror-flag`,
        capability: "supplier-mirror",
        status: "not-applicable",
        safeMessage: "Supplier Mirror is disabled.",
        remediation: "Set MSL_SUPPLIER_MIRROR_WORKER_ENABLED=true to enable Supplier Mirror.",
      }),
    );
  }

  // ── Company Agent Admin feature flag ────────────────────────────
  if (features.companyAgentAdminEnabled) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-company-agent-admin-flag`,
        capability: "telegram-ceo",
        status: "ready",
        safeMessage: "Company Agent Admin feature flag is enabled.",
        remediation: "Company Agent admin tools are active.",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-company-agent-admin-flag`,
        capability: "telegram-ceo",
        status: "not-applicable",
        safeMessage: "Company Agent Admin is disabled.",
        remediation: "Set MSL_COMPANY_AGENT_ADMIN_ENABLED=true to enable admin tools.",
      }),
    );
  }

  return results;
}
