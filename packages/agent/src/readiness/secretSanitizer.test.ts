import { describe, expect, it } from "vitest";

import { sanitizeSecret, sanitizeEnv } from "./secretSanitizer.js";

// ── sanitizeSecret ──────────────────────────────────────────────────

describe("sanitizeSecret", () => {
  it('returns "[missing]" for undefined', () => {
    expect(sanitizeSecret("DEEPSEEK_API_KEY", undefined)).toBe("[missing]");
  });

  it('returns "[missing]" for empty string', () => {
    expect(sanitizeSecret("DEEPSEEK_API_KEY", "")).toBe("[missing]");
  });

  it('returns "[placeholder]" for test values', () => {
    expect(sanitizeSecret("DEEPSEEK_API_KEY", "test-key")).toBe("[placeholder]");
    expect(sanitizeSecret("BOT_TOKEN", "example-token")).toBe("[placeholder]");
    expect(sanitizeSecret("MINIMAX_API_KEY", "changeme")).toBe("[placeholder]");
    expect(sanitizeSecret("MERCADOLIBRE_CLIENT_SECRET", "your-secret")).toBe("[placeholder]");
    expect(sanitizeSecret("MSL_ENCRYPTION_KEY", "xxx-key")).toBe("[placeholder]");
    expect(sanitizeSecret("MSL_ENCRYPTION_KEY", "placeholder-key")).toBe("[placeholder]");
    expect(sanitizeSecret("MSL_ENCRYPTION_KEY", "dummy")).toBe("[placeholder]");
  });

  it('returns "[present]" for keys containing "key"', () => {
    expect(sanitizeSecret("DEEPSEEK_API_KEY", "sk-real-value")).toBe("[present]");
    expect(sanitizeSecret("MINIMAX_API_KEY", "mm-real-value")).toBe("[present]");
    expect(sanitizeSecret("MSL_ENCRYPTION_KEY", "enc-real-value")).toBe("[present]");
    expect(sanitizeSecret("MSL_API_KEY", "api-real-value")).toBe("[present]");
    expect(sanitizeSecret("MSL_MCP_API_KEY", "mcp-real-value")).toBe("[present]");
  });

  it('returns "[present]" for keys containing "secret"', () => {
    expect(sanitizeSecret("MERCADOLIBRE_CLIENT_SECRET", "real-secret")).toBe("[present]");
    expect(sanitizeSecret("MSL_OAUTH_STATE_SECRET", "real-state-secret")).toBe("[present]");
  });

  it('returns "[present]" for keys containing "token"', () => {
    expect(sanitizeSecret("BOT_TOKEN", "123456:ABCdef")).toBe("[present]");
    expect(sanitizeSecret("MERCADOLIBRE_ACCESS_TOKEN", "APP_USR-123")).toBe("[present]");
    expect(sanitizeSecret("MERCADOLIBRE_SOURCE_ACCESS_TOKEN", "APP_USR-456")).toBe("[present]");
    expect(sanitizeSecret("MSL_CONVERSATION_ACCESS_TOKEN", "tok-xxx")).toBe("[present]");
    expect(sanitizeSecret("ML_API_TOKEN", "ml-tok-xxx")).toBe("[present]");
  });

  it('returns "[present]" for keys containing "auth"', () => {
    expect(sanitizeSecret("SOME_AUTH_VALUE", "real-auth")).toBe("[present]");
  });

  it("shows paths as-is", () => {
    expect(sanitizeSecret("MSL_CHAT_SQLITE_PATH", "/data/chat.db")).toBe("/data/chat.db");
    expect(sanitizeSecret("MSL_APPROVAL_QUEUE_DB_PATH", "/data/approvals.db")).toBe(
      "/data/approvals.db",
    );
    expect(sanitizeSecret("MSL_CORTEX_SQLITE_PATH", ":memory:")).toBe(":memory:");
    expect(sanitizeSecret("MSL_LOG_DIR", "/var/log/msl")).toBe("/var/log/msl");
  });

  it("shows URLs and hosts as-is", () => {
    expect(sanitizeSecret("MINIMAX_API_HOST", "https://api.minimaxi.com")).toBe(
      "https://api.minimaxi.com",
    );
    expect(sanitizeSecret("DEEPSEEK_BASE_URL", "https://api.deepseek.com")).toBe(
      "https://api.deepseek.com",
    );
    expect(sanitizeSecret("MINIMAX_BASE_URL", "https://custom.endpoint.com")).toBe(
      "https://custom.endpoint.com",
    );
  });

  it("shows mode and enabled flags as-is", () => {
    expect(sanitizeSecret("MSL_RUNTIME_MODE", "production")).toBe("production");
    expect(sanitizeSecret("MSL_CREATIVE_STUDIO_ENABLED", "true")).toBe("true");
    expect(sanitizeSecret("MSL_SUPPLIER_MIRROR_WORKER_ENABLED", "false")).toBe("false");
  });

  it("shows model names as-is", () => {
    expect(sanitizeSecret("DEEPSEEK_MODEL", "deepseek-v4-flash")).toBe("deepseek-v4-flash");
    expect(sanitizeSecret("MINIMAX_IMAGE_MODEL", "image-01")).toBe("image-01");
  });

  it("shows IDs as-is", () => {
    expect(sanitizeSecret("MSL_CHAT_SELLER_ID", "seller123")).toBe("seller123");
    expect(sanitizeSecret("MSL_TELEGRAM_ADMIN_CHAT_IDS", "12345,67890")).toBe("12345,67890");
    expect(sanitizeSecret("MERCADOLIBRE_SELLER_ID", "123456789")).toBe("123456789");
  });
});

// ── sanitizeEnv ─────────────────────────────────────────────────────

describe("sanitizeEnv", () => {
  it("sanitizes a full env map", () => {
    const env = {
      DEEPSEEK_API_KEY: "sk-real-value",
      BOT_TOKEN: "123456:ABCdef",
      MSL_CHAT_SQLITE_PATH: "/data/chat.db",
      MSL_RUNTIME_MODE: "production",
      MERCADOLIBRE_CLIENT_ID: "12345", // "id" in key → shown as-is
      MERCADOLIBRE_CLIENT_SECRET: "real-secret",
      MSL_LOGS_DIR: "/var/log/msl",
    };

    const sanitized = sanitizeEnv(env);

    expect(sanitized.DEEPSEEK_API_KEY).toBe("[present]");
    expect(sanitized.BOT_TOKEN).toBe("[present]");
    expect(sanitized.MSL_CHAT_SQLITE_PATH).toBe("/data/chat.db");
    expect(sanitized.MSL_RUNTIME_MODE).toBe("production");
    expect(sanitized.MERCADOLIBRE_CLIENT_ID).toBe("12345"); // "id" is in the allowed list
    expect(sanitized.MERCADOLIBRE_CLIENT_SECRET).toBe("[present]");
    expect(sanitized.MSL_LOGS_DIR).toBe("/var/log/msl");
  });

  it("handles missing values", () => {
    const env = {
      DEEPSEEK_API_KEY: undefined,
      MSL_CHAT_SQLITE_PATH: "",
    };
    const sanitized = sanitizeEnv(env);
    expect(sanitized.DEEPSEEK_API_KEY).toBe("[missing]");
    expect(sanitized.MSL_CHAT_SQLITE_PATH).toBe("[missing]");
  });
});
