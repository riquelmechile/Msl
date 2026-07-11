import type { UnitEconomicsSnapshot } from "@msl/domain";
import type { ReconciliationVerdict } from "./EconomicIngestionPipeline.js";

/**
 * Compare source-reported economic totals against the computed sum of
 * UnitEconomicsSnapshot values for the same ingestion run.
 *
 * @param sourceTotals — totals as reported by the source system (ML API).
 * @param computed — the UnitEconomicsSnapshot instances produced during this run.
 * @param tolerance — maximum allowed difference in minor units (e.g., 1 centavo).
 * @returns A ReconciliationVerdict describing the match quality.
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
  };

  for (const snap of computed) {
    computedTotals.grossRevenue += snap.grossRevenue;
    computedTotals.fees += snap.marketplaceFees;
    computedTotals.shipping += snap.sellerShippingCost;
    computedTotals.ads += snap.advertisingCost;
    computedTotals.refunds += snap.refunds;
  }

  const diffs = {
    grossRevenue: Math.abs(sourceTotals.grossRevenue - computedTotals.grossRevenue),
    fees: Math.abs(sourceTotals.fees - computedTotals.fees),
    shipping: Math.abs(sourceTotals.shipping - computedTotals.shipping),
    ads: Math.abs(sourceTotals.ads - computedTotals.ads),
    refunds: Math.abs(sourceTotals.refunds - computedTotals.refunds),
  };

  const maxDiff = Math.max(...Object.values(diffs));
  const totalSource =
    sourceTotals.grossRevenue +
    sourceTotals.fees +
    sourceTotals.shipping +
    sourceTotals.ads +
    sourceTotals.refunds;
  const totalComputed =
    computedTotals.grossRevenue +
    computedTotals.fees +
    computedTotals.shipping +
    computedTotals.ads +
    computedTotals.refunds;

  // No computed snapshots → incomplete
  if (computed.length === 0) {
    return {
      status: "incomplete",
      details: "No UnitEconomicsSnapshots were computed — reconciliation cannot proceed.",
      sourceTotal: totalSource,
      computedTotal: 0,
      difference: totalSource,
    };
  }

  // Any disputed snapshots?
  const disputedCount = computed.filter((s) => s.calculationStatus === "disputed").length;
  if (disputedCount > 0) {
    return {
      status: "disputed",
      details: `${disputedCount} snapshot(s) have disputed calculation status.`,
      sourceTotal: totalSource,
      computedTotal: totalComputed,
      difference: Math.abs(totalSource - totalComputed),
    };
  }

  // Within tolerance?
  if (maxDiff <= tolerance) {
    const status = maxDiff === 0 ? "balanced" : ("balanced-with-tolerance" as const);
    return {
      status,
      details:
        maxDiff === 0
          ? "All categories match exactly."
          : `All differences within tolerance (${tolerance} minor units). Max diff: ${maxDiff}.`,
      sourceTotal: totalSource,
      computedTotal: totalComputed,
      difference: maxDiff,
    };
  }

  // Exceeds tolerance
  const mismatchDetails: string[] = [];
  if (diffs.grossRevenue > tolerance) {
    mismatchDetails.push(
      `grossRevenue: source=${sourceTotals.grossRevenue}, computed=${computedTotals.grossRevenue}, diff=${diffs.grossRevenue}`,
    );
  }
  if (diffs.fees > tolerance) {
    mismatchDetails.push(
      `fees: source=${sourceTotals.fees}, computed=${computedTotals.fees}, diff=${diffs.fees}`,
    );
  }
  if (diffs.shipping > tolerance) {
    mismatchDetails.push(
      `shipping: source=${sourceTotals.shipping}, computed=${computedTotals.shipping}, diff=${diffs.shipping}`,
    );
  }
  if (diffs.ads > tolerance) {
    mismatchDetails.push(
      `ads: source=${sourceTotals.ads}, computed=${computedTotals.ads}, diff=${diffs.ads}`,
    );
  }
  if (diffs.refunds > tolerance) {
    mismatchDetails.push(
      `refunds: source=${sourceTotals.refunds}, computed=${computedTotals.refunds}, diff=${diffs.refunds}`,
    );
  }

  return {
    status: "mismatched",
    details: `Reconciliation failed (tolerance: ${tolerance} minor units). Mismatches: ${mismatchDetails.join("; ")}`,
    sourceTotal: totalSource,
    computedTotal: totalComputed,
    difference: maxDiff,
  };
}
