import type { EconomicOutcome } from "./economicOutcome.js";
import type { UnitEconomicsSnapshot } from "./unitEconomics.js";
import type { EconomicSignal } from "./economicLearning.js";

// ── Input type ──────────────────────────────────────────────────────────────

export type SignalInput = {
  outcome: EconomicOutcome;
  snapshot: UnitEconomicsSnapshot;
  baselineSnapshot?: UnitEconomicsSnapshot;
};

// ── Signal computer ─────────────────────────────────────────────────────────

/**
 * Compute an economic signal from an outcome and its unit economics snapshot.
 *
 * Guarantees:
 * - No NaN, no Infinity in any output field
 * - Magnitude is always clamped to [0, 1]
 * - Confidence is always in (0, 1]
 * - All reason codes are deterministic strings
 * - sourceValues use only finite integers/numbers from the snapshot
 */
export function computeEconomicSignal(input: SignalInput): EconomicSignal {
  const { outcome, snapshot, baselineSnapshot } = input;

  // Validate inputs — prevent NaN/Infinity propagation
  assertFinite(snapshot.netProfit, "netProfit");
  assertFinite(snapshot.grossRevenue, "grossRevenue");
  assertFinite(snapshot.contributionProfit, "contributionProfit");
  assertFinite(snapshot.netMargin, "netMargin");
  assertFinite(snapshot.contributionMargin, "contributionMargin");

  if (baselineSnapshot) {
    assertFinite(baselineSnapshot.netProfit, "baseline.netProfit");
    assertFinite(baselineSnapshot.grossRevenue, "baseline.grossRevenue");
  }

  // ── Direction ──────────────────────────────────────────────────

  const direction = computeDirection(snapshot, baselineSnapshot);

  // ── Magnitude (0..1 clamped) ────────────────────────────────────

  const magnitude = computeMagnitude(outcome, snapshot, baselineSnapshot);

  // ── Confidence ──────────────────────────────────────────────────

  const confidence = computeConfidence(snapshot);

  // ── Reason codes ────────────────────────────────────────────────

  const reasonCodes = buildReasonCodes(outcome, snapshot, baselineSnapshot, direction);

  // ── Source values (bounded metadata, no Money objects) ──────────

  const sourceValues: Record<string, number> = {
    netProfit: snapshot.netProfit,
    grossRevenue: snapshot.grossRevenue,
    contributionProfit: snapshot.contributionProfit,
    netMargin: snapshot.netMargin,
    contributionMargin: snapshot.contributionMargin,
  };

  return {
    direction,
    magnitude,
    confidence,
    reasonCodes,
    sourceValues,
  };
}

// ── Direction ───────────────────────────────────────────────────────────────

function computeDirection(
  snapshot: UnitEconomicsSnapshot,
  baselineSnapshot?: UnitEconomicsSnapshot,
): "positive" | "neutral" | "negative" {
  const netProfit = snapshot.netProfit;

  if (netProfit > 0) {
    // If baseline exists, profit must exceed baseline to be positive
    if (baselineSnapshot && netProfit <= baselineSnapshot.netProfit) {
      return "neutral";
    }
    return "positive";
  }

  if (netProfit === 0) {
    return "neutral";
  }

  // netProfit < 0
  return "negative";
}

// ── Magnitude ───────────────────────────────────────────────────────────────

