import { describe, it, expect } from "vitest";
import type { NormalizedCommerceTransaction } from "@msl/domain";
import { createMoney, createNormalizedCommerceTransaction } from "@msl/domain";
import { adaptAdvertisingCost, type AdData } from "./advertisingCost.js";

function buildTx(): NormalizedCommerceTransaction {
  const amount = createMoney(15990, "CLP");
  const result = createNormalizedCommerceTransaction({
    transactionId: "tx-ad-test",
    sellerId: "seller-1",
    channel: "mercadolibre",
    orderId: "order-test",
    itemId: "item-test",
    quantity: 1,
    unitPrice: amount.success ? amount.money : { amountMinor: 0, currency: "CLP" },
    grossRevenue: amount.success ? amount.money : { amountMinor: 0, currency: "CLP" },
    currency: "CLP",
    orderStatus: "paid",
    occurredAt: 1720000000000,
    updatedAt: 1720000000000,
    sourceVersion: "2025-07-01T10:00:00Z",
    sourceEvidenceIds: ["order:order-test"],
    ingestionRunId: "run-1",
  });

  if (!result.success) throw new Error(`Test setup failed: ${result.error.message}`);
  return result.transaction;
}

describe("adaptAdvertisingCost", () => {
  it("creates an order-linked component when transaction is provided", () => {
    const tx = buildTx();
    const adData: AdData = { campaignId: "camp-1", cost: 5000, currency: "CLP" };

    const result = adaptAdvertisingCost("seller-1", adData, tx);
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.type).toBe("advertising");
    expect(c.amount.amountMinor).toBe(5000);
    expect(c.source).toBe("mercadolibre");
    expect(c.sourceRecordId).toBe("order-test");
    expect(c.verification).toBe("verified");
    expect(c.confidence).toBe(0.95);
    expect(c.occurredAt).toBe(1720000000000);
  });

  it("creates a derived component (no order context) when transaction is NOT provided", () => {
    const adData: AdData = { campaignId: "camp-2", cost: 3000, currency: "CLP" };

    const result = adaptAdvertisingCost("seller-1", adData);
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.source).toBe("derived");
    expect(c.sourceRecordId).toBe("camp-2");
    expect(c.verification).toBe("unverified");
    expect(c.confidence).toBe(0.5);
    expect(c.metadata).toBeDefined();
    expect(c.metadata!.allocation).toBe("seller-period-level");
    expect(c.metadata!.note).toContain("campaign-level");
  });

  it("returns empty array when adData is null", () => {
    expect(adaptAdvertisingCost("seller-1", null)).toEqual([]);
  });

  it("returns empty array when adData.cost is zero", () => {
    const adData: AdData = { campaignId: "camp-3", cost: 0, currency: "CLP" };
    expect(adaptAdvertisingCost("seller-1", adData)).toEqual([]);
  });

  it("returns empty array when adData.cost is negative", () => {
    const adData: AdData = { campaignId: "camp-4", cost: -1000, currency: "CLP" };
    expect(adaptAdvertisingCost("seller-1", adData)).toEqual([]);
  });

  it("uses adData.period.start for occurredAt when no transaction is available", () => {
    const adData: AdData = {
      campaignId: "camp-5",
      cost: 2000,
      currency: "CLP",
      period: { start: 1710000000000, end: 1720000000000 },
    };

    const result = adaptAdvertisingCost("seller-1", adData);
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.occurredAt).toBe(1710000000000);
  });
});
