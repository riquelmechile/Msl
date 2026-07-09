// ── Public types ─────────────────────────────────────────────────────

export type EnvValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

// ── Helpers ─────────────────────────────────────────────────────────

function env(name: string): string | undefined {
  return process.env[name]?.trim();
}

// ── Validator ────────────────────────────────────────────────────────

/**
 * Validate runtime environment variables before starting agent operations.
 *
 * Pure function — reads from `process.env`, no side effects.
 * Returns structured validation result with errors and warnings.
 */
export function validateRuntimeEnv(): EnvValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Mandatory: cortex SQLite path ───────────────────────────
  const cortexPath = env("MSL_CORTEX_SQLITE_PATH");
  if (!cortexPath) {
    errors.push("MSL_CORTEX_SQLITE_PATH: missing (required for daemon scheduler)");
  }

  // ── Creative studio: conditional checks ─────────────────────
  const creativeEnabled = env("MSL_CREATIVE_STUDIO_ENABLED");
  const isCreativeActive = creativeEnabled === "true" || creativeEnabled === "1";

  if (isCreativeActive) {
    const apiHost = env("MINIMAX_API_HOST");
    const baseUrl = env("MINIMAX_BASE_URL");

    if (!apiHost && !baseUrl) {
      errors.push(
        "MINIMAX_API_HOST or MINIMAX_BASE_URL: missing (required when MSL_CREATIVE_STUDIO_ENABLED=true)",
      );
    } else if (apiHost && baseUrl && apiHost !== baseUrl) {
      warnings.push(
        `MINIMAX_API_HOST="${apiHost}" differs from MINIMAX_BASE_URL="${baseUrl}". Using MINIMAX_API_HOST.`,
      );
    }

    if (!apiHost && baseUrl) {
      warnings.push("MINIMAX_BASE_URL is deprecated; use MINIMAX_API_HOST instead");
    }

    const storagePath = env("MSL_CREATIVE_STUDIO_STORAGE_PATH");
    if (!storagePath) {
      warnings.push(
        "MSL_CREATIVE_STUDIO_STORAGE_PATH: not set; creative assets saved to default temp directory",
      );
    }
  }

  // ── Webhook port: non-critical warning ──────────────────────
  if (!env("MSL_WEBHOOK_PORT")) {
    warnings.push("MSL_WEBHOOK_PORT: not set; webhook ingestor will not start");
  }

  return { valid: errors.length === 0, errors, warnings };
}
