import { describe, expect, it } from "vitest";
import { FinanceDirectorFallback } from "./FinanceDirectorFallback.js";
import type { FinanceDirectorEvidence } from "./FinanceDirectorEvidenceAssembler.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEvidence(overrides: Partial<FinanceDirectorEvidence> = {}): FinanceDirectorEvidence {
  return {
    snapshots: [
      {
        snapshotId: "snap-1",
        sellerId: "plasticov",
        grossRevenue: 100000,
        netProfit: 50000,
        netMargin: 0.5,
        calculationStatus: "complete" as const,
        missingInputs: ["shipping"],
        currency: "CLP",
        sellerFundedDiscounts: 0,
        refunds: 0,
        marketplaceFees: 10000,
        sellerShippingCost: 0,
        advertisingCost: 2000,
        productCost: 30000,
        allocatedLandedCost: 0,
        taxes: 0,
        financingCost: 0,
        packagingCost: 0,
        otherCosts: 0,
        contributionProfit: 58000,
        contributionMargin: 0.58,
        calculatedAt: Date.now(),
      },
    ],
    outcomes: [
      {
        outcomeId: "out-1",
        sellerId: "plasticov",
        status: "observed" as const,
        confidence: 0.8,
        completeness: 0.9,
        evidenceIds: [],
        createdAt: Date.now(),
      },
    ],
    profitSummary: {
      totalRevenue: 100000,
      totalCosts: 50000,
      netProfit: 50000,
      netMargin: 0.5,
      snapshotCount: 1,
    },
    missingInputs: ["shipping"],
    sellerCurrency: "CLP",
    evidenceTimestamp: Date.now(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("FinanceDirectorFallback", () => {
  const fallback = new FinanceDirectorFallback();

  it("produces assessment with snapshot evidence", () => {
    const evidence = makeEvidence();
    const assessment = fallback.buildFallbackAssessment(
      evidence,
      "Financial health review",
      "plasticov",
      "account-health",
    );

    expect(assessment.assessmentId).toContain("fallback-");
    expect(assessment.sellerId).toBe("plasticov");
    expect(assessment.assessmentType).toBe("account-health");
    expect(assessment.objective).toBe("Financial health review");
    expect(assessment.verifiedFacts.length).toBeGreaterThan(0);
    expect(assessment.verifiedFacts.some((f) => f.includes("snap-1"))).toBe(true);
    expect(assessment.verifiedFacts.some((f) => f.includes("out-1"))).toBe(true);
  });

  it("lists missing inputs in verifiedFacts", () => {
    const evidence = makeEvidence({
      missingInputs: ["shipping", "tax", "refund"],
    });

    const assessment = fallback.buildFallbackAssessment(
      evidence,
      "Review",
      "plasticov",
      "account-health",
    );

    expect(assessment.verifiedFacts.some((f) => f.includes("shipping"))).toBe(true);
    expect(assessment.verifiedFacts.some((f) => f.includes("tax"))).toBe(true);
    expect(assessment.verifiedFacts.some((f) => f.includes("refund"))).toBe(true);
  });

  it("sets fallbackUsed: true", () => {
    const evidence = makeEvidence();
    const assessment = fallback.buildFallbackAssessment(
      evidence,
      "Review",
      "plasticov",
      "account-health",
    );

    expect(assessment.fallbackUsed).toBe(true);
    expect(assessment.modelUsed).toBe("none");
  });

  it("sets noMutationExecuted: true", () => {
    const evidence = makeEvidence();
    const assessment = fallback.buildFallbackAssessment(
      evidence,
      "Review",
      "plasticov",
      "account-health",
    );

    expect(assessment.noMutationExecuted).toBe(true);
  });

  it("never contains invented recommendations", () => {
    const evidence = makeEvidence();
    const assessment = fallback.buildFallbackAssessment(
      evidence,
      "Review",
      "plasticov",
      "account-health",
    );

    // Fallback should never have recommendations
    expect(assessment.recommendations).toHaveLength(0);
    // Recommendations should not contain any invented action items
    for (const rec of assessment.recommendations) {
      expect(rec.action).toBeFalsy();
    }
  });

  it("generates risks when evidence has missing inputs", () => {
    const evidence = makeEvidence({
      missingInputs: ["shipping", "tax", "refund", "financing", "landed_cost", "packaging"],
    });

    const assessment = fallback.buildFallbackAssessment(
      evidence,
      "Review",
      "plasticov",
      "account-health",
    );

    expect(assessment.risks.length).toBeGreaterThan(0);
    const riskTexts = assessment.risks.map((r) => r.description).join(" ");
    expect(riskTexts).toContain("6 cost inputs are missing");
  });

  it("reports low confidence when evidence is sparse", () => {
    const evidence = makeEvidence({
      snapshots: [],
      outcomes: [],
      profitSummary: null,
      missingInputs: ["product_cost", "marketplace_fee", "shipping", "advertising", "tax"],
    });

    const assessment = fallback.buildFallbackAssessment(
      evidence,
      "Review",
      "plasticov",
      "account-health",
    );

    // Sparse evidence → confidence should be low
    expect(assessment.confidence).toBeLessThan(0.5);
    expect(assessment.risks.some((r) => r.severity === "critical")).toBe(true);
  });
});
