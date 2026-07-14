import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import type { EconomicLearningStore } from "@msl/memory";
import { createSqliteEconomicLearningStore } from "@msl/memory";
import {
  createEconomicLearningEligibility,
  createEconomicAttributionAssessment,
  createEconomicReinforcementPlan,
  createEconomicLearningEvent,
} from "@msl/domain";
import {
  createExplainEconomicLearningTool,
  createInspectEconomicLearningStatusTool,
  createListEconomicLearningEventsTool,
  createEconomicLearningTools,
} from "./economicLearningTools.js";

// ── Helpers ──────────────────────────────────────────────────────────

function exec(
  tool: ReturnType<typeof createExplainEconomicLearningTool>,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return tool.execute(args) as Record<string, unknown>;
}

function createStore(db: Database.Database): EconomicLearningStore {
  return createSqliteEconomicLearningStore(db);
}

function seedTestData(store: EconomicLearningStore, outcomeId: string, sellerId: string) {
  // Save eligibility
  store.saveEligibility(
    createEconomicLearningEligibility({
      outcomeId,
      sellerId,
      eligible: true,
      reasonCodes: [],
      outcomeStatus: "verified",
      completeness: 0.9,
      confidence: 0.85,
      evidenceQuality: 0.95,
      hasVerifiedEconomicImpact: true,
      hasAttributionTargets: true,
      currencies: ["CLP"],
    }),
  );

  // Save attribution
  store.saveAttribution(
    createEconomicAttributionAssessment({
      outcomeId,
      sellerId,
      targetType: "agent",
      targetId: "agent-1",
      strength: "contributory",
      confidence: 0.8,
      supportingEvidenceIds: ["ev-1"],
      contradictingEvidenceIds: [],
      alternativeExplanations: [],
      evaluator: "EconomicAttributionEvaluator",
    }),
  );

  // Save plan
  store.savePlan(
    createEconomicReinforcementPlan({
      outcomeId,
      sellerId,
      economicSignal: {
        direction: "positive",
        magnitude: 0.7,
        confidence: 0.8,
        reasonCodes: ["positive-net-profit"],
        sourceValues: { netProfit: 5000 },
      },
      attributionStrength: "contributory",
      confidence: 0.8,
      targetNodes: [{ nodeId: "node-1", reason: "positive outcome" }],
      targetEdges: [],
      proposedAdjustments: [
        { nodeId: "node-1", delta: 0.1, reason: "reinforce", targetType: "node" },
      ],
      lessonCandidates: [],
      blockedTargets: [],
      reasonCodes: [],
      status: "applied",
      reinforcementPolicyVersion: "0.1.0",
      attributionPolicyVersion: "0.1.0",
      signalPolicyVersion: "0.1.0",
    }),
  );

  // Save event
  store.insertEvent(
    createEconomicLearningEvent({
      idempotencyKey: `idem-${outcomeId}`,
      outcomeId,
      sellerId,
      planId: "plan-1",
      attributionId: "attr-1",
      targetNodeIds: ["node-1"],
      targetEdgeIds: [],
      adjustments: [
        {
          nodeId: "node-1",
          delta: 0.1,
          targetType: "node",
          beforeValue: 0.5,
          afterValue: 0.6,
        },
      ],
      lessonsCreated: [],
      beforeStateHash: "abc",
      afterStateHash: "def",
      status: "processed",
      metadata: { outcomeId, sellerId },
      reinforcementPolicyVersion: "0.1.0",
    }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("explain_economic_learning", () => {
  it("returns structured explanation with events in store", () => {
    const db = new Database(":memory:");
    const store = createStore(db);
    const outcomeId = "outcome-1";
    const sellerId = "plasticov";

    seedTestData(store, outcomeId, sellerId);

    const tool = createExplainEconomicLearningTool(store);
    const result = exec(tool, { outcomeId, sellerId });

    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);

    const data = result.data as Record<string, unknown>;
    expect(data.outcomeId).toBe(outcomeId);
    expect(data.sellerId).toBe(sellerId);
    expect(data.eligibility).toBeDefined();
    expect(data.attributions).toBeDefined();
    expect(data.reinforcementPlan).toBeDefined();
    expect(data.learningEvents).toBeDefined();

    const events = data.learningEvents as Array<Record<string, unknown>>;
    expect(events.length).toBe(1);

    const findings = data.keyFindings as string[];
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.includes("eligible"))).toBe(true);
  });

  it("handles nonexistent outcome gracefully", () => {
    const db = new Database(":memory:");
    const store = createStore(db);

    const tool = createExplainEconomicLearningTool(store);
    const result = exec(tool, { outcomeId: "nonexistent", sellerId: "plasticov" });

    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("No economic learning data found");
  });

  it("enforces seller isolation — data from one seller is invisible to another", () => {
    const db = new Database(":memory:");
    const store = createStore(db);
    const outcomeId = "outcome-2";

    // Seed data for plasticov
    seedTestData(store, outcomeId, "plasticov");

    // Query as maustian — should find no data
    const tool = createExplainEconomicLearningTool(store);
    const result = exec(tool, { outcomeId, sellerId: "maustian" });

    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("No economic learning data found");
  });
});

