import type { UnitEconomicsSnapshot } from "@msl/domain";
import type { ReconciliationVerdict } from "./EconomicIngestionPipeline.js";

/** Dimension status shared by revenue and cost reconciliation. */
type DimensionStatus = "balanced" | "balanced-with-tolerance" | "mismatched" | "incomplete";

/** Dimension reconciliation pair. */
type DimensionReconciliation = {
  status: DimensionStatus;
  sourceTotal: number;
  computedTotal: number;
  difference: number;
};

/**
 * Compare source-reported economic totals against the computed sum of
 * UnitEconomicsSnapshot values for the same ingestion run.
 *
 * Multi-dimensional reconciliation: revenue, cost, and coverage are
 * evaluated independently. Zero-both-sides (no revenue AND no cost)
 * produces status "incomplete", NOT "balanced".
 *
 * @param sourceTotals — totals as reported by the source system (ML API).
 * @param computed — the UnitEconomicsSnapshot instances produced during this run.
 * @param tolerance — maximum allowed difference in minor units (e.g., 1 centavo).
 * @returns A multi-dimensional ReconciliationVerdict.
 */
export function reconcileEconomics(
  sourceTotals: {
    grossRevenue: number;
    fees: number;
    shipping: number;
    ads: number;
    refunds: number;
  },
  computed: UnitEconomicsSnapshot[],
  tolerance: number,
): ReconciliationVerdict {
  const computedTotals = {
    grossRevenue: 0,
    fees: 0,
    shipping: 0,
    ads: 0,
    refunds: 0,
    productCost: 0,
    landedCost: 0,
  };

  for (const snap of computed) {
    computedTotals.grossRevenue += snap.grossRevenue;
    computedTotals.fees += snap.marketplaceFees;
    computedTotals.shipping += snap.sellerShippingCost;
    computedTotals.ads += snap.advertisingCost;
    computedTotals.refunds += snap.refunds;
    computedTotals.productCost += snap.productCost;
    computedTotals.landedCost += snap.allocatedLandedCost;
  }

  // ── Revenue dimension ──────────────────────────────────────────────────

  const revenueDiff = Math.abs(sourceTotals.grossRevenue - computedTotals.grossRevenue);
  const revenueStatus: DimensionStatus =
    revenueDiff <= tolerance
      ? revenueDiff === 0
        ? "balanced"
        : "balanced-with-tolerance"
      : "mismatched";

  const revenueReconciliation: DimensionReconciliation = {
    status: revenueStatus,
    sourceTotal: sourceTotals.grossRevenue,
    computedTotal: computedTotals.grossRevenue,
    difference: revenueDiff,
  };

  // ── Cost dimension (fees + shipping + ads + refunds) ───────────────────

  const sourceCost = sourceTotals.fees + sourceTotals.shipping + sourceTotals.ads + sourceTotals.refunds;
  const computedCost = computedTotals.fees + computedTotals.shipping + computedTotals.ads + computedTotals.refunds;
  const costDiff = Math.abs(sourceCost - computedCost);
  const costStatus: DimensionStatus =
    costDiff <= tolerance
      ? costDiff === 0
        ? "balanced"
        : "balanced-with-tolerance"
      : "mismatched";

  const costReconciliation: DimensionReconciliation = {
    status: costStatus,
    sourceTotal: sourceCost,
    computedTotal: computedCost,
    difference: costDiff,
  };

  // ── Coverage ───────────────────────────────────────────────────────────

  const productCostMissing = computedTotals.productCost === 0;
  const landedCostMissing = computedTotals.landedCost === 0;

  const coverage: ReconciliationVerdict["coverage"] = {
    meaningful: !productCostMissing || !landedCostMissing || computed.length > 0,
    dimensions: {
      marketplaceFee: computedTotals.fees > 0 ? "complete" : "missing",
      shipping: computedTotals.shipping > 0 ? "complete" : "missing",
      ads: computedTotals.ads > 0 ? "complete" : "missing",
      refunds: computedTotals.refunds > 0 ? "complete" : "missing",
      productCost: productCostMissing ? "missing" : "complete",
      landedCost: landedCostMissing ? "missing" : "complete",
    },
  };

  // ── Overall status ─────────────────────────────────────────────────────

  // No computed snapshots → incomplete
  if (computed.length === 0) {
    return {
      status: "incomplete",
      details: "No UnitEconomicsSnapshots were computed — reconciliation cannot proceed.",
      sourceTotal: sourceTotals.grossRevenue + sourceCost,
      computedTotal: 0,
      difference: sourceTotals.grossRevenue + sourceCost,
      revenueReconciliation,
      costReconciliation,
      coverage,
      productCostMissing,
      landedCostMissing,
    };
  }

  // Any disputed snapshots?
  const disputedCount = computed.filter((s) => s.calculationStatus === "disputed").length;
  if (disputedCount > 0) {
    const totalSource =
      sourceTotals.grossRevenue + sourceCost;
    const totalComputed =
      computedTotals.grossRevenue + computedCost;
    return {
      status: "disputed",
      details: `${disputedCount} snapshot(s) have disputed calculation status.`,
      sourceTotal: totalSource,
      computedTotal: totalComputed,
      difference: Math.abs(totalSource - totalComputed),
      revenueReconciliation,
      costReconciliation,
      coverage,
      productCostMissing,
      landedCostMissing,
    };
  }

  // Zero-both-sides → incomplete (spec: zero revenue AND zero cost)
  if (sourceTotals.grossRevenue === 0 && sourceCost === 0 &&
      computedTotals.grossRevenue === 0 && computedCost === 0) {
    return {
      status: "incomplete",
      details: "Both revenue and costs are zero — reconciliation cannot determine balance. This is classified as incomplete, not balanced.",
      sourceTotal: 0,
      computedTotal: 0,
      difference: 0,
      revenueReconciliation,
      costReconciliation,
      coverage: {
        ...coverage,
        meaningful: false,
      },
      productCostMissing,
      landedCostMissing,
    };
  }

  // Within tolerance on both dimensions?
  const bothBalanced = revenueDiff <= tolerance && costDiff <= tolerance;
  if (bothBalanced) {
    const maxDiff = Math.max(revenueDiff, costDiff);
    const status = maxDiff === 0 ? "balanced" : ("balanced-with-tolerance" as const);
    const totalSource =
      sourceTotals.grossRevenue + sourceCost;
    const totalComputed =
      computedTotals.grossRevenue + computedCost;
    return {
      status,
      details:
        maxDiff === 0
          ? "All categories match exactly across revenue and cost dimensions."
          : `All differences within tolerance (${tolerance} minor units). Revenue diff: ${revenueDiff}, Cost diff: ${costDiff}.`,
      sourceTotal: totalSource,
      computedTotal: totalComputed,
      difference: maxDiff,
      revenueReconciliation,
      costReconciliation,
      coverage,
      productCostMissing,
      landedCostMissing,
    };
  }

  // Exceeds tolerance on at least one dimension
  const mismatchDetails: string[] = [];
  if (revenueDiff > tolerance) {
    mismatchDetails.push(
      `grossRevenue: source=${sourceTotals.grossRevenue}, computed=${computedTotals.grossRevenue}, diff=${revenueDiff}`,
    );
  }
  if (costDiff > tolerance) {
    mismatchDetails.push(
      `costs: source=${sourceCost}, computed=${computedCost}, diff=${costDiff}`,
    );
  }

  const totalSource =
    sourceTotals.grossRevenue + sourceCost;
  const totalComputed =
    computedTotals.grossRevenue + computedCost;
  const maxDiff = Math.max(revenueDiff, costDiff);

  return {
    status: "mismatched",
    details: `Reconciliation failed (tolerance: ${tolerance} minor units). Mismatches: ${mismatchDetails.join("; ")}`,
    sourceTotal: totalSource,
    computedTotal: totalComputed,
    difference: maxDiff,
    revenueReconciliation,
    costReconciliation,
    coverage,
    productCostMissing,
    landedCostMissing,
  };
}
