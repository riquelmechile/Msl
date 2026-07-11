import type { ConfigSensitivity, ProductionCapability } from "@msl/domain";

// ── Types ────────────────────────────────────────────────────────────

export type EnvVarDescriptor = {
  /** Environment variable name (e.g. "DEEPSEEK_API_KEY") */
  name: string;
  /** How sensitive the value is */
  sensitivity: ConfigSensitivity;
  /** The primary capability this env var enables */
  capability: ProductionCapability;
  /** Condition under which this var is required. Empty string = always. */
  isRequiredFor: string;
  /** Validates the raw value. Returns the validation result. */
  validate: (value: string | undefined) => ValidationResult;
  /** Patterns that indicate a placeholder/dummy value */
  placeholderPatterns: RegExp[];
  /** Human-readable remediation instruction */
  remediation: string;
  /** Whether the variable is optional in all runtime modes */
  alwaysOptional: boolean;
};

export type ValidationResult = {
  valid: boolean;
  status: "filled" | "missing" | "placeholder" | "malformed" | "next-public-exposed";
  reason: string;
};

// ── Placeholder detection ────────────────────────────────────────────

const placeholderRegexes = [/^(test|example|changeme|your-|xxx|placeholder|dummy)/i];

function isPlaceholderValue(value: string): boolean {
  return placeholderRegexes.some((re) => re.test(value.trim()));
}

function isNextPublicKey(name: string): boolean {
  return name.toUpperCase().startsWith("NEXT_PUBLIC_");
}

function validateEnvValue(
  name: string,
  value: string | undefined,
  required: boolean,
): ValidationResult {
  if (isNextPublicKey(name) && value !== undefined && value.trim() !== "") {
    return { valid: false, status: "next-public-exposed", reason: `NEXT_PUBLIC_ secret "${name}" is exposed to the client bundle` };
  }
  if (value === undefined || value.trim() === "") {
    if (required) {
      return { valid: false, status: "missing", reason: `${name} is not set` };
    }
    return { valid: true, status: "missing", reason: `${name} is not set (optional)` };
  }
  if (isPlaceholderValue(value)) {
    if (required) {
      return { valid: false, status: "placeholder", reason: `${name} contains a placeholder value` };
    }
    return { valid: true, status: "placeholder", reason: `${name} contains a placeholder value (optional)` };
  }
  return { valid: true, status: "filled", reason: `${name} is set` };
}

// ── Configuration inventory ──────────────────────────────────────────

