import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import type { EconomicOutcomeStore, FinanceDirectorAssessmentStore } from "@msl/memory";
import {
  createSqliteEconomicOutcomeStore,
  createSqliteFinanceDirectorAssessmentStore,
} from "@msl/memory";
import { createEconomicOutcome } from "@msl/domain";
import type { FinancialAssessment } from "@msl/domain";
import type { FinanceDirectorAdvisor, AnalyzeInput } from "../../finance/FinanceDirectorAdvisor.js";
import {
  createAskFinanceDirectorTool,
  createReviewFinancialHealthTool,
  createExplainEconomicOutcomeTool,
  createReviewProposalProfitabilityTool,
  createFinanceDirectorTools,
} from "./financeDirectorTools.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createEconomicStore(db: Database.Database): EconomicOutcomeStore {
  return createSqliteEconomicOutcomeStore(db);
}

function createAssessmentStore(db: Database.Database): FinanceDirectorAssessmentStore {
  return createSqliteFinanceDirectorAssessmentStore(db);
}

/** A fake advisor that returns a structured assessment without calling DeepSeek. */
function fakeAdvisor(): FinanceDirectorAdvisor {
  const now = Date.now();
  const analyzeFn = (input: AnalyzeInput) => {
    const assessment: FinancialAssessment = {
      assessmentId: `fa-${now}`,
      sellerId: input.sellerId,
      objective: input.objective,
      assessmentType: input.assessmentType,
      generatedAt: now,
      currencies: ["CLP" as const],
      evidenceIds: input.evidence.evidenceTimestamp ? ["evidence-1"] : [],
      outcomeIds: [],
      snapshotIds: [],
      summary: `Analysis of ${input.objective} for ${input.sellerId}`,
      verifiedFacts: ["Fact 1", "Fact 2"],
      hypotheses: [],
      risks: [],
      opportunities: [],
      missingEvidence: [],
      confidence: 0.75,
      uncertaintyReasons: [],
      recommendations: [],
      requestsForEvidence: [],
      modelUsed: "fake-finance-director-test",
      fallbackUsed: false,
      promptBlockHashes: {},
      noMutationExecuted: true,
    };
    return Promise.resolve({
      assessment,
      modelUsed: "fake-finance-director-test",
      cacheHitTokens: 0,
      cacheMissTokens: 100,
      outputTokens: 50,
      costMicros: 0,
    });
  };
  return {
    analyze: analyzeFn,
    // Satisfy class interface with stubs
    gateway: undefined as unknown as FinanceDirectorAdvisor["gateway"],
    transport: undefined as unknown as FinanceDirectorAdvisor["transport"],
    ledger: undefined as unknown as FinanceDirectorAdvisor["ledger"],
    promptBuilder: undefined as unknown as FinanceDirectorAdvisor["promptBuilder"],
    validator: undefined as unknown as FinanceDirectorAdvisor["validator"],
    fallback: undefined as unknown as FinanceDirectorAdvisor["fallback"],
  } as unknown as FinanceDirectorAdvisor;
}

// ── Test setup ───────────────────────────────────────────────────────

function setupDbs() {
  const db1 = new Database(":memory:");
  const db2 = new Database(":memory:");
  const economicStore = createEconomicStore(db1);
  const assessmentStore = createAssessmentStore(db2);
  return { db1, db2, economicStore, assessmentStore };
}

// ── ask_finance_director tests ────────────────────────────────────────

describe("ask_finance_director", () => {
  it("returns FinancialAssessment with noMutationExecuted:true", async () => {
    const { economicStore, assessmentStore } = setupDbs();
    const advisor = fakeAdvisor();

    const tool = createAskFinanceDirectorTool({
      economicStore,
      assessmentStore,
      advisorFactory: () => advisor,
    });

    const result = await tool.execute({
      sellerId: "plasticov",
      question: "Are we profitable?",
    });

    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as FinancialAssessment;
    expect(data).toBeDefined();
    expect(data.noMutationExecuted).toBe(true);
    expect(data.sellerId).toBe("plasticov");
  });

  it("enforces seller isolation — requires sellerId", async () => {
    const { economicStore, assessmentStore } = setupDbs();
    const advisor = fakeAdvisor();

    const tool = createAskFinanceDirectorTool({
      economicStore,
      assessmentStore,
      advisorFactory: () => advisor,
    });

    // No sellerId
    const result = await tool.execute({
      question: "Are we profitable?",
    });

    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("sellerId");
  });

  it("returns error when economic store is missing", async () => {
    const advisor = fakeAdvisor();

    const tool = createAskFinanceDirectorTool({
      advisorFactory: () => advisor,
    });

    const result = await tool.execute({
      sellerId: "plasticov",
      question: "Are we profitable?",
    });

    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("no está disponible");
  });

  it("returns error when DeepSeek advisor is unavailable", async () => {
    const { economicStore } = setupDbs();

    const tool = createAskFinanceDirectorTool({
      economicStore,
      advisorFactory: () => null as FinanceDirectorAdvisor | null,
    });

    const result = await tool.execute({
      sellerId: "plasticov",
      question: "Are we profitable?",
    });

    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("DeepSeek");
  });

  it("returns error when advisor throws", async () => {
    const { economicStore } = setupDbs();
    const crashingAdvisor = {
      analyze: () => {
        return Promise.reject(new Error("Simulated DeepSeek failure"));
      },
    } as unknown as FinanceDirectorAdvisor;

    const tool = createAskFinanceDirectorTool({
      economicStore,
      advisorFactory: () => crashingAdvisor,
    });

    const result = await tool.execute({
      sellerId: "plasticov",
      question: "Are we profitable?",
    });

    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("Simulated DeepSeek failure");
  });
});