describe("inspect_economic_learning_status", () => {
  it("returns status overview", () => {
    const db = new Database(":memory:");
    const store = createStore(db);
    const outcomeId = "outcome-3";
    const sellerId = "plasticov";

    seedTestData(store, outcomeId, sellerId);

    const tool = createInspectEconomicLearningStatusTool(store);
    const result = exec(tool, { outcomeId, sellerId });

    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);

    const data = result.data as Record<string, unknown>;
    expect(data.outcomeId).toBe(outcomeId);
    expect(data.sellerId).toBe(sellerId);

    const eligibility = data.eligibility as Record<string, unknown> | null;
    expect(eligibility).toBeDefined();
    expect(eligibility!.eligible).toBe(true);

    const attributions = data.attributions as Record<string, unknown>;
    expect(attributions.count).toBe(1);

    const events = data.events as Record<string, unknown>;
    expect(events.count).toBe(1);
    expect(events.lastEventTimestamp).toBeDefined();
  });
});

describe("list_economic_learning_events", () => {
  it("returns bounded events for a seller", () => {
    const db = new Database(":memory:");
    const store = createStore(db);
    const sellerId = "plasticov";

    seedTestData(store, "outcome-4", sellerId);
    seedTestData(store, "outcome-5", sellerId);

    const tool = createListEconomicLearningEventsTool(store);
    const result = exec(tool, { sellerId, limit: 10 });

    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);

    const data = result.data as Record<string, unknown>;
    expect(data.sellerId).toBe(sellerId);

    const events = data.events as Array<Record<string, unknown>>;
    expect(events.length).toBe(2);
    for (const ev of events) {
      expect(ev.eventId).toBeDefined();
      expect(ev.outcomeId).toBeDefined();
      expect(ev.status).toBe("processed");
    }
  });

  it("enforces seller isolation — different seller gets empty", () => {
    const db = new Database(":memory:");
    const store = createStore(db);

    seedTestData(store, "outcome-6", "plasticov");

    const tool = createListEconomicLearningEventsTool(store);
    const result = exec(tool, { sellerId: "maustian" });

    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);

    const data = result.data as Record<string, unknown>;
    const events = data.events as Array<Record<string, unknown>>;
    expect(events.length).toBe(0);
  });

  it("respects default limit of 20", () => {
    const db = new Database(":memory:");
    const store = createStore(db);
    const sellerId = "plasticov";

    for (let i = 0; i < 5; i++) {
      seedTestData(store, `outcome-max-${i}`, sellerId);
    }

    const tool = createListEconomicLearningEventsTool(store);
    const result = exec(tool, { sellerId });

    expect(result.status).toBe("ok");
    const data = result.data as Record<string, unknown>;
    const events = data.events as Array<Record<string, unknown>>;
    expect(events.length).toBe(5);
  });
});

describe("store missing — graceful degradation", () => {
  it("explain tool returns error when store is undefined", () => {
    const tool = createExplainEconomicLearningTool(undefined);
    const result = exec(tool, { outcomeId: "any", sellerId: "plasticov" });

    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("no está disponible");
  });

  it("inspect tool returns error when store is undefined", () => {
    const tool = createInspectEconomicLearningStatusTool(undefined);
    const result = exec(tool, { outcomeId: "any", sellerId: "plasticov" });

    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("no está disponible");
  });

  it("list tool returns error when store is undefined", () => {
    const tool = createListEconomicLearningEventsTool(undefined);
    const result = exec(tool, { sellerId: "plasticov" });

    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
    expect(result.error).toContain("no está disponible");
  });

  it("factory returns tools that handle undefined store", () => {
    const tools = createEconomicLearningTools(undefined);
    expect(tools.length).toBe(3);

    for (const tool of tools) {
      const result = tool.execute(
        tool.name === "list_economic_learning_events"
          ? { sellerId: "plasticov" }
          : { outcomeId: "any", sellerId: "plasticov" },
      ) as Record<string, unknown>;
      expect(result.status).toBe("error");
      expect(result.noExternalMutationExecuted).toBe(true);
    }
  });
});
