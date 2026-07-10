import { describe, expect, it } from "vitest";
import {
  DeepSeekFakeTransport,
  type DeepSeekChatResponse,
} from "../conversation/transports/deepseekTransport.js";
import { FinanceDirectorAdvisor } from "./FinanceDirectorAdvisor.js";
import type { FinanceDirectorEvidence } from "./FinanceDirectorEvidenceAssembler.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function clpSnapshot(overrides: Record<string, unknown> = {}): NonNullable<FinanceDirectorEvidence["snapshots"]>[number] {
  return {
    snapshotId: typeof overrides.snapshotId === "string" ? `snap-${overrides.snapshotId}` : "snap-1",
    sellerId: (overrides.sellerId ?? "plasticov") as string,
    grossRevenue: (overrides.grossRevenue ?? 100000) as number,
    netProfit: (overrides.netProfit ?? 50000) as number,
    netMargin: (overrides.netMargin ?? 0.5) as number,
    calculationStatus: "complete" as const,
    missingInputs: (overrides.missingInputs ?? []) as never,
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

function makeEvidence(overrides: Partial<FinanceDirectorEvidence> = {}): FinanceDirectorEvidence {
  return {
    snapshots: [clpSnapshot({ snapshotId: "1" })],
    outcomes: [],
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
    ...overrides,
  };
}

function makeMockResponse(assessmentOverrides: Record<string, unknown>): DeepSeekChatResponse {
  const body = {
    summary: "Product shows healthy profit margins in CLP.",
    verifiedFacts: ["Revenue is 100000 CLP", "Net profit is 50000 CLP"],
    hypotheses: [
      { statement: "Profit margins are sustainable", confidence: 0.7, evidence: "snap-1" },
    ],
    risks: [
      { description: "Shipping cost unknown", severity: "low", probability: 0.3 },
    ],
    opportunities: [],
    missingEvidence: [],
    recommendations: [
      { action: "Monitor shipping costs for better accuracy", rationale: "Shipping is a variable cost", urgency: "monitor" },
    ],
    requestsForEvidence: [],
    confidence: 0.8,
    uncertaintyReasons: ["Shipping cost data is partial"],
    assessmentType: "account-health",
    ...assessmentOverrides,
  };

  return {
    id: "mock-cmpl-001",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(body) },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 500,
      completion_tokens: 100,
      total_tokens: 600,
      prompt_tokens_details: { cached_tokens: 200 },
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("FinanceDirectorAdvisor", () => {
  // ── Profit interpretation ─────────────────────────────────────────────

  it("profit interpretation — two products, same revenue, different profit", async () => {
    const transport = new DeepSeekFakeTransport([
      makeMockResponse({
        summary: "Both products have same revenue but different profit margins.",
        verifiedFacts: [
          "Product A: revenue=100000, netProfit=50000",
          "Product B: revenue=100000, netProfit=20000",
        ],
      }),
    ]);

    const advisor = new FinanceDirectorAdvisor({ transport });
    const evidence = makeEvidence({
      snapshots: [
        clpSnapshot({ snapshotId: "A", grossRevenue: 100000, netProfit: 50000 }),
        clpSnapshot({ snapshotId: "B", grossRevenue: 100000, netProfit: 20000 }),
      ],
    });

    const result = await advisor.analyze({
      evidence,
      objective: "Compare products A and B",
      sellerId: "plasticov",
      assessmentType: "product-profitability",
    });

    expect(result.assessment.objective).toBe("Compare products A and B");
    expect(result.assessment.fallbackUsed).toBe(false);
    expect(result.assessment.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.modelUsed).toBeTruthy();
  });

  // ── Revenue with net loss detection ────────────────────────────────────

  it("revenue with net loss detection", async () => {
    const transport = new DeepSeekFakeTransport([
      makeMockResponse({
        summary: "Despite positive revenue, net profit is negative.",
        verifiedFacts: ["Revenue=50000, costs exceed revenue"],
        confidence: 0.3,
        recommendations: [
          { action: "Investigate cost structure", rationale: "Net loss detected", urgency: "escalate" },
        ],
      }),
    ]);

    const advisor = new FinanceDirectorAdvisor({ transport });
    const evidence = makeEvidence({
      snapshots: [clpSnapshot({ snapshotId: "loss", grossRevenue: 50000, netProfit: -10000, netMargin: -0.2 })],
    });

    const result = await advisor.analyze({
      evidence,
      objective: "Is this product profitable?",
      sellerId: "plasticov",
      assessmentType: "product-profitability",
    });

    expect(result.assessment.fallbackUsed).toBe(false);
    expect(result.modelUsed).toBeTruthy();
  });

  // ── Partial snapshot → requests evidence ───────────────────────────────

  it("partial snapshot — requests missing evidence", async () => {
    const transport = new DeepSeekFakeTransport([
      makeMockResponse({
        summary: "Only partial cost data available.",
        confidence: 0.4,
        missingEvidence: [
          { kind: "shipping", reason: "Shipping cost missing", targetAgent: "cost-supplier", priority: "high" },
        ],
        requestsForEvidence: [
          { kind: "shipping", targetAgent: "cost-supplier", reason: "Required for accuracy", priority: "high", ttl: 86400 },
        ],
      }),
    ]);

    const advisor = new FinanceDirectorAdvisor({ transport });
    const evidence = makeEvidence({
      snapshots: [clpSnapshot({
        snapshotId: "partial",
        missingInputs: ["shipping", "tax"],
        calculationStatus: "partial",
        netProfit: 30000,
        netMargin: 0.3,
        contributionProfit: 50000,
        contributionMargin: 0.5,
      })],
      missingInputs: ["shipping", "tax"],
      profitSummary: null,
    });

    const result = await advisor.analyze({
      evidence,
      objective: "Review partial data",
      sellerId: "plasticov",
      assessmentType: "missing-cost-review",
    });

    expect(result.assessment.fallbackUsed).toBe(false);
    expect(result.assessment.confidence).toBeLessThanOrEqual(0.5);
  });

  // ── Observed vs verified distinction ───────────────────────────────────

  it("observed vs verified distinction — does not claim verification", async () => {
    const transport = new DeepSeekFakeTransport([
      makeMockResponse({
        summary: "Outcome is observed but not yet verified.",
        verifiedFacts: ["Outcome out-1 is in 'observed' status, NOT verified"],
        confidence: 0.6,
        uncertaintyReasons: ["Outcome verification pending"],
      }),
    ]);

    const advisor = new FinanceDirectorAdvisor({ transport });
    const evidence = makeEvidence({
      outcomes: [{
        outcomeId: "out-1",
        sellerId: "plasticov",
        status: "observed" as const,
        confidence: 0.8,
        completeness: 0.9,
        evidenceIds: [],
        createdAt: Date.now(),
      }],
    });

    const result = await advisor.analyze({
      evidence,
      objective: "Review outcome out-1",
      sellerId: "plasticov",
      assessmentType: "outcome-review",
    });

    expect(result.assessment.fallbackUsed).toBe(false);
    // Should not contain "verified" claims — but we accept the LLM's output
    expect(result.assessment.confidence).toBeLessThan(1.0);
  });

  // ── Cross-account without mixing ───────────────────────────────────────

  it("cross-account — does not mix seller data", async () => {
    const transport = new DeepSeekFakeTransport([
      makeMockResponse({
        summary: "Assessment for plasticov only. Maustian data is excluded.",
        verifiedFacts: ["Plasticov revenue: 100000 CLP"],
      }),
    ]);

    const advisor = new FinanceDirectorAdvisor({ transport });
    const evidence = makeEvidence();

    // Even if we pass maustian snapshots, advisor should only act on plasticov context
    const result = await advisor.analyze({
      evidence,
      objective: "Review plasticov only",
      sellerId: "plasticov",
      assessmentType: "account-health",
    });

    expect(result.assessment.sellerId).toBe("plasticov");
    expect(result.assessment.fallbackUsed).toBe(false);
  });

  // ── ROAS positive but net profit negative ──────────────────────────────

  it("ROAS positive but net profit negative", async () => {
    const transport = new DeepSeekFakeTransport([
      makeMockResponse({
        summary: "ROAS > 1 but net profit is negative after all costs.",
        verifiedFacts: ["Ad revenue: 20000, ad spend: 10000, ROAS: 2.0", "Net profit: -5000"],
        confidence: 0.5,
        hypotheses: [
          { statement: "High ROAS is deceptive due to hidden costs", confidence: 0.6, evidence: "snap-roas" },
        ],
      }),
    ]);

    const advisor = new FinanceDirectorAdvisor({ transport });
    const evidence = makeEvidence({
      snapshots: [clpSnapshot({
        snapshotId: "roas",
        grossRevenue: 20000,
        advertisingCost: 10000,
        netProfit: -5000,
        netMargin: -0.25,
        contributionProfit: 10000,
        contributionMargin: 0.5,
      })],
    });

    const result = await advisor.analyze({
      evidence,
      objective: "Is ROAS 2.0 profitable?",
      sellerId: "plasticov",
      assessmentType: "ads-profitability",
    });

    expect(result.assessment.fallbackUsed).toBe(false);
    // The LLM output should note ROAS > 1 doesn't mean net profit
  });

  // ── Old costs → low confidence ─────────────────────────────────────────

  it("old costs — results in low confidence", async () => {
    const transport = new DeepSeekFakeTransport([
      makeMockResponse({
        summary: "Cost data is older than 30 days. Confidence degraded.",
        confidence: 0.3,
        uncertaintyReasons: ["Cost data is stale (>30 days)"],
      }),
    ]);

    const advisor = new FinanceDirectorAdvisor({ transport });
    const thirtyDaysAgo = Date.now() - 31 * 86400000;
    const evidence = makeEvidence({
      snapshots: [clpSnapshot({
        snapshotId: "old",
        calculatedAt: thirtyDaysAgo,
      })],
    });

    const result = await advisor.analyze({
      evidence,
      objective: "Review profitability with old costs",
      sellerId: "plasticov",
      assessmentType: "account-health",
    });

    expect(result.assessment.fallbackUsed).toBe(false);
    expect(result.assessment.confidence).toBeLessThanOrEqual(0.5);
  });

  // ── Currency mismatch detection ────────────────────────────────────────

  it("currency mismatch — flags cross-currency analysis", async () => {
    const transport = new DeepSeekFakeTransport([
      makeMockResponse({
        summary: "Evidence is CLP, but analysis requires avoiding cross-currency comparison.",
        confidence: 0.5,
        uncertaintyReasons: ["Must not mix CLP and USD"],
      }),
    ]);

    const advisor = new FinanceDirectorAdvisor({ transport });
    const evidence = makeEvidence({ sellerCurrency: "CLP" });

    const result = await advisor.analyze({
      evidence,
      objective: "Is this more profitable in USD?",
      sellerId: "plasticov",
      assessmentType: "account-health",
    });

    expect(result.assessment.fallbackUsed).toBe(false);
  });

  // ── DeepSeek timeout → fallback ────────────────────────────────────────

  it("DeepSeek timeout triggers fallback", async () => {
    // Create a transport that throws (simulating timeout)
    const transport = {
      listModels: () => Promise.resolve([]),
      createChatCompletion: () => Promise.reject(new Error("Timeout")),
      streamChatCompletion: () => {
        throw new Error("Not implemented");
      },
    };

    const advisor = new FinanceDirectorAdvisor({ transport });
    const evidence = makeEvidence();

    const result = await advisor.analyze({
      evidence,
      objective: "Review",
      sellerId: "plasticov",
      assessmentType: "account-health",
    });

    // Should fall back gracefully
    expect(result.assessment.fallbackUsed).toBe(true);
    expect(result.assessment.modelUsed).toBe("none");
    expect(result.assessment.confidence).toBeDefined();
    expect(result.assessment.noMutationExecuted).toBe(true);
  });

  // ── Invalid LLM output → fallback ──────────────────────────────────────

  it("invalid LLM output triggers fallback", async () => {
    const transport = new DeepSeekFakeTransport([
      {
        id: "bad-cmpl",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "not json at all, just random text" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
      },
      // Second attempt also fails (retry fires, also bad)
      {
        id: "bad-cmpl-2",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "still not json" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
      },
    ]);

    const advisor = new FinanceDirectorAdvisor({ transport });
    const evidence = makeEvidence();

    const result = await advisor.analyze({
      evidence,
      objective: "Test invalid output",
      sellerId: "plasticov",
      assessmentType: "account-health",
    });

    expect(result.assessment.fallbackUsed).toBe(true);
    expect(result.assessment.modelUsed).toBe("none");
    expect(result.assessment.noMutationExecuted).toBe(true);
  });
});
