import type { Currency, NormalizedCommerceTransaction } from "@msl/domain";

/**
 * Extracted revenue result from order revenue adapter.
 * Revenue is the input to UnitEconomicsSnapshot, NOT a cost component.
 */
export type RevenueResult = { grossRevenue: number; currency: Currency };

/**
 * Extract gross revenue from a normalized commerce transaction.
 *
 * - Cancelled orders return null (zero revenue).
 * - Active orders return the grossRevenue amount in minor units.
 *
 * Revenue is NOT stored as an EconomicCostComponent — it feeds
 * directly into UnitEconomicsInput.grossRevenue.
 */
export function extractOrderRevenue(tx: NormalizedCommerceTransaction): RevenueResult | null {
  if (tx.orderStatus === "cancelled") return null;
  return { grossRevenue: tx.grossRevenue.amountMinor, currency: tx.currency };
}
