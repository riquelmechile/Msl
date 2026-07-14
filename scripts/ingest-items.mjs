#!/usr/bin/env node
/**
 * Fetch item details (descriptions, pictures, attributes, health/quality)
 * using multiget batches of 20 items. Saves to Cortex.
 *
 * Usage:
 *   node scripts/ingest-items.mjs --seller source [options]
 *   node scripts/ingest-items.mjs --seller target [options]
 *
 * Options:
 *   --seller <id>      Seller ID: "source" (Plasticov) or "target" (Maustian). Required.
 *   --limit <n>        Maximum items in a batch. Default: 20.
 *   --max-pages <n>    Maximum batches to process. Default: 500.
 *   --dry-run          Fetch items but do not persist to Cortex.
 *   --no-persist       Do not save to disk.
 *   --json             Output results as JSON.
 *   --max-time <ms>    Maximum time in milliseconds before aborting. Default: 600000 (10 min).
 */
import { loadRepositoryEnvironment } from "../packages/mercadolibre/src/env.js";

loadRepositoryEnvironment();

// ── CLI parsing ─────────────────────────────────────────────────────

function parseArgv(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seller" && i + 1 < argv.length) {
      args.seller = argv[++i];
    } else if (arg === "--limit" && i + 1 < argv.length) {
      args.limit = parseInt(argv[++i], 10);
    } else if (arg === "--max-pages" && i + 1 < argv.length) {
      args.maxPages = parseInt(argv[++i], 10);
    } else if (arg === "--max-time" && i + 1 < argv.length) {
      args.maxTime = parseInt(argv[++i], 10);
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--no-persist") {
      args.noPersist = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

const args = parseArgv(process.argv);

if (args.help) {
  console.log("Usage: node scripts/ingest-items.mjs --seller <source|target> [options]");
  console.log("Options: --limit <n> --max-pages <n> --dry-run --no-persist --json --max-time <ms>");
  process.exit(0);
}

// ── Seller validation ───────────────────────────────────────────────

function resolveSeller(sellerId) {
  if (sellerId === "source") return process.env.MERCADOLIBRE_SOURCE_SELLER_ID;
  if (sellerId === "target") return process.env.MERCADOLIBRE_TARGET_SELLER_ID;
  return sellerId;
}

const rawSeller = args.seller || args._[0];
if (!rawSeller) {
  console.error("Usage: node scripts/ingest-items.mjs --seller <source|target>");
  console.error("  --seller  Seller: 'source' (Plasticov) or 'target' (Maustian). Required.");
  process.exit(1);
}

const sellerId = resolveSeller(rawSeller);
if (!sellerId) {
  console.error(`Error: Seller "${rawSeller}" is not configured.`);
  console.error(`  Set MERCADOLIBRE_${rawSeller.toUpperCase()}_SELLER_ID in .env.local`);
  process.exit(1);
}

if (rawSeller !== "source" && rawSeller !== "target" && rawSeller !== sellerId) {
  console.error(`Error: Unrecognized seller "${rawSeller}". Use "source" or "target".`);
  process.exit(1);
}

// ── Constants from CLI options ─────────────────────────────────────

const BATCH_SIZE = args.limit || 20;
const MAX_BATCHES = args.maxPages || 500;
const MAX_TIME_MS = args.maxTime || 600000; // 10 min default
const DRY_RUN = args.dryRun || false;
const NO_PERSIST = args.noPersist || DRY_RUN;
const JSON_OUTPUT = args.json || false;
const ATTRS =
  "id,title,price,available_quantity,condition,seller_id,descriptions,pictures,attributes,health,catalog_product_id,listing_type_id,warranty,shipping,currency_id,permalink";

// ── Abort controller for timeout and signals ─────────────────────────

const abortController = new AbortController();

const timeout = setTimeout(() => {
  if (!abortController.signal.aborted) {
    abortController.abort(new Error(`Timeout after ${MAX_TIME_MS}ms`));
  }
}, MAX_TIME_MS);

let shuttingDown = false;
function onShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`\n⚠️  Received ${signal}. Shutting down gracefully...`);
  clearTimeout(timeout);
  abortController.abort(new Error(`Received ${signal}`));
}
process.on("SIGINT", () => onShutdown("SIGINT"));
process.on("SIGTERM", () => onShutdown("SIGTERM"));

// ── Dependencies ────────────────────────────────────────────────────

const {
  createMultiAppOAuthManager,
  resolveOAuthConfigs,
  createOAuthMlcApiClient,
  createMercadoLibreApiFetchTransport,
} = await import("@msl/mercadolibre");
const { createGraphEngine } = await import("@msl/memory");

