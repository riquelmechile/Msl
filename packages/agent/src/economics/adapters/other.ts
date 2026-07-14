import type { NormalizedCommerceTransaction } from "@msl/domain";
import type { EconomicCostComponent } from "@msl/domain";

/**
 * Other costs adapter — DECLARED MISSING INPUT (stub).
 *
 * Real implementation would need:
 * - Any seller-specific cost not covered by other adapters
 * - Manual cost entry (seller declares custom costs)
 * - Integration with accounting system or custom cost rules
 *
 * This PR leaves this as a declared missing input. The pipeline
 * will report "other" as missing in coverage analysis.
 */
export function adaptOther(_tx: NormalizedCommerceTransaction): EconomicCostComponent[] {
  return [];
}
