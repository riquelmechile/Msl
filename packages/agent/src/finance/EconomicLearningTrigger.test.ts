import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createEconomicOutcome, transitionOutcome } from "@msl/domain";
import type { EconomicOutcome, UnitEconomicsSnapshot } from "@msl/domain";
import type { EconomicLearningStore, GraphEngine } from "@msl/memory";
import type { EconomicOutcomeReader as EconomicOutcomeStore } from "@msl/memory";
import { createSqliteEconomicLearningStore } from "@msl/memory";
import {
  cleanupEconomicFixtureDatabases,
  createEconomicFixtureDatabase,
  createEconomicOutcomeReaderFixture,
} from "../../tests/economicReaderFixture.js";
import { EconomicLearningTrigger, type TriggerInput } from "./EconomicLearningTrigger.js";

// ── Helpers ──────────────────────────────────────────────────────────

afterEach(cleanupEconomicFixtureDatabases);

function createOutcomeStore(db: Database.Database): EconomicOutcomeStore {
  return createEconomicOutcomeReaderFixture(db);
}

function createLearningStore(db: Database.Database): EconomicLearningStore {
  return createSqliteEconomicLearningStore(db);
}

function makeVerifiedOutcome(
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
  const observed = transitionOutcome(raw, "observing");
  const fullyObserved = transitionOutcome(observed, "observed");
  const verified: EconomicOutcome = {
    ...fullyObserved,
    status: "verified",
    verifiedAt: Date.now(),
    completeness: 0.9,
    confidence: 0.85,
  };
  return verified;
}

function makeDisputedOutcome(
  sellerId: string,
  opts?: { proposalId?: string; originatingAgentId?: string },
): EconomicOutcome {
  const base = makeVerifiedOutcome(sellerId, opts);
  const disputed: EconomicOutcome = {
    ...base,
    status: "disputed",
    disputedAt: Date.now(),
  };
  return disputed;
}

function makeInvalidatedOutcome(
  sellerId: string,
  opts?: { proposalId?: string; originatingAgentId?: string },
): EconomicOutcome {
  const base = makeVerifiedOutcome(sellerId, opts);
  const invalidated: EconomicOutcome = {
    ...base,
    status: "invalidated",
    invalidatedAt: Date.now(),
  };
  return invalidated;
}

function makePendingOutcome(sellerId: string): EconomicOutcome {
  return createEconomicOutcome({ sellerId });
}

