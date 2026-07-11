import { createReadinessCheckResult } from "./types.js";
import type { ReadinessCheckResult } from "./types.js";
import type { ReadinessContext } from "./types.js";

const CHECK_PREFIX = "env";

export function checkEnvironmentReadiness(ctx: ReadinessContext): ReadinessCheckResult[] {
  const results: ReadinessCheckResult[] = [];

  // ── Runtime mode check ──────────────────────────────────────────
  const mode = ctx.runtimeMode;
  if (mode === "production") {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-runtime-mode`,
        capability: "background-workers",
        status: "ready",
        safeMessage: "MSL_RUNTIME_MODE is production — strict validation active.",
        remediation: "Runtime mode is production.",
      }),
    );
  } else if (mode === "development") {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-runtime-mode`,
        capability: "background-workers",
        status: "degraded",
        safeMessage: "MSL_RUNTIME_MODE is development — relaxed validation mode.",
        remediation: "Set MSL_RUNTIME_MODE=production to enable strict readiness checks.",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-runtime-mode`,
        capability: "background-workers",
        status: "blocked",
        safeMessage: `MSL_RUNTIME_MODE is "${mode}" — expected "production" or "development".`,
        remediation: "Set MSL_RUNTIME_MODE to either 'production' or 'development'.",
        reasonCode: `env-invalid-runtime-mode-${mode}`,
      }),
    );
  }

  // ── Data path checks ────────────────────────────────────────────
  const dataDir = ctx.env.MSL_DATA_DIR;
  if (dataDir && dataDir.trim() !== "") {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-data-dir`,
        capability: "background-workers",
        status: "ready",
        safeMessage: `MSL_DATA_DIR is set.`,
        remediation: "MSL_DATA_DIR configured.",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-data-dir`,
        capability: "background-workers",
        status: "degraded",
        safeMessage: "MSL_DATA_DIR is not set. In production, this may cause missing persistence.",
        remediation: "Set MSL_DATA_DIR to the persistent data directory on the VPS.",
      }),
    );
  }

  // ── Log path checks ─────────────────────────────────────────────
  const logDir = ctx.env.MSL_LOG_DIR;
  if (logDir && logDir.trim() !== "") {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-log-dir`,
        capability: "background-workers",
        status: "ready",
        safeMessage: `MSL_LOG_DIR is set.`,
        remediation: "MSL_LOG_DIR configured.",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-log-dir`,
        capability: "background-workers",
        status: "degraded",
        safeMessage: "MSL_LOG_DIR is not set. Logs may not be persisted.",
        remediation: "Set MSL_LOG_DIR to the log output directory on the VPS.",
      }),
    );
  }

  // ── APP dir check ───────────────────────────────────────────────
  const appDir = ctx.env.MSL_APP_DIR;
  if (appDir && appDir.trim() !== "") {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-app-dir`,
        capability: "background-workers",
        status: "ready",
        safeMessage: `MSL_APP_DIR is set.`,
        remediation: "MSL_APP_DIR configured.",
      }),
    );
  }

  return results;
}
