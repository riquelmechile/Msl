#!/usr/bin/env node
/**
 * Fetch ALL item details (descriptions, pictures, attributes, health/quality)
 * using multiget batches of 20 items. Saves to Cortex.
 * Usage: node scripts/ingest-items.mjs [sellerId]
 */
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

function loadEnv(filePath) {
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv(resolve(import.meta.dirname, "..", ".env.local"));

const {
  createMultiAppOAuthManager,
  resolveOAuthConfigs,
  createOAuthMlcApiClient,
  createMercadoLibreApiFetchTransport,
} = await import("@msl/mercadolibre");
const { createGraphEngine } = await import("@msl/memory");

const sellerId = process.argv[2];
if (!sellerId) {
  console.error("Usage: node scripts/ingest-items.mjs <sellerId>");
  process.exit(1);
}

const configs = resolveOAuthConfigs(process.env);
const oauthManager = createMultiAppOAuthManager(configs);
const client = createOAuthMlcApiClient({
  oauthManager,
  transport: createMercadoLibreApiFetchTransport(),
  now: () => new Date(),
  allowedSellerIds: [sellerId],
});

const BATCH_SIZE = 20;
const ATTRS =
  "id,title,price,available_quantity,condition,seller_id,descriptions,pictures,attributes,health,catalog_product_id,listing_type_id,warranty,shipping,currency_id,permalink";

// Get all listing IDs from the seller's items
console.log(`📋 Fetching listing IDs for seller ${sellerId}...`);
const listingsSnap = await client.getListings(sellerId);
const allIds = listingsSnap.data.map((l) => l.id).filter((id) => id && /^MLC\d+$/.test(id));

console.log(`📦 ${allIds.length} items to fetch in batches of ${BATCH_SIZE}...`);

// Batch fetch
const cortexPath = (
  process.env.MSL_TELEGRAM_CORTEX_SQLITE_PATH?.trim() || process.env.MSL_CORTEX_SQLITE_PATH?.trim()
)?.replace(/\.sqlite$/, `.telegram-${sellerId}.sqlite`);

const engine = cortexPath ? createGraphEngine(cortexPath) : undefined;

let processed = 0;
let withPictures = 0;
let withDescriptions = 0;
let withAttributes = 0;
let withHealth = 0;
const today = new Date().toISOString().slice(0, 10);

for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
  const batch = allIds.slice(i, i + BATCH_SIZE);
  const idsParam = batch.join(",");
  const url = `https://api.mercadolibre.com/items?ids=${idsParam}&attributes=${ATTRS}`;

  try {
    const at = await oauthManager.ensureValidToken(sellerId);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${at}` },
    });
    if (!res.ok) {
      console.error(`  ❌ Batch ${i}: HTTP ${res.status}`);
      continue;
    }

    const items = await res.json();
    for (const entry of items) {
      if (entry.code !== 200) continue;
      const item = entry.body;
      processed++;

      if (item.pictures?.length) withPictures++;
      if (item.descriptions?.length) withDescriptions++;
      if (item.attributes?.length) withAttributes++;
      if (item.health) withHealth++;

      // Save to Cortex
      if (engine) {
        const label = `item_detail_${item.id}_${today}`;
        engine.getOrCreateNode(label, {
          type: "item_detail",
          itemId: item.id,
          sellerId,
          title: item.title ?? "",
          price: item.price ?? 0,
          availableQuantity: item.available_quantity ?? 0,
          condition: item.condition ?? "",
          listingTypeId: item.listing_type_id ?? "",
          pictureCount: item.pictures?.length ?? 0,
          descriptionCount: item.descriptions?.length ?? 0,
          attributeCount: item.attributes?.length ?? 0,
          hasHealth: !!item.health,
          catalogProductId: item.catalog_product_id ?? "",
          capturedAt: new Date().toISOString(),
        });
      }
    }

    const pct = Math.round((processed / allIds.length) * 100);
    console.log(
      `  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${processed}/${allIds.length} (${pct}%) | pics:${withPictures} desc:${withDescriptions} attr:${withAttributes} health:${withHealth}`,
    );

    // Rate limit respect
    await new Promise((r) => setTimeout(r, 300));
  } catch (err) {
    console.error(`  ❌ Batch ${i} error: ${err.message}`);
  }
}

console.log(`\n✅ Done: ${processed} items processed`);
console.log(`   Pictures: ${withPictures}, Descriptions: ${withDescriptions}`);
console.log(`   Attributes: ${withAttributes}, Health: ${withHealth}`);
oauthManager.close();
