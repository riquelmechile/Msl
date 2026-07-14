import type { NormalizedCommerceTransaction } from "@msl/domain";
import type { EconomicCostComponent } from "@msl/domain";

/**
 * Product cost adapter — DECLARED MISSING INPUT (stub).
 *
 * Real implementation would need:
 * - Supplier cost data (cost price per SKU/variation)
 * - Integration with supplier/catalog systems (supplier mirrors, purchase orders)
 * - Unit cost allocation per item sold
 * - COGS tracking per transaction
 *
 * This PR leaves this as a declared missing input. The pipeline
 * will report "product_cost" as missing in coverage analysis.
 */
export function adaptProductCost(_tx: NormalizedCommerceTransaction): EconomicCostComponent[] {
  return [];
}
