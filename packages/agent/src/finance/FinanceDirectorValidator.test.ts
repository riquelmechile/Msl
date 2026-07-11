import { describe, expect, it } from "vitest";
import type { FinancialAssessment, FinancialRisk, Hypothesis, MissingEvidence, Recommendation } from "@msl/domain";
import { FinanceDirectorValidator } from "./FinanceDirectorValidator.js";
import type { FinanceDirectorEvidence } from "./FinanceDirectorEvidenceAssembler.js";

// ── Mutable test type (FinancialAssessment without readonly) ─────────────────

type MutableAssessment = {
  assessmentType?: string;
  sellerId?: string;
  summary?: string;
  confidence?: number;
  verifiedFacts?: string[];
  hypotheses?: Hypothesis[];
  risks?: FinancialRisk[];
  opportunities?: { description: string; estimatedImpact: string }[];
  missingEvidence?: MissingEvidence[];
  recommendations?: Recommendation[];
  requestsForEvidence?: { kind: string; targetAgent: string; reason: string; priority: "low" | "medium" | "high"; ttl: number }[];
  uncertaintyReasons?: string[];
  evidenceIds?: string[];
  outcomeIds?: string[];
  snapshotIds?: string[];
  currencies?: readonly ("CLP" | "USD")[];
  modelUsed?: string;
  fallbackUsed?: boolean;
  noMutationExecuted?: true;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeValidEvidence(): FinanceDirectorEvidence {
  return {
    snapshots: [
      {
        snapshotId: "snap-1",
        sellerId: "plasticov",
        grossRevenue: 100000,
        netProfit: 50000,
        netMargin: 0.5,
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
    missingInputs: [],
    sellerCurrency: "CLP",
    evidenceTimestamp: Date.now(),
  };
}

function makeValidPartial(): MutableAssessment {
  return {
    assessmentType: "account-health",
    sellerId: "plasticov",
    summary: "Financial assessment shows healthy margins with 50% net margin on CLP sales.",
    confidence: 0.8,
    verifiedFacts: ["Revenue is 100000 CLP"],
    hypotheses: [],
    risks: [],
    opportunities: [],
    missingEvidence: [],
    recommendations: [],
    requestsForEvidence: [],
    uncertaintyReasons: [],
    evidenceIds: ["snap-1", "out-1"],
    outcomeIds: ["out-1"],
    snapshotIds: ["snap-1"],
    currencies: ["CLP"] as const,
    modelUsed: "deepseek-v4-flash",
    fallbackUsed: false,
    noMutationExecuted: true as const,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("FinanceDirectorValidator", () => {
  const validator = new FinanceDirectorValidator();

  // ── Valid assessment passes ─────────────────────────────────────────────

  it("passes a valid assessment", () => {
    const result = validator.validate(makeValidPartial() as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  // ── Rejects invented figure ─────────────────────────────────────────────

  it("rejects invented figure — confidence not a valid number", () => {
    const partial = makeValidPartial();
    partial.confidence = Number.NaN;

    const result = validator.validate(partial as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "invented-figure")).toBe(true);
  });

  // ── Rejects missing→zero treatment ──────────────────────────────────────

  it("rejects missing→zero treatment when missing inputs exist", () => {
    const evidence = makeValidEvidence();
    evidence.missingInputs = ["shipping", "tax"];

    const partial = makeValidPartial();
    partial.hypotheses = [
      { statement: "Total costs are zero", confidence: 0.5, evidence: "snap-1" },
    ];

    const result = validator.validate(partial as Partial<FinancialAssessment>, evidence);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "missing-to-zero")).toBe(true);
  });

  // ── Rejects currency mixing ─────────────────────────────────────────────

  it("rejects currency mixing — CLP and USD compared directly", () => {
    const partial = makeValidPartial();
    partial.summary = "Sales in CLP are better than USD for the same product.";

    const result = validator.validate(partial as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "currency-mixing")).toBe(true);
  });

  // ── Rejects partial as complete ─────────────────────────────────────────

  it("rejects partial data presented as complete", () => {
    const evidence = makeValidEvidence();
    evidence.missingInputs = ["shipping", "tax", "financing"];

    const partial = makeValidPartial();
    partial.summary = "All costs are included and the complete picture shows profitability.";

    const result = validator.validate(partial as Partial<FinancialAssessment>, evidence);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "partial-as-complete")).toBe(true);
  });

  // ── Rejects observed as verified ────────────────────────────────────────

  it("rejects observed outcome presented as verified", () => {
    const partial = makeValidPartial();
    partial.summary = "The observed result confirms and verifies the profitability.";

    const result = validator.validate(partial as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "observed-as-verified")).toBe(true);
  });

  // ── Rejects invented causality ──────────────────────────────────────────

  it("rejects invented causality without sufficient evidence", () => {
    const partial = makeValidPartial();
    partial.hypotheses = [
      { statement: "Profit increased because of the price change", confidence: 0.2, evidence: "" },
    ];

    const result = validator.validate(partial as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "invented-causality")).toBe(true);
  });

  // ── Rejects direct mutation ─────────────────────────────────────────────

  it("rejects direct mutation recommendation", () => {
    const partial = makeValidPartial();
    partial.recommendations = [
      { action: "Execute price change immediately", rationale: "Margins are too low", urgency: "escalate" },
    ];

    const result = validator.validate(partial as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "direct-mutation")).toBe(true);
  });

  // ── Degrades hidden uncertainty ─────────────────────────────────────────

  it("detects hidden uncertainty — confidence=1.0 with missing evidence", () => {
    const evidence = makeValidEvidence();
    evidence.missingInputs = ["shipping", "tax", "financing", "refund"];

    const partial = makeValidPartial();
    partial.confidence = 1.0;

    const result = validator.validate(partial as Partial<FinancialAssessment>, evidence);
    // This is a DEGRADE rule — it produces an issue but might not block
    expect(result.issues.some((i) => i.rule === "hidden-uncertainty")).toBe(true);
  });

  // ── Rejects guaranteed profit ───────────────────────────────────────────

  it("rejects guaranteed profit claim", () => {
    const partial = makeValidPartial();
    partial.summary = "This product has guaranteed profit with seguro de ganancia.";

    const result = validator.validate(partial as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "guaranteed-profit")).toBe(true);
  });

  // ── Rejects missing seller scope ────────────────────────────────────────

  it("rejects missing seller scope — no sellerId in assessment", () => {
    const partial = makeValidPartial();
    delete partial.sellerId;

    const result = validator.validate(partial as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "missing-seller-scope")).toBe(true);
  });

  // ── Rejects non-existent evidenceId ─────────────────────────────────────

  it("rejects non-existent evidenceId", () => {
    const partial = makeValidPartial();
    partial.evidenceIds = ["nonexistent-evidence-id"];

    const result = validator.validate(partial as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "non-existent-evidenceId")).toBe(true);
  });

  // ── Rejects invented evidence kind ──────────────────────────────────────

  it("rejects invented evidence kind", () => {
    const partial = makeValidPartial();
    partial.missingEvidence = [
      { kind: "fake-evidence-type", reason: "Missing", targetAgent: "none", priority: "high" },
    ];

    const result = validator.validate(partial as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "invented-evidence-kind")).toBe(true);
  });

  // ── Invalid format ──────────────────────────────────────────────────────

  it("rejects invalid format — missing required fields", () => {
    const partial: MutableAssessment = {
      confidence: 0.5,
    };

    const result = validator.validate(partial as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.rule === "invalid-format")).toBe(true);
  });

  // ── Budget violation ────────────────────────────────────────────────────

  it("flags recommendation suggesting large spending without cost evidence", () => {
    const evidence = makeValidEvidence();
    // Remove evidence IDs to simulate missing cost evidence
    evidence.snapshots = [];
    evidence.missingInputs = ["product_cost", "advertising"];
    evidence.profitSummary = null;

    const partial = makeValidPartial();
    partial.evidenceIds = [];
    partial.recommendations = [
      {
        action: "invest $200,000 in ads to boost visibility",
        rationale: "More ads will increase sales",
        urgency: "escalate",
      },
    ];

    const result = validator.validate(partial as Partial<FinancialAssessment>, evidence);
    expect(result.issues.some((i) => i.rule === "budget-violation")).toBe(true);
  });

  it("does NOT flag normal recommendation without excessive spending", () => {
    const partial = makeValidPartial();
    partial.recommendations = [
      {
        action: "review pricing strategy for high-cost items",
        rationale: "Some items may be underpriced relative to costs",
        urgency: "escalate",
      },
    ];

    const result = validator.validate(partial as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.issues.some((i) => i.rule === "budget-violation")).toBe(false);
  });

  it("does NOT flag recommendation when cost evidence is present", () => {
    const partial = makeValidPartial();
    partial.recommendations = [
      {
        action: "invest $200,000 in targeted advertising",
        rationale: "ROI data shows strong conversion on these channels",
        urgency: "escalate",
      },
    ];
    // evidenceIds include snap-1 and out-1, which indicate cost evidence exists

    const result = validator.validate(partial as Partial<FinancialAssessment>, makeValidEvidence());
    expect(result.issues.some((i) => i.rule === "budget-violation")).toBe(false);
  });

  it("flags 'boost ad spend' without cost evidence", () => {
    const evidence = makeValidEvidence();
    evidence.snapshots = [];
    evidence.missingInputs = ["advertising"];
    evidence.profitSummary = null;

    const partial = makeValidPartial();
    partial.evidenceIds = [];
    partial.summary = "We should boost ad spend to capture more market share.";

    const result = validator.validate(partial as Partial<FinancialAssessment>, evidence);
    expect(result.issues.some((i) => i.rule === "budget-violation")).toBe(true);
  });

  it("flags budget increase exceeding 50% without cost evidence", () => {
    const evidence = makeValidEvidence();
    evidence.snapshots = [];
    evidence.missingInputs = ["advertising"];
    evidence.profitSummary = null;

    const partial = makeValidPartial();
    partial.evidenceIds = [];
    partial.recommendations = [
      {
        action: "increase budget by 75% on seasonal campaigns",
        rationale: "Competitors are spending more",
        urgency: "escalate",
      },
    ];

    const result = validator.validate(partial as Partial<FinancialAssessment>, evidence);
    expect(result.issues.some((i) => i.rule === "budget-violation")).toBe(true);
  });

  // ── checkInventedFigures hardening (5.1) ──────────────────────────────────

  describe("checkInventedFigures hardening", () => {
    it("passes when all numeric claims match evidence values", () => {
      const assessment = makeValidPartial();
      assessment.summary = "Net profit is 50000 with margin 0.5 on revenue 100000.";
      assessment.verifiedFacts = ["Revenue 100000 CLP"];
      assessment.hypotheses = [
        { statement: "Ad spend of 2000 CLP drives sales", confidence: 0.7, evidence: "snap-1" },
      ];

      const result = validator.validate(
        assessment as Partial<FinancialAssessment>,
        makeValidEvidence(),
      );
      // All numbers (100000, 50000, 0.5, 2000) should be in evidence — no invented-figure issues
      const figIssues = result.issues.filter((i) => i.rule === "invented-figure");
      expect(figIssues).toHaveLength(0);
    });

    it("flags unsubstantiated numeric claims not found in evidence", () => {
      const assessment = makeValidPartial();
      assessment.summary = "Revenue reached 999999 CLP this quarter.";
      assessment.verifiedFacts = ["Sales up by 75000 units"];

      const result = validator.validate(
        assessment as Partial<FinancialAssessment>,
        makeValidEvidence(),
      );
      // 999999 and 75000 are NOT in evidence (evidence has 100000 revenue, etc.)
      const figIssues = result.issues.filter((i) => i.rule === "invented-figure");
      expect(figIssues.length).toBeGreaterThanOrEqual(1);
      expect(figIssues.some((i) => i.detail.includes("Unsubstantiated") || i.detail.includes("Undocumented"))).toBe(true);
    });

    it("flags fabricated metric — ROAS claimed without ad cost data", () => {
      const evidence = makeValidEvidence();
      // Strip advertising cost to make ROAS underivable
      evidence.snapshots = [
        {
          ...evidence.snapshots[0]!,
          advertisingCost: 0,
        },
      ];

      const assessment = makeValidPartial();
      assessment.summary = "Our ROAS is 4.7 which indicates strong campaign performance.";

      const result = validator.validate(
        assessment as Partial<FinancialAssessment>,
        evidence,
      );
      expect(result.issues.some((i) => i.detail.includes("Fabricated metric") && i.detail.includes("ROAS"))).toBe(true);
    });

    it("flags fabricated metric — CAC claimed without acquisition data", () => {
      const assessment = makeValidPartial();
      assessment.recommendations = [
        {
          action: "CAC is $2.47 per customer",
          rationale: "Customer acquisition cost is low",
          urgency: "escalate",
        },
      ];

      const result = validator.validate(
        assessment as Partial<FinancialAssessment>,
        makeValidEvidence(),
      );
      // CAC of 2.47 should be flagged — evidence has no clicks/customer counts
      expect(result.issues.some((i) => i.detail.includes("Fabricated metric") && i.detail.includes("CAC"))).toBe(true);
    });

    it("flags suspicious precision — 3+ decimal places from integer Money", () => {
      const assessment = makeValidPartial();
      assessment.verifiedFacts = ["Profit margin is 47.831% based on calculations."];

      const result = validator.validate(
        assessment as Partial<FinancialAssessment>,
        makeValidEvidence(),
      );
      expect(result.issues.some((i) => i.detail.includes("Suspicious precision"))).toBe(true);
    });

    it("does NOT flag reasonable precision (0-2 decimal places)", () => {
      const assessment = makeValidPartial();
      assessment.verifiedFacts = ["Profit margin is 32% and unit cost 14.50 CLP."];

      const result = validator.validate(
        assessment as Partial<FinancialAssessment>,
        makeValidEvidence(),
      );
      // 32 and 14.50 have ≤2 decimal places — should NOT trigger suspicious precision
      const precisionIssues = result.issues.filter((i) => i.detail.includes("Suspicious precision"));
      expect(precisionIssues).toHaveLength(0);
    });

    it("flags undocumented amount — CLP claim not in evidence", () => {
      const assessment = makeValidPartial();
      assessment.recommendations = [
        {
          action: "Shipping cost increased by 12000 CLP due to logistics changes",
          rationale: "Costs are rising",
          urgency: "escalate",
        },
      ];

      const result = validator.validate(
        assessment as Partial<FinancialAssessment>,
        makeValidEvidence(),
      );
      // 12000 should be flagged — evidence snap has sellerShippingCost=5000, not 12000
      expect(result.issues.some((i) => i.detail.includes("Undocumented amount"))).toBe(true);
    });

    it("flags currency mismatch — USD claim against CLP evidence", () => {
      const assessment = makeValidPartial();
      assessment.summary = "Revenue reached $50000 USD this month with strong growth.";

      const result = validator.validate(
        assessment as Partial<FinancialAssessment>,
        makeValidEvidence(),
      );
      // Evidence currency is CLP, claim references USD
      expect(result.issues.some((i) => i.detail.includes("Currency mismatch"))).toBe(true);
    });

    it("passes assessment with no numeric claims (qualitative only)", () => {
      const assessment = makeValidPartial();
      assessment.summary = "Financial health is stable and improving across all accounts.";
      assessment.verifiedFacts = ["Seller is maintaining good standing"];
      assessment.hypotheses = [
        { statement: "Market conditions are favorable", confidence: 0.6, evidence: "out-1" },
      ];

      const result = validator.validate(
        assessment as Partial<FinancialAssessment>,
        makeValidEvidence(),
      );
      // No numeric claims → no invented-figure issues from hardening (confidence check may still fire if needed)
      const figIssues = result.issues.filter((i) => i.rule === "invented-figure");
      expect(figIssues).toHaveLength(0);
    });

    it("aggregates multiple issues in one assessment", () => {
      const assessment = makeValidPartial();
      assessment.summary = "ROAS is 5.2 and margin is 47.831% with undocumented 50000 CLP bonus.";
      assessment.recommendations = [
        {
          action: "Undocumented cost of 99999 USD needs investigation",
          rationale: "Suspicious cost",
          urgency: "escalate",
        },
      ];

      const result = validator.validate(
        assessment as Partial<FinancialAssessment>,
        makeValidEvidence(),
      );
      const figIssues = result.issues.filter((i) => i.rule === "invented-figure");
      // Should have at least 3 issues: fabricated ROAS (no ad cost), suspicious precision (47.831), undocumented/currency-mismatch
      expect(figIssues.length).toBeGreaterThanOrEqual(3);
      // Each should have rule "invented-figure" with distinct detail
      const details = figIssues.map((i) => i.detail);
      expect(new Set(details).size).toBe(figIssues.length); // all distinct
    });

    it("preserves existing confidence validation alongside hardening", () => {
      const assessment = makeValidPartial();
      assessment.confidence = 1.5; // Invalid
      assessment.summary = "Revenue is 100000 CLP with ROAS of 3.2.";

      const result = validator.validate(
        assessment as Partial<FinancialAssessment>,
        makeValidEvidence(),
      );
      // Should still catch invalid confidence
      expect(result.issues.some((i) => i.detail.includes("not a valid 0-1 number"))).toBe(true);
      // AND catch fabricated ROAS (advertisingCost is 2000, revenue is 100000 — ROAS is derivable actually)
      // Actually ROAS IS derivable here (advertisingCost=2000, grossRevenue=100000), so no ROAS issue
      // But confidence is still caught
    });
  });
});
