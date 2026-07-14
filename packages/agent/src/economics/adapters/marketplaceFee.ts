import type { NormalizedCommerceTransaction } from "@msl/domain";
import { createMoney, createEconomicCostComponent } from "@msl/domain";
import type { EconomicCostComponent } from "@msl/domain";

export type FeeData = { saleFeeAmount?: number; currencyId?: string };

/**
 * Adapt marketplace fee data into an EconomicCostComponent.
 *
 * Rules:
 * - Only creates a component if feeData.saleFeeAmount > 0.
 * - Source: "mercadolibre" — fee data comes directly from ML.
 * - sourceRecordId: the order ID.
 * - verification: "verified" (ML-reported fees are trusted).
 * - confidence: 0.95.
 * - If feeData is null or saleFeeAmount is undefined/zero: returns empty array.
 * - Does NOT estimate fees — only uses real data.
 */
export function adaptMarketplaceFee(
  tx: NormalizedCommerceTransaction,
  feeData: FeeData | null,
): EconomicCostComponent[] {
  if (!feeData?.saleFeeAmount || feeData.saleFeeAmount <= 0) return [];

  const feeCurrency = feeData.currencyId ?? tx.currency;
  const moneyResult = createMoney(feeData.saleFeeAmount, feeCurrency);
  if (!moneyResult.success) return [];

  const result = createEconomicCostComponent({
    sellerId: tx.sellerId,
    type: "marketplace_fee",
    amount: moneyResult.money,
    source: "mercadolibre",
    sourceRecordId: tx.orderId,
    sourceVersion: tx.sourceVersion,
    economicMeaning: "marketplace_fee",
    ingestionRunId: tx.ingestionRunId,
    occurredAt: tx.occurredAt,
    observedAt: Date.now(),
    verification: "verified",
    confidence: 0.95,
  });

  return result.success ? [result.component] : [];
}
