import { describe, expect, it } from "vitest";

import {
  PRODUCTION_CONFIG_INVENTORY,
  getConfigByName,
  getConfigForCapability,
  getAllCapabilities,
} from "./productionConfig.js";

describe("PRODUCTION_CONFIG_INVENTORY", () => {
  it("contains entries for all expected env vars", () => {
    const names = PRODUCTION_CONFIG_INVENTORY.map((e) => e.name);
    expect(names).toContain("DEEPSEEK_API_KEY");
    expect(names).toContain("BOT_TOKEN");
    expect(names).toContain("MINIMAX_API_KEY");
    expect(names).toContain("MSL_CREATIVE_STUDIO_ENABLED");
    expect(names).toContain("MERCADOLIBRE_CLIENT_ID");
    expect(names).toContain("MERCADOLIBRE_CLIENT_SECRET");
    expect(names).toContain("MERCADOLIBRE_REDIRECT_URI");
    expect(names).toContain("MERCADOLIBRE_ACCESS_TOKEN");
    expect(names).toContain("MERCADOLIBRE_REFRESH_TOKEN");
    expect(names).toContain("MERCADOLIBRE_SELLER_ID");
    expect(names).toContain("MERCADOLIBRE_SOURCE_ACCESS_TOKEN");
    expect(names).toContain("MSL_MERCADOLIBRE_OAUTH_DB_PATH");
    expect(names).toContain("MERCADOLIBRE_SOURCE_CLIENT_ID");
    expect(names).toContain("MERCADOLIBRE_SOURCE_CLIENT_SECRET");
    expect(names).toContain("MERCADOLIBRE_SOURCE_REDIRECT_URI");
    expect(names).toContain("MERCADOLIBRE_TARGET_CLIENT_ID");
    expect(names).toContain("MERCADOLIBRE_TARGET_CLIENT_SECRET");
    expect(names).toContain("MERCADOLIBRE_TARGET_REDIRECT_URI");
    expect(names).toContain("MSL_OAUTH_STATE_SECRET");
    expect(names).toContain("MERCADOLIBRE_SOURCE_SELLER_ID");
    expect(names).toContain("MERCADOLIBRE_TARGET_SELLER_ID");
    expect(names).toContain("MSL_TELEGRAM_ADMIN_CHAT_IDS");
    expect(names).toContain("MSL_TELEGRAM_ADMIN_USER_IDS");
    expect(names).toContain("MSL_TELEGRAM_SQLITE_PATH");
    expect(names).toContain("MSL_TELEGRAM_CORTEX_SQLITE_PATH");
    expect(names).toContain("MSL_TELEGRAM_ACTIVE_COMPANY_AGENT_ID");
    expect(names).toContain("MSL_COMPANY_AGENT_ADMIN_ENABLED");
    expect(names).toContain("MSL_CHAT_SQLITE_PATH");
    expect(names).toContain("MSL_AGENT_BUS_DB_PATH");
    expect(names).toContain("MSL_APPROVAL_QUEUE_DB_PATH");
    expect(names).toContain("MSL_CORTEX_SQLITE_PATH");
    expect(names).toContain("MSL_ENCRYPTION_KEY");
    expect(names).toContain("MSL_ALLOW_INSECURE_DEV_SECRETS");
    expect(names).toContain("MSL_ALLOW_UNAUTHENTICATED_LOCAL");
    expect(names).toContain("MSL_API_KEY");
    expect(names).toContain("MSL_CONVERSATION_ACCESS_TOKEN");
    expect(names).toContain("MSL_MCP_API_KEY");
    expect(names).toContain("MSL_CHAT_SELLER_ID");
    expect(names).toContain("MSL_CHAT_SELLER_NAME");
    expect(names).toContain("MSL_PLASTICOV_SELLER_ID");
    expect(names).toContain("MSL_MAUSTIAN_SELLER_ID");
    expect(names).toContain("MSL_SUPPLIER_MIRROR_DB_PATH");
    expect(names).toContain("MSL_SUPPLIER_MIRROR_WORKER_ENABLED");
    expect(names).toContain("MSL_JINPENG_ML_SELLER_ID");
    expect(names).toContain("MSL_JINPENG_ML_NICKNAME");
    expect(names).toContain("MSL_JINPENG_ML_PROFILE_URL");
    expect(names).toContain("MSL_JINPENG_XKP_URL");
    expect(names).toContain("MSL_RUNTIME_MODE");
    expect(names).toContain("MSL_APP_DIR");
    expect(names).toContain("MSL_DATA_DIR");
    expect(names).toContain("MSL_LOG_DIR");
    expect(names).toContain("MINIMAX_API_HOST");
    expect(names).toContain("MINIMAX_BASE_URL");
    expect(names).toContain("MINIMAX_IMAGE_MODEL");
    expect(names).toContain("MINIMAX_VIDEO_MODEL");
    expect(names).toContain("MINIMAX_REQUEST_TIMEOUT_MS");
    expect(names).toContain("MSL_CREATIVE_STUDIO_MAX_DAILY_USD");
    expect(names).toContain("MSL_CREATIVE_STUDIO_MAX_JOB_USD");
    expect(names).toContain("MSL_CREATIVE_STUDIO_STORAGE_PATH");
    expect(names).toContain("MSL_CREATIVE_STUDIO_ML_AUTO_DIAGNOSE");
    expect(names).toContain("ML_API_TOKEN");
    expect(names).toContain("MSL_CREATIVE_STUDIO_MAX_CONCURRENT_JOBS");
    expect(names).toContain("MSL_CREATIVE_STUDIO_MIN_COOLDOWN_MS");
    expect(names).toContain("MSL_CREATIVE_STUDIO_DB_PATH");
    expect(names).toContain("DEEPSEEK_BASE_URL");
    expect(names).toContain("DEEPSEEK_MODEL");
  });

  it("all entries have unique names", () => {
    const names = PRODUCTION_CONFIG_INVENTORY.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("all entries have a validate function", () => {
    for (const entry of PRODUCTION_CONFIG_INVENTORY) {
      expect(typeof entry.validate).toBe("function");
    }
  });

  it("critical secrets have correct sensitivity", () => {
    const criticalNames = PRODUCTION_CONFIG_INVENTORY.filter(
      (e) => e.sensitivity === "critical-secret",
    ).map((e) => e.name);
    expect(criticalNames).toContain("DEEPSEEK_API_KEY");
    expect(criticalNames).toContain("BOT_TOKEN");
    expect(criticalNames).toContain("MINIMAX_API_KEY");
    expect(criticalNames).toContain("MERCADOLIBRE_CLIENT_SECRET");
    expect(criticalNames).toContain("MSL_ENCRYPTION_KEY");
    expect(criticalNames).toContain("MSL_OAUTH_STATE_SECRET");
  });

  it("validates filled values correctly", () => {
    const deepseekConfig = getConfigByName("DEEPSEEK_API_KEY")!;
    const result = deepseekConfig.validate("sk-real-api-key");
    expect(result.status).toBe("filled");
    expect(result.valid).toBe(true);
  });

  it("validates missing required values", () => {
    const deepseekConfig = getConfigByName("DEEPSEEK_API_KEY")!;
    const result = deepseekConfig.validate(undefined);
    expect(result.status).toBe("missing");
    expect(result.valid).toBe(false);
  });

  it("validates missing optional values as valid", () => {
    const baseUrlConfig = getConfigByName("DEEPSEEK_BASE_URL")!;
    const result = baseUrlConfig.validate(undefined);
    expect(result.valid).toBe(true);
  });

  it("detects placeholder values", () => {
    const deepseekConfig = getConfigByName("DEEPSEEK_API_KEY")!;
    const result = deepseekConfig.validate("test-key");
    expect(result.status).toBe("placeholder");
    expect(result.valid).toBe(false);
  });

  it("validates MSL_RUNTIME_MODE correctly", () => {
    const config = getConfigByName("MSL_RUNTIME_MODE")!;
    expect(config.validate("production").valid).toBe(true);
    expect(config.validate("development").valid).toBe(true);
    expect(config.validate("staging").valid).toBe(false);
    expect(config.validate("staging").status).toBe("malformed");
  });
});

describe("getConfigForCapability", () => {
  it("returns entries for deepseek-reasoning", () => {
    const entries = getConfigForCapability("deepseek-reasoning");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((e) => e.name)).toContain("DEEPSEEK_API_KEY");
  });

  it("returns entries for creative-studio", () => {
    const entries = getConfigForCapability("creative-studio");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((e) => e.name)).toContain("MINIMAX_API_KEY");
  });
});

describe("getConfigByName", () => {
  it("returns the correct entry", () => {
    const entry = getConfigByName("DEEPSEEK_API_KEY");
    expect(entry).toBeDefined();
    expect(entry!.sensitivity).toBe("critical-secret");
  });

  it("returns undefined for unknown variable", () => {
    expect(getConfigByName("UNKNOWN_VAR")).toBeUndefined();
  });
});

describe("getAllCapabilities", () => {
  it("returns all unique capabilities", () => {
    const caps = getAllCapabilities();
    expect(caps).toContain("deepseek-reasoning");
    expect(caps).toContain("telegram-ceo");
    expect(caps).toContain("creative-studio");
    expect(caps).toContain("supplier-mirror");
    expect(caps).toContain("mercadolibre-read-plasticov");
    expect(caps).toContain("mercadolibre-read-maustian");
    expect(caps).toContain("web-chat");
    expect(caps).toContain("mcp-server");
    expect(caps).toContain("background-workers");
    expect(caps).toContain("economic-truth");
  });
});
