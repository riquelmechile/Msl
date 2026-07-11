import { describe, expect, it } from "vitest";

import { assessProductionReadiness } from "./ProductionReadinessService.js";
import type { AssessReadinessInput } from "./ProductionReadinessService.js";
import { checkEnvironmentReadiness } from "./EnvironmentReadinessChecker.js";
import { checkSellerAccountReadiness } from "./SellerAccountReadinessChecker.js";
import { checkDatabaseReadiness } from "./DatabaseReadinessChecker.js";
import { checkProviderReadiness } from "./ProviderReadinessChecker.js";
import { checkRuntimeReadiness } from "./RuntimeReadinessChecker.js";
import { checkFeatureGateReadiness } from "./FeatureGateReadinessChecker.js";
import { checkSecurityReadiness } from "./SecurityReadinessChecker.js";
import type { ReadinessContext } from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────

function fakeEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    MSL_RUNTIME_MODE: "development",
    ...overrides,
  };
}

function isTruthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function makeCtx(overrides: Partial<AssessReadinessInput> = {}): ReadinessContext {
  const env = overrides.env ?? fakeEnv();
  const runtimeMode = overrides.runtimeMode ?? (env.MSL_RUNTIME_MODE || "development");
  return {
    runtimeMode,
    sellers: overrides.sellers ?? { plasticov: "plasticov-id", maustian: "maustian-id" },
    env,
    features: {
      creativeStudioEnabled: isTruthy(env.MSL_CREATIVE_STUDIO_ENABLED),
      supplierMirrorEnabled: isTruthy(env.MSL_SUPPLIER_MIRROR_WORKER_ENABLED),
      companyAgentAdminEnabled: isTruthy(env.MSL_COMPANY_AGENT_ADMIN_ENABLED),
      databaseIntegrityEnabled: isTruthy(env.MSL_DURABILITY_ENABLED),
      walHealthEnabled: isTruthy(env.MSL_DURABILITY_ENABLED),
    },
  };
}

function makeAssessInput(overrides: Partial<AssessReadinessInput> = {}): AssessReadinessInput {
  const env = overrides.env ?? fakeEnv();
  return {
    runtimeMode: overrides.runtimeMode ?? (env.MSL_RUNTIME_MODE || "development"),
    sellers: overrides.sellers ?? { plasticov: "plasticov-id", maustian: "maustian-id" },
    env,
  };
}


// ── EnvironmentReadinessChecker ─────────────────────────────────────

describe("EnvironmentReadinessChecker", () => {
  it("reports ready for production mode", () => {
    const ctx = makeCtx({ runtimeMode: "production" });
    const results = checkEnvironmentReadiness(ctx);
    const modeCheck = results.find((r) => r.checkId === "env-runtime-mode");
    expect(modeCheck?.status).toBe("ready");
  });

  it("reports degraded for development mode", () => {
    const ctx = makeCtx({ runtimeMode: "development" });
    const results = checkEnvironmentReadiness(ctx);
    const modeCheck = results.find((r) => r.checkId === "env-runtime-mode");
    expect(modeCheck?.status).toBe("degraded");
  });

  it("reports blocked for invalid runtime mode", () => {
    const ctx = makeCtx({ runtimeMode: "staging" });
    const results = checkEnvironmentReadiness(ctx);
    const modeCheck = results.find((r) => r.checkId === "env-runtime-mode");
    expect(modeCheck?.status).toBe("blocked");
  });

  it("reports ready when data dir is set", () => {
    const ctx = makeCtx({ env: fakeEnv({ MSL_DATA_DIR: "/data" }) });
    const results = checkEnvironmentReadiness(ctx);
    const check = results.find((r) => r.checkId === "env-data-dir");
    expect(check?.status).toBe("ready");
  });

  it("reports degraded when data dir is not set", () => {
    const ctx = makeCtx({ env: fakeEnv({ MSL_DATA_DIR: undefined }) });
    const results = checkEnvironmentReadiness(ctx);
    const check = results.find((r) => r.checkId === "env-data-dir");
    expect(check?.status).toBe("degraded");
  });
});

