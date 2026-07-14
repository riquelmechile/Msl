import type { NormalizedCommerceTransaction } from "@msl/domain";
import type { EconomicCostComponent } from "@msl/domain";

/**
 * Landed cost adapter — DECLARED MISSING INPUT (stub).
 *
 * Real implementation would need:
 * - Customs/duty data per international shipment
 * - Freight cost per container or per-unit allocation
 * - Insurance costs per shipment
 * - Integration with customs broker systems or manual entry
 *
 * This PR leaves this as a declared missing input. The pipeline
 * will report "landed_cost" as missing in coverage analysis.
 */
export function adaptLandedCost(_tx: NormalizedCommerceTransaction): EconomicCostComponent[] {
  return [];
}
