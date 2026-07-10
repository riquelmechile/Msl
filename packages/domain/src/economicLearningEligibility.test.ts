import { describe, expect, it } from "vitest";
import { createEconomicOutcome, transitionOutcome } from "./economicOutcome.js";
import type { EconomicOutcome } from "./economicOutcome.js";
import type { UnitEconomicsSnapshot } from "./unitEconomics.js";
import {
  evaluateEconomicLearningEligibility,
  type EligibilityInput,
} from "./economicLearningEligibility.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeOutcome(
  overrides: Partial<EconomicOutcome> = {},
): EconomicOutcome {
  let outcome = createEconomicOutcome({ sellerId: "seller-1" });
  outcome = { ...outcome, ...overrides };
  return outcome;
}

function makeVerifiedOutcome(
  overrides: Partial<EconomicOutcome> = {},
): EconomicOutcome {
  let outcome = createEconomicOutcome({ sellerId: "seller-1" });
  outcome = transitionOutcome(outcome, "observing");
  outcome = transitionOutcome(outcome, "observed");
  outcome = transitionOutcome(outcome, "verified");
  outcome = {
    ...outcome,
    observedEconomicImpactId: "impact-1",
    completeness: 1.0,
    confidence: 0.9,
    ...overrides,
  };
  return outcome;
}