// ── SellerAccountReadinessChecker ───────────────────────────────────

describe("SellerAccountReadinessChecker", () => {
  it("blocks when plasticov seller ID is missing", () => {
    const ctx = makeCtx({
      env: fakeEnv({
        MERCADOLIBRE_SOURCE_SELLER_ID: undefined,
        MERCADOLIBRE_TARGET_SELLER_ID: "maustian-id",
      }),
    });
    const results = checkSellerAccountReadiness(ctx);
    const plasticovCheck = results.find(
      (r) => r.checkId === "seller-plasticov-id",
    );
    expect(plasticovCheck?.status).toBe("blocked");
    expect(plasticovCheck?.sellerId).toBe("plasticov");
  });

  it("ready when seller IDs are set", () => {
    const ctx = makeCtx({
      env: fakeEnv({
        MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov-id",
        MERCADOLIBRE_TARGET_SELLER_ID: "maustian-id",
      }),
    });
    const results = checkSellerAccountReadiness(ctx);
    const plasticovCheck = results.find(
      (r) => r.checkId === "seller-plasticov-id",
    );
    expect(plasticovCheck?.status).toBe("ready");
  });

  it("reports OAuth ready for dual-account config", () => {
    const ctx = makeCtx({
      env: fakeEnv({
        MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov-id",
        MERCADOLIBRE_TARGET_SELLER_ID: "maustian-id",
        MERCADOLIBRE_SOURCE_CLIENT_ID: "client-src",
        MERCADOLIBRE_SOURCE_CLIENT_SECRET: "secret-src",
        MERCADOLIBRE_SOURCE_REDIRECT_URI: "https://src.example.com/callback",
        MERCADOLIBRE_TARGET_CLIENT_ID: "client-tgt",
        MERCADOLIBRE_TARGET_CLIENT_SECRET: "secret-tgt",
        MERCADOLIBRE_TARGET_REDIRECT_URI: "https://tgt.example.com/callback",
      }),
    });
    const results = checkSellerAccountReadiness(ctx);
    const srcOauthCheck = results.find((r) => r.checkId === "seller-plasticov-oauth");
    expect(srcOauthCheck?.status).toBe("ready");
  });

  it("detects cross-binding when seller IDs are identical", () => {
    const ctx = makeCtx({
      env: fakeEnv({
        MERCADOLIBRE_SOURCE_SELLER_ID: "same-id",
        MERCADOLIBRE_TARGET_SELLER_ID: "same-id",
      }),
    });
    const results = checkSellerAccountReadiness(ctx);
    const crossCheck = results.filter((r) => r.checkId.includes("cross-binding"));
    expect(crossCheck.length).toBeGreaterThan(0);
    expect(crossCheck.every((r) => r.status === "blocked")).toBe(true);
  });
});

// ── ProviderReadinessChecker ────────────────────────────────────────

describe("ProviderReadinessChecker", () => {
  it("reports DeepSeek blocked when key missing", () => {
    const ctx = makeCtx({ env: fakeEnv({ DEEPSEEK_API_KEY: undefined }) });
    const results = checkProviderReadiness(ctx);
    const check = results.find((r) => r.checkId === "provider-deepseek");
    expect(check?.status).toBe("blocked");
  });

  it("reports DeepSeek ready when key is set", () => {
    const ctx = makeCtx({ env: fakeEnv({ DEEPSEEK_API_KEY: "sk-real" }) });
    const results = checkProviderReadiness(ctx);
    const check = results.find((r) => r.checkId === "provider-deepseek");
    expect(check?.status).toBe("ready");
  });

  it("reports MiniMax not-applicable when Creative Studio is disabled", () => {
    const ctx = makeCtx({
      env: fakeEnv({
        MSL_CREATIVE_STUDIO_ENABLED: "false",
      }),
    });
    const results = checkProviderReadiness(ctx);
    const check = results.find((r) => r.checkId === "provider-minimax");
    expect(check?.status).toBe("not-applicable");
  });

  it("reports MiniMax blocked when Creative Studio enabled but key missing", () => {
    const ctx = makeCtx({
      env: fakeEnv({
        MSL_CREATIVE_STUDIO_ENABLED: "true",
        MINIMAX_API_KEY: undefined,
      }),
    });
    const results = checkProviderReadiness(ctx);
    const check = results.find((r) => r.checkId === "provider-minimax");
    expect(check?.status).toBe("blocked");
  });

  it("reports Telegram blocked when bot token missing", () => {
    const ctx = makeCtx({ env: fakeEnv({ BOT_TOKEN: undefined }) });
    const results = checkProviderReadiness(ctx);
    const check = results.find((r) => r.checkId === "provider-bot-token");
    expect(check?.status).toBe("blocked");
  });

  it("reports Telegram ready when bot token is set", () => {
    const ctx = makeCtx({ env: fakeEnv({ BOT_TOKEN: "123456:ABCdef" }) });
    const results = checkProviderReadiness(ctx);
    const check = results.find((r) => r.checkId === "provider-bot-token");
    expect(check?.status).toBe("ready");
  });
});

