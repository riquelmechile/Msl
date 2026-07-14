#!/usr/bin/env node
/**
 * Fetch claims with pagination and save to Cortex.
 *
 * Usage:
 *   node scripts/ingest-claims.mjs --seller source [options]
 *   node scripts/ingest-claims.mjs --seller target [options]
 *
 * Options:
 *   --seller <id>      Seller ID: "source" (Plasticov) or "target" (Maustian). Required.
 *   --limit <n>        Maximum claims per page. Default: 50.
 *   --max-pages <n>    Maximum pages to paginate through. Default: 200.
 *   --dry-run          Fetch claims but do not persist to Cortex.
 *   --no-persist       Do not save to disk.
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
  console.log("Usage: node scripts/ingest-claims.mjs --seller <source|target> [options]");
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
  console.error("Usage: node scripts/ingest-claims.mjs --seller <source|target>");
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
const MAX_CLAIMS = PAGE_SIZE * MAX_PAGES;
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

const { createMultiAppOAuthManager, resolveOAuthConfigs } = await import("@msl/mercadolibre");
const { createGraphEngine } = await import("@msl/memory");

const configs = resolveOAuthConfigs(process.env);

for (const [, config] of configs) {
  const original = config.onTokenRefresh;
  config.onTokenRefresh = (sid) => {
    if (!JSON_OUTPUT) {
      console.log(
        JSON.stringify({
          level: "info",
          component: "ingest-claims",
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

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  if (!JSON_OUTPUT) console.log(`📋 Fetching claims for seller ${sellerId}...`);

  let totalClaims = 0;
  let openedCount = 0;
  let closedCount = 0;
  let offset = 0;
  let page = 1;
  let lastError = null;
  let rateLimited = false;
  let persistedCount = 0;

  while (offset < MAX_CLAIMS) {
    if (abortController.signal.aborted) break;

    try {
      const at = await oauthManager.ensureValidToken(sellerId);
      const qs = new URLSearchParams({
        "players.user_id": sellerId,
        "players.role": "respondent",
        type: "mediations",
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const res = await fetch(`https://api.mercadolibre.com/post-purchase/v1/claims/search?${qs}`, {
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
        const errBody = await res.text();
        if (!JSON_OUTPUT) console.error(`  ❌ HTTP ${res.status}: ${errBody.slice(0, 150)}`);
        break;
      }

      const body = await res.json();
      const claims = body.data || [];
      if (claims.length === 0) break;

      totalClaims += claims.length;
      const total = body.paging?.total ?? 0;
      const pct = total > 0 ? Math.round((totalClaims / total) * 100) : 0;

      const opened = claims.filter((c) => c.status === "opened").length;
      const closed = claims.filter((c) => c.status === "closed").length;
      openedCount += opened;
      closedCount += closed;

      if (!JSON_OUTPUT) {
        console.log(
          `  Page ${page}: ${claims.length} claims (${totalClaims}/${total} = ${pct}%, opened: ${opened}, closed: ${closed})`,
        );
      }

      // Save to Cortex (unless dry-run / no-persist)
      if (!NO_PERSIST) {
        const cortexPath = (
          process.env.MSL_TELEGRAM_CORTEX_SQLITE_PATH?.trim() ||
          process.env.MSL_CORTEX_SQLITE_PATH?.trim()
        )?.replace(/\.sqlite$/, `.telegram-${sellerId}.sqlite`);
        if (cortexPath) {
          const engine = createGraphEngine(cortexPath);
          for (const claim of claims) {
            const label = `claim_snapshot_${claim.id}`;
            engine.getOrCreateNode(label, {
              type: "claim_snapshot",
              claimId: claim.id,
              sellerId,
              status: claim.status ?? "",
              claimType: claim.type ?? "",
              resource: claim.resource ?? "",
              reasonId: claim.reason_id ?? "",
              stage: claim.stage ?? "",
              dateCreated: claim.date_created ?? "",
              capturedAt: new Date().toISOString(),
            });
          }
          persistedCount += claims.length;
        }
      }

      if (claims.length < PAGE_SIZE) break;
      if (totalClaims >= total && total > 0) break;

      offset += PAGE_SIZE;
      page++;

      if (page > MAX_PAGES) {
        if (!JSON_OUTPUT) console.log(`  ⚠️  Reached max pages (${MAX_PAGES}). Stopping.`);
        break;
      }

      // Rate limit between pages
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      if (err.name === "AbortError") break;
      if (err.message && err.message.includes("429")) {
        rateLimited = true;
      }
      if (!JSON_OUTPUT) console.error(`  ❌ Failed at offset ${offset}: ${err.message}`);
      lastError = err.message;
      break;
    }
  }

  // ── Output ────────────────────────────────────────────────────────

  const result = {
    sellerId,
    totalClaims,
    openedCount,
    closedCount,
    pages: page,
    persistedCount,
    status: lastError ? "error" : shuttingDown ? "interrupted" : "complete",
    ...(lastError ? { error: lastError } : {}),
    ...(rateLimited ? { rateLimited: true } : {}),
    ...(DRY_RUN ? { dryRun: true } : {}),
    ...(NO_PERSIST ? { persisted: false } : { persisted: persistedCount }),
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(result));
  } else {
    console.log(`\n✅ Done: ${totalClaims} claims processed`);
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
