import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { EconomicOutcome, EconomicOutcomeStatus } from "@msl/domain";
import { createEconomicOutcome } from "@msl/domain";
import {
  createSqliteEconomicOutcomeStore,
  type EconomicOutcomeStore,
  type ProfitSummary,
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
});