export const PRODUCTION_CONFIG_INVENTORY: EnvVarDescriptor[] = [
  // ── Runtime ───────────────────────────────────────────────────────
  {
    name: "MSL_RUNTIME_MODE",
    sensitivity: "public",
    capability: "background-workers",
    isRequiredFor: "",
    alwaysOptional: false,
    validate: (v) => {
      if (!v || v.trim() === "") {
        return { valid: true, status: "missing", reason: "MSL_RUNTIME_MODE not set, defaulting to development" };
      }
      if (v.trim() !== "production" && v.trim() !== "development") {
        return { valid: false, status: "malformed", reason: `MSL_RUNTIME_MODE must be "production" or "development", got "${v.trim()}"` };
      }
      return { valid: true, status: "filled", reason: `Runtime mode: ${v.trim()}` };
    },
    placeholderPatterns: [],
    remediation: "Set MSL_RUNTIME_MODE=production for production readiness. Set to development for local work.",
  },
  {
    name: "MSL_APP_DIR",
    sensitivity: "public",
    capability: "background-workers",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_APP_DIR", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_APP_DIR to the application root directory on the VPS.",
  },
  {
    name: "MSL_DATA_DIR",
    sensitivity: "public",
    capability: "background-workers",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_DATA_DIR", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_DATA_DIR to the persistent data directory.",
  },
  {
    name: "MSL_LOG_DIR",
    sensitivity: "public",
    capability: "background-workers",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_LOG_DIR", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_LOG_DIR to the log output directory.",
  },
  // ── DeepSeek ──────────────────────────────────────────────────────
  {
    name: "DEEPSEEK_API_KEY",
    sensitivity: "critical-secret",
    capability: "deepseek-reasoning",
    isRequiredFor: "always",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("DEEPSEEK_API_KEY", v, true),
    placeholderPatterns: [],
    remediation: "Set DEEPSEEK_API_KEY with your DeepSeek API key from https://platform.deepseek.com",
  },
  {
    name: "DEEPSEEK_BASE_URL",
    sensitivity: "public",
    capability: "deepseek-reasoning",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("DEEPSEEK_BASE_URL", v, false),
    placeholderPatterns: [],
    remediation: "Leave DEEPSEEK_BASE_URL empty to use the default https://api.deepseek.com",
  },
  {
    name: "DEEPSEEK_MODEL",
    sensitivity: "public",
    capability: "deepseek-reasoning",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("DEEPSEEK_MODEL", v, false),
    placeholderPatterns: [],
    remediation: "Leave DEEPSEEK_MODEL empty to use the default model.",
  },
  // ── Telegram Bot ──────────────────────────────────────────────────
  {
    name: "BOT_TOKEN",
    sensitivity: "critical-secret",
    capability: "telegram-ceo",
    isRequiredFor: "always in production",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("BOT_TOKEN", v, true),
    placeholderPatterns: [],
    remediation: "Set BOT_TOKEN with your Telegram bot token from @BotFather.",
  },
  {
    name: "MSL_TELEGRAM_ADMIN_CHAT_IDS",
    sensitivity: "secret",
    capability: "telegram-ceo",
    isRequiredFor: "always in production",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MSL_TELEGRAM_ADMIN_CHAT_IDS", v, true),
    placeholderPatterns: [],
    remediation: "Set MSL_TELEGRAM_ADMIN_CHAT_IDS with comma-separated Telegram chat IDs.",
  },
  {
    name: "MSL_TELEGRAM_ADMIN_USER_IDS",
    sensitivity: "secret",
    capability: "telegram-ceo",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_TELEGRAM_ADMIN_USER_IDS", v, false),
    placeholderPatterns: [],
    remediation: "Optionally set MSL_TELEGRAM_ADMIN_USER_IDS for user-based admin authorization.",
  },
  {
    name: "MSL_TELEGRAM_SQLITE_PATH",
    sensitivity: "public",
    capability: "telegram-ceo",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_TELEGRAM_SQLITE_PATH", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_TELEGRAM_SQLITE_PATH for durable Telegram session persistence.",
  },
  {
    name: "MSL_TELEGRAM_CORTEX_SQLITE_PATH",
    sensitivity: "public",
    capability: "telegram-ceo",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_TELEGRAM_CORTEX_SQLITE_PATH", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_TELEGRAM_CORTEX_SQLITE_PATH for Telegram Cortex memory persistence.",
  },
  {
    name: "MSL_TELEGRAM_ACTIVE_COMPANY_AGENT_ID",
    sensitivity: "public",
    capability: "telegram-ceo",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_TELEGRAM_ACTIVE_COMPANY_AGENT_ID", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_TELEGRAM_ACTIVE_COMPANY_AGENT_ID for explicit company agent routing.",
  },
  {
    name: "MSL_COMPANY_AGENT_ADMIN_ENABLED",
    sensitivity: "public",
    capability: "telegram-ceo",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => {
      if (!v || v.trim() === "") {
        return { valid: true, status: "missing", reason: "MSL_COMPANY_AGENT_ADMIN_ENABLED not set, admin tools disabled" };
      }
      return { valid: true, status: "filled", reason: "Company agent admin flag set" };
    },
    placeholderPatterns: [],
    remediation: "Set MSL_COMPANY_AGENT_ADMIN_ENABLED=true to enable company-agent admin tools in Telegram.",
  },
  // ── MiniMax / Creative Studio ─────────────────────────────────────
  {
    name: "MSL_CREATIVE_STUDIO_ENABLED",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => {
      if (!v || v.trim() === "") {
        return { valid: true, status: "missing", reason: "Creative Studio disabled" };
      }
      return { valid: true, status: "filled", reason: `Creative Studio ${v.trim()}` };
    },
    placeholderPatterns: [],
    remediation: "Set MSL_CREATIVE_STUDIO_ENABLED=true to enable the Creative Studio agent.",
  },
  {
    name: "MINIMAX_API_KEY",
    sensitivity: "critical-secret",
    capability: "creative-studio",
    isRequiredFor: "if MSL_CREATIVE_STUDIO_ENABLED is true",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MINIMAX_API_KEY", v, true),
    placeholderPatterns: [],
    remediation: "Set MINIMAX_API_KEY with your MiniMax API key from https://platform.minimax.io",
  },
  {
    name: "MINIMAX_API_HOST",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MINIMAX_API_HOST", v, false),
    placeholderPatterns: [],
    remediation: "Leave MINIMAX_API_HOST empty to use the default endpoint.",
  },
  {
    name: "MINIMAX_BASE_URL",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MINIMAX_BASE_URL", v, false),
    placeholderPatterns: [],
    remediation: "Leave MINIMAX_BASE_URL empty to use the default.",
  },
  {
    name: "MINIMAX_IMAGE_MODEL",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MINIMAX_IMAGE_MODEL", v, false),
    placeholderPatterns: [],
    remediation: "Optionally override MiniMax image model. Default: image-01.",
  },
  {
    name: "MINIMAX_VIDEO_MODEL",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MINIMAX_VIDEO_MODEL", v, false),
    placeholderPatterns: [],
    remediation: "Optionally override MiniMax video model. Default: video-01.",
  },
  {
    name: "MINIMAX_REQUEST_TIMEOUT_MS",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => {
      if (!v || v.trim() === "") {
        return { valid: true, status: "missing", reason: "MINIMAX_REQUEST_TIMEOUT_MS not set, using default 120000ms" };
      }
      const ms = Number(v);
      if (!Number.isFinite(ms) || ms < 0) {
        return { valid: false, status: "malformed", reason: `MINIMAX_REQUEST_TIMEOUT_MS must be a positive number, got "${v}"` };
      }
      return { valid: true, status: "filled", reason: `MiniMax timeout: ${ms}ms` };
    },
    placeholderPatterns: [],
    remediation: "Set MINIMAX_REQUEST_TIMEOUT_MS to a positive integer (ms).",
  },
  {
    name: "MSL_CREATIVE_STUDIO_MAX_DAILY_USD",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => {
      if (!v || v.trim() === "") {
        return { valid: true, status: "missing", reason: "MSL_CREATIVE_STUDIO_MAX_DAILY_USD not set, using default 5.00" };
      }
      const usd = Number(v);
      if (!Number.isFinite(usd) || usd <= 0) {
        return { valid: false, status: "malformed", reason: `MSL_CREATIVE_STUDIO_MAX_DAILY_USD must be a positive number, got "${v}"` };
      }
      return { valid: true, status: "filled", reason: `Max daily: $${usd}` };
    },
    placeholderPatterns: [],
    remediation: "Set MSL_CREATIVE_STUDIO_MAX_DAILY_USD to your daily budget cap.",
  },
  {
    name: "MSL_CREATIVE_STUDIO_MAX_JOB_USD",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => {
      if (!v || v.trim() === "") {
        return { valid: true, status: "missing", reason: "MSL_CREATIVE_STUDIO_MAX_JOB_USD not set, using default 0.50" };
      }
      const usd = Number(v);
      if (!Number.isFinite(usd) || usd <= 0) {
        return { valid: false, status: "malformed", reason: `MSL_CREATIVE_STUDIO_MAX_JOB_USD must be a positive number, got "${v}"` };
      }
      return { valid: true, status: "filled", reason: `Max per-job: $${usd}` };
    },
    placeholderPatterns: [],
    remediation: "Set MSL_CREATIVE_STUDIO_MAX_JOB_USD to your per-job budget cap.",
  },
  {
    name: "MSL_CREATIVE_STUDIO_STORAGE_PATH",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_CREATIVE_STUDIO_STORAGE_PATH", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_CREATIVE_STUDIO_STORAGE_PATH to the local storage path for creative assets.",
  },
  {
    name: "MSL_CREATIVE_STUDIO_ML_AUTO_DIAGNOSE",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => {
      if (!v || v.trim() === "") {
        return { valid: true, status: "missing", reason: "ML auto-diagnose using default (true)" };
      }
      return { valid: true, status: "filled", reason: `ML auto-diagnose: ${v.trim()}` };
    },
    placeholderPatterns: [],
    remediation: "Set MSL_CREATIVE_STUDIO_ML_AUTO_DIAGNOSE=false to disable automatic ML image diagnosis.",
  },
  {
    name: "ML_API_TOKEN",
    sensitivity: "secret",
    capability: "creative-studio",
    isRequiredFor: "if MSL_CREATIVE_STUDIO_ML_AUTO_DIAGNOSE is enabled",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("ML_API_TOKEN", v, true),
    placeholderPatterns: [],
    remediation: "Set ML_API_TOKEN for MercadoLibre ML diagnosis service.",
  },
  {
    name: "MSL_CREATIVE_STUDIO_MAX_CONCURRENT_JOBS",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => {
      if (!v || v.trim() === "") {
        return { valid: true, status: "missing", reason: "MSL_CREATIVE_STUDIO_MAX_CONCURRENT_JOBS not set, using default 3" };
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) {
        return { valid: false, status: "malformed", reason: `MSL_CREATIVE_STUDIO_MAX_CONCURRENT_JOBS must be >= 1, got "${v}"` };
      }
      return { valid: true, status: "filled", reason: `Max concurrent jobs: ${n}` };
    },
    placeholderPatterns: [],
    remediation: "Set MSL_CREATIVE_STUDIO_MAX_CONCURRENT_JOBS to the maximum number of concurrent creative jobs.",
  },
  {
    name: "MSL_CREATIVE_STUDIO_MIN_COOLDOWN_MS",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => {
      if (!v || v.trim() === "") {
        return { valid: true, status: "missing", reason: "MSL_CREATIVE_STUDIO_MIN_COOLDOWN_MS not set, using default 2000" };
      }
      const ms = Number(v);
      if (!Number.isFinite(ms) || ms < 0) {
        return { valid: false, status: "malformed", reason: `MSL_CREATIVE_STUDIO_MIN_COOLDOWN_MS must be >= 0, got "${v}"` };
      }
      return { valid: true, status: "filled", reason: `Min cooldown: ${ms}ms` };
    },
    placeholderPatterns: [],
    remediation: "Set MSL_CREATIVE_STUDIO_MIN_COOLDOWN_MS to the minimum cooldown between jobs (ms).",
  },
  {
    name: "MSL_CREATIVE_STUDIO_DB_PATH",
    sensitivity: "public",
    capability: "creative-studio",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_CREATIVE_STUDIO_DB_PATH", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_CREATIVE_STUDIO_DB_PATH for durable CreativeJobQueue SQLite persistence.",
  },
  // ── MercadoLibre OAuth ────────────────────────────────────────────
  {
    name: "MERCADOLIBRE_CLIENT_ID",
    sensitivity: "secret",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "always in production",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_CLIENT_ID", v, true),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_CLIENT_ID from your MercadoLibre developer application.",
  },
  {
    name: "MERCADOLIBRE_CLIENT_SECRET",
    sensitivity: "critical-secret",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "always in production",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_CLIENT_SECRET", v, true),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_CLIENT_SECRET from your MercadoLibre developer application.",
  },
  {
    name: "MERCADOLIBRE_REDIRECT_URI",
    sensitivity: "public",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "always in production",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_REDIRECT_URI", v, true),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_REDIRECT_URI to your OAuth redirect URI.",
  },
  {
    name: "MERCADOLIBRE_ACCESS_TOKEN",
    sensitivity: "critical-secret",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "if MERCADOLIBRE_SOURCE_ACCESS_TOKEN is not set",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_ACCESS_TOKEN", v, false),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_ACCESS_TOKEN or MERCADOLIBRE_SOURCE_ACCESS_TOKEN.",
  },
  {
    name: "MERCADOLIBRE_REFRESH_TOKEN",
    sensitivity: "critical-secret",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "if using legacy single-account OAuth",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_REFRESH_TOKEN", v, false),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_REFRESH_TOKEN for OAuth token refresh.",
  },
  {
    name: "MERCADOLIBRE_SELLER_ID",
    sensitivity: "secret",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "if using legacy single-account OAuth",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_SELLER_ID", v, false),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_SELLER_ID to the MercadoLibre seller/user ID.",
  },
  {
    name: "MERCADOLIBRE_SOURCE_ACCESS_TOKEN",
    sensitivity: "critical-secret",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "if using dual-account OAuth",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_SOURCE_ACCESS_TOKEN", v, false),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_SOURCE_ACCESS_TOKEN for Plasticov's API access.",
  },
  {
    name: "MSL_MERCADOLIBRE_OAUTH_DB_PATH",
    sensitivity: "public",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "always in production",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MSL_MERCADOLIBRE_OAUTH_DB_PATH", v, true),
    placeholderPatterns: [],
    remediation: "Set MSL_MERCADOLIBRE_OAUTH_DB_PATH for the MCP OAuth token store.",
  },
  {
    name: "MERCADOLIBRE_SOURCE_CLIENT_ID",
    sensitivity: "secret",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "if using dual-account OAuth",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_SOURCE_CLIENT_ID", v, false),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_SOURCE_CLIENT_ID for Plasticov's OAuth app.",
  },
  {
    name: "MERCADOLIBRE_SOURCE_CLIENT_SECRET",
    sensitivity: "critical-secret",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "if using dual-account OAuth",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_SOURCE_CLIENT_SECRET", v, false),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_SOURCE_CLIENT_SECRET for Plasticov's OAuth app.",
  },
  {
    name: "MERCADOLIBRE_SOURCE_REDIRECT_URI",
    sensitivity: "public",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "if using dual-account OAuth",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_SOURCE_REDIRECT_URI", v, false),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_SOURCE_REDIRECT_URI for Plasticov's OAuth callback.",
  },
  {
    name: "MERCADOLIBRE_TARGET_CLIENT_ID",
    sensitivity: "secret",
    capability: "mercadolibre-read-maustian",
    isRequiredFor: "if using dual-account OAuth",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_TARGET_CLIENT_ID", v, false),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_TARGET_CLIENT_ID for Maustian's OAuth app.",
  },
  {
    name: "MERCADOLIBRE_TARGET_CLIENT_SECRET",
    sensitivity: "critical-secret",
    capability: "mercadolibre-read-maustian",
    isRequiredFor: "if using dual-account OAuth",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_TARGET_CLIENT_SECRET", v, false),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_TARGET_CLIENT_SECRET for Maustian's OAuth app.",
  },
  {
    name: "MERCADOLIBRE_TARGET_REDIRECT_URI",
    sensitivity: "public",
    capability: "mercadolibre-read-maustian",
    isRequiredFor: "if using dual-account OAuth",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_TARGET_REDIRECT_URI", v, false),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_TARGET_REDIRECT_URI for Maustian's OAuth callback.",
  },
  {
    name: "MSL_OAUTH_STATE_SECRET",
    sensitivity: "critical-secret",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "if using OAuth",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MSL_OAUTH_STATE_SECRET", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_OAUTH_STATE_SECRET for HMAC state signing in OAuth callback.",
  },
  {
    name: "MERCADOLIBRE_SOURCE_SELLER_ID",
    sensitivity: "secret",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "if using dual-account sync",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_SOURCE_SELLER_ID", v, false),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_SOURCE_SELLER_ID to Plasticov's MercadoLibre user ID.",
  },
  {
    name: "MERCADOLIBRE_TARGET_SELLER_ID",
    sensitivity: "secret",
    capability: "mercadolibre-read-maustian",
    isRequiredFor: "if using dual-account sync",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MERCADOLIBRE_TARGET_SELLER_ID", v, false),
    placeholderPatterns: [],
    remediation: "Set MERCADOLIBRE_TARGET_SELLER_ID to Maustian's MercadoLibre user ID.",
  },
  // ── Persistence (SQLite) ──────────────────────────────────────────
  {
    name: "MSL_CHAT_SQLITE_PATH",
    sensitivity: "public",
    capability: "web-chat",
    isRequiredFor: "if MSL_AGENT_BUS_DB_PATH is not set",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MSL_CHAT_SQLITE_PATH", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_CHAT_SQLITE_PATH or MSL_AGENT_BUS_DB_PATH for chat persistence.",
  },
  {
    name: "MSL_AGENT_BUS_DB_PATH",
    sensitivity: "public",
    capability: "web-chat",
    isRequiredFor: "if MSL_CHAT_SQLITE_PATH is not set",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MSL_AGENT_BUS_DB_PATH", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_AGENT_BUS_DB_PATH or MSL_CHAT_SQLITE_PATH for agent message bus persistence.",
  },
  {
    name: "MSL_APPROVAL_QUEUE_DB_PATH",
    sensitivity: "public",
    capability: "mcp-server",
    isRequiredFor: "always in production",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MSL_APPROVAL_QUEUE_DB_PATH", v, true),
    placeholderPatterns: [],
    remediation: "Set MSL_APPROVAL_QUEUE_DB_PATH for the MCP approval queue database.",
  },
  {
    name: "MSL_CORTEX_SQLITE_PATH",
    sensitivity: "public",
    capability: "economic-truth",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_CORTEX_SQLITE_PATH", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_CORTEX_SQLITE_PATH for the shared Cortex graph database.",
  },
  // ── Security ──────────────────────────────────────────────────────
  {
    name: "MSL_ENCRYPTION_KEY",
    sensitivity: "critical-secret",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "always in production",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MSL_ENCRYPTION_KEY", v, true),
    placeholderPatterns: [],
    remediation: "Set MSL_ENCRYPTION_KEY with a long random value for OAuth token encryption.",
  },
  {
    name: "MSL_ALLOW_INSECURE_DEV_SECRETS",
    sensitivity: "conditional",
    capability: "mercadolibre-read-plasticov",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => {
      if (!v || v.trim() === "") {
        return { valid: true, status: "missing", reason: "MSL_ALLOW_INSECURE_DEV_SECRETS not set — dev fallback disabled" };
      }
      return { valid: true, status: "filled", reason: "Insecure dev secrets allowed (dev only)" };
    },
    placeholderPatterns: [],
    remediation: "Do NOT set MSL_ALLOW_INSECURE_DEV_SECRETS in production. This is a dev escape hatch only.",
  },
  {
    name: "MSL_ALLOW_UNAUTHENTICATED_LOCAL",
    sensitivity: "conditional",
    capability: "web-chat",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => {
      if (!v || v.trim() === "") {
        return { valid: true, status: "missing", reason: "MSL_ALLOW_UNAUTHENTICATED_LOCAL not set — authentication required" };
      }
      return { valid: true, status: "filled", reason: "Unauthenticated local access allowed (dev only)" };
    },
    placeholderPatterns: [],
    remediation: "Do NOT set MSL_ALLOW_UNAUTHENTICATED_LOCAL in production.",
  },
  {
    name: "MSL_API_KEY",
    sensitivity: "secret",
    capability: "web-chat",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_API_KEY", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_API_KEY as the Bearer token for /api/chat requests.",
  },
  {
    name: "MSL_CONVERSATION_ACCESS_TOKEN",
    sensitivity: "secret",
    capability: "web-chat",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_CONVERSATION_ACCESS_TOKEN", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_CONVERSATION_ACCESS_TOKEN for browser /conversacion access.",
  },
  {
    name: "MSL_MCP_API_KEY",
    sensitivity: "secret",
    capability: "mcp-server",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_MCP_API_KEY", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_MCP_API_KEY to protect the MCP server tools.",
  },
  {
    name: "MSL_CHAT_SELLER_ID",
    sensitivity: "public",
    capability: "web-chat",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_CHAT_SELLER_ID", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_CHAT_SELLER_ID to a non-demo seller ID for chat identity.",
  },
  {
    name: "MSL_CHAT_SELLER_NAME",
    sensitivity: "public",
    capability: "web-chat",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_CHAT_SELLER_NAME", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_CHAT_SELLER_NAME for chat seller display name.",
  },
  // ── Supplier Mirror / Jinpeng ─────────────────────────────────────
  {
    name: "MSL_PLASTICOV_SELLER_ID",
    sensitivity: "public",
    capability: "supplier-mirror",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_PLASTICOV_SELLER_ID", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_PLASTICOV_SELLER_ID for supplier mirror identity.",
  },
  {
    name: "MSL_MAUSTIAN_SELLER_ID",
    sensitivity: "public",
    capability: "supplier-mirror",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_MAUSTIAN_SELLER_ID", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_MAUSTIAN_SELLER_ID for supplier mirror identity.",
  },
  {
    name: "MSL_SUPPLIER_MIRROR_DB_PATH",
    sensitivity: "public",
    capability: "supplier-mirror",
    isRequiredFor: "if MSL_SUPPLIER_MIRROR_WORKER_ENABLED is true",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MSL_SUPPLIER_MIRROR_DB_PATH", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_SUPPLIER_MIRROR_DB_PATH for the Supplier Mirror SQLite database.",
  },
  {
    name: "MSL_SUPPLIER_MIRROR_WORKER_ENABLED",
    sensitivity: "public",
    capability: "supplier-mirror",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => {
      if (!v || v.trim() === "") {
        return { valid: true, status: "missing", reason: "Supplier Mirror worker disabled" };
      }
      return { valid: true, status: "filled", reason: `Supplier Mirror worker ${v.trim()}` };
    },
    placeholderPatterns: [],
    remediation: "Set MSL_SUPPLIER_MIRROR_WORKER_ENABLED=true to enable the Supplier Mirror worker.",
  },
  {
    name: "MSL_JINPENG_ML_SELLER_ID",
    sensitivity: "public",
    capability: "supplier-mirror",
    isRequiredFor: "if supplier mirror is enabled",
    alwaysOptional: false,
    validate: (v) => validateEnvValue("MSL_JINPENG_ML_SELLER_ID", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_JINPENG_ML_SELLER_ID to Jinpeng's MercadoLibre seller ID.",
  },
  {
    name: "MSL_JINPENG_ML_NICKNAME",
    sensitivity: "public",
    capability: "supplier-mirror",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_JINPENG_ML_NICKNAME", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_JINPENG_ML_NICKNAME for Jinpeng's display nickname.",
  },
  {
    name: "MSL_JINPENG_ML_PROFILE_URL",
    sensitivity: "public",
    capability: "supplier-mirror",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_JINPENG_ML_PROFILE_URL", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_JINPENG_ML_PROFILE_URL for Jinpeng's MercadoLibre profile.",
  },
  {
    name: "MSL_JINPENG_XKP_URL",
    sensitivity: "public",
    capability: "supplier-mirror",
    isRequiredFor: "",
    alwaysOptional: true,
    validate: (v) => validateEnvValue("MSL_JINPENG_XKP_URL", v, false),
    placeholderPatterns: [],
    remediation: "Set MSL_JINPENG_XKP_URL for XKP enrichment source.",
  },
];

// ── Lookup helpers ───────────────────────────────────────────────────

export function getConfigForCapability(capability: ProductionCapability): EnvVarDescriptor[] {
  return PRODUCTION_CONFIG_INVENTORY.filter((c) => c.capability === capability);
}

export function getConfigByName(name: string): EnvVarDescriptor | undefined {
  return PRODUCTION_CONFIG_INVENTORY.find((c) => c.name === name);
}

export function getAllCapabilities(): ProductionCapability[] {
  const seen = new Set<ProductionCapability>();
  for (const entry of PRODUCTION_CONFIG_INVENTORY) {
    seen.add(entry.capability);
  }
  return [...seen];
}
