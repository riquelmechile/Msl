import type { NormalizedCommerceTransaction } from "@msl/domain";
import { createMoney, createEconomicCostComponent } from "@msl/domain";
import type { EconomicCostComponent } from "@msl/domain";

export type AdData = {
  campaignId: string;
  cost: number; // in minor units
  currency: string;
  period?: { start: number; end: number };
};

/**
 * Adapt advertising cost data into an EconomicCostComponent.
 *
 * Rules:
 * - If adData.cost > 0: creates type: "advertising" component.
 * - When tx is provided: assignment is at order level (sourceRecordId: tx.orderId,
 *   source: "mercadolibre", verification: "verified", confidence: 0.95).
 * - When tx is NOT provided (campaign-level only): component is at seller/period
 *   level, source: "derived", verification: "unverified", confidence: 0.5.
 * - Allocates cost via the sourceRecordId link.
 */
export function adaptAdvertisingCost(
  sellerId: string,
  adData: AdData | null,
  tx?: NormalizedCommerceTransaction,
): EconomicCostComponent[] {
  if (!adData || adData.cost <= 0) return [];

  const moneyResult = createMoney(adData.cost, adData.currency);
  if (!moneyResult.success) return [];

  const hasOrderContext = tx !== undefined;

  const baseInput = {
    sellerId,
    type: "advertising" as const,
    amount: moneyResult.money,
    source: hasOrderContext ? ("mercadolibre" as const) : ("derived" as const),
    sourceRecordId: tx?.orderId ?? adData.campaignId,
    ...(tx !== undefined
      ? { sourceVersion: tx.sourceVersion, ingestionRunId: tx.ingestionRunId }
      : {}),
    economicMeaning: "advertising",
    occurredAt: tx?.occurredAt ?? adData.period?.start ?? Date.now(),
    observedAt: Date.now(),
    verification: hasOrderContext ? ("verified" as const) : ("unverified" as const),
    confidence: hasOrderContext ? 0.95 : 0.5,
  };

  const result = hasOrderContext
    ? createEconomicCostComponent(baseInput)
    : createEconomicCostComponent({
        ...baseInput,
        metadata: {
          allocation: "seller-period-level",
          note:
            "No order-level transaction available — derived from campaign-level " +
            "data with lower confidence. Real allocation would require per-order " +
            "advertising cost attribution from the ads platform.",
        },
      });

  return result.success ? [result.component] : [];
}
