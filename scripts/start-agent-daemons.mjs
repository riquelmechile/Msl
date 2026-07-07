#!/usr/bin/env node
/**
 * Start the daemon scheduler as a standalone process.
 * Usage: node scripts/start-agent-daemons.mjs
 *
 * The daemon scheduler polls the agent message bus and dispatches
 * pending work to specialist daemons (market catalog, operations
 * manager, cost supplier, creative commercial).
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
const cortexPath = env.MSL_CORTEX_SQLITE_PATH?.trim();
if (!cortexPath) {
  console.error(
    "Cannot start daemon scheduler: MSL_CORTEX_SQLITE_PATH is not set.",
  );
  process.exit(1);
}

// ── Imports ────────────────────────────────────────────────────
const { createAgentMessageBusStore, createAgentConsensusStore, startDaemonScheduler } =
  await import("@msl/agent");
const { createGraphEngine, createDatabase, createSqliteOperationalReadModel } =
  await import("@msl/memory");
const { getMlAccountRoleConfig } = await import("@msl/mercadolibre");

// ── Bus DB (agent message bus uses its own SQLite tables) ──────
const busDb = createDatabase(cortexPath);
const bus = createAgentMessageBusStore(busDb);
const consensusStore = createAgentConsensusStore(busDb);

// ── Cortex + operational reader ────────────────────────────────
const engine = createGraphEngine(cortexPath);
const readerDb = createDatabase(cortexPath);
const reader = createSqliteOperationalReadModel(readerDb);

// ── Seller config ──────────────────────────────────────────────
const roleConfig = getMlAccountRoleConfig(env);
const sellerIds = [roleConfig.sourceSellerId, roleConfig.targetSellerId];

// ── Start daemon scheduler ─────────────────────────────────────
console.log("[agent-daemons] Starting daemon scheduler...");

const handle = startDaemonScheduler({
  bus,
  reader,
  cortex: engine,
  sellerIds,
  consensusStore,
  intervalMs: 15 * 60 * 1000, // 15 minutes
});

// ── Graceful shutdown ──────────────────────────────────────────
process.on("SIGINT", () => {
  console.log("\n[agent-daemons] Stopping daemon scheduler...");
  handle.stop();
  busDb.close();
  readerDb.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[agent-daemons] Stopping daemon scheduler...");
  handle.stop();
  busDb.close();
  readerDb.close();
  process.exit(0);
});
