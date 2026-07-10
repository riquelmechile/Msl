import { describe, expect, it } from "vitest";

import {
  createGetAccountBrainStatusTool,
  createCompareAccountAssetsTool,
} from "./accountBrainTools.js";
import type { AccountBrainService } from "../accountBrainService.js";

// ── Minimal mock service for tool unit tests ──────────────────────────

function mockBrainService(overrides?: Partial<AccountBrainService>): AccountBrainService {
  const defaults = {
    getAccountBrainStatus: () => ({
      sellerId: "plasticov",
      status: "active",
      health: { currentStatus: "healthy" },
      capabilities: [{ kind: "Fulfillment", status: "active" }],
      profitGoal: { value: 35 },
      risks: [],
      opportunities: [],
      strategy: [],
      agentActivity: {
        sessionsToday: 0,
        status: "idle",
        agentIds: [],
        proposals: 0,
        lessons: 0,
      },
      pendingApprovals: [],
      costAndCache: {
        perAgent: {},
        cacheEfficiency: 0,
        totalEstimatedCostMicros: 0,
      },
      cortex: { nodeCount: 0, hasAccountNode: false, recentGlobalNodes: [] },
      recommendedFocus: ["No critical items — account operating normally."],
      confidence: "high",
      evidence: [],
      noMutationExecuted: true,
    }),
    compareAccountAssets: () => ({
      recommendedSellerId: "plasticov",
      confidence: "high",
      ranking: [
        {
          sellerId: "plasticov",
          score: 85,
          capabilities: [{ kind: "Fulfillment", status: "active" }],
          health: { currentStatus: "healthy" },
          risks: [],
          opportunities: [],
          profitGoal: { value: 35 },
          costLoad: {
            perAgent: {},
            cacheEfficiency: 0,
            totalEstimatedCostMicros: 0,
          },
          strengths: ["Healthy account", "1/1 active capabilities"],
          weaknesses: [],
        },
        {
          sellerId: "maustian",
          score: 72,
          capabilities: [{ kind: "Fulfillment", status: "missing" }],
          health: { currentStatus: "degraded" },
          risks: [],
          opportunities: [],
          profitGoal: { value: 20 },
          costLoad: {
            perAgent: {},
            cacheEfficiency: 0,
            totalEstimatedCostMicros: 5000,
          },
          missingCapabilities: ["Fulfillment"],
          strengths: [],
          weaknesses: [],
        },
      ],
      decisionLogic: "Clear winner with delta 13.0.",
      evidence: [],
      suggestedNextAction: {
        kind: "recommend_account",
        description: 'Recommend "plasticov" for this product.',
        requiresApproval: true,
      },
      noMutationExecuted: true,
    }),
  };

  return { ...defaults, ...overrides } as unknown as AccountBrainService;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("get_account_brain_status tool", () => {
  it("returns noMutationExecuted: true on every response", () => {
    const service = mockBrainService();
    const tool = createGetAccountBrainStatusTool(service);

    const result1 = tool.execute({ sellerId: "plasticov" }) as Record<string, unknown>;
    expect(result1.noMutationExecuted).toBe(true);

    const result2 = tool.execute({}) as Record<string, unknown>;
    expect(result2.noMutationExecuted).toBe(true);
  });

  it("returns unavailable when service is undefined", () => {
    const tool = createGetAccountBrainStatusTool();
    const result = tool.execute({}) as Record<string, unknown>;

    expect(result.noMutationExecuted).toBe(true);
    expect(result.status).toBe("unavailable");
    expect(result.message).toBeDefined();
  });

  it("returns account-scoped data — no cross-contamination", () => {
    const service = mockBrainService({
      getAccountBrainStatus: (sellerId: string) => ({
        sellerId,
        status: "active",
        health: { currentStatus: sellerId === "plasticov" ? "healthy" : "critical" },
        capabilities: [],
        profitGoal: { value: sellerId === "plasticov" ? 35 : 20 },
        risks: [],
        opportunities: [],
        strategy: [],
        agentActivity: { sessionsToday: 0, status: "idle", agentIds: [], proposals: 0, lessons: 0 },
        pendingApprovals: [],
        costAndCache: {
          perAgent: {},
          cacheEfficiency: 0,
          totalEstimatedCostMicros: 0,
        },
        cortex: { nodeCount: 0, hasAccountNode: false, recentGlobalNodes: [] },
        recommendedFocus: [],
        confidence: "high",
        evidence: [],
        noMutationExecuted: true,
      }),
    });

    const tool = createGetAccountBrainStatusTool(service);

    const plasticovResult = tool.execute({ sellerId: "plasticov" }) as Record<string, unknown>;
    expect(plasticovResult.status).toBe("active");
    expect((plasticovResult.health as Record<string, unknown>).currentStatus).toBe("healthy");

    const maustianResult = tool.execute({ sellerId: "maustian" }) as Record<string, unknown>;
    expect(maustianResult.status).toBe("active");
    expect((maustianResult.health as Record<string, unknown>).currentStatus).toBe("critical");
  });
});

describe("compare_account_assets tool", () => {
  it("returns noMutationExecuted: true on every response", () => {
    const service = mockBrainService();
    const tool = createCompareAccountAssetsTool(service);

    const result = tool.execute({
      productName: "Test Product",
      goal: "maximize_profit",
    }) as Record<string, unknown>;
    expect(result.noMutationExecuted).toBe(true);
  });

  it("returns unavailable when service is undefined", () => {
    const tool = createCompareAccountAssetsTool();
    const result = tool.execute({}) as Record<string, unknown>;

    expect(result.noMutationExecuted).toBe(true);
    expect(result.recommendedSellerId).toBeNull();
    expect(result.confidence).toBe("low");
    expect((result.suggestedNextAction as Record<string, unknown>).requiresApproval).toBe(true);
  });

  it("suggestedNextAction always requires approval", () => {
    const service = mockBrainService();
    const tool = createCompareAccountAssetsTool(service);

    const result = tool.execute({
      productName: "Test Product",
      goal: "maximize_profit",
    }) as Record<string, unknown>;

    const suggestedNextAction = result.suggestedNextAction as Record<string, unknown>;
    expect(suggestedNextAction.requiresApproval).toBe(true);
  });

  it("returns ranking with per-seller scores and seller isolation", () => {
    const service = mockBrainService();
    const tool = createCompareAccountAssetsTool(service);

    const result = tool.execute({
      candidateSellerIds: ["plasticov", "maustian"],
    }) as Record<string, unknown>;

    const ranking = result.ranking as Array<Record<string, unknown>>;
    expect(ranking).toHaveLength(2);
    expect(ranking[0]!.sellerId).toBe("plasticov");
    expect(ranking[1]!.sellerId).toBe("maustian");
    expect(ranking[0]!.score as number).toBeGreaterThan(ranking[1]!.score as number);
    expect(result.recommendedSellerId).toBe("plasticov");
  });
});