// ── review_financial_health tests ─────────────────────────────────────

describe("review_financial_health", () => {
  it("returns account-health FinancialAssessment", async () => {
    const { economicStore, assessmentStore } = setupDbs();
    const advisor = fakeAdvisor();

    const tool = createReviewFinancialHealthTool({
      economicStore,
      assessmentStore,
      advisorFactory: () => advisor,
    });

    const result = await tool.execute({
      sellerId: "plasticov",
      timeWindow: "7d",
    });

    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as FinancialAssessment;
    expect(data.assessmentType).toBe("account-health");
    expect(data.sellerId).toBe("plasticov");
  });

  it("returns error when sellerId missing", async () => {
    const { economicStore } = setupDbs();
    const advisor = fakeAdvisor();

    const tool = createReviewFinancialHealthTool({
      economicStore,
      advisorFactory: () => advisor,
    });

    const result = await tool.execute({});
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });
});

// ── explain_economic_outcome tests ────────────────────────────────────

describe("explain_economic_outcome", () => {
  it("returns outcome-review FinancialAssessment", async () => {
    const { economicStore, assessmentStore } = setupDbs();
    const advisor = fakeAdvisor();

    // Seed an outcome
    const outcome = createEconomicOutcome({
      sellerId: "plasticov",
      orderId: "order-1",
      observedAt: Date.now(),
    });
    economicStore.insertOutcome(outcome);

    const tool = createExplainEconomicOutcomeTool({
      economicStore,
      assessmentStore,
      advisorFactory: () => advisor,
    });

    const result = await tool.execute({
      sellerId: "plasticov",
      outcomeId: outcome.outcomeId,
    });

    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as FinancialAssessment;
    expect(data.assessmentType).toBe("outcome-review");
    expect(data.sellerId).toBe("plasticov");
  });

  it("returns error for non-existent outcome", async () => {
    const { economicStore } = setupDbs();
    const advisor = fakeAdvisor();

    const tool = createExplainEconomicOutcomeTool({
      economicStore,
      advisorFactory: () => advisor,
    });

    const result = await tool.execute({
      sellerId: "plasticov",
      outcomeId: "non-existent-outcome",
    });

    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("no encontrado");
  });

  it("enforces seller isolation on outcome lookup", async () => {
    const { economicStore } = setupDbs();

    // Seed outcome for plasticov
    const outcome = createEconomicOutcome({
      sellerId: "plasticov",
      orderId: "order-1",
      observedAt: Date.now(),
    });
    economicStore.insertOutcome(outcome);

    const advisor = fakeAdvisor();
    const tool = createExplainEconomicOutcomeTool({
      economicStore,
      advisorFactory: () => advisor,
    });

    // Try to access with different seller
    const result = await tool.execute({
      sellerId: "maustian",
      outcomeId: outcome.outcomeId,
    });

    // The outcome belongs to plasticov, not maustian — should not be found
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("no encontrado");
  });
});

// ── review_proposal_profitability tests ───────────────────────────────

describe("review_proposal_profitability", () => {
  it("returns assessment but does NOT approve", async () => {
    const { economicStore, assessmentStore } = setupDbs();
    const advisor = fakeAdvisor();

    const tool = createReviewProposalProfitabilityTool({
      economicStore,
      assessmentStore,
      advisorFactory: () => advisor,
    });

    const result = await tool.execute({
      sellerId: "plasticov",
      proposalId: "proposal-abc",
    });

    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.approvalChanged).toBe(false);
    const data = result.data as FinancialAssessment;
    expect(data.assessmentType).toBe("proposal-review");
    expect(data.sellerId).toBe("plasticov");
  });

  it("requires sellerId", async () => {
    const { economicStore } = setupDbs();
    const advisor = fakeAdvisor();

    const tool = createReviewProposalProfitabilityTool({
      economicStore,
      advisorFactory: () => advisor,
    });

    const result = await tool.execute({
      proposalId: "proposal-abc",
    });

    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("sellerId");
  });

  it("requires proposalId", async () => {
    const { economicStore } = setupDbs();
    const advisor = fakeAdvisor();

    const tool = createReviewProposalProfitabilityTool({
      economicStore,
      advisorFactory: () => advisor,
    });

    const result = await tool.execute({
      sellerId: "plasticov",
    });

    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("proposalId");
  });
});

// ── Factory tests ─────────────────────────────────────────────────────

describe("createFinanceDirectorTools", () => {
  it("returns all 4 tools", () => {
    const { economicStore, assessmentStore } = setupDbs();
    const advisor = fakeAdvisor();

    const tools = createFinanceDirectorTools({
      economicStore,
      assessmentStore,
      advisorFactory: () => advisor,
    });

    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "ask_finance_director",
      "explain_economic_outcome",
      "review_financial_health",
      "review_proposal_profitability",
    ]);
  });

  it("each tool has noExternalMutationExecuted on error responses", async () => {
    // Create tools without stores — all should return errors
    const tools = createFinanceDirectorTools({});
    for (const tool of tools) {
      const result = await tool.execute({ sellerId: "plasticov" });
      expect(result.noExternalMutationExecuted).toBe(true);
    }
  });
});
