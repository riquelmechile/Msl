import type { MlItem, NewItem } from "./types.js";

// ---------------------------------------------------------------------------
// buildNewItemFromMlItem
// ---------------------------------------------------------------------------

/**
 * Constructs a valid {@link NewItem} from a source {@link MlItem} with
 * optional overrides for price, stock, title, and other listing fields.
 *
 * Uses source.item defaults (currency_id, buying_mode, listing_type_id,
 * condition) when available and falls back to CLP / buy_it_now /
 * gold_special / new when the source item does not carry explicit values.
 */
export function buildNewItemFromMlItem(sourceItem: MlItem, overrides?: Partial<NewItem>): NewItem {
  // Map pictures: { url } -> { source }
  const pictures =
    overrides?.pictures ?? sourceItem.pictures?.map((p) => ({ source: p.url })) ?? [];

  // Map variations if present
  const variations = sourceItem.variations?.map((v) => {
    const combinations = v.attribute_combinations.map((ac) => {
      const combo: Record<string, string> = {};
      if (ac.name !== undefined) combo.name = ac.name;
      if (ac.value_id !== undefined) combo.value_id = ac.value_id;
      if (ac.value_name !== undefined) combo.value_name = ac.value_name;
      return combo;
    });
    const attrs = v.attributes?.map((a) => {
      const attr: Record<string, string> = { id: a.id };
      if (a.value_name !== undefined) attr.value_name = a.value_name;
      return attr as { id: string; value_name?: string };
    });
    return {
      attribute_combinations: combinations,
      price: v.price,
      available_quantity: v.available_quantity,
      picture_ids: v.picture_ids,
      ...(attrs?.length ? { attributes: attrs } : {}),
    };
  });

  const item: NewItem = {
    title: overrides?.title ?? sourceItem.title,
    category_id: overrides?.category_id ?? sourceItem.category_id,
    price: overrides?.price ?? sourceItem.price,
    currency_id: overrides?.currency_id ?? sourceItem.currency_id ?? "CLP",
    available_quantity: overrides?.available_quantity ?? sourceItem.available_quantity,
    buying_mode: overrides?.buying_mode ?? sourceItem.buying_mode ?? "buy_it_now",
    listing_type_id: overrides?.listing_type_id ?? sourceItem.listing_type_id ?? "gold_special",
    condition: overrides?.condition ?? sourceItem.condition ?? "new",
    pictures: overrides?.pictures ?? pictures,
  };

  // Optional fields — only include when present to keep payload clean
  if (overrides?.descriptions?.length || sourceItem.title) {
    item.descriptions = overrides?.descriptions ?? [{ plain_text: sourceItem.title }];
  }
  if (overrides?.attributes?.length) {
    item.attributes = overrides.attributes;
  } else if (sourceItem.attributes?.length) {
    item.attributes = sourceItem.attributes.map((a) => ({ id: a.id, value_name: a.value_name }));
  }
  if (variations?.length) {
    item.variations = variations;
  }
  if (overrides?.catalog_product_id) {
    item.catalog_product_id = overrides.catalog_product_id;
  } else if (sourceItem.catalog_product_id) {
    item.catalog_product_id = sourceItem.catalog_product_id;
  }
  if (overrides?.catalog_listing) {
    item.catalog_listing = overrides.catalog_listing;
  }
  if (overrides?.warranty) {
    item.warranty = overrides.warranty;
  } else if (sourceItem.warranty) {
    item.warranty = sourceItem.warranty;
  }
  if (overrides?.shipping) {
    item.shipping = overrides.shipping;
  } else if (sourceItem.shipping) {
    item.shipping = sourceItem.shipping;
  }
  if (overrides?.sale_terms?.length) {
    item.sale_terms = overrides.sale_terms;
  } else if (sourceItem.sale_terms?.length) {
    item.sale_terms = sourceItem.sale_terms;
  }
  if (overrides?.video_id) {
    item.video_id = overrides.video_id;
  }

  return item;
}
