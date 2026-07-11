import type { NormalizedCommerceTransaction } from "@msl/domain";
import { createMoney, createEconomicCostComponent } from "@msl/domain";
import type { EconomicCostComponent } from "@msl/domain";

export type DiscountData = {
  /** Seller-funded discount amount in minor units */
  sellerFundedAmount?: number;
  /** ML-funded discount amount (not a seller cost — ignored) */
  mlFundedAmount?: number;
  /** Total discount including both seller and ML contributions */
  totalDiscount?: number;
};

/**
 * Adapt seller-funded discount into an EconomicCostComponent.
 *
 * Rules:
 * - Only sellerFundedAmount > 0 creates a component.
 * - mlFundedAmount is NOT a seller cost → ignored.
 * - Source: "mercadolibre".
 * - verification: "verified", confidence: 0.95.
 * - If no discount data: returns empty array.
 */
export function adaptSellerDiscount(
  tx: NormalizedCommerceTransaction,
  discountData: DiscountData | null,
): EconomicCostComponent[] {
  if (!discountData?.sellerFundedAmount || discountData.sellerFundedAmount <= 0) return [];

  const moneyResult = createMoney(discountData.sellerFundedAmount, tx.currency);
  if (!moneyResult.success) return [];

  const result = createEconomicCostComponent({
    sellerId: tx.sellerId,
    type: "seller_discount",
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