const configs = resolveOAuthConfigs(process.env);

for (const [, config] of configs) {
  const original = config.onTokenRefresh;
  config.onTokenRefresh = (sid) => {
    if (!JSON_OUTPUT) {
      console.log(
        JSON.stringify({
          level: "info",
          component: "ingest-items",
          msg: "meli-refresh-succeeded",
          sellerId: sid,
          ts: new Date().toISOString(),
        }),
      );
    }
    original?.(sid);
  };
}

const oauthManager = createMultiAppOAuthManager(configs);
const client = createOAuthMlcApiClient({
  oauthManager,
  transport: createMercadoLibreApiFetchTransport(),
  now: () => new Date(),
  allowedSellerIds: [sellerId],
});

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  if (!JSON_OUTPUT) console.log(`📋 Fetching listing IDs for seller ${sellerId}...`);

  // Get all listing IDs from the seller's items
  const listingsSnap = await client.getListings(sellerId);
  const allIds = listingsSnap.data.map((l) => l.id).filter((id) => id && /^MLC\d+$/.test(id));

  if (!JSON_OUTPUT)
    console.log(`📦 ${allIds.length} items to fetch in batches of ${BATCH_SIZE}...`);

  const cortexPath = (
    process.env.MSL_TELEGRAM_CORTEX_SQLITE_PATH?.trim() ||
    process.env.MSL_CORTEX_SQLITE_PATH?.trim()
  )?.replace(/\.sqlite$/, `.telegram-${sellerId}.sqlite`);

  const engine = cortexPath ? createGraphEngine(cortexPath) : undefined;

  let processed = 0;
  let withPictures = 0;
  let withDescriptions = 0;
  let withAttributes = 0;
  let withHealth = 0;
  let lastError = null;
  let rateLimited = false;
  let batchCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
    if (abortController.signal.aborted) break;
    if (batchCount >= MAX_BATCHES) {
      if (!JSON_OUTPUT) console.log(`  ⚠️  Reached max batches (${MAX_BATCHES}). Stopping.`);
      break;
    }

    const batch = allIds.slice(i, i + BATCH_SIZE);
    const idsParam = batch.join(",");
    const url = `https://api.mercadolibre.com/items?ids=${idsParam}&attributes=${ATTRS}`;

    try {
      const at = await oauthManager.ensureValidToken(sellerId);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${at}` },
        signal: abortController.signal,
      });

      if (res.status === 429) {
        rateLimited = true;
        const retryAfter = res.headers.get("retry-after");
        if (!JSON_OUTPUT) {
          console.error(`  ⚠️  Rate limited (429). Retry-After: ${retryAfter || "unknown"}`);
        }
      }

      if (!res.ok) {
        if (!JSON_OUTPUT) console.error(`  ❌ Batch ${i}: HTTP ${res.status}`);
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

        // Save to Cortex (unless dry-run / no-persist)
        if (engine && !NO_PERSIST) {
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

      batchCount++;

      if (!JSON_OUTPUT) {
        const pct = Math.round((processed / allIds.length) * 100);
        console.log(
          `  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${processed}/${allIds.length} (${pct}%) | pics:${withPictures} desc:${withDescriptions} attr:${withAttributes} health:${withHealth}`,
        );
      }

      // Rate limit between batches
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      if (err.name === "AbortError") break;
      if (err.message && err.message.includes("429")) {
        rateLimited = true;
      }
      if (!JSON_OUTPUT) console.error(`  ❌ Batch ${i} error: ${err.message}`);
      lastError = err.message;
    }
  }

  // ── Output ────────────────────────────────────────────────────────

  const result = {
    sellerId,
    processed,
    totalItems: allIds.length,
    batches: batchCount,
    withPictures,
    withDescriptions,
    withAttributes,
    withHealth,
    status: lastError ? "error" : shuttingDown ? "interrupted" : "complete",
    ...(lastError ? { error: lastError } : {}),
    ...(rateLimited ? { rateLimited: true } : {}),
    ...(DRY_RUN ? { dryRun: true } : {}),
    ...(NO_PERSIST ? { persisted: false } : { persisted: !!(engine && !NO_PERSIST) }),
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(result));
  } else {
    console.log(`\n✅ Done: ${processed} items processed`);
    console.log(`   Pictures: ${withPictures}, Descriptions: ${withDescriptions}`);
    console.log(`   Attributes: ${withAttributes}, Health: ${withHealth}`);
  }

  return result;
}

// ── Execute ─────────────────────────────────────────────────────────

try {
  await main();
} catch (err) {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
} finally {
  clearTimeout(timeout);
  oauthManager.close();
}
