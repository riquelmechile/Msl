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
import { randomUUID } from "node:crypto";

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
  console.error("Cannot start daemon scheduler: MSL_CORTEX_SQLITE_PATH is not set.");
  process.exit(1);
}

// ── Runtime env validation ────────────────────────────────────
const { validateRuntimeEnv } = await import("@msl/agent");
const envCheck = validateRuntimeEnv();
if (!envCheck.valid) {
  for (const error of envCheck.errors) {
    console.warn("[agent-daemons] Env error:", error);
  }
}
for (const warning of envCheck.warnings) {
  console.warn("[agent-daemons] Env warning:", warning);
}

// ── Imports ────────────────────────────────────────────────────
const { createAgentMessageBusStore, createAgentConsensusStore, startDaemonScheduler, createEconomicLearningDaemon, createDaemonLogger } =
  await import("@msl/agent");
const { createGraphEngine, getSharedDb, createSqliteOperationalReadModel, getSharedManager, BackupScheduler, createSqliteEconomicOutcomeStore, createSqliteEconomicLearningStore } =
  await import("@msl/memory");
const { getMlAccountRoleConfig } = await import("@msl/mercadolibre");
const { createSqliteApprovalQueueRepository, createInMemoryApprovalQueueRepository } =
  await import("@msl/tools");

// ── Shared DB connection (consolidated from 3 createDatabase() calls) ──
const sharedDb = getSharedDb(cortexPath);

// ── Bus DB (agent message bus uses its own SQLite tables) ──────
const bus = createAgentMessageBusStore(sharedDb);
const consensusStore = createAgentConsensusStore(sharedDb);

// ── Cortex + operational reader ────────────────────────────────
const engine = createGraphEngine(cortexPath);
const reader = createSqliteOperationalReadModel(sharedDb);

// ── Seller config ──────────────────────────────────────────────
const roleConfig = getMlAccountRoleConfig(env);
const sellerIds = [roleConfig.sourceSellerId, roleConfig.targetSellerId];

// ── Supplier Mirror ──────────────────────────────────────────
const { getSupplierMirrorRuntimeFromEnv } = await import("@msl/memory");
const { startSupplierMirrorScheduler } = await import("@msl/workers");
const supplierMirrorRuntime = getSupplierMirrorRuntimeFromEnv(env);
let supplierMirrorStore = undefined;
if (supplierMirrorRuntime) {
  supplierMirrorStore = supplierMirrorRuntime.store;
  console.log("[agent-daemons] Supplier Mirror store connected");
}

// Start supplier mirror worker if explicitly enabled
const workerEnabled = env.MSL_SUPPLIER_MIRROR_WORKER_ENABLED?.trim() === "true";
let supplierMirrorHandle = undefined;
if (supplierMirrorRuntime && workerEnabled) {
  console.log("[agent-daemons] Supplier Mirror worker enabled — starting scheduler");
  supplierMirrorHandle = startSupplierMirrorScheduler({
    store: supplierMirrorRuntime.store,
    adapters: new Map(),
    intervalMs: 10 * 60 * 1000, // 10 minutes
  });
}

// ── Durability: BackupScheduler ────────────────────────────────
const backupDir = env.MSL_BACKUP_DIR?.trim() || resolve(import.meta.dirname, "..", "backups");
const durabilityEnabled = env.MSL_DURABILITY_ENABLED?.trim() === "true";
let backupScheduler = undefined;

if (durabilityEnabled) {
  const cortexManager = getSharedManager(cortexPath);
  backupScheduler = new BackupScheduler({
    entries: [{ manager: cortexManager, dbPath: cortexPath, dbType: "cortex" }],
    backupDir,
    backupIntervalMs: 24 * 60 * 60 * 1000, // 24h
    walCheckpointIntervalMs: 60 * 60 * 1000,  // 1h
    integrityCheckIntervalMs: 6 * 60 * 60 * 1000, // 6h
  });
  backupScheduler.start();
  console.log("[agent-daemons] BackupScheduler started (backups → " + backupDir + ")");
}

