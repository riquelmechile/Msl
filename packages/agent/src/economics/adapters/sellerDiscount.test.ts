import { describe, it, expect } from "vitest";
import type { NormalizedCommerceTransaction } from "@msl/domain";
import { createMoney, createNormalizedCommerceTransaction } from "@msl/domain";
import { adaptSellerDiscount, type DiscountData } from "./sellerDiscount.js";

function buildTx(): NormalizedCommerceTransaction {
  const amount = createMoney(15990, "CLP");
  const result = createNormalizedCommerceTransaction({
    transactionId: "tx-disc-test",
    sellerId: "seller-1",
    channel: "mercadolibre",
    orderId: "order-test",
    itemId: "item-test",
    quantity: 1,
    unitPrice: amount.success ? amount.money : { amountMinor: 0, currency: "CLP" },
    grossRevenue: amount.success ? amount.money : { amountMinor: 0, currency: "CLP" },
    currency: "CLP",
    orderStatus: "paid",
    occurredAt: Date.now(),
    updatedAt: Date.now(),
    sourceVersion: "2025-07-01T10:00:00Z",
    sourceEvidenceIds: ["order:order-test"],
    ingestionRunId: "run-1",
  });

  if (!result.success) throw new Error(`Test setup failed: ${result.error.message}`);
  return result.transaction;
}

describe("adaptSellerDiscount", () => {
  it("creates a seller_discount component for seller-funded discount", () => {
    const tx = buildTx();
    const discountData: DiscountData = {
      sellerFundedAmount: 1000,
      mlFundedAmount: 500,
      totalDiscount: 1500,
    };

    const result = adaptSellerDiscount(tx, discountData);
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.type).toBe("seller_discount");
    expect(c.amount.amountMinor).toBe(1000);
    expect(c.source).toBe("mercadolibre");
    expect(c.verification).toBe("verified");
    expect(c.confidence).toBe(0.95);
  });

  it("ignores mlFundedAmount (returns empty since sellerFundedAmount is 0)", () => {
    const tx = buildTx();
    const discountData: DiscountData = {
      sellerFundedAmount: 0,
      mlFundedAmount: 500,
      totalDiscount: 500,
    };

    expect(adaptSellerDiscount(tx, discountData)).toEqual([]);
  });

  it("returns empty array when discountData is null", () => {
    const tx = buildTx();
    expect(adaptSellerDiscount(tx, null)).toEqual([]);
  });

  it("returns empty array when sellerFundedAmount is undefined", () => {
    const tx = buildTx();
    const discountData: DiscountData = { mlFundedAmount: 500 };
    expect(adaptSellerDiscount(tx, discountData)).toEqual([]);
  });

  it("returns empty array when sellerFundedAmount is negative", () => {
    const tx = buildTx();
    const discountData: DiscountData = { sellerFundedAmount: -500 };
    expect(adaptSellerDiscount(tx, discountData)).toEqual([]);
  });

  it("only uses sellerFundedAmount even when totalDiscount includes ml contribution", () => {
    const tx = buildTx();
    const discountData: DiscountData = {
      sellerFundedAmount: 2000,
      mlFundedAmount: 3000,
      totalDiscount: 5000,
    };

    const result = adaptSellerDiscount(tx, discountData);
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.amount.amountMinor).toBe(2000);
  });
});
