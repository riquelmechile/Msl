import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createEconomicOutcome, transitionOutcome } from "@msl/domain";
import type { EconomicOutcome, UnitEconomicsSnapshot } from "@msl/domain";
import type { EconomicLearningStore, EconomicOutcomeStore, GraphEngine } from "@msl/memory";
import { createSqliteEconomicLearningStore, createSqliteEconomicOutcomeStore } from "@msl/memory";
import { EconomicLearningPipeline } from "./EconomicLearningPipeline.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createOutcomeStore(db: Database.Database): EconomicOutcomeStore {
  return createSqliteEconomicOutcomeStore(db);
}

function createLearningStore(db: Database.Database): EconomicLearningStore {
  return createSqliteEconomicLearningStore(db);
}

function makeOutcome(
  sellerId: string,
  opts?: {
    proposalId?: string;
    originatingAgentId?: string;
    workSessionId?: string;
    observedEconomicImpactId?: string;
  },
): EconomicOutcome {
  const raw = createEconomicOutcome({
    sellerId,
    ...(opts?.proposalId ? { proposalId: opts.proposalId } : {}),
    ...(opts?.originatingAgentId ? { originatingAgentId: opts.originatingAgentId } : {}),
    ...(opts?.workSessionId ? { workSessionId: opts.workSessionId } : {}),
    ...(opts?.observedEconomicImpactId
      ? { observedEconomicImpactId: opts.observedEconomicImpactId }
      : {}),
  });
  // Transition to observed, then verified
  const observed = transitionOutcome(raw, "observing");
  const fullyObserved = transitionOutcome(observed, "observed");
  // Manually set fields for verification
  const verified: EconomicOutcome = {
    ...fullyObserved,
    status: "verified",
    verifiedAt: Date.now(),
    completeness: 0.9,
    confidence: 0.85,
  };
  return verified;
}

function makeSnapshot(outcome: EconomicOutcome): UnitEconomicsSnapshot {
  const sellerId = outcome.sellerId;
  return {
    snapshotId: `snap-${outcome.outcomeId}`,
    sellerId,
    orderId: outcome.orderId ?? "order-1",
    itemId: outcome.itemId ?? "item-1",
    sku: outcome.sku ?? "SKU-001",
    currency: "CLP",
    grossRevenue: 12000,
    sellerFundedDiscounts: 0,
    refunds: 0,
    marketplaceFees: 2000,
    sellerShippingCost: 1500,
    advertisingCost: 0,
    productCost: 5000,
    allocatedLandedCost: 0,
    taxes: 0,
    financingCost: 0,
    packagingCost: 0,
    otherCosts: 0,
    contributionProfit: 8500,
    netProfit: 3500,
    contributionMargin: 0.71,
    netMargin: 0.29,
    missingInputs: [],
    calculationStatus: "complete",
    calculatedAt: Date.now(),
  };
}

// ── Fake GraphEngine ──────────────────────────────────────────────────

type FakeNode = {
  id: number;
  label: string;
  activation: number;
  metadata: Record<string, unknown>;
  sellerId?: string;
};

class FakeGraphEngine {
  nodes: FakeNode[] = [];
  private nextNodeId = 1;

  getOrCreateNode(
    label: string,
    metadata: Record<string, unknown> = {},
    _sellerId?: string,
  ): FakeNode {
    const existing = this.nodes.find((n) => n.label === label);
    if (existing) return existing;
    const node: FakeNode = {
      id: this.nextNodeId++,
      label,
      activation: 0.5,
      metadata,
    };
    this.nodes.push(node);
    return node;
  }

  getNode(id: number): FakeNode | null {
    return this.nodes.find((n) => n.id === id) ?? null;
  }

  traverse() {
    return { activatedNodes: [], traversedEdges: [] };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("EconomicLearningPipeline", () => {
  it("verified outcome → full pipeline: eligibility→attribution→plan→event", () => {
    const db1 = new Database(":memory:");
    const db2 = new Database(":memory:");
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);
    const engine = new FakeGraphEngine();

    const outcome = makeOutcome("plasticov", {
      proposalId: "prop-1",
      originatingAgentId: "agent-fd",
      observedEconomicImpactId: "impact-1",
    });
    const snapshot = makeSnapshot(outcome);

    const pipeline = new EconomicLearningPipeline();
    const result = pipeline.processVerifiedOutcome({
      outcome,
      economicStore,
      learningStore,
      engine: engine as unknown as GraphEngine,
      snapshot,
    });

    expect(result.status).toBe("processed");
    expect(result.eligibility).toBeDefined();
    expect(result.eligibility!.eligible).toBe(true);
    expect(result.attributions).toBeDefined();
    expect(result.attributions!.length).toBeGreaterThanOrEqual(0);
    expect(result.plan).toBeDefined();
    expect(result.event).toBeDefined();
    expect(result.event!.status).toBe("processed");
  });

  it("non-verified outcome → blocked", () => {
    const db1 = new Database(":memory:");
    const db2 = new Database(":memory:");
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);

    // Create an outcome that's only observed, not verified
    const raw = createEconomicOutcome({
      sellerId: "plasticov",
      observedEconomicImpactId: "impact-2",
    });
    const observed = transitionOutcome(raw, "observing");
    const outcome: EconomicOutcome = {
      ...observed,
      status: "observed",
      observedAt: Date.now(),
    };

    const pipeline = new EconomicLearningPipeline();
    const result = pipeline.processVerifiedOutcome({
      outcome,
      economicStore,
      learningStore,
    });

    expect(result.status).toBe("blocked");
    expect(result.reasonCodes).toContain("outcome-not-verified");
  });

  it("incomplete outcome (no observed impact) → blocked", () => {
    const db1 = new Database(":memory:");
    const db2 = new Database(":memory:");
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);

    const outcome = makeOutcome("plasticov", {
      proposalId: "prop-2",
      originatingAgentId: "agent-fd",
      // No observedEconomicImpactId
    });

    const pipeline = new EconomicLearningPipeline();
    const result = pipeline.processVerifiedOutcome({
      outcome,
      economicStore,
      learningStore,
    });

    expect(result.status).toBe("blocked");
    expect(result.reasonCodes).toContain("missing-observed-impact");
  });