// ── Observability: structured logging ──────────────────────────
let daemonLogger = undefined;
if (env.MSL_STRUCTURED_LOGGING_ENABLED?.trim() === "true") {
  daemonLogger = createDaemonLogger("agent-daemons", randomUUID());
  console.log("[agent-daemons] Structured logging enabled");
}

// ── Economic learning daemon (optional) ────────────────────────
let economicLearningDaemon = undefined;
if (env.MSL_ECONOMIC_LEARNING_ENABLED?.trim() === "true") {
  const economicOutcomeStore = createSqliteEconomicOutcomeStore(sharedDb);
  const economicLearningStore = createSqliteEconomicLearningStore(sharedDb);
  economicLearningDaemon = createEconomicLearningDaemon(
    economicOutcomeStore,
    economicLearningStore,
    engine,
  );
  console.log("[agent-daemons] Economic learning daemon registered");
}

// ── CEO handler Telegram context ────────────────────────────────
const botToken = env.BOT_TOKEN?.trim();
const adminChatIds = env.MSL_TELEGRAM_ADMIN_CHAT_IDS?.trim()
  ? env.MSL_TELEGRAM_ADMIN_CHAT_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean)
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

// ── DeepSeek advisors from env ──────────────────────────────────
const { createDaemonAdvisorsFromEnv } = await import("@msl/agent");
const advisors = createDaemonAdvisorsFromEnv(env, {
  supplierMirrorStore,
});

// ── Webhook ingestor (optional) ──────────────────────────────
const webhookPort = env.MSL_WEBHOOK_PORT?.trim();
let webhookHandle = undefined;
if (webhookPort) {
  const { createWebhookIngestor } = await import("@msl/agent");
  webhookHandle = createWebhookIngestor(bus);
  webhookHandle.start(Number(webhookPort));
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
  supplierMirrorStore,
  ...advisors,
  intervalMs: 15 * 60 * 1000, // 15 minutes
  ...(economicLearningDaemon ? { economicLearningDaemon } : {}),
});

// ── Proactive monitors (independent of message-driven scheduler) ──
const { runSystemHealthCheck } = await import("@msl/agent");
const { runDlqMonitor } = await import("@msl/agent");

// Health check every 30 minutes
const healthInterval = setInterval(
  () => {
    const dbEntries = durabilityEnabled
      ? [{ manager: getSharedManager(cortexPath), name: "cortex", dbPath: cortexPath }]
      : undefined;
    const backupFreshness = backupScheduler
      ? (name) => backupScheduler.isBackupFresh(name)
      : undefined;
    const health = runSystemHealthCheck(bus, engine, dbEntries, backupFreshness);
    if (!health.ok && ceoContext?.adminChatIds && ceoContext.sendProactiveMessage) {
      const alertMsg = health.checks
        .filter((c) => c.status !== "ok")
        .map((c) => `• [${c.status.toUpperCase()}] ${c.name}: ${c.detail}`)
        .join("\n");
      for (const chatId of ceoContext.adminChatIds) {
        ceoContext
          .sendProactiveMessage(Number(chatId), `🏥 <b>System Health Alert</b>\n${alertMsg}`)
          .catch(() => {});
      }
    }
    console.log("[agent-daemons] Health check:", health.ok ? "OK" : "ISSUES FOUND");
  },
  30 * 60 * 1000,
);

// DLQ monitor every 15 minutes
const dlqInterval = setInterval(
  () => {
    runDlqMonitor(bus, ceoContext?.adminChatIds ?? [], ceoContext?.sendProactiveMessage);
  },
  15 * 60 * 1000,
);

// ── Graceful shutdown ──────────────────────────────────────────
const shutdown = () => {
  clearInterval(healthInterval);
  clearInterval(dlqInterval);
  console.log("\n[agent-daemons] Stopping daemon scheduler...");
  handle.stop();
  backupScheduler?.stop();
  webhookHandle?.stop();
  supplierMirrorHandle?.stop();
  sharedDb.close();
  approvalRepo?.close?.();
  supplierMirrorRuntime?.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