function computeMagnitude(
  outcome: EconomicOutcome,
  snapshot: UnitEconomicsSnapshot,
  baselineSnapshot?: UnitEconomicsSnapshot,
): number {
  const netProfit = snapshot.netProfit;
  const grossRevenue = snapshot.grossRevenue;

  let magnitude: number;

  // Strategy 1: compare netProfit against expected economic impact
  if (outcome.expectedEconomicImpact) {
    const expected = parseExpectedImpact(outcome.expectedEconomicImpact);
    if (expected !== null && expected !== 0) {
      // How well did we meet expectations?
      // Ratio: actual/expected for positive expectations
      // Clamp: never go nuts
      magnitude = Math.min(Math.abs(netProfit / expected), 1);
      return clamp(magnitude, 0, 1);
    }
  }

  // Strategy 2: compare delta against baseline
  if (baselineSnapshot) {
    const delta = netProfit - baselineSnapshot.netProfit;
    const baseAbs = Math.max(Math.abs(baselineSnapshot.netProfit), 1);
    magnitude = Math.abs(delta) / baseAbs;
    return clamp(magnitude, 0, 1);
  }

  // Strategy 3: relative magnitude from profit vs revenue
  const denominator = Math.max(grossRevenue, 1);
  const raw = Math.abs(netProfit) / denominator;
  magnitude = Math.min(raw, 1);

  return clamp(magnitude, 0, 1);
}

// ── Confidence ──────────────────────────────────────────────────────────────

function computeConfidence(snapshot: UnitEconomicsSnapshot): number {
  let base: number;

  switch (snapshot.calculationStatus) {
    case "complete":
      base = 0.9;
      break;
    case "partial":
      base = 0.6;
      break;
    case "unverifiable":
      base = 0.3;
      break;
    case "disputed":
      base = 0.1;
      break;
  }

  // Reduce confidence further for each missing input
  const missingPenalty = snapshot.missingInputs.length * 0.05;
  const adjusted = base - missingPenalty;

  // Never <= 0, never > 1
  return clamp(adjusted, 0.01, 1);
}

// ── Reason codes ─────────────────────────────────────────────────────────────

function buildReasonCodes(
  outcome: EconomicOutcome,
  snapshot: UnitEconomicsSnapshot,
  baselineSnapshot: UnitEconomicsSnapshot | undefined,
  direction: "positive" | "neutral" | "negative",
): string[] {
  const codes: string[] = [];

  // Direction-based codes
  if (direction === "positive") {
    codes.push("positive-net-profit");
  } else if (direction === "negative") {
    codes.push("negative-net-profit");
  } else {
    codes.push("neutral-net-profit");
  }

  // Baseline comparison
  if (baselineSnapshot) {
    if (snapshot.netProfit > baselineSnapshot.netProfit) {
      codes.push("exceeded-baseline");
    } else if (snapshot.netProfit < baselineSnapshot.netProfit) {
      codes.push("below-baseline");
    } else {
      codes.push("matched-baseline");
    }
  }

  // Expected impact comparison
  if (outcome.expectedEconomicImpact) {
    const expected = parseExpectedImpact(outcome.expectedEconomicImpact);
    if (expected !== null) {
      if (snapshot.netProfit >= expected) {
        codes.push("met-or-exceeded-expected");
      } else {
        codes.push("below-expected");
      }
    }
  }

  // Refund awareness
  if (snapshot.refunds > 0) {
    codes.push("profitability-refunded");
  }

  // Calculation quality
  codes.push(`calc-${snapshot.calculationStatus}`);

  return codes;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`computeEconomicSignal: ${label} must be finite, got ${value}`);
  }
}

/**
 * Parse expectedEconomicImpact string into a numeric value.
 * Returns null if not parseable.
 *
 * Expected formats:
 * - A plain number string like "50000"
 * - Descriptive strings like "POSITIVE" or "NEGATIVE"
 *   (mapped to approximate magnitudes)
 */
function parseExpectedImpact(impact: string): number | null {
  // Try numeric parse first
  const num = Number(impact);
  if (Number.isFinite(num) && !isNaN(num)) {
    return num;
  }

  // Descriptive strings
  const upper = impact.toUpperCase();
  if (upper === "POSITIVE" || upper === "HIGH") {
    return 100000; // approximate positive magnitude
  }
  if (upper === "NEGATIVE" || upper === "LOW") {
    return -50000;
  }
  if (upper === "NEUTRAL") {
    return 0;
  }

  return null;
}
