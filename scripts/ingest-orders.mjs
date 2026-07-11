#!/usr/bin/env node
/**
 * Fetch orders with pagination and save to Cortex.
 *
 * Usage:
 *   node scripts/ingest-orders.mjs --seller source [options]
 *   node scripts/ingest-orders.mjs --seller target [options]
 *
 * Options:
 *   --seller <id>      Seller ID: "source" (Plasticov) or "target" (Maustian). Required.
 *   --limit <n>        Maximum orders per page. Default: 50.
 *   --max-pages <n>    Maximum pages to paginate through. Default: 200 (10k orders at limit=50).
 *   --dry-run          Fetch orders but do not persist to Cortex.
 *   --no-persist       Do not save to disk (override Cortex save).
 *   --json             Output results as JSON.
 *   --max-time <ms>    Maximum time in milliseconds before aborting. Default: 300000 (5 min).
 */
import { loadRepositoryEnvironment } from "../packages/mercadolibre/src/env.js";

loadRepositoryEnvironment();

// ── CLI parsing ─────────────────────────────────────────────────────

function parseArgv(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seller" && i + 1 < argv.length) { args.seller = argv[++i]; }
    else if (arg === "--limit" && i + 1 < argv.length) { args.limit = parseInt(argv[++i], 10); }
    else if (arg === "--max-pages" && i + 1 < argv.length) { args.maxPages = parseInt(argv[++i], 10); }
    else if (arg === "--max-time" && i + 1 < argv.length) { args.maxTime = parseInt(argv[++i], 10); }
    else if (arg === "--dry-run") { args.dryRun = true; }
    else if (arg === "--no-persist") { args.noPersist = true; }
    else if (arg === "--json") { args.json = true; }
    else if (arg === "--help" || arg === "-h") { args.help = true; }
    else { args._.push(arg); }
  }
  return args;
}

const args = parseArgv(process.argv);

if (args.help) {
  console.log("Usage: node scripts/ingest-orders.mjs --seller <source|target> [options]");
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
  console.error("Usage: node scripts/ingest-orders.mjs --seller <source|target>");
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

const PAGE_SIZE = args.limit || 50;
const MAX_PAGES = args.maxPages || 200;
const MAX_ORDERS = PAGE_SIZE * MAX_PAGES;
const MAX_TIME_MS = args.maxTime || 300000; // 5 min default
const DRY_RUN = args.dryRun || false;
const NO_PERSIST = args.noPersist || DRY_RUN;
const JSON_OUTPUT = args.json || false;

// ── Abort controller for timeout and signals ─────────────────────────

const abortController = new AbortController();

const timeout = setTimeout(() => {
  if (!abortController.signal.aborted) {
    abortController.abort(new Error(`Timeout after ${MAX_TIME_MS}ms`));
  }
}, MAX_TIME_MS);

// Graceful shutdown on SIGINT/SIGTERM
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

const configs = resolveOAuthConfigs(process.env);

// Wire onTokenRefresh callback for observability
for (const [, config] of configs) {
  const original = config.onTokenRefresh;
  config.onTokenRefresh = (sid) => {
    if (!JSON_OUTPUT) {
      console.log(
        JSON.stringify({
          level: "info",
          component: "ingest-orders",
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
  if (!JSON_OUTPUT) console.log(`📦 Fetching orders for seller ${sellerId}...`);

  let totalOrders = 0;
  let totalAmount = 0;
  let offset = 0;
  let page = 1;
  let lastError = null;
  let rateLimited = false;

  while (offset < MAX_ORDERS) {
    if (abortController.signal.aborted) break;

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

      if (!JSON_OUTPUT) {
        console.log(
          `  Page ${page}: ${orders.length} orders (${totalOrders}/${total} = ${pct}%, $${Math.round(totalAmount).toLocaleString("es-CL")} CLP)`,
        );
      }

      if (orders.length < PAGE_SIZE) break;
      if (totalOrders >= total && total > 0) break;

      offset += PAGE_SIZE;
      page++;

      if (page > MAX_PAGES) {
        if (!JSON_OUTPUT) console.log(`  ⚠️  Reached max pages (${MAX_PAGES}). Stopping.`);
        break;
      }

      // Rate limit between pages
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      // Check for rate limiting
      if (err.message && err.message.includes("429")) {
        rateLimited = true;
        if (!JSON_OUTPUT) console.error(`  ⚠️  Rate limited (429). Consider reducing concurrency.`);
      }
      if (!JSON_OUTPUT) console.error(`  ❌ Failed at offset ${offset}: ${err.message}`);
      lastError = err.message;
      break;
    }
  }

  // ── Persist to Cortex (unless --dry-run or --no-persist) ──────────

  let cortexSaved = false;
  if (!NO_PERSIST) {
    try {
      const { createGraphEngine } = await import("@msl/memory");
      const cortexPath =
        process.env.MSL_TELEGRAM_CORTEX_SQLITE_PATH?.trim() ||
        process.env.MSL_CORTEX_SQLITE_PATH?.trim();
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
        cortexSaved = true;
        if (!JSON_OUTPUT) console.log(`  ✅ Saved to Cortex: ${label}`);
      }
    } catch (err) {
      if (!JSON_OUTPUT) console.error(`  ⚠️  Cortex save failed: ${err.message}`);
    }
  }

  // ── Output ────────────────────────────────────────────────────────

  const result = {
    sellerId,
    totalOrders,
    totalAmount: Math.round(totalAmount),
    pages: page,
    status: lastError ? "error" : shuttingDown ? "interrupted" : "complete",
    ...(lastError ? { error: lastError } : {}),
    ...(rateLimited ? { rateLimited: true } : {}),
    ...(DRY_RUN ? { dryRun: true } : {}),
    ...(NO_PERSIST ? { persisted: false } : { persisted: cortexSaved }),
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(result));
  } else {
    console.log(
      `\n✅ Done: ${totalOrders} orders, $${Math.round(totalAmount).toLocaleString("es-CL")} CLP total`,
    );
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
