#!/usr/bin/env node
/**
 * Start the background ingestion worker as a standalone process.
 * Usage: node scripts/start-worker-ingestion.mjs
 *
 * This process syncs MercadoLibre data (listings, orders, claims,
 * reputation, etc.) into the Cortex graph engine independently from
 * the Telegram bot. Alerts are logged but not pushed to Telegram.
 */
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

function loadEnvIfPresent(filePath) {
  if (!existsSync(filePath)) return false;

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
  return true;
}

const envPath = resolve(import.meta.dirname, "..", ".env.local");
loadEnvIfPresent(envPath);

const env = process.env;

// ── Validate required env ──────────────────────────────────────
const oauthDbPath = env.MSL_MERCADOLIBRE_OAUTH_DB_PATH?.trim();
if (!oauthDbPath) {
  console.error(
    "Cannot start ingestion worker: MSL_MERCADOLIBRE_OAUTH_DB_PATH is not set.",
  );
  process.exit(1);
}

const cortexPath = env.MSL_CORTEX_SQLITE_PATH?.trim();
if (!cortexPath) {
  console.error(
    "Cannot start ingestion worker: MSL_CORTEX_SQLITE_PATH is not set.",
  );
  process.exit(1);
}

// ── Imports ────────────────────────────────────────────────────
const { startBackgroundIngestion } = await import("@msl/agent");
const { createGraphEngine, createDatabase, createSqliteOperationalReadModel } =
  await import("@msl/memory");
const {
  createMercadoLibreApiFetchTransport,
  createOAuthMlcApiClient,
  createMultiAppOAuthManager,
  getMlAccountRoleConfig,
  resolveOAuthConfigs,
} = await import("@msl/mercadolibre");

// ── OAuth ──────────────────────────────────────────────────────
const roleConfig = getMlAccountRoleConfig(env);
const configs = resolveOAuthConfigs(env);
const oauthManager = createMultiAppOAuthManager(configs);
const now = () => new Date();

const mlcClient = createOAuthMlcApiClient({
  oauthManager,
  transport: createMercadoLibreApiFetchTransport(),
  now,
  allowedSellerIds: [roleConfig.sourceSellerId, roleConfig.targetSellerId],
});

// ── Cortex + operational store ─────────────────────────────────
const engine = createGraphEngine(cortexPath);
const operationalDb = createDatabase(cortexPath);
const operationalReadModel = createSqliteOperationalReadModel(operationalDb);

// ── Seller config ──────────────────────────────────────────────
const sellerIds = [roleConfig.sourceSellerId, roleConfig.targetSellerId];
const sellerNames = {
  [roleConfig.sourceSellerId]:
    env.MERCADOLIBRE_SOURCE_SELLER_NAME?.trim() || "Plasticov",
  [roleConfig.targetSellerId]:
    env.MERCADOLIBRE_TARGET_SELLER_NAME?.trim() || "Maustian",
};

const deepseekApiKey = env.DEEPSEEK_API_KEY?.trim();

// ── Start ingestion ────────────────────────────────────────────
console.log("[worker-ingestion] Starting background ingestion worker...");

const baseConfig = {
  mlcClient,
  engine,
  sendProactiveMessage: async () => {
    // No-op: standalone worker has no Telegram access
  },
  listActiveChats: async () => [],
  sellerIds,
  sellerNames,
  intervalMs: 6 * 60 * 60 * 1000, // 6 hours
  ...(operationalReadModel ? { operationalStore: operationalReadModel } : {}),
};

const handle = startBackgroundIngestion(
  deepseekApiKey ? { ...baseConfig, deepseekApiKey } : baseConfig,
);

// ── Graceful shutdown ──────────────────────────────────────────
process.on("SIGINT", () => {
  console.log("\n[worker-ingestion] Stopping ingestion worker...");
  handle.stop();
  oauthManager.close();
  operationalDb.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[worker-ingestion] Stopping ingestion worker...");
  handle.stop();
  oauthManager.close();
  operationalDb.close();
  process.exit(0);
});
