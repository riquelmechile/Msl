import { describe, expect, it } from "vitest";
import { createUnitEconomicsSnapshot, type UnitEconomicsSnapshot } from "./unitEconomics.js";
import { createEconomicCostComponent } from "./economicCost.js";
import type { Money } from "./money.js";

const now = Date.now();

function clp(n: number): Money {
  return { amountMinor: n, currency: "CLP" };
}

describe("createUnitEconomicsSnapshot", () => {
  it("creates a snapshot and computes economics", () => {
    const cogs = createEconomicCostComponent({
      sellerId: "seller-1",
      type: "product_cost",
      amount: clp(30000),
      source: "derived",
      occurredAt: now,
      observedAt: now,
      verification: "verified",
      confidence: 0.9,
    });
    if (!cogs.success) throw new Error("failed");
    const shipping = createEconomicCostComponent({
      sellerId: "seller-1",
      type: "shipping",
      amount: clp(5000),
      source: "derived",
      occurredAt: now,
      observedAt: now,
      verification: "verified",
      confidence: 0.9,
    });
    if (!shipping.success) throw new Error("failed");

    const snapshot = createUnitEconomicsSnapshot({
      sellerId: "seller-1",
      channel: "mercadolibre",
      grossRevenue: 100000,
      currency: "CLP",
      costComponents: [cogs.component, shipping.component],
    });

    expect(snapshot.grossRevenue).toBe(100000);
    expect(snapshot.contributionProfit).toBe(65000); // 100000 - 30000 - 5000
    expect(snapshot.calculationStatus).toBe("partial"); // missing many costs
    expect(snapshot.sellerId).toBe("seller-1");
    expect(snapshot.channel).toBe("mercadolibre");
    expect(typeof snapshot.snapshotId).toBe("string");
    expect(snapshot.calculatedAt).toBeGreaterThan(0);
  });

  it("handles no costs", () => {
    const snapshot = createUnitEconomicsSnapshot({
      sellerId: "seller-1",
      grossRevenue: 50000,
      currency: "CLP",
      costComponents: [],
    });
    expect(snapshot.netProfit).toBe(50000);
    expect(snapshot.calculationStatus).toBe("partial");
  });

  it("uses currency from the input", () => {
    const snapshot = createUnitEconomicsSnapshot({
      sellerId: "seller-1",
      grossRevenue: 100,
      currency: "USD",
      costComponents: [],
    });
    expect(snapshot.currency).toBe("USD");
  });
});
