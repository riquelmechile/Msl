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
});
