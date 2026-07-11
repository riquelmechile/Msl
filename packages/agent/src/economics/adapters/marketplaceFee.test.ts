import { describe, it, expect } from "vitest";
import type { Currency, NormalizedCommerceTransaction } from "@msl/domain";
import { createMoney, createNormalizedCommerceTransaction } from "@msl/domain";
import { adaptMarketplaceFee, type FeeData } from "./marketplaceFee.js";

function buildTx(overrides: Partial<{
  sellerId: string;
  orderId: string;
  currency: Currency;
  occurredAt: number;
}> = {}): NormalizedCommerceTransaction {
  const amount = createMoney(15990, "CLP");
  const currency: Currency = overrides.currency ?? "CLP";
  const result = createNormalizedCommerceTransaction({
    transactionId: "tx-fee-test",
    sellerId: overrides.sellerId ?? "seller-1",
    channel: "mercadolibre",
    orderId: overrides.orderId ?? "order-test",
    itemId: "item-test",
    quantity: 1,
    unitPrice: amount.success ? amount.money : { amountMinor: 0, currency: "CLP" },
    grossRevenue: amount.success ? amount.money : { amountMinor: 0, currency: "CLP" },
    currency,
    orderStatus: "paid",
    occurredAt: overrides.occurredAt ?? Date.now(),
    updatedAt: Date.now(),
    sourceVersion: "2025-07-01T10:00:00Z",
    sourceEvidenceIds: ["order:order-test"],
    ingestionRunId: "run-1",
  });

  if (!result.success) throw new Error(`Test setup failed: ${result.error.message}`);
  return result.transaction;
}

describe("adaptMarketplaceFee", () => {
  it("creates a marketplace_fee component when fee data is present", () => {
    const tx = buildTx();
    const feeData: FeeData = { saleFeeAmount: 2000, currencyId: "CLP" };

    const result = adaptMarketplaceFee(tx, feeData);
    expect(result).toHaveLength(1);
    const component = result[0]!;
    expect(component.type).toBe("marketplace_fee");
    expect(component.amount.amountMinor).toBe(2000);
    expect(component.amount.currency).toBe("CLP");
    expect(component.source).toBe("mercadolibre");
    expect(component.sourceRecordId).toBe("order-test");
    expect(component.sellerId).toBe("seller-1");
    expect(component.verification).toBe("verified");
    expect(component.confidence).toBe(0.95);
  });

  it("returns empty array when feeData is null", () => {
    const tx = buildTx();
    expect(adaptMarketplaceFee(tx, null)).toEqual([]);
  });

  it("returns empty array when saleFeeAmount is undefined", () => {
    const tx = buildTx();
    expect(adaptMarketplaceFee(tx, {})).toEqual([]);
  });

  it("returns empty array when saleFeeAmount is zero", () => {
    const tx = buildTx();
    const feeData: FeeData = { saleFeeAmount: 0 };
    expect(adaptMarketplaceFee(tx, feeData)).toEqual([]);
  });

  it("returns empty array when saleFeeAmount is negative", () => {
    const tx = buildTx();
    const feeData: FeeData = { saleFeeAmount: -500 };
    expect(adaptMarketplaceFee(tx, feeData)).toEqual([]);
  });

  it("defaults to transaction currency when fee currencyId is missing", () => {
    const tx = buildTx({ currency: "CLP" });
    const feeData: FeeData = { saleFeeAmount: 1500 };

    const result = adaptMarketplaceFee(tx, feeData);
    expect(result).toHaveLength(1);
    const component = result[0]!;
    expect(component.amount.currency).toBe("CLP");
  });
});
