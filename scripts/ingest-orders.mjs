#!/usr/bin/env node
/**
 * Fetch ALL orders with pagination and save to Cortex.
 * Usage: node scripts/ingest-orders.mjs [sellerId]
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

const sellerId = process.argv[2];
if (!sellerId) {
  console.error("Usage: node scripts/ingest-orders.mjs <sellerId>");
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

const PAGE_SIZE = 50;
const MAX_ORDERS = 10000; // safety limit

console.log(`📦 Fetching orders for seller ${sellerId}...`);
let totalOrders = 0;
let totalAmount = 0;
let offset = 0;
let page = 1;

while (offset < MAX_ORDERS) {
  try {
    const snap = await client.getOrders(sellerId, {
      limit: PAGE_SIZE,
      offset,
    });

    const orders = snap.data;
    if (!orders || orders.length === 0) break;

    for (const order of orders) {
      if (order.totalAmount) totalAmount += order.totalAmount;
    }

    totalOrders += orders.length;
    const total = snap.paging?.total ?? 0;
    const pct = total > 0 ? Math.round((totalOrders / total) * 100) : 0;

    console.log(
      `  Page ${page}: ${orders.length} orders (${totalOrders}/${total} = ${pct}%, $${Math.round(totalAmount).toLocaleString("es-CL")} CLP)`,
    );

    if (orders.length < PAGE_SIZE) break;
    if (totalOrders >= total && total > 0) break;

    offset += PAGE_SIZE;
    page++;
    await new Promise((r) => setTimeout(r, 300)); // rate limit
  } catch (err) {
    console.error(`  ❌ Failed at offset ${offset}: ${err.message}`);
    break;
  }
}

// Save to Cortex
const { createGraphEngine } = await import("@msl/memory");
const cortexPath =
  process.env.MSL_TELEGRAM_CORTEX_SQLITE_PATH?.trim() || process.env.MSL_CORTEX_SQLITE_PATH?.trim();
if (cortexPath) {
  const scopedPath = cortexPath.replace(/\.sqlite$/, `.telegram-${sellerId}.sqlite`);
  const engine = createGraphEngine(scopedPath);
  const label = `order_snapshot_batch_${sellerId}_${new Date().toISOString().slice(0, 10)}`;
  engine.getOrCreateNode(label, {
    type: "order_snapshot",
    sellerId,
    totalOrders,
    totalAmount,
    capturedAt: new Date().toISOString(),
  });
  console.log(`  ✅ Saved to Cortex: ${label}`);
}

console.log(
  `\n✅ Done: ${totalOrders} orders, $${Math.round(totalAmount).toLocaleString("es-CL")} CLP total`,
);
oauthManager.close();
