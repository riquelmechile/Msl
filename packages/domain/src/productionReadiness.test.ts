import { describe, expect, it } from "vitest";

import {
  createProductionReadinessReport,
  createReadinessCheckResult,
  createSellerReadinessReport,
  severityForStatus,
  worstStatus,
} from "./productionReadiness.js";
import type { ReadinessCheckResult, ReadinessStatus } from "./productionReadiness.js";

// ── severityForStatus ────────────────────────────────────────────────

describe("severityForStatus", () => {
  it('returns "critical" for blocked status', () => {
    expect(severityForStatus("blocked")).toBe("critical");
  });

  it('returns "warning" for degraded status', () => {
    expect(severityForStatus("degraded")).toBe("warning");
  });

  it('returns "info" for ready status', () => {
    expect(severityForStatus("ready")).toBe("info");
  });

  it('returns "info" for not-applicable status', () => {
    expect(severityForStatus("not-applicable")).toBe("info");
  });
});

// ── worstStatus ──────────────────────────────────────────────────────

describe("worstStatus", () => {
  it("blocked beats everything", () => {
    const cases: ReadinessStatus[] = ["ready", "degraded", "not-applicable"];
    for (const other of cases) {
      expect(worstStatus("blocked", other)).toBe("blocked");
      expect(worstStatus(other, "blocked")).toBe("blocked");
    }
  });

  it("degraded beats ready", () => {
    expect(worstStatus("degraded", "ready")).toBe("degraded");
    expect(worstStatus("ready", "degraded")).toBe("degraded");
  });

  it("ready beats not-applicable", () => {
    expect(worstStatus("ready", "not-applicable")).toBe("ready");
    expect(worstStatus("not-applicable", "ready")).toBe("ready");
  });

  it("same status returns same", () => {
    expect(worstStatus("ready", "ready")).toBe("ready");
  });
});

// ── createReadinessCheckResult ───────────────────────────────────────

describe("createReadinessCheckResult", () => {
  it("creates a valid check result with defaults", () => {
    const result = createReadinessCheckResult({
      checkId: "env-runtime-mode",
      capability: "deepseek-reasoning",
      status: "blocked",
    });

    expect(result.checkId).toBe("env-runtime-mode");
    expect(result.capability).toBe("deepseek-reasoning");
    expect(result.status).toBe("blocked");
    expect(result.severity).toBe("critical");
    expect(result.reasonCode).toBe("env-runtime-mode");
    expect(result.checkedAt).toBeTruthy();
    expect(result.metadata).toEqual({});
    expect(result.noMutationExecuted).toBe(true);
  });

  it("applies explicit reasonCode", () => {
    const result = createReadinessCheckResult({
      checkId: "test-check",
      capability: "telegram-ceo",
      status: "degraded",
      reasonCode: "custom-reason",
    });

    expect(result.reasonCode).toBe("custom-reason");
    expect(result.severity).toBe("warning");
  });

  it("accepts sellerId for per-seller checks", () => {
    const result = createReadinessCheckResult({
      checkId: "oauth-plasticov",
      capability: "mercadolibre-read-plasticov",
      status: "ready",
      sellerId: "plasticov",
      safeMessage: "OAuth configured",
      remediation: "Ready",
    });

    expect(result.sellerId).toBe("plasticov");
    expect(result.safeMessage).toBe("OAuth configured");
  });
});

// ── createProductionReadinessReport ──────────────────────────────────

describe("createProductionReadinessReport", () => {
  it("creates a report with mandatory fields", () => {
    const report = createProductionReadinessReport({
      runtimeMode: "development",
    });

    expect(report.runtimeMode).toBe("development");
    expect(report.reportId).toBeTruthy();
    expect(report.overallStatus).toBe("not-applicable");
    expect(report.generatedAt).toBeTruthy();
    expect(report.capabilities).toEqual({});
    expect(report.sellerReports).toEqual([]);
    expect(report.blockers).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.readyCapabilities).toEqual([]);
    expect(report.disabledCapabilities).toEqual([]);
    expect(report.remediationPlan).toEqual([]);
    expect(report.noMutationExecuted).toBe(true);
  });

  it("accepts override for commitSha", () => {
    const report = createProductionReadinessReport({
      runtimeMode: "production",
      commitSha: "abc123",
    });

    expect(report.commitSha).toBe("abc123");
    expect(report.runtimeMode).toBe("production");
  });

  it("accepts all overrides", () => {
    const blockers: ReadinessCheckResult[] = [
      createReadinessCheckResult({
        checkId: "b1",
        capability: "deepseek-reasoning",
        status: "blocked",
      }),
    ];
    const report = createProductionReadinessReport({
      runtimeMode: "production",
      overallStatus: "blocked",
      blockers,
      readyCapabilities: ["daemon-scheduler"],
    });

    expect(report.overallStatus).toBe("blocked");
    expect(report.blockers).toHaveLength(1);
    expect(report.readyCapabilities).toEqual(["daemon-scheduler"]);
  });
});

// ── createSellerReadinessReport ──────────────────────────────────────

describe("createSellerReadinessReport", () => {
  it("creates a seller report with mandatory fields", () => {
    const report = createSellerReadinessReport({
      sellerId: "plasticov",
      accountName: "Plasticov",
    });

    expect(report.sellerId).toBe("plasticov");
    expect(report.accountName).toBe("Plasticov");
    expect(report.overallStatus).toBe("not-applicable");
    expect(report.capabilities).toEqual({});
    expect(report.oauthBinding).toBeNull();
    expect(report.encryptionReadiness.keyPresent).toBe(false);
    expect(report.checks).toEqual([]);
  });

  it("accepts oauth binding override", () => {
    const report = createSellerReadinessReport({
      sellerId: "plasticov",
      accountName: "Plasticov",
      oauthBinding: {
        configured: true,
        hasClientId: true,
        hasClientSecret: true,
        hasRedirectUri: true,
        isPlaceholder: false,
      },
    });

    expect(report.oauthBinding?.configured).toBe(true);
  });
});
