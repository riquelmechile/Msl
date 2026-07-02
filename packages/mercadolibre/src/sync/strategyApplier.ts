import type { MlItem, NewItem } from "../types.js";
import type { ExactChange } from "@msl/domain";

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

export type StrategyPreviewResult =
  | { status: "available"; fieldChanges: ExactChange[] }
  | { status: "unavailable"; reason: "strategy-unavailable" };

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
  const margin = strategies.find((s): s is MarginStrategy => s.type === "margin");

  // --- 3. Pricing rules ---
  const pricingRule = strategies.find((s): s is PricingRuleStrategy => s.type === "pricing_rule");

  // --- 4. Stock ---
  const stock = strategies.find((s): s is StockStrategy => s.type === "stock");

  // Apply margin + pricing to base item price
  let price = item.price;
  if (margin) {
    price = Math.round(item.price * (1 + margin.percentage));
  }
  if (pricingRule) {
    if (pricingRule.floor !== undefined && price < pricingRule.floor) {
      price = pricingRule.floor;
    }
    if (pricingRule.cap !== undefined && price > pricingRule.cap) {
      price = pricingRule.cap;
    }
  }

  // Apply stock to base item quantity
  let available_quantity = item.available_quantity;
  if (stock) {
    if (stock.available_quantity !== undefined) {
      available_quantity = stock.available_quantity;
    }
    if (stock.limit !== undefined && available_quantity > stock.limit) {
      available_quantity = stock.limit;
    }
  }

  // Apply strategies to each variation independently
  const variations = item.variations?.map((v) => {
    let varPrice = v.price;
    if (margin) {
      varPrice = Math.round(v.price * (1 + margin.percentage));
    }
    if (pricingRule) {
      if (pricingRule.floor !== undefined && varPrice < pricingRule.floor) {
        varPrice = pricingRule.floor;
      }
      if (pricingRule.cap !== undefined && varPrice > pricingRule.cap) {
        varPrice = pricingRule.cap;
      }
    }

    let varQty = v.available_quantity;
    if (stock) {
      if (stock.available_quantity !== undefined) {
        varQty = stock.available_quantity;
      }
      if (stock.limit !== undefined && varQty > stock.limit) {
        varQty = stock.limit;
      }
    }

    const variation: NewItem["variations"] extends Array<infer T> | undefined ? T : never = {
      attribute_combinations: v.attribute_combinations.map((ac) => ({
        name: ac.name,
        value_id: ac.value_id,
        value_name: ac.value_name,
      })),
      price: varPrice,
      available_quantity: varQty,
    } as NewItem["variations"] extends Array<infer T> | undefined ? T : never;

    // Attach optional variation fields
    const vRecord = variation as Record<string, unknown>;
    if (v.picture_ids?.length) {
      vRecord.picture_ids = v.picture_ids;
    }
    if (v.attributes?.length) {
      vRecord.attributes = v.attributes.map((a) => ({
        id: a.id,
        value_name: a.value_name,
      }));
    }

    return variation;
  });

  // Build NewItem preserving all source metadata
  const pictures = item.pictures.map((p) => ({ source: p.url }));

  const newItem: NewItem = {
    title: item.title,
    category_id: item.category_id,
    price,
    currency_id: item.currency_id ?? "CLP",
    available_quantity,
    buying_mode: item.buying_mode ?? "buy_it_now",
    listing_type_id: item.listing_type_id ?? "gold_special",
    condition: item.condition ?? "new",
    pictures,
  };

  // Optional fields — attached via Record cast to stay exactOptionalPropertyTypes-safe
  const ni = newItem as Record<string, unknown>;

  // Descriptions: use source title as plain_text if no explicit description
  ni.descriptions = [{ plain_text: item.title }];

  // Attributes from source
  if (item.attributes?.length) {
    ni.attributes = item.attributes.map((a) => ({ id: a.id, value_name: a.value_name }));
  }

  // Variations with strategy-applied prices/quantities
  if (variations?.length) {
    ni.variations = variations;
  }

  // Preserve shipping configuration
  if (item.shipping) {
    ni.shipping = item.shipping;
  }

  // Preserve sale terms (warranty, manufacturing time, etc.)
  if (item.sale_terms?.length) {
    ni.sale_terms = item.sale_terms;
  }

  // Preserve warranty text
  if (item.warranty) {
    ni.warranty = item.warranty;
  }

  // Preserve catalog product ID for catalog listings
  if (item.catalog_product_id) {
    ni.catalog_product_id = item.catalog_product_id;
  }

  return { applied: true, item: newItem };
}

export function previewStrategyChanges(
  item: MlItem,
  strategies: Strategy[],
): StrategyPreviewResult {
  const result = applyStrategies(item, strategies);

  if (!result.applied) {
    return { status: "unavailable", reason: "strategy-unavailable" };
  }

  const fieldChanges: ExactChange[] = [];
  const fields = ["title", "category_id", "price", "available_quantity"] as const;

  for (const field of fields) {
    if (item[field] !== result.item[field]) {
      fieldChanges.push({ field, from: item[field], to: result.item[field] });
    }
  }

  return { status: "available", fieldChanges };
}
