// ── Public types ─────────────────────────────────────────────────────

export type ProductionSecretStatus = "present" | "missing" | "default";

export type SecretCheck = {
  name: string;
  status: ProductionSecretStatus;
  required: boolean;
  description: string;
};

export type ProductionValidation = {
  valid: boolean;
  runtimeMode: string;
  checks: SecretCheck[];
  missingRequired: string[];
  warnings: string[];
};

// ── Constants ───────────────────────────────────────────────────────

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MINIMAX_API_HOST = "https://api.minimaxi.com";

// ── Helpers ─────────────────────────────────────────────────────────

function masked(value: string): string {
  if (value.length <= 4) return "****";
  return `****${value.slice(-4)}`;
}

function isEmpty(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

function isDefault(value: string | undefined, fallback: string): boolean {
  return !isEmpty(value) && (value as string).trim() === fallback;
}

function isTruthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function statusFor(value: string | undefined, fallback?: string): ProductionSecretStatus {
  if (isEmpty(value)) return "missing";
  if (fallback !== undefined && isDefault(value, fallback)) return "default";
  return "present";
}

// ── Single-secret check builder ─────────────────────────────────────

function check(
  name: string,
  raw: string | undefined,
  opts: {
    required: boolean;
    description: string;
    fallback?: string;
  },
): SecretCheck {
  return {
    name,
    status: statusFor(raw, opts.fallback),
    required: opts.required,
    description: opts.description,
  };
}

// ── Validator ───────────────────────────────────────────────────────

/**
 * Validate production secrets for safe deployment.
 *
 * Pure function — receives `env` as a parameter for testability.
 * In production mode, missing required secrets produce `valid: false`.
 * In development mode, missing secrets produce `valid: true` with warnings.
 */
export function validateProductionSecrets(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): ProductionValidation {
  const runtimeMode = (env.MSL_RUNTIME_MODE ?? "development").trim().toLowerCase();
  const isProduction = runtimeMode === "production";
  const creativeEnabled = isTruthy(env.MSL_CREATIVE_STUDIO_ENABLED);

  // Bot is always active in production mode
  const botExpected = isProduction;

  const checks: SecretCheck[] = [];
  const missingRequired: string[] = [];
  const warnings: string[] = [];

  // ── Runtime mode check ──────────────────────────────────────────
  if (!isProduction) {
    warnings.push(
      `MSL_RUNTIME_MODE is "${runtimeMode}" — secret validation is informational only. ` +
        "Set MSL_RUNTIME_MODE=production for strict enforcement.",
    );
  }

  // ── DeepSeek ────────────────────────────────────────────────────
  checks.push(
    check("DEEPSEEK_API_KEY", env.DEEPSEEK_API_KEY, {
      required: isProduction,
      description: "DeepSeek API key for LLM inference",
    }),
  );
  checks.push(
    check("DEEPSEEK_BASE_URL", env.DEEPSEEK_BASE_URL, {
      required: false,
      description: "DeepSeek API base URL",
      fallback: DEFAULT_DEEPSEEK_BASE_URL,
    }),
  );

  // ── MiniMax (conditional on Creative Studio) ────────────────────
  checks.push(
    check("MINIMAX_API_KEY", env.MINIMAX_API_KEY, {
      required: isProduction && creativeEnabled,
      description: "MiniMax API key for image/video generation",
    }),
  );
  checks.push(
    check("MINIMAX_API_HOST", env.MINIMAX_API_HOST, {
      required: false,
      description: "MiniMax API host override",
      fallback: DEFAULT_MINIMAX_API_HOST,
    }),
  );

  // ── MercadoLibre OAuth ──────────────────────────────────────────
  checks.push(
    check("MERCADOLIBRE_CLIENT_ID", env.MERCADOLIBRE_CLIENT_ID, {
      required: isProduction,
      description: "MercadoLibre OAuth application client ID",
    }),
  );
  checks.push(
    check("MERCADOLIBRE_CLIENT_SECRET", env.MERCADOLIBRE_CLIENT_SECRET, {
      required: isProduction,
      description: "MercadoLibre OAuth application client secret",
    }),
  );
  checks.push(
    check("MERCADOLIBRE_REDIRECT_URI", env.MERCADOLIBRE_REDIRECT_URI, {
      required: isProduction,
      description: "MercadoLibre OAuth redirect URI",
    }),
  );

  const hasMlAccessToken = !isEmpty(env.MERCADOLIBRE_ACCESS_TOKEN);
  const hasSourceAccessToken = !isEmpty(env.MERCADOLIBRE_SOURCE_ACCESS_TOKEN);
  const hasAnyMlToken = hasMlAccessToken || hasSourceAccessToken;

  checks.push(
    check("MERCADOLIBRE_ACCESS_TOKEN", env.MERCADOLIBRE_ACCESS_TOKEN, {
      required: isProduction && !hasSourceAccessToken,
      description: "MercadoLibre seller access token (legacy single-account)",
    }),
  );
  checks.push(
    check("MERCADOLIBRE_SOURCE_ACCESS_TOKEN", env.MERCADOLIBRE_SOURCE_ACCESS_TOKEN, {
      required: isProduction && !hasMlAccessToken,
      description: "MercadoLibre source seller access token (dual-account)",
    }),
  );

  if (isProduction && !hasAnyMlToken) {
    missingRequired.push("MERCADOLIBRE_ACCESS_TOKEN or MERCADOLIBRE_SOURCE_ACCESS_TOKEN");
  }

  // ── Persistence ─────────────────────────────────────────────────
  checks.push(
    check("MSL_APPROVAL_QUEUE_DB_PATH", env.MSL_APPROVAL_QUEUE_DB_PATH, {
      required: isProduction,
      description: "SQLite path for MCP approval queue",
    }),
  );

  const hasChatSqlite = !isEmpty(env.MSL_CHAT_SQLITE_PATH);
  const hasAgentBusDb = !isEmpty(env.MSL_AGENT_BUS_DB_PATH);
  const hasAnyChatDb = hasChatSqlite || hasAgentBusDb;

  checks.push(
    check("MSL_CHAT_SQLITE_PATH", env.MSL_CHAT_SQLITE_PATH, {
      required: isProduction && !hasAgentBusDb,
      description: "SQLite path for chat session persistence",
    }),
  );
  checks.push(
    check("MSL_AGENT_BUS_DB_PATH", env.MSL_AGENT_BUS_DB_PATH, {
      required: isProduction && !hasChatSqlite,
      description: "SQLite path for agent message bus persistence",
    }),
  );

  if (isProduction && !hasAnyChatDb) {
    missingRequired.push("MSL_CHAT_SQLITE_PATH or MSL_AGENT_BUS_DB_PATH");
  }

  checks.push(
    check("MSL_CREATIVE_STUDIO_STORAGE_PATH", env.MSL_CREATIVE_STUDIO_STORAGE_PATH, {
      required: isProduction && creativeEnabled,
      description: "Local storage path for creative assets",
    }),
  );

  // ── Telegram Bot (production implies bot) ───────────────────────
  checks.push(
    check("BOT_TOKEN", env.BOT_TOKEN, {
      required: botExpected,
      description: "Telegram bot token from @BotFather",
    }),
  );
  checks.push(
    check("MSL_TELEGRAM_ADMIN_CHAT_IDS", env.MSL_TELEGRAM_ADMIN_CHAT_IDS, {
      required: botExpected,
      description: "Comma-separated Telegram chat IDs allowed admin access",
    }),
  );

  // ── Collect missing required ────────────────────────────────────
  for (const c of checks) {
    if (c.required && c.status === "missing") {
      missingRequired.push(c.name);
    }
    if (isProduction && !c.required && c.status === "missing") {
      warnings.push(`${c.name}: not set (${c.description})`);
    }
  }

  if (isProduction && !env.MSL_CREATIVE_STUDIO_ENABLED) {
    warnings.push("MSL_CREATIVE_STUDIO_ENABLED is not true — MiniMax secrets are optional.");
  }

  const valid = missingRequired.length === 0;

  return {
    valid,
    runtimeMode,
    checks,
    missingRequired: [...new Set(missingRequired)],
    warnings,
  };
}

// ── Formatter ───────────────────────────────────────────────────────

/**
 * Render the validation result as a human-readable checklist string.
 * Present secrets are masked to show only the last 4 characters.
 */
export function formatProductionValidation(
  validation: ProductionValidation,
  env: Record<string, string | undefined>,
): string {
  const lines: string[] = [];
  const mode = validation.runtimeMode.toUpperCase();
  const icon = validation.valid ? "✅" : "❌";

  lines.push("");
  lines.push(`🔐 Production Secrets Check — MSL_RUNTIME_MODE=${mode}`);
  lines.push("━".repeat(72));

  const maxName = Math.max(...validation.checks.map((c) => c.name.length), 8);

  for (const c of validation.checks) {
    const label = c.required ? "REQUIRED" : "optional";
    const statusIcon = c.status === "present" ? "✅" : c.status === "default" ? "⚙️ " : "❌";
    const padded = c.name.padEnd(maxName + 2);
    const raw = env[c.name];

    let valueHint = "";
    if (c.status === "present" && raw && raw.length > 4) {
      valueHint = ` (${masked(raw)})`;
    } else if (c.status === "default") {
      valueHint = ` (default)`;
    }

    lines.push(`${statusIcon} ${padded} ${label.padEnd(10)} ${c.description}${valueHint}`);
  }

  lines.push("━".repeat(72));

  if (validation.missingRequired.length > 0) {
    lines.push("");
    lines.push(`❌ ${validation.missingRequired.length} required secret(s) missing:`);
    for (const name of validation.missingRequired) {
      lines.push(`   - ${name}`);
    }
  }

  if (validation.warnings.length > 0) {
    lines.push("");
    lines.push(`⚠️  ${validation.warnings.length} warning(s):`);
    for (const w of validation.warnings) {
      lines.push(`   • ${w}`);
    }
  }

  if (validation.valid) {
    lines.push("");
    lines.push("✅ Ready for production — all required secrets are present.");
  } else {
    lines.push("");
    lines.push(
      `❌ Not ready for production — ${validation.missingRequired.length} secret(s) missing.`,
    );
  }

  lines.push("");

  return lines.join("\n");
}
