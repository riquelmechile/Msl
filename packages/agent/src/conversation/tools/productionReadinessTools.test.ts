import { describe, expect, it } from "vitest";

import { createInspectProductionReadinessTool } from "./productionReadinessTools.js";

// ── Helpers ─────────────────────────────────────────────────────────

function fakeEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    MSL_RUNTIME_MODE: "development",
    ...overrides,
  };
}

// ── inspect_production_readiness ────────────────────────────────────

describe("createInspectProductionReadinessTool", () => {
  it("returns a tool definition with correct name", () => {
    const tool = createInspectProductionReadinessTool(fakeEnv());
    expect(tool.name).toBe("inspect_production_readiness");
    expect(tool.description).toContain("Inspect MSL production readiness");
  });

  it("returns full report with noExternalMutationExecuted: true", () => {
    const tool = createInspectProductionReadinessTool(fakeEnv());
    const result = tool.execute({}) as Record<string, unknown>;

    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.overallStatus).toBeDefined();
    expect(result.runtimeMode).toBe("development");
    expect(Array.isArray(result.blockers)).toBe(true);
    expect(Array.isArray(result.remediationPlan)).toBe(true);
    expect(Array.isArray(result.sellerReports)).toBe(true);
    expect(Array.isArray(result.readyCapabilities)).toBe(true);
  });

  it("filters by capability", () => {
    const tool = createInspectProductionReadinessTool(
      fakeEnv({
        DEEPSEEK_API_KEY: "sk-real",
        BOT_TOKEN: "123456:ABCdef",
        MSL_ENCRYPTION_KEY: "real-key",
      }),
    );
    const result = tool.execute({ capability: "deepseek-reasoning" }) as Record<string, unknown>;

    expect(result.capability).toBe("deepseek-reasoning");
    expect(result.status).toBeDefined();
    expect(result.noExternalMutationExecuted).toBe(true);
    // Should have blockers/warnings arrays
    expect(Array.isArray(result.blockers)).toBe(true);
  });

  it("filters by seller", () => {
    const tool = createInspectProductionReadinessTool(
      fakeEnv({
        MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov-id",
        MERCADOLIBRE_TARGET_SELLER_ID: "maustian-id",
      }),
    );
    const result = tool.execute({ sellerId: "plasticov" }) as Record<string, unknown>;

    expect(Array.isArray(result.sellerReports)).toBe(true);
    const reports = result.sellerReports as Array<Record<string, unknown>>;
    expect(reports.length).toBe(1);
    expect(reports[0]?.sellerId).toBe("plasticov");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("does not leak secrets in output", () => {
    const tool = createInspectProductionReadinessTool(
      fakeEnv({
        DEEPSEEK_API_KEY: "sk-real-secret-value",
        BOT_TOKEN: "123456:ABCdefGHIjkl",
        MERCADOLIBRE_CLIENT_SECRET: "super-secret-client-secret",
        MSL_ENCRYPTION_KEY: "encryption-key-value",
      }),
    );
    const result = tool.execute({}) as Record<string, unknown>;

    // Deep-dive: check that no result contains raw secrets
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain("sk-real-secret-value");
    expect(resultJson).not.toContain("123456:ABCdefGHIjkl");
    expect(resultJson).not.toContain("super-secret-client-secret");
    expect(resultJson).not.toContain("encryption-key-value");
  });

  it("handles empty args gracefully", () => {
    const tool = createInspectProductionReadinessTool(fakeEnv());
    const result = tool.execute({}) as Record<string, unknown>;
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.overallStatus).toBeDefined();
  });

  it("handles null/undefined args gracefully", () => {
    const tool = createInspectProductionReadinessTool(fakeEnv());
    // Execute with explicit null args
    const result = tool.execute({ capability: null, sellerId: null }) as Record<string, unknown>;
    expect(result.noExternalMutationExecuted).toBe(true);
    // Should return full report since null filters get coerced to undefined
    expect(result.overallStatus).toBeDefined();
  });
});
