import { describe, expect, it } from "vitest";
import { FinanceDirectorPromptBuilder } from "./FinanceDirectorPromptBuilder.js";
import type { FinanceDirectorEvidence } from "./FinanceDirectorEvidenceAssembler.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFakeSnapshot(
  overrides: Record<string, unknown> = {},
): NonNullable<FinanceDirectorEvidence["snapshots"]>[number] {
  return {
    snapshotId: (overrides.snapshotId ?? "s1") as string,
    sellerId: (overrides.sellerId ?? "plasticov") as string,
    grossRevenue: (overrides.grossRevenue ?? 100000) as number,
    netProfit: (overrides.netProfit ?? 50000) as number,
    netMargin: (overrides.netMargin ?? 0.5) as number,
    calculationStatus: "complete" as const,
    missingInputs: [],
    currency: "CLP" as const,
    sellerFundedDiscounts: 0,
    refunds: 0,
    marketplaceFees: 10000,
    sellerShippingCost: 5000,
    advertisingCost: 2000,
    productCost: 30000,
    allocatedLandedCost: 0,
    taxes: 0,
    financingCost: 0,
    packagingCost: 0,
    otherCosts: 3000,
    contributionProfit: 50000,
    contributionMargin: 0.5,
    calculatedAt: Date.now(),
  };
}

function makeEmptyEvidence(
  overrides: Partial<FinanceDirectorEvidence> = {},
): FinanceDirectorEvidence {
  return {
    snapshots: [],
    outcomes: [],
    profitSummary: null,
    missingInputs: [],
    sellerCurrency: "CLP",
    evidenceTimestamp: Date.now(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("FinanceDirectorPromptBuilder", () => {
  const builder = new FinanceDirectorPromptBuilder();

  // ── Block A stability ──────────────────────────────────────────────────

  it("block A hash is stable across calls with the same params", () => {
    const evidence = makeEmptyEvidence();

    const result1 = builder.buildPrompt({
      objective: "Analyze profit",
      evidence,
      sellerId: "plasticov",
    });

    const result2 = builder.buildPrompt({
      objective: "Analyze profit",
      evidence,
      sellerId: "plasticov",
    });

    expect(result1.blockHashes.blockA).toBe(result2.blockHashes.blockA);
    expect(result1.blockHashes.blockA).toBeTruthy();
  });

  it("block B hash is stable across calls", () => {
    const evidence = makeEmptyEvidence();

    const result1 = builder.buildPrompt({
      objective: "Analyze profit",
      evidence,
      sellerId: "plasticov",
    });

    const result2 = builder.buildPrompt({
      objective: "Analyze profit",
      evidence,
      sellerId: "plasticov",
    });

    expect(result1.blockHashes.blockB).toBe(result2.blockHashes.blockB);
    expect(result1.blockHashes.blockB).toBeTruthy();
  });

  it("block A hash does not change with different evidence", () => {
    const evidence1 = makeEmptyEvidence({
      snapshots: [makeFakeSnapshot({ snapshotId: "s1", grossRevenue: 100000 })],
    });
    const evidence2 = makeEmptyEvidence({
      snapshots: [makeFakeSnapshot({ snapshotId: "s2", grossRevenue: 50000 })],
    });

    const result1 = builder.buildPrompt({
      objective: "Analyze",
      evidence: evidence1,
      sellerId: "plasticov",
    });

    const result2 = builder.buildPrompt({
      objective: "Analyze",
      evidence: evidence2,
      sellerId: "plasticov",
    });

    // Block A should be identical regardless of evidence
    expect(result1.blockHashes.blockA).toBe(result2.blockHashes.blockA);
    expect(result1.blockHashes.blockA).toBeTruthy();
  });

  it("evidence data appears in volatileInput (block D) only", () => {
    const evidence = makeEmptyEvidence({
      snapshots: [makeFakeSnapshot({ snapshotId: "snap-1", grossRevenue: 150000 })],
    });

    const result = builder.buildPrompt({
      objective: "Test",
      evidence,
      sellerId: "plasticov",
    });

    // Block D hash should be present and depend on evidence
    expect(result.blockHashes.blockD).toBeTruthy();

    // Different evidence should produce different block D
    const evidence2 = makeEmptyEvidence({
      snapshots: [makeFakeSnapshot({ snapshotId: "snap-2", grossRevenue: 250000 })],
    });

    const result2 = builder.buildPrompt({
      objective: "Test",
      evidence: evidence2,
      sellerId: "plasticov",
    });

    expect(result.blockHashes.blockD).not.toBe(result2.blockHashes.blockD);
    // But block A should remain identical
    expect(result.blockHashes.blockA).toBe(result2.blockHashes.blockA);
  });

  it("seller info stays in cacheableContext (block B+C)", () => {
    const evidence = makeEmptyEvidence();

    const result = builder.buildPrompt({
      objective: "Test",
      evidence,
      sellerId: "plasticov",
    });

    // Seller should be in cacheableContext (block B + block C)
    expect(result.cacheableContext).toContain("plasticov");
    // But NOT in stablePrefix (block A)
    expect(result.stablePrefix).not.toContain("plasticov");
  });

  it("block hashes are reproducible", () => {
    const evidence = makeEmptyEvidence();

    const result1 = builder.buildPrompt({
      objective: "Same objective",
      evidence,
      sellerId: "plasticov",
      assessmentType: "account-health",
    });

    const result2 = builder.buildPrompt({
      objective: "Same objective",
      evidence,
      sellerId: "plasticov",
      assessmentType: "account-health",
    });

    // All hashes should be identical for identical inputs
    expect(result1.blockHashes).toEqual(result2.blockHashes);
  });

  it("session context changes block C hash", () => {
    const evidence = makeEmptyEvidence();

    const result1 = builder.buildPrompt({
      objective: "Test",
      evidence,
      sellerId: "plasticov",
    });

    const result2 = builder.buildPrompt({
      objective: "Test",
      evidence,
      sellerId: "plasticov",
      sessionContext: "Continuing from previous analysis",
    });

    // Block A and B should be same, but C should differ
    expect(result1.blockHashes.blockA).toBe(result2.blockHashes.blockA);
    expect(result1.blockHashes.blockB).toBe(result2.blockHashes.blockB);
    expect(result1.blockHashes.blockC).not.toBe(result2.blockHashes.blockC);
  });
});
