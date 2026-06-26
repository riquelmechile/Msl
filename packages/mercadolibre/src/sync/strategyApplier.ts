import type { MlItem, NewItem } from "../types.js";

// ---------------------------------------------------------------------------
// Strategy types
// ---------------------------------------------------------------------------

export type MarginStrategy = {
  type: "margin";
  /** Decimal percentage (e.g. 0.50 = 50% margin on source price) */
  percentage: number;
};

export type CategoryFilterStrategy = {
  type: "category_filter";
  /** Category IDs to skip during sync */
  excluded: string[];
};

export type StockStrategy = {
  type: "stock";
  /** Override available_quantity in target listing */
  available_quantity?: number;
  /** Cap maximum stock per listing */
  limit?: number;
};

export type PricingRuleStrategy = {
  type: "pricing_rule";
  /** Minimum allowed price in target currency */
  floor?: number;
  /** Maximum allowed price in target currency */
  cap?: number;
};

export type Strategy =
  | MarginStrategy
  | CategoryFilterStrategy
  | StockStrategy
  | PricingRuleStrategy;

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export type StrategyApplicationResult =
  | { applied: true; item: NewItem }
  | { applied: false; reason: "category_excluded" };

/**
 * Apply a set of CEO strategies to a source MlItem, producing a NewItem ready
 * for publishing on the target account.
 *
 * - MarginStrategy: target price = sourcePrice * (1 + percentage)
 * - CategoryFilterStrategy: skip items whose category_id is in the excluded set
 * - StockStrategy: override or cap available_quantity
 * - PricingRuleStrategy: clamp price within [floor, cap]
 *
 * Strategies are applied in order: category → margin → pricing → stock.
 * If a category filter excludes the item, the result is `{ applied: false }`.
 */
export function applyStrategies(item: MlItem, strategies: Strategy[]): StrategyApplicationResult {
  // --- 1. Category filter ---
  const categoryFilter = strategies.find(
    (s): s is CategoryFilterStrategy => s.type === "category_filter",
  );
  if (categoryFilter && categoryFilter.excluded.includes(item.category_id)) {
    return { applied: false, reason: "category_excluded" };
  }

  // --- 2. Margin ---
  let price = item.price;
  const margin = strategies.find((s): s is MarginStrategy => s.type === "margin");
  if (margin) {
    price = Math.round(item.price * (1 + margin.percentage));
  }

  // --- 3. Pricing rules ---
  const pricingRule = strategies.find((s): s is PricingRuleStrategy => s.type === "pricing_rule");
  if (pricingRule) {
    if (pricingRule.floor !== undefined && price < pricingRule.floor) {
      price = pricingRule.floor;
    }
    if (pricingRule.cap !== undefined && price > pricingRule.cap) {
      price = pricingRule.cap;
    }
  }

  // --- 4. Stock ---
  let available_quantity = item.available_quantity;
  const stock = strategies.find((s): s is StockStrategy => s.type === "stock");
  if (stock) {
    if (stock.available_quantity !== undefined) {
      available_quantity = stock.available_quantity;
    }
    if (stock.limit !== undefined && available_quantity > stock.limit) {
      available_quantity = stock.limit;
    }
  }

  const newItem: NewItem = {
    title: item.title,
    category_id: item.category_id,
    price,
    available_quantity,
    pictures: item.pictures.map((p) => p.url),
    description: item.title, // Default description from title
    attributes: item.attributes.map((a) => ({
      id: a.id,
      value_name: a.value_name,
    })),
  };

  return { applied: true, item: newItem };
}
