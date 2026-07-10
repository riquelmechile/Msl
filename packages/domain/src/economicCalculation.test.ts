import { describe, expect, it } from "vitest";
import {
  computeContributionProfit,
  computeMargin,
  computeNetProfit,
  computeUnitEconomics,
} from "./economicCalculation.js";
import {
  createEconomicCostComponent,
  type EconomicCostComponent,
  type EconomicCostComponentInput,
} from "./economicCost.js";
import type { CostComponentType } from "./economicCost.js";
import { CurrencyMismatchError, type Money } from "./money.js";
import type { UnitEconomicsInput } from "./unitEconomics.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const now = Date.now();

function cost(
  overrides: { type: CostComponentType; amount: Money } & Partial<EconomicCostComponentInput>,
): EconomicCostComponent {
  const result = createEconomicCostComponent({
    sellerId: "seller-1",
    source: "derived",
    occurredAt: now,
    observedAt: now,
    verification: "verified",
    confidence: 0.9,
    ...overrides,
  });
  if (!result.success) throw new Error(`Failed to create cost component: ${result.error.message}`);
  return result.component;
}

function clp(amountMinor: number): Money {
  return { amountMinor, currency: "CLP" };
}

function usd(amountMinor: number): Money {
  return { amountMinor, currency: "USD" };
}

// ── computeContributionProfit ──────────────────────────────────────────────

describe("computeContributionProfit", () => {
  it("revenue minus variable costs gives profit", () => {
    const revenue = clp(100000);
    const variableCosts = [clp(30000), clp(10000)]; // total 40000
    const result = computeContributionProfit(revenue, variableCosts);
    expect(result.amountMinor).toBe(60000);
    expect(result.currency).toBe("CLP");
  });

  it("handles negative profit (costs exceed revenue)", () => {
    const revenue = clp(30000);
    const variableCosts = [clp(50000)];
    const result = computeContributionProfit(revenue, variableCosts);
    expect(result.amountMinor).toBe(-20000);
  });

  it("returns revenue when no costs", () => {
    const revenue = clp(50000);
    const result = computeContributionProfit(revenue, []);
    expect(result.amountMinor).toBe(50000);
  });

  it("rejects currency mismatch between revenue and costs", () => {
    const revenue = clp(100000);
    const costs = [usd(5000)];
    expect(() => computeContributionProfit(revenue, costs)).toThrow(CurrencyMismatchError);
  });
});

// ── computeNetProfit ───────────────────────────────────────────────────────

describe("computeNetProfit", () => {
  it("revenue minus all costs gives net profit", () => {
    const revenue = clp(100000);
    const allCosts = [clp(30000), clp(20000), clp(5000)]; // total 55000
    const result = computeNetProfit(revenue, allCosts);
    expect(result.amountMinor).toBe(45000);
  });

  it("handles negative net profit", () => {
    const revenue = clp(50000);
    const allCosts = [clp(30000), clp(30000)];
    const result = computeNetProfit(revenue, allCosts);
    expect(result.amountMinor).toBe(-10000);
  });

  it("rejects currency mismatch", () => {
    expect(() => computeNetProfit(clp(100000), [usd(5000)])).toThrow(CurrencyMismatchError);
  });
});

// ── computeMargin ──────────────────────────────────────────────────────────

describe("computeMargin", () => {
  it("40% margin on positive profit", () => {
    const profit = clp(40000);
    const revenue = clp(100000);
    expect(computeMargin(profit, revenue)).toBeCloseTo(0.4, 5);
  });

  it("margin is 0 when profit is 0", () => {
    expect(computeMargin(clp(0), clp(100000))).toBe(0);
  });

  it("zero revenue returns 0 margin (no division by zero)", () => {
    expect(computeMargin(clp(50000), clp(0))).toBe(0);
  });

  it("negative margin for negative profit", () => {
    const profit = clp(-20000);
    const revenue = clp(100000);
    expect(computeMargin(profit, revenue)).toBeCloseTo(-0.2, 5);
  });

  it("handles both zero (no NaN)", () => {
    expect(computeMargin(clp(0), clp(0))).toBe(0);
    expect(Number.isNaN(computeMargin(clp(0), clp(0)))).toBe(false);
  });

  it("rejects currency mismatch", () => {
    expect(() => computeMargin(clp(1000), usd(5000))).toThrow(CurrencyMismatchError);
  });
});

// ── computeUnitEconomics ───────────────────────────────────────────────────

