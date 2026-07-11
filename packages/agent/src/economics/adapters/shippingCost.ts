import type { NormalizedCommerceTransaction } from "@msl/domain";
import { createMoney, createEconomicCostComponent } from "@msl/domain";
import type { EconomicCostComponent } from "@msl/domain";

export type ShippingData = {
  /** Seller-funded shipping cost in minor units */
  shippingCost?: number;
  /** Who pays for shipping: "buyer" | "seller" | "ml" */
  shippingMode?: string;
};

/**
 * Adapt shipping cost into an EconomicCostComponent.
 *
 * Rules:
 * - Only creates a component when shippingMode is "seller" AND shippingCost > 0.
 * - buyer-paid, ml-funded, or unknown → no component.
 * - Cancelled shipping → no component.
 * - Source: "mercadolibre".
 * - verification: "verified".
 */
export function adaptShippingCost(
  tx: NormalizedCommerceTransaction,
  shippingData: ShippingData | null,
): EconomicCostComponent[] {
  if (!shippingData) return [];
  if (shippingData.shippingMode !== "seller") return [];
  if (!shippingData.shippingCost || shippingData.shippingCost <= 0) return [];

  const moneyResult = createMoney(shippingData.shippingCost, tx.currency);
  if (!moneyResult.success) return [];

  const result = createEconomicCostComponent({
    sellerId: tx.sellerId,
    type: "shipping",
    amount: moneyResult.money,
    source: "mercadolibre",
    sourceRecordId: tx.orderId,
    occurredAt: tx.occurredAt,
    observedAt: Date.now(),
    verification: "verified",
    confidence: 0.95,
  });

  return result.success ? [result.component] : [];
}