// ── RuntimeReadinessChecker ─────────────────────────────────────────

describe("RuntimeReadinessChecker", () => {
  it("reports not-applicable for disabled features", () => {
    const ctx = makeCtx({
      env: fakeEnv({
        MSL_CREATIVE_STUDIO_ENABLED: "false",
        MSL_SUPPLIER_MIRROR_WORKER_ENABLED: "",
        MSL_COMPANY_AGENT_ADMIN_ENABLED: "",
      }),
    });
    const results = checkRuntimeReadiness(ctx);
    const creativeCheck = results.find((r) => r.checkId === "runtime-creative-studio-flag");
    expect(creativeCheck?.status).toBe("not-applicable");
  });

  it("reports ready for enabled features", () => {
    const ctx = makeCtx({
      env: fakeEnv({
        MSL_CREATIVE_STUDIO_ENABLED: "true",
        MSL_SUPPLIER_MIRROR_WORKER_ENABLED: "true",
        MSL_COMPANY_AGENT_ADMIN_ENABLED: "true",
      }),
    });
    const results = checkRuntimeReadiness(ctx);
    const creativeCheck = results.find((r) => r.checkId === "runtime-creative-studio-flag");
    expect(creativeCheck?.status).toBe("ready");
  });
});

// ── FeatureGateReadinessChecker ─────────────────────────────────────

describe("FeatureGateReadinessChecker", () => {
  it("reports blocked when supplier mirror enabled but Jinpeng ID missing", () => {
    const ctx = makeCtx({
      env: fakeEnv({
        MSL_SUPPLIER_MIRROR_WORKER_ENABLED: "true",
        MSL_JINPENG_ML_SELLER_ID: undefined,
      }),
    });
    const results = checkFeatureGateReadiness(ctx);
    const check = results.find((r) => r.checkId === "featgate-supplier-mirror-jinpeng-missing");
    expect(check?.status).toBe("blocked");
  });

  it("reports ready when chat db is configured", () => {
    const ctx = makeCtx({
      env: fakeEnv({ MSL_CHAT_SQLITE_PATH: "/data/chat.db" }),
    });
    const results = checkFeatureGateReadiness(ctx);
    const check = results.find((r) => r.checkId === "featgate-chat-db-present");
    expect(check?.status).toBe("ready");
  });

  it("reports degraded when no chat db is configured", () => {
    const ctx = makeCtx({
      env: fakeEnv({ MSL_CHAT_SQLITE_PATH: undefined, MSL_AGENT_BUS_DB_PATH: undefined }),
    });
    const results = checkFeatureGateReadiness(ctx);
    const check = results.find((r) => r.checkId === "featgate-chat-db-missing");
    expect(check?.status).toBe("degraded");
  });
});

// ── SecurityReadinessChecker ────────────────────────────────────────

