import type { NormalizedCommerceTransaction } from "@msl/domain";
import type { EconomicCostComponent } from "@msl/domain";

/**
 * Packaging cost adapter — DECLARED MISSING INPUT (stub).
 *
 * Real implementation would need:
 * - Packaging material cost per unit or per shipment
 * - Labor cost for packing (if variable)
 * - Integration with fulfillment or warehouse systems
 *
 * This PR leaves this as a declared missing input. The pipeline
 * will report "packaging" as missing in coverage analysis.
 */
export function adaptPackaging(
  _tx: NormalizedCommerceTransaction,
): EconomicCostComponent[] {
  return [];
}
