import { describe, it, expect } from "vitest";
import type { NormalizedCommerceTransaction } from "@msl/domain";
import { createMoney, createNormalizedCommerceTransaction } from "@msl/domain";
import { adaptRefundReturn, type RefundData } from "./refundReturn.js";

function buildTx(): NormalizedCommerceTransaction {
  const amount = createMoney(15990, "CLP");
  const result = createNormalizedCommerceTransaction({
    transactionId: "tx-refund-test",
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

describe("adaptRefundReturn", () => {
  it("creates a refund component when refundAmount > 0", () => {
    const tx = buildTx();
    const refundData: RefundData = { refundAmount: 5000 };

    const result = adaptRefundReturn(tx, refundData);
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.type).toBe("refund");
    expect(c.amount.amountMinor).toBe(5000);
    expect(c.source).toBe("mercadolibre");
    expect(c.verification).toBe("verified");
  });

  it("creates a return component when returnCost > 0", () => {
    const tx = buildTx();
    const refundData: RefundData = { returnCost: 2000 };

    const result = adaptRefundReturn(tx, refundData);
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.type).toBe("return");
    expect(c.amount.amountMinor).toBe(2000);
    expect(c.metadata?.note).toContain("taxes bucket");
  });

  it("creates both refund and return components when both are > 0", () => {
    const tx = buildTx();
    const refundData: RefundData = { refundAmount: 5000, returnCost: 2000 };

    const result = adaptRefundReturn(tx, refundData);
    expect(result).toHaveLength(2);

    const refund = result.find((c) => c.type === "refund")!;
    expect(refund).toBeDefined();
    expect(refund.amount.amountMinor).toBe(5000);

    const returnCost = result.find((c) => c.type === "return")!;
    expect(returnCost).toBeDefined();
    expect(returnCost.amount.amountMinor).toBe(2000);
  });

  it("returns empty array when refundData is null", () => {
    const tx = buildTx();
    expect(adaptRefundReturn(tx, null)).toEqual([]);
  });

  it("returns empty array when both amounts are zero", () => {
    const tx = buildTx();
    const refundData: RefundData = { refundAmount: 0, returnCost: 0 };
    expect(adaptRefundReturn(tx, refundData)).toEqual([]);
  });

  it("uses claimId as sourceRecordId when provided", () => {
    const tx = buildTx();
    const refundData: RefundData = { refundAmount: 5000, claimId: "claim-abc" };

    const result = adaptRefundReturn(tx, refundData);
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.sourceRecordId).toBe("claim-abc");
  });

  it("falls back to orderId as sourceRecordId when claimId is missing", () => {
    const tx = buildTx();
    const refundData: RefundData = { refundAmount: 5000 };

    const result = adaptRefundReturn(tx, refundData);
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.sourceRecordId).toBe("order-test");
  });

  it("sets metadata.partial when isPartial is true", () => {
    const tx = buildTx();
    const refundData: RefundData = { refundAmount: 3000, isPartial: true };

    const result = adaptRefundReturn(tx, refundData);
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.metadata).toEqual({ partial: true });
  });

  it("does not set metadata.partial when isPartial is false", () => {
    const tx = buildTx();
    const refundData: RefundData = { refundAmount: 5000, isPartial: false };

    const result = adaptRefundReturn(tx, refundData);
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.metadata).toBeUndefined();
  });
});
