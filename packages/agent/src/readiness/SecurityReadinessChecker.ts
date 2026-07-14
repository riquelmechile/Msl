import { createReadinessCheckResult } from "./types.js";
import type { ReadinessCheckResult } from "./types.js";
import type { ReadinessContext } from "./types.js";

const CHECK_PREFIX = "security";

export function checkSecurityReadiness(ctx: ReadinessContext): ReadinessCheckResult[] {
  const results: ReadinessCheckResult[] = [];
  const { env, runtimeMode } = ctx;
  const isProduction = runtimeMode === "production";

  // ── Encryption key ──────────────────────────────────────────────
  const encKey = env.MSL_ENCRYPTION_KEY;
  if (
    encKey &&
    encKey.trim() !== "" &&
    !/^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(encKey.trim())
  ) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-encryption-key`,
        capability: "mercadolibre-read-plasticov",
        status: "ready",
        safeMessage: "MSL_ENCRYPTION_KEY is present and valid.",
        remediation: "Encryption key is ready.",
      }),
    );
  } else if (
    encKey &&
    /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(encKey.trim())
  ) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-encryption-key`,
        capability: "mercadolibre-read-plasticov",
        status: "blocked",
        safeMessage: "MSL_ENCRYPTION_KEY is a placeholder — real encryption is not configured.",
        remediation: "Replace MSL_ENCRYPTION_KEY with a real random value.",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-encryption-key`,
        capability: "mercadolibre-read-plasticov",
        status: "blocked",
        safeMessage: "MSL_ENCRYPTION_KEY is not set.",
        remediation: "Set MSL_ENCRYPTION_KEY to a long random value.",
      }),
    );
  }

  // ── Insecure dev secrets flag ──────────────────────────────────
  const insecureDev = env.MSL_ALLOW_INSECURE_DEV_SECRETS;
  if (insecureDev && insecureDev.trim().toLowerCase() === "true") {
    if (isProduction) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-insecure-dev-secrets`,
          capability: "mercadolibre-read-plasticov",
          status: "blocked",
          safeMessage:
            "MSL_ALLOW_INSECURE_DEV_SECRETS is enabled in production — this bypasses token encryption.",
          remediation: "Set MSL_ALLOW_INSECURE_DEV_SECRETS=false or remove it in production.",
        }),
      );
    } else {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-insecure-dev-secrets`,
          capability: "mercadolibre-read-plasticov",
          status: "degraded",
          safeMessage:
            "MSL_ALLOW_INSECURE_DEV_SECRETS is enabled — token encryption bypassed (dev only).",
          remediation: "This is acceptable for development. Disable before production.",
        }),
      );
    }
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-insecure-dev-secrets`,
        capability: "mercadolibre-read-plasticov",
        status: "ready",
        safeMessage: "MSL_ALLOW_INSECURE_DEV_SECRETS is disabled — encryption is enforced.",
        remediation: "Security posture is good.",
      }),
    );
  }

  // ── Unauthenticated local flag ──────────────────────────────────
  const unauthLocal = env.MSL_ALLOW_UNAUTHENTICATED_LOCAL;
  if (unauthLocal && unauthLocal.trim().toLowerCase() === "true") {
    if (isProduction) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-unauth-local`,
          capability: "web-chat",
          status: "blocked",
          safeMessage:
            "MSL_ALLOW_UNAUTHENTICATED_LOCAL is enabled in production — unauthenticated access is allowed.",
          remediation: "Set MSL_ALLOW_UNAUTHENTICATED_LOCAL=false or remove it in production.",
        }),
      );
    } else {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-unauth-local`,
          capability: "web-chat",
          status: "degraded",
          safeMessage:
            "MSL_ALLOW_UNAUTHENTICATED_LOCAL is enabled — unauthenticated local access allowed (dev only).",
          remediation: "This is acceptable for development. Disable before production.",
        }),
      );
    }
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-unauth-local`,
        capability: "web-chat",
        status: "ready",
        safeMessage: "MSL_ALLOW_UNAUTHENTICATED_LOCAL is disabled — authentication is required.",
        remediation: "Security posture is good.",
      }),
    );
  }

  // ── NEXT_PUBLIC_ secrets check ──────────────────────────────────
  const envKeys = Object.keys(env);
  for (const key of envKeys) {
    if (key.toUpperCase().startsWith("NEXT_PUBLIC_")) {
      const value = env[key];
      if (value && value.trim() !== "") {
        results.push(
          createReadinessCheckResult({
            checkId: `${CHECK_PREFIX}-next-public-${key.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
            capability: "web-chat",
            status: "blocked",
            safeMessage: `${key} is a NEXT_PUBLIC_ variable with a value — this may expose secrets to the client bundle.`,
            remediation: `Remove the NEXT_PUBLIC_ prefix from "${key}" or ensure the value is not a secret.`,
            metadata: { exposedVar: key },
          }),
        );
      }
    }
  }

  return results;
}