describe("SecurityReadinessChecker", () => {
  it("reports blocked when encryption key is missing", () => {
    const ctx = makeCtx({ env: fakeEnv({ MSL_ENCRYPTION_KEY: undefined }) });
    const results = checkSecurityReadiness(ctx);
    const check = results.find((r) => r.checkId === "security-encryption-key");
    expect(check?.status).toBe("blocked");
  });

  it("reports ready when encryption key is valid", () => {
    const ctx = makeCtx({
      env: fakeEnv({ MSL_ENCRYPTION_KEY: "a-real-random-key-value" }),
    });
    const results = checkSecurityReadiness(ctx);
    const check = results.find((r) => r.checkId === "security-encryption-key");
    expect(check?.status).toBe("ready");
  });

  it("reports blocked for NEXT_PUBLIC_ secrets", () => {
    const ctx = makeCtx({
      env: fakeEnv({
        NEXT_PUBLIC_API_KEY: "exposed-key",
      }),
    });
    const results = checkSecurityReadiness(ctx);
    const nextPublicChecks = results.filter((r) => r.checkId.startsWith("security-next-public-"));
    expect(nextPublicChecks.length).toBeGreaterThan(0);
    expect(nextPublicChecks.every((r) => r.status === "blocked")).toBe(true);
  });

  it("reports blocked when insecure dev secrets is on in production", () => {
    const ctx = makeCtx({
      runtimeMode: "production",
      env: fakeEnv({ MSL_RUNTIME_MODE: "production", MSL_ALLOW_INSECURE_DEV_SECRETS: "true" }),
    });
    const results = checkSecurityReadiness(ctx);
    const check = results.find((r) => r.checkId === "security-insecure-dev-secrets");
    expect(check?.status).toBe("blocked");
  });

  it("reports degraded when insecure dev secrets on in dev", () => {
    const ctx = makeCtx({
      runtimeMode: "development",
      env: fakeEnv({ MSL_ALLOW_INSECURE_DEV_SECRETS: "true" }),
    });
    const results = checkSecurityReadiness(ctx);
    const check = results.find((r) => r.checkId === "security-insecure-dev-secrets");
    expect(check?.status).toBe("degraded");
  });
});

// ── DatabaseReadinessChecker ────────────────────────────────────────

describe("DatabaseReadinessChecker", () => {
  it("reports not-applicable for unset db paths", () => {
    const ctx = makeCtx({ env: fakeEnv({ MSL_APPROVAL_QUEUE_DB_PATH: undefined }) });
    const results = checkDatabaseReadiness(ctx);
    const check = results.find((r) => r.checkId === "db-msl-approval-queue-db-path");
    expect(check?.status).toBe("not-applicable");
  });

  it("reports blocked for :memory: in production", () => {
    const ctx = makeCtx({
      runtimeMode: "production",
      env: fakeEnv({ MSL_APPROVAL_QUEUE_DB_PATH: ":memory:" }),
    });
    const results = checkDatabaseReadiness(ctx);
    const memoryCheck = results.find((r) => r.checkId === "db-msl-approval-queue-db-path-memory");
    expect(memoryCheck?.status).toBe("blocked");
  });

  it("reports ready for :memory: in development", () => {
    const ctx = makeCtx({
      runtimeMode: "development",
      env: fakeEnv({ MSL_APPROVAL_QUEUE_DB_PATH: ":memory:" }),
    });
    const results = checkDatabaseReadiness(ctx);
    const memoryCheck = results.find((r) => r.checkId === "db-msl-approval-queue-db-path-memory");
    expect(memoryCheck?.status).toBe("ready");
  });

  it("detects shared path conflicts", () => {
    const ctx = makeCtx({
      env: fakeEnv({
        MSL_CHAT_SQLITE_PATH: "/same/path.db",
        MSL_AGENT_BUS_DB_PATH: "/same/path.db",
      }),
    });
    const results = checkDatabaseReadiness(ctx);
    const conflict = results.find((r) => r.checkId === "db-chat-bus-conflict");
    expect(conflict?.status).toBe("blocked");
  });

  it("reports ready for valid writeable paths", () => {
    // Use /tmp which should be writeable on any system
    const ctx = makeCtx({
      env: fakeEnv({
        MSL_APPROVAL_QUEUE_DB_PATH: "/tmp/msl-test-approvals.db",
        MSL_CHAT_SQLITE_PATH: "/tmp/msl-test-chat.db",
      }),
    });
    const results = checkDatabaseReadiness(ctx);
    const approvalCheck = results.find((r) => r.checkId === "db-msl-approval-queue-db-path");
    expect(approvalCheck?.status).toBe("ready");
  });
});

