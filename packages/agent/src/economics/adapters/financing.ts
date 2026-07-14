import type { NormalizedCommerceTransaction } from "@msl/domain";
import type { EconomicCostComponent } from "@msl/domain";

/**
 * Financing cost adapter — DECLARED MISSING INPUT (stub).
 *
 * Real implementation would need:
 * - ML installment/cuotas cost (seller-funded interest portion)
 * - Merchant discount rate for payment processing
 * - Working capital cost allocation
 * - Integration with ML billing/sales API for financed sales
 *
 * This PR leaves this as a declared missing input. The pipeline
 * will report "financing" as missing in coverage analysis.
 */
export function adaptFinancing(_tx: NormalizedCommerceTransaction): EconomicCostComponent[] {
  return [];
}
