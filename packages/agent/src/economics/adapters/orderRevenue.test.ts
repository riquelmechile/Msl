import { describe, it, expect } from "vitest";
import type { Currency, NormalizedCommerceTransaction } from "@msl/domain";
import { createMoney, createNormalizedCommerceTransaction } from "@msl/domain";
import { extractOrderRevenue } from "./orderRevenue.js";

/**
 * Build a valid NormalizedCommerceTransaction for test use.
 * Only passed fields are used; sensible defaults are applied.
 */
function buildTx(
  overrides: Partial<{
    orderStatus: string;
    grossRevenueMinor: number;
    currency: Currency;
  }> = {},
): NormalizedCommerceTransaction {
  const status = overrides.orderStatus ?? "paid";
  const amount = overrides.grossRevenueMinor ?? 15990;
  const currency: Currency = overrides.currency ?? "CLP";

  const unitPrice = createMoney(amount, currency);
  const grossRevenue = createMoney(amount, currency);
  const result = createNormalizedCommerceTransaction({
    transactionId: "tx-test-order-item-test",
    sellerId: "seller-1",
    channel: "mercadolibre",
    orderId: "order-test",
    itemId: "item-test",
    quantity: 1,
    unitPrice: unitPrice.success ? unitPrice.money : { amountMinor: 0, currency: "CLP" },
    grossRevenue: grossRevenue.success ? grossRevenue.money : { amountMinor: 0, currency: "CLP" },
    currency,
    orderStatus: status,
    occurredAt: Date.now(),
    updatedAt: Date.now(),
    sourceVersion: "2025-07-01T10:00:00Z",
    sourceEvidenceIds: ["order:order-test"],
    ingestionRunId: "run-1",
  });

  if (!result.success) throw new Error(`Test setup failed: ${result.error.message}`);
  return result.transaction;
}

describe("extractOrderRevenue", () => {
  it("returns null for cancelled orders", () => {
    const tx = buildTx({ orderStatus: "cancelled" });
    expect(extractOrderRevenue(tx)).toBeNull();
  });

  it("returns grossRevenue amountMinor for active/paid orders", () => {
    const tx = buildTx({ grossRevenueMinor: 15990, orderStatus: "paid" });
    const result = extractOrderRevenue(tx);
    expect(result).not.toBeNull();
    expect(result!.grossRevenue).toBe(15990);
    expect(result!.currency).toBe("CLP");
  });

  it("preserves CLP currency in result", () => {
    const tx = buildTx({ currency: "CLP", grossRevenueMinor: 50000 });
    const result = extractOrderRevenue(tx);
    expect(result?.currency).toBe("CLP");
  });

  it("preserves USD currency in result", () => {
    const tx = buildTx({ currency: "USD", grossRevenueMinor: 2500 });
    const result = extractOrderRevenue(tx);
    expect(result?.currency).toBe("USD");
    expect(result?.grossRevenue).toBe(2500);
  });
});
