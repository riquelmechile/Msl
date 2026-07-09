import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { validateRuntimeEnv } from "../../src/conversation/validateEnv.js";

// ── Save & restore process.env ─────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

beforeEach(() => {
  // Clear all relevant env vars before each test
  const keys: string[] = [
    "MSL_CORTEX_SQLITE_PATH",
    "MSL_CREATIVE_STUDIO_ENABLED",
    "MINIMAX_API_HOST",
    "MINIMAX_BASE_URL",
    "MSL_CREATIVE_STUDIO_STORAGE_PATH",
    "MSL_WEBHOOK_PORT",
  ];
  for (const key of keys) {
    delete process.env[key];
  }
});

afterEach(() => {
  // Restore original env
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

describe("validateRuntimeEnv", () => {
  it("returns valid=true when all required vars are present", () => {
    setEnv("MSL_CORTEX_SQLITE_PATH", "/data/cortex.db");
    setEnv("MSL_WEBHOOK_PORT", "8080");

    const result = validateRuntimeEnv();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports missing MSL_CORTEX_SQLITE_PATH as an error", () => {
    // Don't set MSL_CORTEX_SQLITE_PATH
    const result = validateRuntimeEnv();
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.includes("MSL_CORTEX_SQLITE_PATH"))).toBe(true);
  });

  it("reports no error for missing MSL_CORTEX_SQLITE_PATH when creative is disabled", () => {
    setEnv("MSL_CREATIVE_STUDIO_ENABLED", "false");
    // Need to keep MSL_CORTEX_SQLITE_PATH set — it's always required
    setEnv("MSL_CORTEX_SQLITE_PATH", "/data/cortex.db");
    setEnv("MSL_WEBHOOK_PORT", "8080");

    const result = validateRuntimeEnv();
    expect(result.valid).toBe(true);
  });

  it("requires MINIMAX_API_HOST or MINIMAX_BASE_URL when creative studio enabled", () => {
    setEnv("MSL_CORTEX_SQLITE_PATH", "/data/cortex.db");
    setEnv("MSL_CREATIVE_STUDIO_ENABLED", "true");
    // Neither MINIMAX_API_HOST nor MINIMAX_BASE_URL set

    const result = validateRuntimeEnv();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("MINIMAX_API_HOST"))).toBe(true);
  });

  it("passes when MINIMAX_API_HOST is set and creative studio enabled", () => {
    setEnv("MSL_CORTEX_SQLITE_PATH", "/data/cortex.db");
    setEnv("MSL_CREATIVE_STUDIO_ENABLED", "true");
    setEnv("MINIMAX_API_HOST", "https://api.minimax.chat");

    const result = validateRuntimeEnv();
    expect(result.valid).toBe(true);
  });

  it("passes when MINIMAX_BASE_URL fallback is set and creative studio enabled", () => {
    setEnv("MSL_CORTEX_SQLITE_PATH", "/data/cortex.db");
    setEnv("MSL_CREATIVE_STUDIO_ENABLED", "true");
    setEnv("MINIMAX_BASE_URL", "https://api.minimax.io");

    const result = validateRuntimeEnv();
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("deprecated"))).toBe(true);
  });

  it("warns when MINIMAX_BASE_URL and MINIMAX_API_HOST differ", () => {
    setEnv("MSL_CORTEX_SQLITE_PATH", "/data/cortex.db");
    setEnv("MSL_CREATIVE_STUDIO_ENABLED", "true");
    setEnv("MINIMAX_API_HOST", "https://api.minimax.chat");
    setEnv("MINIMAX_BASE_URL", "https://api-old.minimax.io");

    const result = validateRuntimeEnv();
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("differs"))).toBe(true);
  });

  it("warns when MSL_WEBHOOK_PORT is not set", () => {
    setEnv("MSL_CORTEX_SQLITE_PATH", "/data/cortex.db");

    const result = validateRuntimeEnv();
    expect(result.warnings.some((w) => w.includes("MSL_WEBHOOK_PORT"))).toBe(true);
  });

  it("allows creative studio disabled to skip MINIMAX checks", () => {
    setEnv("MSL_CORTEX_SQLITE_PATH", "/data/cortex.db");
    setEnv("MSL_WEBHOOK_PORT", "8080");
    setEnv("MSL_CREATIVE_STUDIO_ENABLED", "false");

    const result = validateRuntimeEnv();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    // No MINIMAX-related errors because creative studio is disabled
    expect(result.errors.some((e) => e.includes("MINIMAX"))).toBe(false);
  });

  it("warns about missing storage path when creative studio is enabled", () => {
    setEnv("MSL_CORTEX_SQLITE_PATH", "/data/cortex.db");
    setEnv("MSL_CREATIVE_STUDIO_ENABLED", "true");
    setEnv("MINIMAX_API_HOST", "https://api.minimax.chat");
    // MSL_CREATIVE_STUDIO_STORAGE_PATH not set

    const result = validateRuntimeEnv();
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("MSL_CREATIVE_STUDIO_STORAGE_PATH"))).toBe(true);
  });
});