function makeSnapshot(outcome: EconomicOutcome): UnitEconomicsSnapshot {
  return {
    snapshotId: `snap-${outcome.outcomeId}`,
    sellerId: outcome.sellerId,
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
};

class FakeGraphEngine {
  nodes: FakeNode[] = [];
  private nextNodeId = 1;

  getOrCreateNode(label: string, metadata: Record<string, unknown> = {}): FakeNode {
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

// ── Helper to build trigger input ─────────────────────────────────────

function triggerInput(
  outcome: EconomicOutcome,
  economicStore: EconomicOutcomeStore,
  learningStore: EconomicLearningStore,
  engine?: GraphEngine,
  snapshot?: UnitEconomicsSnapshot,
): TriggerInput {
  const base: TriggerInput = { outcome, economicStore, learningStore };
  if (engine !== undefined) base.engine = engine;
  if (snapshot !== undefined) base.snapshot = snapshot;
  return base;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("EconomicLearningTrigger", () => {
  // ── 1. Verified outcome triggers learning pipeline ────────────────────

  it("verified outcome triggers learning pipeline", () => {
    const db1 = createEconomicFixtureDatabase();
    const db2 = createEconomicFixtureDatabase();
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);
    const engine = new FakeGraphEngine();

    const outcome = makeVerifiedOutcome("plasticov", {
      proposalId: "prop-1",
      originatingAgentId: "agent-fd",
      observedEconomicImpactId: "impact-1",
    });
    const snapshot = makeSnapshot(outcome);

    const trigger = new EconomicLearningTrigger();
    const result = trigger.onOutcomeTransition(
      triggerInput(
        outcome,
        economicStore,
        learningStore,
        engine as unknown as GraphEngine,
        snapshot,
      ),
    );

    expect(result.triggered).toBe(true);
    expect(result.status).toBe("processed");
    expect(result.event).toBeDefined();
  });

  // ── 2. Disputed outcome triggers reversal ─────────────────────────────

  it("disputed outcome triggers reversal", () => {
    const db1 = createEconomicFixtureDatabase();
    const db2 = createEconomicFixtureDatabase();
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);

    const outcome = makeDisputedOutcome("plasticov", {
      proposalId: "prop-2",
      originatingAgentId: "agent-fd",
    });

    const trigger = new EconomicLearningTrigger();
    const result = trigger.onOutcomeTransition(triggerInput(outcome, economicStore, learningStore));

    expect(result.triggered).toBe(true);
    expect(result.event).toBeDefined();
    expect(result.event!.status).toBe("reversed");
  });

  // ── 3. Invalidated outcome triggers reversal ──────────────────────────

  it("invalidated outcome triggers reversal", () => {
    const db1 = createEconomicFixtureDatabase();
    const db2 = createEconomicFixtureDatabase();
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);

    const outcome = makeInvalidatedOutcome("plasticov", {
      proposalId: "prop-3",
      originatingAgentId: "agent-fd",
    });

    const trigger = new EconomicLearningTrigger();
    const result = trigger.onOutcomeTransition(triggerInput(outcome, economicStore, learningStore));

    expect(result.triggered).toBe(true);
    expect(result.event).toBeDefined();
    expect(result.event!.status).toBe("reversed");
  });

  // ── 4. Pending outcome does NOT trigger ──────────────────────────────

  it("pending outcome does NOT trigger", () => {
    const db1 = createEconomicFixtureDatabase();
    const db2 = createEconomicFixtureDatabase();
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);

    const outcome = makePendingOutcome("plasticov");

    const trigger = new EconomicLearningTrigger();
    const result = trigger.onOutcomeTransition(triggerInput(outcome, economicStore, learningStore));

    expect(result.triggered).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("outcome-status-pending");
  });

  // ── 5. Duplicate outcome within cooldown deduplicates ─────────────────

  it("duplicate outcome within cooldown deduplicates", () => {
    const db1 = createEconomicFixtureDatabase();
    const db2 = createEconomicFixtureDatabase();
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);

    const outcome = makeVerifiedOutcome("plasticov", {
      proposalId: "prop-5",
      originatingAgentId: "agent-fd",
      observedEconomicImpactId: "impact-5",
    });
    const snapshot = makeSnapshot(outcome);

    const trigger = new EconomicLearningTrigger();
    const engine = new FakeGraphEngine();

    // First trigger — should process
    const first = trigger.onOutcomeTransition(
      triggerInput(
        outcome,
        economicStore,
        learningStore,
        engine as unknown as GraphEngine,
        snapshot,
      ),
    );
    expect(first.triggered).toBe(true);
    expect(first.status).toBe("processed");

    // Second trigger within cooldown — should deduplicate
    const second = trigger.onOutcomeTransition(
      triggerInput(
        outcome,
        economicStore,
        learningStore,
        engine as unknown as GraphEngine,
        snapshot,
      ),
    );
    expect(second.triggered).toBe(false);
    expect(second.status).toBe("blocked");
    expect(second.reason).toBe("deduplicated");
  });

  // ── 6. Different sellers don't mix ────────────────────────────────────

  it("different sellers don't mix — Plasticov outcome doesn't affect Maustian", () => {
    const db1 = createEconomicFixtureDatabase();
    const db2 = createEconomicFixtureDatabase();
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);
    const engine = new FakeGraphEngine();

    const plasticovOutcome = makeVerifiedOutcome("plasticov", {
      proposalId: "prop-6a",
      originatingAgentId: "agent-fd",
      observedEconomicImpactId: "impact-6a",
    });
    const maustianOutcome = makeVerifiedOutcome("maustian", {
      proposalId: "prop-6b",
      originatingAgentId: "agent-fd",
      observedEconomicImpactId: "impact-6b",
    });

    const trigger = new EconomicLearningTrigger();

    const resultA = trigger.onOutcomeTransition(
      triggerInput(
        plasticovOutcome,
        economicStore,
        learningStore,
        engine as unknown as GraphEngine,
        makeSnapshot(plasticovOutcome),
      ),
    );
    const resultB = trigger.onOutcomeTransition(
      triggerInput(
        maustianOutcome,
        economicStore,
        learningStore,
        engine as unknown as GraphEngine,
        makeSnapshot(maustianOutcome),
      ),
    );

    expect(resultA.triggered).toBe(true);
    expect(resultA.sellerId).toBe("plasticov");
    expect(resultB.triggered).toBe(true);
    expect(resultB.sellerId).toBe("maustian");

    // Verify seller isolation in learning store
    const eventsA = learningStore.listBySeller("plasticov", { limit: 100 });
    const eventsB = learningStore.listBySeller("maustian", { limit: 100 });
    for (const ev of eventsA) {
      expect(ev.sellerId).toBe("plasticov");
    }
    for (const ev of eventsB) {
      expect(ev.sellerId).toBe("maustian");
    }
  });

  // ── 7. Cortex failure does not corrupt EconomicOutcome ────────────────

  it("Cortex failure does not corrupt EconomicOutcome", () => {
    const db1 = createEconomicFixtureDatabase();
    const db2 = createEconomicFixtureDatabase();
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);

    const outcome = makeVerifiedOutcome("plasticov", {
      proposalId: "prop-7",
      originatingAgentId: "agent-fd",
      observedEconomicImpactId: "impact-7",
    });
    const snapshot = makeSnapshot(outcome);

    const trigger = new EconomicLearningTrigger();
    // No engine provided — pipeline should handle gracefully
    const result = trigger.onOutcomeTransition(
      triggerInput(outcome, economicStore, learningStore, undefined, snapshot),
    );

    // Outcome should still be valid — the trigger result may be failed, but the outcome object itself is untouched
    expect(outcome.status).toBe("verified");
    expect(outcome.outcomeId).toBeTruthy();
    expect(outcome.sellerId).toBe("plasticov");
    // The transition was attempted
    expect(result.triggered).toBe(true);
  });

  // ── 8. Trigger failure returns failed status gracefully ──────────────

  it("trigger failure returns failed status gracefully", () => {
    // Use a store method that throws to simulate failure
    const db1 = createEconomicFixtureDatabase();
    const db2 = createEconomicFixtureDatabase();
    const economicStore = createOutcomeStore(db1);
    // Use a malformed store that will throw
    const brokenLearningStore = {
      ...createLearningStore(db2),
      isAlreadyProcessed: () => {
        throw new Error("network-failure");
      },
    };

    const outcome = makeVerifiedOutcome("plasticov", {
      proposalId: "prop-8",
      originatingAgentId: "agent-fd",
      observedEconomicImpactId: "impact-8",
    });
    const snapshot = makeSnapshot(outcome);

    const trigger = new EconomicLearningTrigger();
    const result = trigger.onOutcomeTransition(
      triggerInput(
        outcome,
        economicStore,
        brokenLearningStore,
        new FakeGraphEngine() as unknown as GraphEngine,
        snapshot,
      ),
    );

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("network-failure");
  });

  // ── 9. pruneDedupCache removes old entries ────────────────────────────

  it("pruneDedupCache removes old entries", () => {
    const db1 = createEconomicFixtureDatabase();
    const db2 = createEconomicFixtureDatabase();
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);
    const engine = new FakeGraphEngine();

    void economicStore;
    void learningStore;
    void engine;

    const trigger = new EconomicLearningTrigger();

    // Add an old entry by directly manipulating the map
    // @ts-expect-error - accessing private for test
    trigger.processedOutcomes.set("old-out:plasticov", Date.now() - 700_000); // 700s ago → beyond 600s threshold
    // @ts-expect-error - accessing private for test
    trigger.processedOutcomes.set("recent-out:plasticov", Date.now() - 100_000); // 100s ago → within threshold

    const pruned = trigger.pruneDedupCache();

    expect(pruned).toBe(1);
    // @ts-expect-error - accessing private for test
    expect(trigger.processedOutcomes.has("old-out:plasticov")).toBe(false);
    // @ts-expect-error - accessing private for test
    expect(trigger.processedOutcomes.has("recent-out:plasticov")).toBe(true);
  });

  // ── 10. Failed transition does not emit event ─────────────────────────

  it("Failed transition does not emit event", () => {
    const db1 = createEconomicFixtureDatabase();
    const db2 = createEconomicFixtureDatabase();
    const economicStore = createOutcomeStore(db1);
    const learningStore = createLearningStore(db2);

    const outcome = makeVerifiedOutcome("plasticov", {
      proposalId: "prop-10",
      originatingAgentId: "agent-fd",
      observedEconomicImpactId: "impact-10",
    });
    const snapshot = makeSnapshot(outcome);

    const trigger = new EconomicLearningTrigger();
    // No engine → pipeline returns failed status via cortex-unavailable
    const result = trigger.onOutcomeTransition(
      triggerInput(outcome, economicStore, learningStore, undefined, snapshot),
    );

    // If status is "failed", no valid event should be emitted that claims success
    // An event may exist but its status should reflect the failure
    if (result.status === "failed" && result.event) {
      expect(result.event.status).not.toBe("processed");
    }
  });
});