// ── assessProductionReadiness (integration) ─────────────────────────

describe("assessProductionReadiness (integration)", () => {
  it("generates a report with all capabilities", () => {
    const report = assessProductionReadiness(
      makeAssessInput({ runtimeMode: "development", env: fakeEnv() }),
    );
    expect(report.reportId).toBeTruthy();
    expect(report.runtimeMode).toBe("development");
    expect(report.noMutationExecuted).toBe(true);
    expect(report.capabilities).toBeDefined();
    expect(report.sellerReports).toHaveLength(2);
  });

  it("computes overall status as blocked when any capability is blocked", () => {
    const report = assessProductionReadiness(
      makeAssessInput({
        runtimeMode: "production",
        env: fakeEnv({
          MSL_RUNTIME_MODE: "production",
          // Missing all critical keys
        }),
      }),
    );
    // With no keys set, many things should be blocked
    expect(report.overallStatus).toBe("blocked");
    expect(report.blockers.length).toBeGreaterThan(0);
  });

  it("includes seller reports for both plasticov and maustian", () => {
    const report = assessProductionReadiness(
      makeAssessInput({
        env: fakeEnv({
          MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov-id",
          MERCADOLIBRE_TARGET_SELLER_ID: "maustian-id",
        }),
      }),
    );
    expect(report.sellerReports.map((s) => s.sellerId).sort()).toEqual([
      "maustian",
      "plasticov",
    ]);
  });

  it("includes remediation plan for blocked capabilities", () => {
    const report = assessProductionReadiness(
      makeAssessInput({
        runtimeMode: "production",
        env: fakeEnv({ MSL_RUNTIME_MODE: "staging" }),
      }),
    );
    // Invalid runtime mode should produce a blocker
    expect(report.remediationPlan.length).toBeGreaterThan(0);
  });

  it("noMutationExecuted is always true", () => {
    const report = assessProductionReadiness(makeAssessInput({ env: fakeEnv() }));
    expect(report.noMutationExecuted).toBe(true);
  });

  it("all checks have noMutationExecuted: true", () => {
    const report = assessProductionReadiness(makeAssessInput({ env: fakeEnv() }));
    const allChecks = [
      ...report.blockers,
      ...report.warnings,
      ...report.sellerReports.flatMap((s) => s.checks),
    ];
    for (const check of allChecks) {
      expect(check.noMutationExecuted).toBe(true);
    }
  });

  it("seller reports include oauth and encryption readiness", () => {
    const report = assessProductionReadiness(
      makeAssessInput({
        env: fakeEnv({
          MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov-id",
          MERCADOLIBRE_TARGET_SELLER_ID: "maustian-id",
          MERCADOLIBRE_SOURCE_CLIENT_ID: "src-client",
          MERCADOLIBRE_SOURCE_CLIENT_SECRET: "src-secret",
          MERCADOLIBRE_SOURCE_REDIRECT_URI: "https://src.example.com",
        }),
      }),
    );
    const plasticov = report.sellerReports.find((s) => s.sellerId === "plasticov");
    expect(plasticov?.oauthBinding).toBeDefined();
    expect(plasticov?.encryptionReadiness).toBeDefined();
  });

  it("produces consistent capacity lists", () => {
    const report = assessProductionReadiness(makeAssessInput({ env: fakeEnv() }));
    const allCaps = new Set([
      ...report.readyCapabilities,
      ...report.disabledCapabilities,
    ]);
    // Blocked capabilities may not be in ready or disabled lists — they're in blockers
    // The union of ready+disabled+blocked should cover all capabilities
    const blockedCaps = new Set(report.blockers.map((b) => b.capability));
    const allReported = new Set([...allCaps, ...blockedCaps]);
    expect(allReported.size).toBeGreaterThan(0);
  });
});
