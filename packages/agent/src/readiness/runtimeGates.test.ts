import { describe, expect, it } from "vitest";

import {
  assertProductionCapabilityReady,
  assertSellerCapabilityReady,
} from "./runtimeGates.js";
import {
  createProductionReadinessReport,
  createReadinessCheckResult,
  createSellerReadinessReport,
} from "./types.js";
import type { ProductionCapability, ProductionReadinessReport } from "./types.js";

// ── Test helpers ────────────────────────────────────────────────────

function makeBlockedReport(): ProductionReadinessReport {
  const blockers = [
    createReadinessCheckResult({
      checkId: "test-blocker",
      capability: "deepseek-reasoning",
      status: "blocked",
      safeMessage: "DeepSeek key missing",
      remediation: "Set DEEPSEEK_API_KEY",
    }),
  ];
  return createProductionReadinessReport({
    runtimeMode: "production",
    overallStatus: "blocked",
    blockers,
    capabilities: { "deepseek-reasoning": "blocked", "telegram-ceo": "ready" } as Record<
      ProductionCapability,
      "blocked" | "ready"
    >,
    sellerReports: [
      createSellerReadinessReport({
        sellerId: "plasticov",
        accountName: "Plasticov",
        overallStatus: "blocked",
        capabilities: { "deepseek-reasoning": "blocked" },
        checks: blockers,
      }),
    ],
  });
}

function makeReadyReport(): ProductionReadinessReport {
  return createProductionReadinessReport({
    runtimeMode: "production",
    overallStatus: "ready",
    capabilities: { "deepseek-reasoning": "ready", "telegram-ceo": "ready" } as Record<
      ProductionCapability,
      "ready"
    >,
  });
}

// ── assertProductionCapabilityReady ─────────────────────────────────

describe("assertProductionCapabilityReady", () => {
  it("does not throw in dev mode even when blocked", () => {
    const report = makeBlockedReport();
    expect(() =>
      assertProductionCapabilityReady("deepseek-reasoning", undefined, report, {
        runtimeMode: "development",
      }),
    ).not.toThrow();
  });

  it("does not throw in test mode even when blocked", () => {
    const report = makeBlockedReport();
    expect(() =>
      assertProductionCapabilityReady("deepseek-reasoning", undefined, report, {
        runtimeMode: "test",
      }),
    ).not.toThrow();
  });

  it("throws in production when capability is blocked", () => {
    const report = makeBlockedReport();
    expect(() =>
      assertProductionCapabilityReady("deepseek-reasoning", undefined, report, {
        runtimeMode: "production",
      }),
    ).toThrow(/Production capability "deepseek-reasoning" is blocked/);
  });

  it("does not throw in production when capability is ready", () => {
    const report = makeReadyReport();
    expect(() =>
      assertProductionCapabilityReady("deepseek-reasoning", undefined, report, {
        runtimeMode: "production",
      }),
    ).not.toThrow();
  });

  it("does not throw in production when capability is not-applicable", () => {
    const report = createProductionReadinessReport({
      runtimeMode: "production",
      capabilities: { "deepseek-reasoning": "not-applicable" } as Record<ProductionCapability, "not-applicable">,
    });
    expect(() =>
      assertProductionCapabilityReady("deepseek-reasoning", undefined, report, {
        runtimeMode: "production",
      }),
    ).not.toThrow();
  });

  it("does not throw in production when capability is degraded", () => {
    const report = createProductionReadinessReport({
      runtimeMode: "production",
      capabilities: { "deepseek-reasoning": "degraded" } as Record<ProductionCapability, "degraded">,
    });
    expect(() =>
      assertProductionCapabilityReady("deepseek-reasoning", undefined, report, {
        runtimeMode: "production",
      }),
    ).not.toThrow();
  });
});

// ── assertSellerCapabilityReady ─────────────────────────────────────

describe("assertSellerCapabilityReady", () => {
  it("does not throw in dev mode", () => {
    const report = makeBlockedReport();
    expect(() =>
      assertSellerCapabilityReady("deepseek-reasoning", "plasticov", report, {
        runtimeMode: "development",
      }),
    ).not.toThrow();
  });

  it("throws in production when seller capability is blocked", () => {
    const report = makeBlockedReport();
    expect(() =>
      assertSellerCapabilityReady("deepseek-reasoning", "plasticov", report, {
        runtimeMode: "production",
      }),
    ).toThrow(/Seller "plasticov" capability "deepseek-reasoning" is blocked/);
  });

  it("throws when seller report is missing", () => {
    const report = createProductionReadinessReport({
      runtimeMode: "production",
      sellerReports: [],
      capabilities: {} as Record<ProductionCapability, "ready">,
    });
    expect(() =>
      assertSellerCapabilityReady("deepseek-reasoning", "plasticov", report, {
        runtimeMode: "production",
      }),
    ).toThrow(/No readiness report found for seller "plasticov"/);
  });

  it("does not throw when seller capability is ready", () => {
    const report = createProductionReadinessReport({
      runtimeMode: "production",
      capabilities: { "deepseek-reasoning": "ready" } as Record<ProductionCapability, "ready">,
      sellerReports: [
        createSellerReadinessReport({
          sellerId: "plasticov",
          accountName: "Plasticov",
          overallStatus: "ready",
          capabilities: { "deepseek-reasoning": "ready" },
        }),
      ],
    });
    expect(() =>
      assertSellerCapabilityReady("deepseek-reasoning", "plasticov", report, {
        runtimeMode: "production",
      }),
    ).not.toThrow();
  });
});