  it("disputed outcome → reversal", () => {
    const db1 = new Database(":memory:");
    const db2 = new Database(":memory:");
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);

    const outcome: EconomicOutcome = {
      ...makeOutcome("plasticov", {
        proposalId: "prop-3",
        originatingAgentId: "agent-fd",
        observedEconomicImpactId: "impact-3",
      }),
      status: "disputed",
      disputedAt: Date.now(),
    };

    const pipeline = new EconomicLearningPipeline();
    const result = pipeline.handleDisputedOutcome({
      outcome,
      economicStore,
      learningStore,
    });

    expect(result.event).toBeDefined();
    expect(result.event!.status).toBe("reversed");
    expect(result.reasonCodes).toContain("disputed-evidence");
  });

  it("invalidated outcome → reversal", () => {
    const db1 = new Database(":memory:");
    const db2 = new Database(":memory:");
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);

    const outcome: EconomicOutcome = {
      ...makeOutcome("plasticov", {
        proposalId: "prop-4",
        originatingAgentId: "agent-fd",
        observedEconomicImpactId: "impact-4",
      }),
      status: "invalidated",
      invalidatedAt: Date.now(),
    };

    const pipeline = new EconomicLearningPipeline();
    const result = pipeline.handleDisputedOutcome({
      outcome,
      economicStore,
      learningStore,
    });

    expect(result.event).toBeDefined();
    expect(result.event!.status).toBe("reversed");
    expect(result.reasonCodes).toContain("invalidated-outcome");
  });

  it("cortex unavailable → failed but no crash", () => {
    const db1 = new Database(":memory:");
    const db2 = new Database(":memory:");
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);

    const outcome = makeOutcome("plasticov", {
      proposalId: "prop-5",
      originatingAgentId: "agent-fd",
      observedEconomicImpactId: "impact-5",
    });
    const snapshot = makeSnapshot(outcome);

    const pipeline = new EconomicLearningPipeline();
    // No engine → bridge returns failed event
    const result = pipeline.processVerifiedOutcome({
      outcome,
      economicStore,
      learningStore,
      // engine intentionally omitted
      snapshot,
    });

    expect(result.status).toBe("failed");
    expect(result.event).toBeDefined();
    expect(result.event!.status).toBe("failed");
    expect(result.reasonCodes).toContain("cortex-unavailable");
  });

  it("idempotent re-processing", () => {
    const db1 = new Database(":memory:");
    const db2 = new Database(":memory:");
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);
    const engine = new FakeGraphEngine();

    const outcome = makeOutcome("plasticov", {
      proposalId: "prop-6",
      originatingAgentId: "agent-fd",
      observedEconomicImpactId: "impact-6",
    });
    const snapshot = makeSnapshot(outcome);

    const pipeline = new EconomicLearningPipeline();

    // First pass
    const first = pipeline.processVerifiedOutcome({
      outcome,
      economicStore,
      learningStore,
      engine: engine as unknown as GraphEngine,
      snapshot,
    });
    expect(first.status).toBe("processed");
    expect(first.event).toBeDefined();

    // Second pass — same outcome
    const second = pipeline.processVerifiedOutcome({
      outcome,
      economicStore,
      learningStore,
      engine: engine as unknown as GraphEngine,
      snapshot,
    });
    expect(second.status).toBe("processed");
    expect(second.reasonCodes).toContain("already-processed");
    expect(second.event).toBeDefined();
  });

  it("seller isolation maintained", () => {
    const db1 = new Database(":memory:");
    const db2 = new Database(":memory:");
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);
    const engine = new FakeGraphEngine();

    // Process for seller A
    const outcomeA = makeOutcome("plasticov", {
      proposalId: "prop-7a",
      originatingAgentId: "agent-fd",
      observedEconomicImpactId: "impact-7a",
    });
    const snapshotA = makeSnapshot(outcomeA);

    const pipeline = new EconomicLearningPipeline();
    const resultA = pipeline.processVerifiedOutcome({
      outcome: outcomeA,
      economicStore,
      learningStore,
      engine: engine as unknown as GraphEngine,
      snapshot: snapshotA,
    });
    expect(resultA.status).toBe("processed");

    // Process for seller B — should be isolated
    const outcomeB = makeOutcome("maustian", {
      proposalId: "prop-7b",
      originatingAgentId: "agent-fd",
      observedEconomicImpactId: "impact-7b",
    });
    const snapshotB = makeSnapshot(outcomeB);

    const resultB = pipeline.processVerifiedOutcome({
      outcome: outcomeB,
      economicStore,
      learningStore,
      engine: engine as unknown as GraphEngine,
      snapshot: snapshotB,
    });
    expect(resultB.status).toBe("processed");

    // Verify seller A's events don't leak to seller B via listBySeller
    const eventsA = learningStore.listBySeller("plasticov", { limit: 100 });
    const eventsB = learningStore.listBySeller("maustian", { limit: 100 });

    expect(eventsA.length).toBeGreaterThan(0);
    expect(eventsB.length).toBeGreaterThan(0);
    for (const ev of eventsA) {
      expect(ev.sellerId).toBe("plasticov");
    }
    for (const ev of eventsB) {
      expect(ev.sellerId).toBe("maustian");
    }
  });
});
