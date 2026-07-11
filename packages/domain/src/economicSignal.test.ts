import { describe, expect, it } from "vitest";
import { createEconomicOutcome } from "./economicOutcome.js";
import type { UnitEconomicsSnapshot } from "./unitEconomics.js";
import type { MissingCostLabel } from "./unitEconomics.js";
import { computeEconomicSignal, type SignalInput } from "./economicSignal.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function makeInput(
  overrides: Partial<{
    netProfit: number;
    grossRevenue: number;
    calculationStatus: UnitEconomicsSnapshot["calculationStatus"];
    refunds: number;
    missingInputs: readonly string[];
    baseline: UnitEconomicsSnapshot | undefined;
    expectedImpact: string | undefined;
  }> = {},
): SignalInput {
  const outcome = createEconomicOutcome({
    sellerId: "seller-1",
    ...(overrides.expectedImpact ? { expectedEconomicImpact: overrides.expectedImpact } : {}),
  });

  const snapshot = makeSnapshot({
    netProfit: overrides.netProfit ?? 45000,
    grossRevenue: overrides.grossRevenue ?? 100000,
    calculationStatus: overrides.calculationStatus ?? "complete",
    refunds: overrides.refunds ?? 0,
    missingInputs: (overrides.missingInputs ?? []) as readonly MissingCostLabel[],
  });

  return {
    outcome,
    snapshot,
    ...(overrides.baseline !== undefined ? { baselineSnapshot: overrides.baseline } : {}),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("computeEconomicSignal", () => {
  // Test 1: positive net profit → positive direction
  it("returns positive direction for positive net profit", () => {
    const signal = computeEconomicSignal(makeInput({ netProfit: 50000 }));
    expect(signal.direction).toBe("positive");
  });

  // Test 2: negative net profit → negative direction
  it("returns negative direction for negative net profit", () => {
    const signal = computeEconomicSignal(makeInput({ netProfit: -20000 }));
    expect(signal.direction).toBe("negative");
  });

  // Test 3: zero → neutral
  it("returns neutral direction for zero net profit", () => {
    const signal = computeEconomicSignal(makeInput({ netProfit: 0 }));
    expect(signal.direction).toBe("neutral");
  });

  // Test 4: profit with refund → still positive if net > 0
  it("returns positive even with refund costs when net profit > 0", () => {
    const signal = computeEconomicSignal(
      makeInput({ netProfit: 10000, refunds: 50000 }),
    );
    expect(signal.direction).toBe("positive");
  });

  // Test 5: above expected → higher magnitude
  it("produces magnitude from expected impact comparison", () => {
    // expected = 10000, actual = 50000 → ratio = 5, clamped to 1
    const signal = computeEconomicSignal(
      makeInput({ netProfit: 50000, expectedImpact: "10000" }),
    );
    expect(signal.magnitude).toBeGreaterThanOrEqual(0);
    expect(signal.magnitude).toBeLessThanOrEqual(1);
    // 50000 / 10000 = 5, clamped to 1
    expect(signal.magnitude).toBe(1);
  });

  // Test 6: below expected → appropriate magnitude
  it("produces fractional magnitude when below expected", () => {
    // expected = 100000, actual = 30000 → 0.3
    const signal = computeEconomicSignal(
      makeInput({ netProfit: 30000, expectedImpact: "100000" }),
    );
    expect(signal.magnitude).toBeCloseTo(0.3, 1);
  });

  // Test 7: no baseline → magnitude from relative profit
  it("computes magnitude from relative profit when no baseline or expected", () => {
    // netProfit=45000, grossRevenue=100000 → 0.45
    const signal = computeEconomicSignal(
      makeInput({ netProfit: 45000, grossRevenue: 100000 }),
    );
    expect(signal.magnitude).toBeCloseTo(0.45, 1);
  });

  // Test 8: partial snapshot → lower confidence
  it("returns lower confidence for partial snapshots", () => {
    const complete = computeEconomicSignal(
      makeInput({ calculationStatus: "complete" }),
    );
    const partial = computeEconomicSignal(
      makeInput({ calculationStatus: "partial", missingInputs: ["shipping"] }),
    );

    expect(complete.confidence).toBe(0.9);
    expect(partial.confidence).toBeLessThan(0.9);
    expect(partial.confidence).toBeGreaterThan(0);
  });

  // Test 9: magnitude clamped to 0..1
  it("clamps magnitude to [0, 1] range", () => {
    // Very small profit → magnitude should be between 0 and 1
    const small = computeEconomicSignal(
      makeInput({ netProfit: 1, grossRevenue: 100000 }),
    );
    expect(small.magnitude).toBeGreaterThanOrEqual(0);
    expect(small.magnitude).toBeLessThanOrEqual(1);

    // Very large profit relative to revenue
    const large = computeEconomicSignal(
      makeInput({ netProfit: 900000, grossRevenue: 100000 }),
    );
    expect(large.magnitude).toBeGreaterThanOrEqual(0);
    expect(large.magnitude).toBeLessThanOrEqual(1);
  });

  // Test 10: no NaN or Infinity
  it("never produces NaN or Infinity", () => {
    const signal = computeEconomicSignal(makeInput({ netProfit: 50000 }));

    expect(Number.isFinite(signal.magnitude)).toBe(true);
    expect(Number.isFinite(signal.confidence)).toBe(true);
    expect(Number.isNaN(signal.magnitude)).toBe(false);
    expect(Number.isNaN(signal.confidence)).toBe(false);
    expect(signal.magnitude).not.toBe(Infinity);
    expect(signal.confidence).not.toBe(Infinity);

    // Check sourceValues too
    for (const [, value] of Object.entries(signal.sourceValues)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  // Additional: disputed snapshot → very low confidence
  it("returns lowest confidence for disputed snapshots", () => {
    const disputed = computeEconomicSignal(
      makeInput({ calculationStatus: "disputed" }),
    );
    expect(disputed.confidence).toBe(0.1);
  });

  // Additional: unverifiable → low confidence
  it("returns low confidence for unverifiable snapshots", () => {
    const unverifiable = computeEconomicSignal(
      makeInput({ calculationStatus: "unverifiable" }),
    );
    expect(unverifiable.confidence).toBe(0.3);
  });

  // Additional: reason codes include calculation status
  it("includes calculation status in reason codes", () => {
    const signal = computeEconomicSignal(makeInput({ calculationStatus: "complete" }));
    expect(signal.reasonCodes).toContain("calc-complete");
  });

  // Additional: refund awareness in reason codes
  it("adds refund code when refunds are present", () => {
    const signal = computeEconomicSignal(
      makeInput({ netProfit: 10000, refunds: 5000 }),
    );
    expect(signal.reasonCodes).toContain("profitability-refunded");
  });

  // Additional: baseline comparison
  it("detects exceeded baseline", () => {
    const baseline = makeSnapshot({ netProfit: 20000 });
    const signal = computeEconomicSignal(
      makeInput({ netProfit: 50000, baseline }),
    );
    expect(signal.reasonCodes).toContain("exceeded-baseline");
    expect(signal.direction).toBe("positive");
  });

  // Additional: below baseline
  it("detects below baseline", () => {
    const baseline = makeSnapshot({ netProfit: 80000 });
    const signal = computeEconomicSignal(
      makeInput({ netProfit: 30000, baseline }),
    );
    expect(signal.reasonCodes).toContain("below-baseline");
    // netProfit > 0 but below baseline → neutral
    expect(signal.direction).toBe("neutral");
  });

  // Additional: positive expected impact → met-or-exceeded
  it("detects met-or-exceeded-expected for POSITIVE expectation", () => {
    // POSITIVE maps to 100000, netProfit=45000 → below
    const signal = computeEconomicSignal(
      makeInput({ netProfit: 45000, expectedImpact: "POSITIVE" }),
    );
    // 45000 < 100000 → below-expected
    expect(signal.reasonCodes).toContain("below-expected");

    // Large profit → meets expected
    const signal2 = computeEconomicSignal(
      makeInput({ netProfit: 150000, expectedImpact: "POSITIVE" }),
    );
    expect(signal2.reasonCodes).toContain("met-or-exceeded-expected");
  });

  // Additional: magnitude from baseline delta
  it("computes magnitude from baseline delta", () => {
    const baseline = makeSnapshot({ netProfit: 20000 });
    // delta = 50000 - 20000 = 30000, base = 20000, ratio = 1.5, clamped to 1
    const signal = computeEconomicSignal(
      makeInput({ netProfit: 50000, baseline }),
    );
    expect(signal.magnitude).toBe(1);
  });

  // Additional: sourceValues contains all expected keys
  it("includes all required source values", () => {
    const signal = computeEconomicSignal(makeInput({ netProfit: 45000 }));
    expect(signal.sourceValues).toHaveProperty("netProfit");
    expect(signal.sourceValues).toHaveProperty("grossRevenue");
    expect(signal.sourceValues).toHaveProperty("contributionProfit");
    expect(signal.sourceValues).toHaveProperty("netMargin");
    expect(signal.sourceValues).toHaveProperty("contributionMargin");
    expect(signal.sourceValues.netProfit).toBe(45000);
  });
});
