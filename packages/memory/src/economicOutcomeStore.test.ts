import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { EconomicOutcome, UnitEconomicsSnapshot } from "@msl/domain";
import {
  createEconomicCostComponent,
  createEconomicOutcome,
  createUnitEconomicsSnapshot,
} from "@msl/domain";
import {
  createSqliteEconomicOutcomeStore,
  type EconomicOutcomeStore,
} from "./economicOutcomeStore.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function createStore(): EconomicOutcomeStore {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  return createSqliteEconomicOutcomeStore(db);
}

function makeOutcome(overrides: Partial<EconomicOutcome> & { sellerId: string }): EconomicOutcome {
  return createEconomicOutcome({
    sellerId: overrides.sellerId,
    ...(overrides.accountId !== undefined ? { accountId: overrides.accountId } : {}),
    ...(overrides.channel !== undefined ? { channel: overrides.channel } : {}),
    ...(overrides.proposalId !== undefined ? { proposalId: overrides.proposalId } : {}),
    ...(overrides.orderId !== undefined ? { orderId: overrides.orderId } : {}),
    ...(overrides.itemId !== undefined ? { itemId: overrides.itemId } : {}),
    ...(overrides.sku !== undefined ? { sku: overrides.sku } : {}),
    ...(overrides.correlationId !== undefined ? { correlationId: overrides.correlationId } : {}),
    ...(overrides.expectedEconomicImpact !== undefined
      ? { expectedEconomicImpact: overrides.expectedEconomicImpact }
      : {}),
    ...(overrides.observedEconomicImpactId !== undefined
      ? { observedEconomicImpactId: overrides.observedEconomicImpactId }
      : {}),
    ...(overrides.baselineReference !== undefined
      ? { baselineReference: overrides.baselineReference }
      : {}),
  });
}

function clp(n: number) {
  return { amountMinor: n, currency: "CLP" as const };
}

function usd(n: number) {
  return { amountMinor: n, currency: "USD" as const };
}

const NOW = Date.now();

function makeCostComponent(
  type: string,
  amount: { amountMinor: number; currency: "CLP" | "USD" },
  sellerId = "plasticov",
) {
  const result = createEconomicCostComponent({
    sellerId,
    type: type as Parameters<typeof createEconomicCostComponent>[0]["type"],
    amount,
    source: "manual",
    occurredAt: NOW,
    observedAt: NOW,
    verification: "verified",
    confidence: 0.9,
  });
  if (!result.success) {
    throw new Error(`Failed to create cost component: ${result.error.message}`);
  }
  return result.component;
}

