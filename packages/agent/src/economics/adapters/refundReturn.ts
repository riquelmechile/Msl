import type { NormalizedCommerceTransaction } from "@msl/domain";
import { createMoney, createEconomicCostComponent } from "@msl/domain";
import type { EconomicCostComponent } from "@msl/domain";

export type RefundData = {
  /** Total refunded amount in minor units */
  refundAmount?: number;
  /** Return shipping/handling cost in minor units */
  returnCost?: number;
  /** Whether this is a partial (not full) refund */
  isPartial?: boolean;
  /** Claim identifier for traceability */
  claimId?: string;
};

/**
 * Adapt refund and return data into EconomicCostComponents.
 *
 * Rules:
 * - refundAmount > 0 → type: "refund" component.
 * - returnCost > 0 → type: "return" component.
 * - Revenue stays GROSS (not adjusted) — refunds are separate cost components.
 * - "return" type folds into "taxes" in UnitEconomicsSnapshot per economicCalculation.ts.
 * - isPartial → metadata: { partial: true }.
 * - claimId is used as sourceRecordId when available.
 * - Source: "mercadolibre", verification: "verified".
 */
export function adaptRefundReturn(
  tx: NormalizedCommerceTransaction,
  refundData: RefundData | null,
): EconomicCostComponent[] {
  const components: EconomicCostComponent[] = [];
  if (!refundData) return components;

  const sourceRecordId = refundData.claimId ?? tx.orderId;

  // Refund component
  if (refundData.refundAmount && refundData.refundAmount > 0) {
    const moneyResult = createMoney(refundData.refundAmount, tx.currency);
    if (moneyResult.success) {
      const metadata: Record<string, unknown> | undefined = refundData.isPartial
        ? { partial: true }
        : undefined;

      const result = createEconomicCostComponent({
        sellerId: tx.sellerId,
        type: "refund",
        amount: moneyResult.money,
        source: "mercadolibre",
        sourceRecordId,
        occurredAt: tx.occurredAt,
        observedAt: Date.now(),
        verification: "verified",
        confidence: 0.95,
        ...(metadata !== undefined ? { metadata } : {}),
      });

      if (result.success) components.push(result.component);
    }
  }

  // Return cost component
  if (refundData.returnCost && refundData.returnCost > 0) {
    const moneyResult = createMoney(refundData.returnCost, tx.currency);
    if (moneyResult.success) {
      const result = createEconomicCostComponent({
        sellerId: tx.sellerId,
        type: "return",
        amount: moneyResult.money,
        source: "mercadolibre",
        sourceRecordId,
        occurredAt: tx.occurredAt,
        observedAt: Date.now(),
        verification: "verified",
        confidence: 0.95,
        metadata: {
          note: "Return cost feeds into taxes bucket in UnitEconomicsSnapshot per economicCalculation.ts",
        },
      });

      if (result.success) components.push(result.component);
    }
  }

  return components;
}
