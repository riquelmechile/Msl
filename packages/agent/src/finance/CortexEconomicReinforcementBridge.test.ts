import { describe, expect, it } from "vitest";
import { createEconomicOutcome, transitionOutcome } from "@msl/domain";
import type {
  EconomicOutcome,
  EconomicReinforcementPlan,
  EconomicLearningEvent,
  EconomicSignal,
} from "@msl/domain";
import { CortexEconomicReinforcementBridge } from "./CortexEconomicReinforcementBridge.js";

// ── Fake GraphEngine ────────────────────────────────────────────────────────

type FakeNode = {
  id: number;
  label: string;
  activation: number;
  metadata: Record<string, unknown>;
  sellerId: string | undefined;
};

type FakeEdge = {
  id: number;
  source: number;
  target: number;
  weight: number;
};

class FakeGraphEngine {
  nodes: FakeNode[] = [];
  edges: FakeEdge[] = [];
  private nextNodeId = 1;
  private nextEdgeId = 1;

  createNodeCalls: Array<{ label: string; metadata: Record<string, unknown>; sellerId: string | undefined }> = [];
  getNodeCalls: number[] = [];
  getOrCreateCalls: Array<{ label: string; metadata: Record<string, unknown>; sellerId: string | undefined }> = [];

  createNode(label: string, metadata: Record<string, unknown> = {}, sellerId: string | undefined = undefined): FakeNode {
    this.createNodeCalls.push({ label, metadata, sellerId });
    const node: FakeNode = { id: this.nextNodeId++, label, activation: 0, metadata, sellerId };
    this.nodes.push(node);
    return node;
  }

  getNode(id: number): FakeNode | null {
    this.getNodeCalls.push(id);
    return this.nodes.find((n) => n.id === id) ?? null;
  }

  getOrCreateNode(label: string, metadata: Record<string, unknown> = {}, sellerId: string | undefined = undefined): FakeNode {
    this.getOrCreateCalls.push({ label, metadata, sellerId });
    const existing = this.nodes.find((n) => n.label === label);
    if (existing) return existing;
    return this.createNode(label, metadata, sellerId);
  }

  reinforceEdge(source: number, target: number, _sellerId?: string): FakeEdge {
    const edge = this.edges.find((e) => e.source === source && e.target === target);
    if (edge) {
      edge.weight = Math.min(1, edge.weight + 0.1);
      return edge;
    }
    const newEdge: FakeEdge = { id: this.nextEdgeId++, source, target, weight: 0.6 };
    this.edges.push(newEdge);
    return newEdge;
  }

  traverse() {
    return {
      activatedNodes: this.nodes.map((n) => ({ nodeId: n.id, label: n.label, activation: n.activation })),
      traversedEdges: this.edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight, co_occurrence_count: 0 })),
      lessons: [] as Array<{ source_node: number; target_node: number; lesson: string }>,
      context: {} as Record<string, unknown>,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeVerifiedOutcome(overrides: Partial<EconomicOutcome> = {}): EconomicOutcome {
  const base = createEconomicOutcome({
    sellerId: "plasticov",
  });
  const observed = transitionOutcome(base, "observing");
  const verified = transitionOutcome(observed, "observed");
  return { ...verified, ...overrides };
}

function makeSignal(): EconomicSignal {
  return {
    direction: "positive",
    magnitude: 0.5,
    confidence: 0.8,
    reasonCodes: ["positive-net-profit"],
    sourceValues: { netProfit: 50000, grossRevenue: 100000, contributionProfit: 50000, netMargin: 0.5, contributionMargin: 0.5 },
  };
}