function makeSnapshot(
  sellerId: string,
  revenue: number,
  currency: "CLP" | "USD",
  costTypes: string[],
  overrides: Partial<{ orderId: string; itemId: string; sku: string; product: string }> = {},
): UnitEconomicsSnapshot {
  const moneyFn = currency === "CLP" ? clp : usd;
  const components = costTypes.map((t) => makeCostComponent(t, moneyFn(1000), sellerId));

  return createUnitEconomicsSnapshot({
    sellerId,
    grossRevenue: revenue,
    currency,
    costComponents: components,
    ...overrides,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("EconomicOutcomeStore", () => {
  // ── Insert and retrieve ──────────────────────────────────────────────

  it("inserts and retrieves an outcome", () => {
    const store = createStore();
    const outcome = makeOutcome({ sellerId: "plasticov" });

    store.insertOutcome(outcome);
    const retrieved = store.getOutcome(outcome.outcomeId, "plasticov");

    expect(retrieved).not.toBeNull();
    expect(retrieved!.outcomeId).toBe(outcome.outcomeId);
    expect(retrieved!.sellerId).toBe("plasticov");
    expect(retrieved!.status).toBe("pending");
    expect(retrieved!.confidence).toBe(0);
    expect(retrieved!.completeness).toBe(0);
  });

  it("returns null for non-existent outcome", () => {
    const store = createStore();
    const result = store.getOutcome("nonexistent", "plasticov");
    expect(result).toBeNull();
  });

  // ── Idempotent insert ────────────────────────────────────────────────

  it("idempotent insert — duplicate outcomeId returns same record", () => {
    const store = createStore();
    const outcome = makeOutcome({ sellerId: "plasticov" });

    store.insertOutcome(outcome);

    // Insert again with same outcomeId — should not error
    store.insertOutcome(outcome);

    const retrieved = store.getOutcome(outcome.outcomeId, "plasticov");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.outcomeId).toBe(outcome.outcomeId);
  });

  // ── Seller isolation ─────────────────────────────────────────────────

  it("seller isolation — queries only return own seller data", () => {
    const store = createStore();

    const plasticovOutcome = makeOutcome({ sellerId: "plasticov" });
    const maustianOutcome = makeOutcome({ sellerId: "maustian" });

    store.insertOutcome(plasticovOutcome);
    store.insertOutcome(maustianOutcome);

    // Plasticov should only see plasticov
    const plasticovResult = store.getOutcome(maustianOutcome.outcomeId, "plasticov");
    expect(plasticovResult).toBeNull();

    // Maustian should only see maustian
    const maustianResult = store.getOutcome(plasticovOutcome.outcomeId, "maustian");
    expect(maustianResult).toBeNull();

    // Cross-check: correct seller sees own data
    const plasticovOwn = store.getOutcome(plasticovOutcome.outcomeId, "plasticov");
    expect(plasticovOwn).not.toBeNull();

    const maustianOwn = store.getOutcome(maustianOutcome.outcomeId, "maustian");
    expect(maustianOwn).not.toBeNull();
  });

  it("listOutcomesBySeller respects seller isolation", () => {
    const store = createStore();

    store.insertOutcome(makeOutcome({ sellerId: "plasticov" }));
    store.insertOutcome(makeOutcome({ sellerId: "plasticov" }));
    store.insertOutcome(makeOutcome({ sellerId: "maustian" }));

    const plasticovList = store.listOutcomesBySeller("plasticov");
    expect(plasticovList.length).toBe(2);
    for (const o of plasticovList) {
      expect(o.sellerId).toBe("plasticov");
    }

    const maustianList = store.listOutcomesBySeller("maustian");
    expect(maustianList.length).toBe(1);
    expect(maustianList[0]!.sellerId).toBe("maustian");
  });

  // ── State transitions ────────────────────────────────────────────────

  it("valid state transitions from pending → observing → observed → verified", () => {
    const store = createStore();
    const outcome = makeOutcome({ sellerId: "plasticov" });
    store.insertOutcome(outcome);

    // pending → observing
    const observing = store.updateOutcomeStatus(outcome.outcomeId, "observing");
    expect(observing.status).toBe("observing");

    // observing → observed
    const observed = store.updateOutcomeStatus(outcome.outcomeId, "observed");
    expect(observed.status).toBe("observed");
    expect(observed.observedAt).toBeGreaterThan(0);

    // observed → verified
    const verified = store.updateOutcomeStatus(outcome.outcomeId, "verified");
    expect(verified.status).toBe("verified");
    expect(verified.verifiedAt).toBeGreaterThan(0);

    // Persisted correctly
    const persisted = store.getOutcome(outcome.outcomeId, "plasticov");
    expect(persisted!.status).toBe("verified");
  });

  it("invalid transition throws EconomicOutcomeStateError", () => {
    const store = createStore();
    const outcome = makeOutcome({ sellerId: "plasticov" });
    store.insertOutcome(outcome);

    // pending → verified is invalid
    expect(() => store.updateOutcomeStatus(outcome.outcomeId, "verified")).toThrow(
      "Invalid state transition",
    );
  });

  it("terminal state rejects transitions — verified → observed throws", () => {
    const store = createStore();
    const outcome = makeOutcome({ sellerId: "plasticov" });
    store.insertOutcome(outcome);

    store.updateOutcomeStatus(outcome.outcomeId, "observing");
    store.updateOutcomeStatus(outcome.outcomeId, "observed");
    store.updateOutcomeStatus(outcome.outcomeId, "verified");

    // verified is terminal — cannot transition to observed
    expect(() => store.updateOutcomeStatus(outcome.outcomeId, "observed")).toThrow(
      "Invalid state transition",
    );
  });

  // ── Verify outcome ───────────────────────────────────────────────────

  it("verifyOutcome transitions to verified with reason", () => {
    const store = createStore();
    const outcome = makeOutcome({ sellerId: "plasticov" });
    store.insertOutcome(outcome);

    store.updateOutcomeStatus(outcome.outcomeId, "observing");
    store.updateOutcomeStatus(outcome.outcomeId, "observed");

    const verified = store.verifyOutcome(outcome.outcomeId, "Manually verified by CEO");
    expect(verified.status).toBe("verified");
    expect(verified.verificationReason).toBe("Manually verified by CEO");
    expect(verified.verifiedAt).toBeGreaterThan(0);
  });

  // ── Dispute outcome ──────────────────────────────────────────────────

  it("disputeOutcome transitions to disputed with reason", () => {
    const store = createStore();
    const outcome = makeOutcome({ sellerId: "plasticov" });
    store.insertOutcome(outcome);

    store.updateOutcomeStatus(outcome.outcomeId, "observing");
    store.updateOutcomeStatus(outcome.outcomeId, "observed");

    const disputed = store.disputeOutcome(
      outcome.outcomeId,
      "Shipping cost contradicts carrier invoice",
    );
    expect(disputed.status).toBe("disputed");
    expect(disputed.verificationReason).toBe("Shipping cost contradicts carrier invoice");
    expect(disputed.disputedAt).toBeGreaterThan(0);
  });

  // ── List by proposal, order, correlation ─────────────────────────────

  it("listOutcomesByProposal filters correctly", () => {
    const store = createStore();

    store.insertOutcome(makeOutcome({ sellerId: "plasticov", proposalId: "prop-1" }));
    store.insertOutcome(makeOutcome({ sellerId: "plasticov", proposalId: "prop-1" }));
    store.insertOutcome(makeOutcome({ sellerId: "plasticov", proposalId: "prop-2" }));

    const list = store.listOutcomesByProposal("prop-1", "plasticov");
    expect(list.length).toBe(2);
    for (const o of list) {
      expect(o.proposalId).toBe("prop-1");
    }
  });

  it("listOutcomesByProposal respects seller isolation", () => {
    const store = createStore();

    store.insertOutcome(makeOutcome({ sellerId: "plasticov", proposalId: "prop-1" }));
    store.insertOutcome(makeOutcome({ sellerId: "maustian", proposalId: "prop-1" }));

    const plasticovList = store.listOutcomesByProposal("prop-1", "plasticov");
    expect(plasticovList.length).toBe(1);
    expect(plasticovList[0]!.sellerId).toBe("plasticov");

    const maustianList = store.listOutcomesByProposal("prop-1", "maustian");
    expect(maustianList.length).toBe(1);
    expect(maustianList[0]!.sellerId).toBe("maustian");
  });

  it("listOutcomesByOrder filters correctly", () => {
    const store = createStore();

    store.insertOutcome(makeOutcome({ sellerId: "plasticov", orderId: "order-1" }));
    store.insertOutcome(makeOutcome({ sellerId: "plasticov", orderId: "order-2" }));

    const list = store.listOutcomesByOrder("order-1", "plasticov");
    expect(list.length).toBe(1);
    expect(list[0]!.orderId).toBe("order-1");
  });

  it("listOutcomesByCorrelationId filters correctly", () => {
    const store = createStore();

    store.insertOutcome(makeOutcome({ sellerId: "plasticov", correlationId: "corr-a" }));
    store.insertOutcome(makeOutcome({ sellerId: "plasticov", correlationId: "corr-b" }));

    const list = store.listOutcomesByCorrelationId("corr-a", "plasticov");
    expect(list.length).toBe(1);
    expect(list[0]!.correlationId).toBe("corr-a");
  });

  // ── Limit enforcement ────────────────────────────────────────────────

  it("listOutcomesBySeller enforces limit", () => {
    const store = createStore();

    for (let i = 0; i < 10; i++) {
      store.insertOutcome(makeOutcome({ sellerId: "plasticov" }));
    }

    const list = store.listOutcomesBySeller("plasticov", { limit: 3 });
    expect(list.length).toBe(3);
  });

  // ── Missing inputs ───────────────────────────────────────────────────

  it("listMissingInputs returns empty when no snapshots", () => {
    const store = createStore();
    const result = store.listMissingInputs("plasticov");
    expect(result).toEqual([]);
  });

  it("listMissingInputs detects single missing cost (product_cost)", () => {
    const store = createStore();
    // Create snapshot with only shipping — product_cost is missing
    const snapshot = makeSnapshot("plasticov", 50000, "CLP", ["shipping"]);
    store.insertUnitEconomicsSnapshot(snapshot);

    const result = store.listMissingInputs("plasticov");
    expect(result.length).toBe(1);
    expect(result[0]!.missingTypes).toContain("product_cost");
  });

  it("listMissingInputs detects several missing costs", () => {
    const store = createStore();
    // Only marketplace_fee provided — product_cost, shipping, advertising missing
    const snapshot = makeSnapshot("plasticov", 50000, "CLP", ["marketplace_fee"]);
    store.insertUnitEconomicsSnapshot(snapshot);

    const result = store.listMissingInputs("plasticov");
    expect(result.length).toBe(1);
    const missingTypes = result[0]!.missingTypes;
    expect(missingTypes).toContain("product_cost");
    expect(missingTypes).toContain("shipping");
    expect(missingTypes).toContain("advertising");
  });

  it("listMissingInputs returns empty for a complete snapshot", () => {
    const store = createStore();
    // All expected cost types present
    const allTypes = [
      "product_cost",
      "marketplace_fee",
      "shipping",
      "advertising",
      "seller_discount",
      "refund",
      "return",
      "tax",
      "financing",
      "landed_cost",
      "packaging",
      "other",
    ];
    const snapshot = makeSnapshot("plasticov", 200000, "CLP", allTypes);
    store.insertUnitEconomicsSnapshot(snapshot);

    const result = store.listMissingInputs("plasticov");
    expect(result).toEqual([]);
  });

  it("listMissingInputs handles both sellers simultaneously", () => {
    const store = createStore();
    // Plasticov missing product_cost
    const plasticovSnap = makeSnapshot("plasticov", 50000, "CLP", ["shipping"]);
    store.insertUnitEconomicsSnapshot(plasticovSnap);

    // Maustian missing marketplace_fee
    const maustianSnap = makeSnapshot("maustian", 30000, "CLP", ["product_cost"]);
    store.insertUnitEconomicsSnapshot(maustianSnap);

    const plasticovResult = store.listMissingInputs("plasticov");
    expect(plasticovResult.length).toBe(1);
    expect(plasticovResult[0]!.missingTypes).toContain("product_cost");

    const maustianResult = store.listMissingInputs("maustian");
    expect(maustianResult.length).toBe(1);
    expect(maustianResult[0]!.missingTypes).toContain("marketplace_fee");
  });

  it("listMissingInputs results are scoped by seller — Maustian should not see Plasticov missing inputs", () => {
    const store = createStore();
    // Plasticov has advertising missing
    const plasticovSnap = makeSnapshot("plasticov", 50000, "CLP", ["shipping", "product_cost"]);
    store.insertUnitEconomicsSnapshot(plasticovSnap);

    // Maustian has nothing — clean store from Maustian perspective
    const maustianResult = store.listMissingInputs("maustian");
    expect(maustianResult).toEqual([]);
  });

  it("listMissingInputs treats explicit zero cost as present, not missing", () => {
    const store = createStore();
    // Create snapshot with product_cost=0 explicitly
    const zeroProductCost = makeCostComponent("product_cost", clp(0));
    const snapshot = createUnitEconomicsSnapshot({
      sellerId: "plasticov",
      grossRevenue: 50000,
      currency: "CLP",
      costComponents: [zeroProductCost],
    });
    store.insertUnitEconomicsSnapshot(snapshot);

    const result = store.listMissingInputs("plasticov");
    // product_cost should NOT appear in missingInputs since it was explicit zero
    if (result.length > 0) {
      for (const entry of result) {
        expect(entry.missingTypes).not.toContain("product_cost");
      }
    }
  });

  // ── Profit summary ───────────────────────────────────────────────────

  it("summarizeProfit returns zeroes when no data", () => {
    const store = createStore();
    const summary = store.summarizeProfit("plasticov", "CLP");
    expect(summary.sellerId).toBe("plasticov");
    expect(summary.currency).toBe("CLP");
    expect(summary.totalRevenue).toBe(0);
    expect(summary.totalCosts).toBe(0);
    expect(summary.netProfit).toBe(0);
    expect(summary.netMargin).toBe(0);
    expect(summary.snapshotCount).toBe(0);
  });

  it("summarizeProfit returns positive profit", () => {
    const store = createStore();
    // Revenue=100000, costs=1000 each for 3 types=3000, netProfit=97000
    const snapshot = makeSnapshot("plasticov", 100000, "CLP", [
      "product_cost",
      "marketplace_fee",
      "shipping",
    ]);
    store.insertUnitEconomicsSnapshot(snapshot);

    const summary = store.summarizeProfit("plasticov", "CLP");
    expect(summary.sellerId).toBe("plasticov");
    expect(summary.currency).toBe("CLP");
    expect(summary.totalRevenue).toBeGreaterThan(0);
    expect(summary.netProfit).toBeGreaterThan(0);
    expect(summary.snapshotCount).toBe(1);
  });

  it("summarizeProfit returns negative profit", () => {
    const store = createStore();
    // Revenue=3000, but costs include expensive product_cost=40000
    const expensiveCOGS = makeCostComponent("product_cost", clp(40000));
    const snapshot = createUnitEconomicsSnapshot({
      sellerId: "plasticov",
      grossRevenue: 3000,
      currency: "CLP",
      costComponents: [expensiveCOGS],
    });
    store.insertUnitEconomicsSnapshot(snapshot);

    const summary = store.summarizeProfit("plasticov", "CLP");
    expect(summary.netProfit).toBeLessThan(0);
    expect(summary.totalCosts).toBeGreaterThan(summary.totalRevenue);
  });

  it("summarizeProfit aggregates multiple snapshots", () => {
    const store = createStore();
    store.insertUnitEconomicsSnapshot(
      makeSnapshot("plasticov", 50000, "CLP", ["product_cost", "marketplace_fee"]),
    );
    store.insertUnitEconomicsSnapshot(makeSnapshot("plasticov", 30000, "CLP", ["shipping"]));
    store.insertUnitEconomicsSnapshot(makeSnapshot("plasticov", 20000, "CLP", ["product_cost"]));

    const summary = store.summarizeProfit("plasticov", "CLP");
    expect(summary.snapshotCount).toBe(3);
    expect(summary.totalRevenue).toBeGreaterThan(0);
    expect(summary.netProfit).not.toBeNaN();
  });

  it("summarizeProfit handles USD currency", () => {
    const store = createStore();
    const snapshot = makeSnapshot("plasticov", 50000, "USD", ["product_cost", "marketplace_fee"]);
    store.insertUnitEconomicsSnapshot(snapshot);

    const summary = store.summarizeProfit("plasticov", "USD");
    expect(summary.currency).toBe("USD");
    expect(summary.snapshotCount).toBe(1);
    expect(summary.totalRevenue).toBe(50000);
  });

  it("summarizeProfit respects seller isolation", () => {
    const store = createStore();
    store.insertUnitEconomicsSnapshot(makeSnapshot("plasticov", 100000, "CLP", ["product_cost"]));
    store.insertUnitEconomicsSnapshot(makeSnapshot("maustian", 200000, "CLP", ["product_cost"]));

    const plasticovSummary = store.summarizeProfit("plasticov", "CLP");
    expect(plasticovSummary.sellerId).toBe("plasticov");
    expect(plasticovSummary.totalRevenue).toBe(100000);

    const maustianSummary = store.summarizeProfit("maustian", "CLP");
    expect(maustianSummary.sellerId).toBe("maustian");
    expect(maustianSummary.totalRevenue).toBe(200000);
  });

  it("summarizeProfit does not mix currencies — CLP only returns CLP data", () => {
    const store = createStore();
    store.insertUnitEconomicsSnapshot(makeSnapshot("plasticov", 100000, "CLP", ["product_cost"]));
    store.insertUnitEconomicsSnapshot(makeSnapshot("plasticov", 50000, "USD", ["product_cost"]));

    const clpSummary = store.summarizeProfit("plasticov", "CLP");
    expect(clpSummary.snapshotCount).toBe(1);
    expect(clpSummary.totalRevenue).toBe(100000);

    const usdSummary = store.summarizeProfit("plasticov", "USD");
    expect(usdSummary.snapshotCount).toBe(1);
    expect(usdSummary.totalRevenue).toBe(50000);
  });

  it("summarizeProfit filters by date range", () => {
    const store = createStore();
    const snapshot1 = makeSnapshot("plasticov", 50000, "CLP", ["product_cost"]);
    // Override calculatedAt by creating a snapshot and manually adjusting
    // The snapshot will have calculatedAt=Date.now() which is recent
    store.insertUnitEconomicsSnapshot(snapshot1);

    // Query with startDate in the far future should yield no results
    const futureStart = Date.now() + 100000000;
    const emptySummary = store.summarizeProfit("plasticov", "CLP", {
      startDate: futureStart,
    });
    expect(emptySummary.snapshotCount).toBe(0);
    expect(emptySummary.totalRevenue).toBe(0);

    // Query with startDate in the past should include the snapshot
    const pastStart = Date.now() - 100000;
    const summary = store.summarizeProfit("plasticov", "CLP", {
      startDate: pastStart,
    });
    expect(summary.snapshotCount).toBe(1);
  });

  // ── Idempotent insert does not duplicate snapshots or cost components ─

  it("idempotent insertOutcome does not duplicate snapshots or cost components", () => {
    const store = createStore();
    // Insert a snapshot first
    const snapshot = makeSnapshot("plasticov", 100000, "CLP", ["product_cost"]);
    store.insertUnitEconomicsSnapshot(snapshot);

    // Now insert an outcome with the same seller
    const outcome = makeOutcome({ sellerId: "plasticov" });
    store.insertOutcome(outcome);

    // Insert the same outcome again (idempotent)
    store.insertOutcome(outcome);

    // Snapshots should still be exactly 1
    const snapshots = store.listUnitEconomicsSnapshots("plasticov");
    expect(snapshots.length).toBe(1);

    // Outcome should still exist but not duplicated
    const retrieved = store.getOutcome(outcome.outcomeId, "plasticov");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.outcomeId).toBe(outcome.outcomeId);

    // List seller should not have duplicates
    const outcomes = store.listOutcomesBySeller("plasticov");
    expect(outcomes.length).toBe(1);
  });
});
