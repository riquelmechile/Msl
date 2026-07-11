import { describe, it, expect } from "vitest";
import type { NormalizedCommerceTransaction } from "@msl/domain";
import { createMoney, createNormalizedCommerceTransaction } from "@msl/domain";
import { adaptShippingCost, type ShippingData } from "./shippingCost.js";

function buildTx(): NormalizedCommerceTransaction {
  const amount = createMoney(15990, "CLP");
  const result = createNormalizedCommerceTransaction({
    transactionId: "tx-ship-test",
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

describe("adaptShippingCost", () => {
  it("creates a shipping component when mode is seller and cost > 0", () => {
    const tx = buildTx();
    const shippingData: ShippingData = { shippingMode: "seller", shippingCost: 3500 };

    const result = adaptShippingCost(tx, shippingData);
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.type).toBe("shipping");
    expect(c.amount.amountMinor).toBe(3500);
    expect(c.source).toBe("mercadolibre");
    expect(c.sourceRecordId).toBe("order-test");
    expect(c.verification).toBe("verified");
  });

  it("returns empty array when mode is buyer", () => {
    const tx = buildTx();
    const shippingData: ShippingData = { shippingMode: "buyer", shippingCost: 3500 };

    expect(adaptShippingCost(tx, shippingData)).toEqual([]);
  });

  it("returns empty array when mode is ml", () => {
    const tx = buildTx();
    const shippingData: ShippingData = { shippingMode: "ml", shippingCost: 3500 };

    expect(adaptShippingCost(tx, shippingData)).toEqual([]);
  });

  it("returns empty array when shippingData is null", () => {
    const tx = buildTx();
    expect(adaptShippingCost(tx, null)).toEqual([]);
  });

  it("returns empty array when shippingCost is zero", () => {
    const tx = buildTx();
    const shippingData: ShippingData = { shippingMode: "seller", shippingCost: 0 };

    expect(adaptShippingCost(tx, shippingData)).toEqual([]);
  });

  it("returns empty array when shippingMode is undefined", () => {
    const tx = buildTx();
    const shippingData: ShippingData = { shippingCost: 3500 };

    expect(adaptShippingCost(tx, shippingData)).toEqual([]);
  });
});