describe("computeUnitEconomics", () => {
  function baseInput(overrides: Partial<UnitEconomicsInput> = {}): UnitEconomicsInput {
    return {
      sellerId: "seller-1",
      grossRevenue: 100000,
      currency: "CLP",
      costComponents: [],
      ...overrides,
    };
  }

  // ── Complete calculation ──────────────────────────────────────────

  it("produces a complete snapshot with all costs present", () => {
    const cogs = cost({ type: "product_cost", amount: clp(40000) });
    const fees = cost({ type: "marketplace_fee", amount: clp(10000) });
    const shipping = cost({ type: "shipping", amount: clp(5000) });
    const tax = cost({ type: "tax", amount: clp(1900) });

    const snapshot = computeUnitEconomics(
      baseInput({
        grossRevenue: 100000,
        costComponents: [cogs, fees, shipping, tax],
      }),
    );

    // Revenue 100000, costs: 40000+10000+5000+1900 = 56900
    // contributionProfit = 100000 - (40000+10000+5000) = 45000 (variable: product_cost, marketplace_fee, shipping)
    // netProfit = 100000 - 56900 = 43100
    expect(snapshot.contributionProfit).toBe(45000);
    expect(snapshot.netProfit).toBe(43100);
    expect(snapshot.contributionMargin).toBeCloseTo(0.45, 5);
    expect(snapshot.netMargin).toBeCloseTo(0.431, 3);
    expect(snapshot.calculationStatus).toBe("partial"); // missing many cost types
    expect(snapshot.grossRevenue).toBe(100000);
    expect(snapshot.currency).toBe("CLP");
    expect(snapshot.sellerId).toBe("seller-1");
  });

  it("flags partial when costs are missing", () => {
    const snapshot = computeUnitEconomics(baseInput({ grossRevenue: 50000, costComponents: [] }));
    expect(snapshot.calculationStatus).toBe("partial");
    expect(snapshot.missingInputs.length).toBeGreaterThan(0);
  });

  it("identifies specific missing cost types", () => {
    const shipping = cost({ type: "shipping", amount: clp(3000) });
    const snapshot = computeUnitEconomics(
      baseInput({
        grossRevenue: 50000,
        costComponents: [shipping],
      }),
    );
    expect(snapshot.missingInputs).toContain("product_cost");
    expect(snapshot.missingInputs).toContain("marketplace_fee");
    expect(snapshot.missingInputs).not.toContain("shipping");
  });

  it("handles negative profit", () => {
    const cogs = cost({ type: "product_cost", amount: clp(25000) });
    const snapshot = computeUnitEconomics(
      baseInput({
        grossRevenue: 20000,
        costComponents: [cogs],
      }),
    );
    expect(snapshot.netProfit).toBe(-5000);
    expect(snapshot.netMargin).toBeLessThan(0);
  });

  it("refunds reduce gross revenue", () => {
    const cogs = cost({ type: "product_cost", amount: clp(20000) });
    const refund = cost({ type: "refund", amount: clp(5000) });
    const snapshot = computeUnitEconomics(
      baseInput({
        grossRevenue: 50000,
        costComponents: [cogs, refund],
      }),
    );
    // gross revenue 50000, refund 5000, product_cost 20000
    // contributionProfit = 50000 - 20000 = 30000
    // netProfit = 50000 - 20000 - 5000 = 25000
    expect(snapshot.contributionProfit).toBe(30000);
    expect(snapshot.netProfit).toBe(25000);
    expect(snapshot.refunds).toBe(5000);
  });

  it("explicit zero product_cost is valid, not missing", () => {
    const cogs = cost({ type: "product_cost", amount: clp(0) });
    const shipping = cost({ type: "shipping", amount: clp(3000) });
    const snapshot = computeUnitEconomics(
      baseInput({
        grossRevenue: 30000,
        costComponents: [cogs, shipping],
      }),
    );
    expect(snapshot.productCost).toBe(0);
    expect(snapshot.missingInputs).not.toContain("product_cost");
    expect(snapshot.contributionProfit).toBe(27000); // 30000 - 0 - 3000
  });

  it("rejects currency mismatch across costs", () => {
    const clpCost = cost({ type: "shipping", amount: clp(3000) });
    const usdCost = cost({ type: "tax", amount: usd(100) });
    expect(() =>
      computeUnitEconomics(
        baseInput({
          grossRevenue: 50000,
          currency: "CLP",
          costComponents: [clpCost, usdCost],
        }),
      ),
    ).toThrow(CurrencyMismatchError);
  });

  it("variable costs feed contribution profit, fixed costs only feed net profit", () => {
    const cogs = cost({ type: "product_cost", amount: clp(30000) }); // variable
    const tax = cost({ type: "tax", amount: clp(5000) }); // fixed
    const snapshot = computeUnitEconomics(
      baseInput({
        grossRevenue: 100000,
        costComponents: [cogs, tax],
      }),
    );
    // contribution = 100000 - 30000 = 70000 (tax not included in contribution)
    // net = 100000 - 30000 - 5000 = 65000
    expect(snapshot.contributionProfit).toBe(70000);
    expect(snapshot.netProfit).toBe(65000);
    expect(snapshot.netProfit).toBeLessThan(snapshot.contributionProfit);
  });

  it("full positive calculation matches manual math", () => {
    const components = [
      cost({ type: "product_cost", amount: clp(25000) }),
      cost({ type: "marketplace_fee", amount: clp(10000) }),
      cost({ type: "shipping", amount: clp(5000) }),
      cost({ type: "advertising", amount: clp(3000) }),
      cost({ type: "seller_discount", amount: clp(2000) }),
      cost({ type: "tax", amount: clp(1900) }),
      cost({ type: "financing", amount: clp(500) }),
      cost({ type: "landed_cost", amount: clp(1000) }),
      cost({ type: "packaging", amount: clp(600) }),
      cost({ type: "other", amount: clp(1000) }),
    ];
    // Variable costs: 25000 + 10000 + 5000 + 3000 + 2000 = 45000
    // Fixed costs: 1900 + 500 + 1000 + 600 + 1000 = 5000
    // All costs: 50000
    // Gross revenue: 100000
    // contributionProfit: 100000 - 45000 = 55000
    // netProfit: 100000 - 50000 = 50000
    // contributionMargin: 55000/100000 = 0.55
    // netMargin: 50000/100000 = 0.50
    const snapshot = computeUnitEconomics(
      baseInput({ grossRevenue: 100000, costComponents: components }),
    );
    expect(snapshot.contributionProfit).toBe(55000);
    expect(snapshot.netProfit).toBe(50000);
    expect(snapshot.contributionMargin).toBeCloseTo(0.55, 5);
    expect(snapshot.netMargin).toBeCloseTo(0.5, 5);
  });
});
