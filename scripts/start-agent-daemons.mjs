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
const { createSqliteApprovalQueueRepository, createInMemoryApprovalQueueRepository } =
  await import("@msl/tools");

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

// ── CEO handler Telegram context ────────────────────────────────
const botToken = env.BOT_TOKEN?.trim();
const adminChatIds = env.MSL_TELEGRAM_ADMIN_CHAT_IDS?.trim()
  ? env.MSL_TELEGRAM_ADMIN_CHAT_IDS.split(",").map((id) => id.trim()).filter(Boolean)
  : [];

const sellerNames = {};
if (env.MERCADOLIBRE_SOURCE_SELLER_NAME?.trim()) {
  sellerNames[roleConfig.sourceSellerId] = env.MERCADOLIBRE_SOURCE_SELLER_NAME.trim();
}
if (env.MERCADOLIBRE_TARGET_SELLER_NAME?.trim()) {
  sellerNames[roleConfig.targetSellerId] = env.MERCADOLIBRE_TARGET_SELLER_NAME.trim();
}

let ceoContext = undefined;
let approvalRepo = undefined;
if (botToken && adminChatIds.length > 0) {
  // Create a lightweight grammY Bot instance for API calls only (no polling)
  const { Bot } = await import("grammy");
  const bot = new Bot(botToken);

  ceoContext = {
    sendProactiveMessage: async (chatId, text, threadId) => {
      const params = { parse_mode: "HTML" };
      if (threadId !== undefined) params.message_thread_id = threadId;
      await bot.api.sendMessage(chatId, text, params);
    },
    createForumTopic: async (chatId, name) => {
      return await bot.api.createForumTopic(chatId, name);
    },
    adminChatIds,
    sellerNames,
  };

  const approvalQueuePath = env.MSL_APPROVAL_QUEUE_DB_PATH?.trim();
  approvalRepo = approvalQueuePath
    ? createSqliteApprovalQueueRepository(approvalQueuePath)
    : createInMemoryApprovalQueueRepository();

  ceoContext.prepareProductAdsAction = async (input) => {
    const actionId = `product-ads:${input.proposalType}:${input.sellerId}:${Date.now()}`;
    await approvalRepo.save({
      action: {
        id: actionId,
        sellerId: input.sellerId,
        kind: "product-ads-action",
        target: {
          type: "product-ads-campaign",
          campaignId: input.campaignId,
          itemId: input.itemId,
          adId: input.adId ?? null,
        },
        exactChange: [
          { field: "sellerId", from: null, to: input.sellerId },
          { field: "proposalType", from: null, to: input.proposalType },
          { field: "campaignId", from: null, to: input.campaignId },
          { field: "itemId", from: null, to: input.itemId },
          { field: "adId", from: null, to: input.adId ?? null },
          { field: "currentStatus", from: null, to: input.currentStatus },
          { field: "metricsSnapshotSummary", from: null, to: input.metricsSnapshotSummary },
          { field: "rationale", from: null, to: input.rationale },
          { field: "sourceTool", from: null, to: input.sourceTool },
          { field: "observedAt", from: null, to: input.observedAt },
          { field: "mutationExecuted", from: null, to: false },
        ],
        rationale: input.rationale,
        riskLevel: "medium",
        expiresAt: input.expiresAt,
        approvalStatus: "pending",
      },
      requestedAt: new Date().toISOString(),
      highlightedRisk: "medium",
      status: "pending",
    });
  };
}

// ── Start daemon scheduler ─────────────────────────────────────
console.log("[agent-daemons] Starting daemon scheduler...");

const handle = startDaemonScheduler({
  bus,
  reader,
  cortex: engine,
  sellerIds,
  consensusStore,
  ceoContext,
  intervalMs: 15 * 60 * 1000, // 15 minutes
});

// ── Graceful shutdown ──────────────────────────────────────────
process.on("SIGINT", () => {
  console.log("\n[agent-daemons] Stopping daemon scheduler...");
  handle.stop();
  busDb.close();
  readerDb.close();
  approvalRepo?.close?.();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[agent-daemons] Stopping daemon scheduler...");
  handle.stop();
  busDb.close();
  readerDb.close();
  approvalRepo?.close?.();
  process.exit(0);
});
