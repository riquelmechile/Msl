import type { CostComponentType } from "./economicCost.js";
import { CurrencyMismatchError, type Currency, type Money } from "./money.js";
import {
  type CalculationStatus,
  type MissingCostLabel,
  type UnitEconomicsInput,
  type UnitEconomicsSnapshot,
} from "./unitEconomics.js";

// ── Cost classification ────────────────────────────────────────────────────

/** Costs included in contribution profit (variable costs). */
const VARIABLE_COST_TYPES: readonly CostComponentType[] = [
  "product_cost",
  "marketplace_fee",
  "shipping",
  "advertising",
  "seller_discount",
];

/** Costs included in net profit but excluded from contribution profit (fixed costs). */
const FIXED_COST_TYPES: readonly CostComponentType[] = [
  "refund",
  "return",
  "tax",
  "financing",
  "landed_cost",
  "packaging",
  "other",
];

/** All recognized cost types that should be present for a complete snapshot. */
const ALL_EXPECTED_COST_TYPES: readonly CostComponentType[] = [
  ...VARIABLE_COST_TYPES,
  ...FIXED_COST_TYPES,
];

// ── Result type ────────────────────────────────────────────────────────────

export type ProfitResult = Money;

// ── Pure functions ─────────────────────────────────────────────────────────

/**
 * Compute contribution profit: gross revenue minus variable costs.
 * Variable costs are: product_cost, marketplace_fee, shipping, advertising, seller_discount.
 * Throws CurrencyMismatchError if any cost has a different currency than revenue.
 */
export function computeContributionProfit(
  revenue: Money,
  variableCosts: readonly Money[],
): ProfitResult {
  assertUniformCurrency(revenue, ...variableCosts);
  const totalCost = variableCosts.reduce((sum, c) => sum + c.amountMinor, 0);
  return { amountMinor: revenue.amountMinor - totalCost, currency: revenue.currency };
}

/**
 * Compute net profit: gross revenue minus ALL costs.
 * Throws CurrencyMismatchError if any cost has a different currency than revenue.
 */
export function computeNetProfit(revenue: Money, allCosts: readonly Money[]): ProfitResult {
  assertUniformCurrency(revenue, ...allCosts);
  const totalCost = allCosts.reduce((sum, c) => sum + c.amountMinor, 0);
  return { amountMinor: revenue.amountMinor - totalCost, currency: revenue.currency };
}

/**
 * Compute margin as profit / revenue as a decimal (0–1).
 * Returns 0 if revenue is zero (avoids NaN/Infinity).
 * Throws CurrencyMismatchError if currencies differ.
 */
export function computeMargin(profit: Money, revenue: Money): number {
  assertUniformCurrency(profit, revenue);
  if (revenue.amountMinor === 0) return 0;
  return profit.amountMinor / revenue.amountMinor;
}

// ── Unit economics assembler ───────────────────────────────────────────────

/**
 * Assemble a full UnitEconomicsSnapshot from raw inputs.
 *
 * Guarantees:
 * - No NaN, Infinity, or silent zero-for-missing
 * - Currency mismatches throw before any computation
 * - Partial data produces calculationStatus "partial" with missingInputs populated
 * - Explicit zero costs are accepted (not treated as missing)
 */
export function computeUnitEconomics(input: UnitEconomicsInput): UnitEconomicsSnapshot {
  const { sellerId, grossRevenue, currency, costComponents } = input;

  // Validate all costs match the declared currency
  const costs = costComponents;
  assertUniformCurrency({ currency }, ...costs.map((c) => c.amount));

  // Classify costs by type
  const costByType = new Map<CostComponentType, number>();
  for (const c of costs) {
    const current = costByType.get(c.type) ?? 0;
    costByType.set(c.type, current + c.amount.amountMinor);
  }

  // Calculate variable and fixed cost totals
  let variableTotal = 0;
  for (const t of VARIABLE_COST_TYPES) {
    variableTotal += costByType.get(t) ?? 0;
  }

  let fixedTotal = 0;
  for (const t of FIXED_COST_TYPES) {
    fixedTotal += costByType.get(t) ?? 0;
  }

  const allCostTotal = variableTotal + fixedTotal;

  // Determine missing inputs
  const presentTypes = new Set(costs.map((c) => c.type));
  const missingInputs: MissingCostLabel[] = ALL_EXPECTED_COST_TYPES.filter(
    (t) => !presentTypes.has(t),
  );

  // Calculation status
  const calculationStatus: CalculationStatus = missingInputs.length > 0 ? "partial" : "complete";

  // Individual cost fields (amountMinor)
  const productCost = costByType.get("product_cost") ?? 0;
  const marketplaceFees = costByType.get("marketplace_fee") ?? 0;
  const sellerShippingCost = costByType.get("shipping") ?? 0;
  const advertisingCost = costByType.get("advertising") ?? 0;
  const sellerFundedDiscounts = costByType.get("seller_discount") ?? 0;
  const refunds = costByType.get("refund") ?? 0;
  // "return" doesn't map to a specific snapshot field directly — included in taxes/other for now
  const taxes = (costByType.get("tax") ?? 0) + (costByType.get("return") ?? 0);
  const financingCost = costByType.get("financing") ?? 0;
  const allocatedLandedCost = costByType.get("landed_cost") ?? 0;
  const packagingCost = costByType.get("packaging") ?? 0;
  const otherCosts = costByType.get("other") ?? 0;

  // Profits
  const contributionProfit = grossRevenue - variableTotal;
  const netProfit = grossRevenue - allCostTotal;

  // Margins (avoid NaN on zero revenue)
  const contributionMargin = grossRevenue === 0 ? 0 : contributionProfit / grossRevenue;
  const netMargin = grossRevenue === 0 ? 0 : netProfit / grossRevenue;

  // Build result — handle exactOptionalPropertyTypes by only including defined optionals
  const snapshot: UnitEconomicsSnapshot = {
    snapshotId: `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sellerId,
    ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
    ...(input.channel !== undefined ? { channel: input.channel } : {}),
    ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
    ...(input.itemId !== undefined ? { itemId: input.itemId } : {}),
    ...(input.sku !== undefined ? { sku: input.sku } : {}),
    ...(input.product !== undefined ? { product: input.product } : {}),
    ...(input.period !== undefined ? { period: input.period } : {}),
    currency,
    grossRevenue,
    sellerFundedDiscounts,
    refunds,
    marketplaceFees,
    sellerShippingCost,
    advertisingCost,
    productCost,
    allocatedLandedCost,
    taxes,
    financingCost,
    packagingCost,
    otherCosts,
    contributionProfit,
    netProfit,
    contributionMargin,
    netMargin,
    missingInputs,
    calculationStatus,
    calculatedAt: Date.now(),
  };

  return snapshot;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function assertUniformCurrency(
  base: { currency: Currency },
  ...others: readonly { currency: Currency }[]
): void {
  for (const o of others) {
    if (o.currency !== base.currency) {
      throw new CurrencyMismatchError(base.currency, o.currency);
    }
  }
}