function makeSnapshot(
  overrides: Partial<UnitEconomicsSnapshot> = {},
): UnitEconomicsSnapshot {
  const base: UnitEconomicsSnapshot = {
    snapshotId: "snap-1",
    sellerId: "seller-1",
    currency: "CLP",
    grossRevenue: 100000,
    sellerFundedDiscounts: 0,
    refunds: 0,
    marketplaceFees: 10000,
    sellerShippingCost: 5000,
    advertisingCost: 3000,
    productCost: 30000,
    allocatedLandedCost: 0,
    taxes: 5000,
    financingCost: 0,
    packagingCost: 2000,
    otherCosts: 0,
    contributionProfit: 52000,
    netProfit: 45000,
    contributionMargin: 0.52,
    netMargin: 0.45,
    missingInputs: [],
    calculationStatus: "complete",
    calculatedAt: Date.now(),
    ...overrides,
  };
  return base;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("evaluateEconomicLearningEligibility", () => {
  // ── Test 1: pending → blocked ──────────────────────────────────────
  it("blocks pending outcome with outcome-not-verified", () => {
    const result = evaluateEconomicLearningEligibility({
      outcome: makeOutcome({ status: "pending" }),
      snapshot: makeSnapshot(),
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("outcome-not-verified");
    expect(result.reasonCodes).toContain("missing-observed-impact");
  });

  // ── Test 2: observing → blocked ────────────────────────────────────
  it("blocks observing outcome with outcome-not-verified", () => {
    let outcome = createEconomicOutcome({ sellerId: "seller-1" });
    outcome = transitionOutcome(outcome, "observing");

    const result = evaluateEconomicLearningEligibility({
      outcome,
      snapshot: makeSnapshot(),
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("outcome-not-verified");
  });

  // ── Test 3: observed → blocked ─────────────────────────────────────
  it("blocks observed outcome with outcome-not-verified", () => {
    let outcome = createEconomicOutcome({ sellerId: "seller-1" });
    outcome = transitionOutcome(outcome, "observing");
    outcome = transitionOutcome(outcome, "observed");

    const result = evaluateEconomicLearningEligibility({
      outcome,
      snapshot: makeSnapshot(),
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("outcome-not-verified");
  });

  // ── Test 4: disputed → blocked ─────────────────────────────────────
  it("blocks disputed outcome (terminal)", () => {
    let outcome = createEconomicOutcome({ sellerId: "seller-1" });
    outcome = transitionOutcome(outcome, "observing");
    outcome = transitionOutcome(outcome, "observed");
    outcome = transitionOutcome(outcome, "disputed");

    const result = evaluateEconomicLearningEligibility({
      outcome,
      snapshot: makeSnapshot(),
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("outcome-not-verified");
  });

  // ── Test 5: invalidated → blocked ──────────────────────────────────
  it("blocks invalidated outcome (terminal)", () => {
    let outcome = createEconomicOutcome({ sellerId: "seller-1" });
    outcome = transitionOutcome(outcome, "observing");
    outcome = transitionOutcome(outcome, "observed");
    outcome = transitionOutcome(outcome, "invalidated");

    const result = evaluateEconomicLearningEligibility({
      outcome,
      snapshot: makeSnapshot(),
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("outcome-not-verified");
  });

  // ── Test 6: verified + complete → eligible ─────────────────────────
  it("marks verified outcome with complete snapshot as eligible", () => {
    const outcome = makeVerifiedOutcome();
    const snapshot = makeSnapshot({ calculationStatus: "complete", missingInputs: [] });

    const result = evaluateEconomicLearningEligibility({
      outcome,
      snapshot,
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });

    expect(result.eligible).toBe(true);
    expect(result.reasonCodes).toEqual([]);
    expect(result.outcomeStatus).toBe("verified");
    expect(result.hasVerifiedEconomicImpact).toBe(true);
    expect(result.evaluatedAt).toBeGreaterThan(0);
    expect(result.currencies).toEqual(["CLP"]);
  });

  // ── Test 7: verified + missing observedImpactId → blocked ──────────
  it("blocks verified outcome without observedEconomicImpactId", () => {
    const outcome = makeVerifiedOutcome();
    // Delete observedEconomicImpactId to simulate missing field
    const { observedEconomicImpactId: _drop, ...outcomeWithoutImpact } = outcome as EconomicOutcome & { observedEconomicImpactId?: string };
    const cleaned = outcomeWithoutImpact as EconomicOutcome;

    const result = evaluateEconomicLearningEligibility({
      outcome: cleaned,
      snapshot: makeSnapshot(),
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("missing-observed-impact");
  });

  // ── Test 8: verified + incomplete snapshot → blocked ───────────────
  it("blocks when snapshot is partial with missing inputs", () => {
    const outcome = makeVerifiedOutcome();
    const snapshot = makeSnapshot({
      calculationStatus: "partial",
      missingInputs: ["product_cost", "shipping"],
    });

    const result = evaluateEconomicLearningEligibility({
      outcome,
      snapshot,
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("incomplete-economic-data");
  });

  // ── Test 9: verified + disputed snapshot → blocked ─────────────────
  it("blocks when snapshot is disputed", () => {
    const outcome = makeVerifiedOutcome();
    const snapshot = makeSnapshot({ calculationStatus: "disputed" });

    const result = evaluateEconomicLearningEligibility({
      outcome,
      snapshot,
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("disputed-evidence");
  });

  // ── Test 10: verified + alreadyProcessed → blocked ─────────────────
  it("blocks already processed outcomes", () => {
    const outcome = makeVerifiedOutcome();
    const snapshot = makeSnapshot({ calculationStatus: "complete" });

    const result = evaluateEconomicLearningEligibility({
      outcome,
      snapshot,
      hasAttributionTargets: true,
      alreadyProcessed: true,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("already-processed");
  });

  // ── Test 11: verified + no attribution targets → blocked ───────────
  it("blocks when no attribution targets are available", () => {
    const outcome = makeVerifiedOutcome();
    const snapshot = makeSnapshot();

    const result = evaluateEconomicLearningEligibility({
      outcome,
      snapshot,
      hasAttributionTargets: false,
      alreadyProcessed: false,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("missing-attribution-target");
  });

  // ── Test 12: verified + seller mismatch → blocked ──────────────────
  it("blocks when snapshot seller does not match outcome seller", () => {
    const outcome = makeVerifiedOutcome({ sellerId: "seller-1" });
    const snapshot = makeSnapshot({ sellerId: "seller-2" });

    const result = evaluateEconomicLearningEligibility({
      outcome,
      snapshot,
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("seller-scope-mismatch");
  });

  // ── Additional: unverifiable snapshot → blocked ────────────────────
  it("blocks when snapshot is unverifiable", () => {
    const outcome = makeVerifiedOutcome();
    const snapshot = makeSnapshot({ calculationStatus: "unverifiable" });

    const result = evaluateEconomicLearningEligibility({
      outcome,
      snapshot,
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasonCodes).toContain("disputed-evidence");
  });

  // ── Additional: multiple block reasons accumulate ──────────────────
  it("accumulates multiple block reasons", () => {
    const outcome = makeOutcome({ status: "pending" });
    // Remove observedEconomicImpactId
    const { observedEconomicImpactId: _drop, ...cleaned } = outcome as EconomicOutcome & { observedEconomicImpactId?: string };

    const result = evaluateEconomicLearningEligibility({
      outcome: cleaned as EconomicOutcome,
      snapshot: makeSnapshot(),
      hasAttributionTargets: false,
      alreadyProcessed: true,
    });

    expect(result.eligible).toBe(false);
    // Should have at least outcome-not-verified, missing-observed-impact,
    // missing-attribution-target, already-processed
    expect(result.reasonCodes).toContain("outcome-not-verified");
    expect(result.reasonCodes).toContain("missing-observed-impact");
    expect(result.reasonCodes).toContain("missing-attribution-target");
    expect(result.reasonCodes).toContain("already-processed");
  });

  // ── Additional: evidence quality varies with snapshot quality ──────
  it("computes evidence quality from snapshot", () => {
    const outcome = makeVerifiedOutcome();

    // Complete → 1.0
    const r1 = evaluateEconomicLearningEligibility({
      outcome,
      snapshot: makeSnapshot({ calculationStatus: "complete" }),
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });
    expect(r1.evidenceQuality).toBe(1.0);

    // Disputed → 0.1
    const r2 = evaluateEconomicLearningEligibility({
      outcome,
      snapshot: makeSnapshot({ calculationStatus: "disputed" }),
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });
    expect(r2.evidenceQuality).toBe(0.1);

    // Unverifiable → 0.3
    const r3 = evaluateEconomicLearningEligibility({
      outcome,
      snapshot: makeSnapshot({ calculationStatus: "unverifiable" }),
      hasAttributionTargets: true,
      alreadyProcessed: false,
    });
    expect(r3.evidenceQuality).toBe(0.3);
  });
});