function makePlan(overrides: Partial<EconomicReinforcementPlan> = {}): EconomicReinforcementPlan {
  return {
    planId: "plan-test",
    outcomeId: "outcome-1",
    sellerId: "plasticov",
    economicSignal: makeSignal(),
    attributionStrength: "contributory",
    confidence: 0.7,
    targetNodes: [{ nodeId: "outcome-1", reason: "Test target" }],
    targetEdges: [],
    proposedAdjustments: [{ nodeId: "1", delta: 0.05, reason: "Test adjustment", targetType: "node" }],
    lessonCandidates: [],
    blockedTargets: [],
    reasonCodes: ["contributory-attribution"],
    createdAt: Date.now(),
    status: "proposed",
    reinforcementPolicyVersion: "0.1.0",
    attributionPolicyVersion: "0.1.0",
    signalPolicyVersion: "0.1.0",
    noExternalMutationExecuted: true as const,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("CortexEconomicReinforcementBridge", () => {
  // ── 1. successful apply creates event ──────────────────────────────────

  it("successful apply creates a processed event", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const engine = new FakeGraphEngine();
    const outcome = makeVerifiedOutcome();
    const plan = makePlan({ outcomeId: outcome.outcomeId });

    const persisted: EconomicLearningEvent[] = [];
    const isProcessed = (_key: string) => false;

    const result = bridge.applyPlan({
      plan,
      outcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessed,
      persistEvent: (e) => persisted.push(e),
    });

    expect(result.applied).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(result.event.status).toBe("processed");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.outcomeId).toBe(outcome.outcomeId);
    expect(persisted[0]!.sellerId).toBe("plasticov");
  });

  // ── 2. idempotency — second call returns same event ───────────────────

  it("idempotency — second call returns same event", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const engine = new FakeGraphEngine();
    const outcome = makeVerifiedOutcome();
    const plan = makePlan({ outcomeId: outcome.outcomeId });

    const persisted: EconomicLearningEvent[] = [];

    // First call: not processed
    const isProcessedFirst = (_key: string) => {
      return false;
    };

    const result1 = bridge.applyPlan({
      plan,
      outcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessedFirst,
      persistEvent: (e) => persisted.push(e),
    });

    expect(result1.applied).toBe(true);
    expect(result1.idempotent).toBe(false);

    // Second call: now processed
    const isProcessedSecond = (_key: string) => true;
    const result2 = bridge.applyPlan({
      plan,
      outcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessedSecond,
      persistEvent: (e) => persisted.push(e),
    });

    expect(result2.idempotent).toBe(true);
    expect(result2.applied).toBe(false);
  });

  // ── 3. engine undefined → failed event, no crash ──────────────────────

  it("engine undefined produces failed event, no crash", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const outcome = makeVerifiedOutcome();
    const plan = makePlan({ outcomeId: outcome.outcomeId });

    const persisted: EconomicLearningEvent[] = [];
    const isProcessed = (_key: string) => false;

    const result = bridge.applyPlan({
      plan,
      outcome,
      engine: undefined,
      isAlreadyProcessed: isProcessed,
      persistEvent: (e) => persisted.push(e),
    });

    expect(result.applied).toBe(false);
    expect(result.event.status).toBe("failed");
    expect(result.errorCode).toBe("cortex-unavailable");
    // Should still persist the failed event for audit
    expect(persisted.length).toBeGreaterThanOrEqual(1);
  });

  // ── 4. seller isolation — events scoped per seller ────────────────────

  it("seller isolation — events scoped per seller", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const engine = new FakeGraphEngine();
    const plasticovOutcome = makeVerifiedOutcome({ sellerId: "plasticov" });
    const maustianOutcome = makeVerifiedOutcome({ sellerId: "maustian" });

    const plasticovPlan = makePlan({ outcomeId: plasticovOutcome.outcomeId, sellerId: "plasticov" });
    const maustianPlan = makePlan({ outcomeId: maustianOutcome.outcomeId, sellerId: "maustian" });

    const persisted: EconomicLearningEvent[] = [];
    const isProcessed = (_key: string) => false;

    bridge.applyPlan({
      plan: plasticovPlan,
      outcome: plasticovOutcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessed,
      persistEvent: (e) => persisted.push(e),
    });

    bridge.applyPlan({
      plan: maustianPlan,
      outcome: maustianOutcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessed,
      persistEvent: (e) => persisted.push(e),
    });

    expect(persisted).toHaveLength(2);
    expect(persisted[0]!.sellerId).toBe("plasticov");
    expect(persisted[1]!.sellerId).toBe("maustian");
    // Events must not share outcome IDs across sellers
    expect(persisted[0]!.outcomeId).not.toBe(persisted[1]!.outcomeId);
  });

  // ── 5. event has before/after hashes ──────────────────────────────────

  it("event has before and after state hashes", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const engine = new FakeGraphEngine();
    const outcome = makeVerifiedOutcome();
    const plan = makePlan({ outcomeId: outcome.outcomeId });

    const persisted: EconomicLearningEvent[] = [];
    const isProcessed = (_key: string) => false;

    const result = bridge.applyPlan({
      plan,
      outcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessed,
      persistEvent: (e) => persisted.push(e),
    });

    expect(result.event.beforeStateHash).toBeDefined();
    expect(result.event.beforeStateHash.length).toBeGreaterThan(0);
    expect(result.event.afterStateHash).toBeDefined();
    expect(result.event.afterStateHash.length).toBeGreaterThan(0);
  });

  // ── 6. adjustments recorded with deltas ────────────────────────────────

  it("adjustments are recorded with deltas in the event", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const engine = new FakeGraphEngine();
    // Pre-create a node so adjustments can find it
    engine.createNode("pre-existing", { type: "test" }, "plasticov");
    const outcome = makeVerifiedOutcome();
    const plan = makePlan({
      outcomeId: outcome.outcomeId,
      proposedAdjustments: [
        { nodeId: "1", delta: 0.05, reason: "Test", targetType: "node" },
        { nodeId: "2", delta: -0.03, reason: "Negative test", targetType: "node" },
      ],
    });

    const persisted: EconomicLearningEvent[] = [];
    const isProcessed = (_key: string) => false;

    const result = bridge.applyPlan({
      plan,
      outcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessed,
      persistEvent: (e) => persisted.push(e),
    });

    // Only node 1 exists (node 2 doesn't), so only 1 adjustment applied
    expect(result.event.adjustments.length).toBeGreaterThanOrEqual(1);
    for (const adj of result.event.adjustments) {
      expect(adj.delta).toBeDefined();
      expect(typeof adj.delta).toBe("number");
      expect(adj.beforeValue).toBeDefined();
      expect(adj.afterValue).toBeDefined();
    }
  });

  // ── 7. reversal marks reversedAt ──────────────────────────────────────

  it("reversal marks reversedAt on the reversed event", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const engine = new FakeGraphEngine();
    const outcome = makeVerifiedOutcome();
    const plan = makePlan({ outcomeId: outcome.outcomeId });

    const persisted: EconomicLearningEvent[] = [];
    const isProcessed = (_key: string) => false;

    // First apply
    bridge.applyPlan({
      plan,
      outcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessed,
      persistEvent: (e) => persisted.push(e),
    });

    // Then reverse
    const reversedResult = bridge.reverseLearning(outcome.outcomeId, "plasticov");

    expect(reversedResult.event.status).toBe("reversed");
    expect(reversedResult.event.reversedAt).toBeDefined();
    expect(reversedResult.event.reversedAt).toBeGreaterThan(0);
  });

  // ── 8. double reversal blocked ────────────────────────────────────────

  it("double reversal is blocked", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const engine = new FakeGraphEngine();
    const outcome = makeVerifiedOutcome();
    const plan = makePlan({ outcomeId: outcome.outcomeId });

    const persisted: EconomicLearningEvent[] = [];
    const isProcessed = (_key: string) => false;

    bridge.applyPlan({
      plan,
      outcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessed,
      persistEvent: (e) => persisted.push(e),
    });

    // First reversal
    const firstReverse = bridge.reverseLearning(outcome.outcomeId, "plasticov");
    expect(firstReverse.event.status).toBe("reversed");

    // Second reversal should be idempotent
    const secondReverse = bridge.reverseLearning(outcome.outcomeId, "plasticov");
    expect(secondReverse.idempotent).toBe(true);
  });

  // ── 9. no economic outcome modification ───────────────────────────────

  it("does not modify the economic outcome", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const engine = new FakeGraphEngine();
    const outcome = makeVerifiedOutcome({ status: "verified" as const });

    // Clone for comparison
    const originalStatus = outcome.status;
    const originalConfidence = outcome.confidence;

    const plan = makePlan({ outcomeId: outcome.outcomeId });

    const persisted: EconomicLearningEvent[] = [];
    const isProcessed = (_key: string) => false;

    bridge.applyPlan({
      plan,
      outcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessed,
      persistEvent: (e) => persisted.push(e),
    });

    // Outcome should be unchanged
    expect(outcome.status).toBe(originalStatus);
    expect(outcome.confidence).toBe(originalConfidence);
  });

  // ── 10. no raw metadata stored ────────────────────────────────────────

  it("no raw metadata stored — metadata is bounded", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const engine = new FakeGraphEngine();
    const outcome = makeVerifiedOutcome();
    const plan = makePlan({ outcomeId: outcome.outcomeId });

    const persisted: EconomicLearningEvent[] = [];
    const isProcessed = (_key: string) => false;

    const result = bridge.applyPlan({
      plan,
      outcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessed,
      persistEvent: (e) => persisted.push(e),
    });

    // Metadata should only contain known keys, no secrets
    const metadata = result.event.metadata;
    expect(metadata).toBeDefined();
    expect(typeof metadata).toBe("object");

    // Should have bounded fields only
    const knownKeys = ["outcomeId", "sellerId", "status"];
    for (const key of Object.keys(metadata)) {
      expect(knownKeys).toContain(key);
    }

    // No raw LLM output, no passwords, no tokens
    const metadataStr = JSON.stringify(metadata);
    expect(metadataStr).not.toContain("token");
    expect(metadataStr).not.toContain("password");
    expect(metadataStr).not.toContain("api_key");
  });

  // ── Additional: computeStateHash is used when provided ─────────────────

  it("uses computeStateHash when provided", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const engine = new FakeGraphEngine();
    const outcome = makeVerifiedOutcome();
    const plan = makePlan({ outcomeId: outcome.outcomeId });

    const persisted: EconomicLearningEvent[] = [];
    const isProcessed = (_key: string) => false;

    const result = bridge.applyPlan({
      plan,
      outcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessed,
      persistEvent: (e) => persisted.push(e),
      computeStateHash: () => "custom-hash-value",
    });

    expect(result.event.beforeStateHash).toBe("custom-hash-value");
    expect(result.event.afterStateHash).toBe("custom-hash-value");
  });

  // ── Additional: idempotency key format is correct ──────────────────────

  it("idempotency key follows correct format", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const engine = new FakeGraphEngine();
    const outcome = makeVerifiedOutcome();
    const plan = makePlan({ outcomeId: outcome.outcomeId, reinforcementPolicyVersion: "0.1.0" });

    const persisted: EconomicLearningEvent[] = [];
    const isProcessed = (_key: string) => false;

    const result = bridge.applyPlan({
      plan,
      outcome,
      engine: engine as unknown as import("@msl/memory").GraphEngine,
      isAlreadyProcessed: isProcessed,
      persistEvent: (e) => persisted.push(e),
    });

    const expectedKey = `${plan.outcomeId}-${plan.sellerId}-0.1.0`;
    expect(result.event.idempotencyKey).toBe(expectedKey);
  });

  // ── Additional: reverse learning with no events ────────────────────────

  it("reverse learning with no prior events produces compensating event", () => {
    const bridge = new CortexEconomicReinforcementBridge();

    const result = bridge.reverseLearning("non-existent-outcome", "plasticov");

    expect(result.idempotent).toBe(true);
    expect(result.errorCode).toBe("all-events-already-reversed");
  });
});
