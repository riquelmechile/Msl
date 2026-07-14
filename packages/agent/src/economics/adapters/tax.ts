import type { NormalizedCommerceTransaction } from "@msl/domain";
import type { EconomicCostComponent } from "@msl/domain";

/**
 * Tax cost adapter — DECLARED MISSING INPUT (stub).
 *
 * Real implementation would need:
 * - VAT/IVA treatment per transaction (seller regime dependent)
 * - Income tax allocation
 * - Withholding tax on marketplace fees (e.g., ML retentions)
 * - Integration with tax authority or accounting systems
 *
 * This PR leaves this as a declared missing input. The pipeline
 * will report "tax" as missing in coverage analysis.
 */
export function adaptTax(_tx: NormalizedCommerceTransaction): EconomicCostComponent[] {
  return [];
}
