import { createReadinessCheckResult } from "./types.js";
import type { ReadinessCheckResult } from "./types.js";
import type { ReadinessContext } from "./types.js";

const CHECK_PREFIX = "featgate";

export function checkFeatureGateReadiness(ctx: ReadinessContext): ReadinessCheckResult[] {
  const results: ReadinessCheckResult[] = [];
  const { env, features } = ctx;

  // ── Creative Studio dependencies ────────────────────────────────
  if (features.creativeStudioEnabled) {
    // MiniMax API key is required
    const minimaxKey = env.MINIMAX_API_KEY;
    if (!minimaxKey || minimaxKey.trim() === "") {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-creative-studio-minimax-missing`,
          capability: "creative-studio",
          status: "blocked",
          safeMessage: "Creative Studio is enabled but MINIMAX_API_KEY is missing.",
          remediation: "Set MINIMAX_API_KEY or disable Creative Studio.",
        }),
      );
    }

    // Storage path is required
    const storagePath = env.MSL_CREATIVE_STUDIO_STORAGE_PATH;
    if (!storagePath || storagePath.trim() === "") {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-creative-studio-storage-missing`,
          capability: "creative-studio",
          status: "degraded",
          safeMessage:
            "Creative Studio is enabled but MSL_CREATIVE_STUDIO_STORAGE_PATH is not set.",
          remediation: "Set MSL_CREATIVE_STUDIO_STORAGE_PATH for asset storage.",
        }),
      );
    }
  }

  // ── Supplier Mirror dependencies ────────────────────────────────
  if (features.supplierMirrorEnabled) {
    // Jinpeng seller ID is required
    const jinpengId = env.MSL_JINPENG_ML_SELLER_ID;
    if (!jinpengId || jinpengId.trim() === "") {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-supplier-mirror-jinpeng-missing`,
          capability: "supplier-mirror",
          status: "blocked",
          safeMessage: "Supplier Mirror is enabled but MSL_JINPENG_ML_SELLER_ID is not set.",
          remediation:
            "Set MSL_JINPENG_ML_SELLER_ID to Jinpeng's ML seller ID or disable Supplier Mirror.",
        }),
      );
    }

    // DB path is required
    const dbPath = env.MSL_SUPPLIER_MIRROR_DB_PATH;
    if (!dbPath || dbPath.trim() === "") {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-supplier-mirror-db-missing`,
          capability: "supplier-mirror",
          status: "degraded",
          safeMessage: "Supplier Mirror is enabled but MSL_SUPPLIER_MIRROR_DB_PATH is not set.",
          remediation: "Set MSL_SUPPLIER_MIRROR_DB_PATH for Supplier Mirror persistence.",
        }),
      );
    }
  }

  // ── Economic Ingestion gate ──────────────────────────────────────
  const economicIngestionEnabled = env.MSL_ECONOMIC_INGESTION_ENABLED;
  const isEconEnabled =
    economicIngestionEnabled?.trim().toLowerCase() === "true" ||
    economicIngestionEnabled?.trim() === "1";

  if (isEconEnabled) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-economic-ingestion-enabled`,
        capability: "real-economic-ingestion",
        status: "ready",
        safeMessage: "Economic ingestion is enabled and feature-gate check passed.",
        remediation: "MSL_ECONOMIC_INGESTION_ENABLED is true. Ingestion pipeline is active.",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-economic-ingestion-disabled`,
        capability: "real-economic-ingestion",
        status: "not-applicable",
        safeMessage: "Economic ingestion is disabled (MSL_ECONOMIC_INGESTION_ENABLED is not true).",
        remediation:
          "Set MSL_ECONOMIC_INGESTION_ENABLED=true to enable the economic ingestion pipeline.",
      }),
    );
  }

  // ── Chat dependencies ───────────────────────────────────────────
  const chatPath = env.MSL_CHAT_SQLITE_PATH;
  const busPath = env.MSL_AGENT_BUS_DB_PATH;
  if (!chatPath && !busPath) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-chat-db-missing`,
        capability: "web-chat",
        status: "degraded",
        safeMessage: "Neither MSL_CHAT_SQLITE_PATH nor MSL_AGENT_BUS_DB_PATH is set.",
        remediation:
          "Set at least one of MSL_CHAT_SQLITE_PATH or MSL_AGENT_BUS_DB_PATH for chat/agent persistence.",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-chat-db-present`,
        capability: "web-chat",
        status: "ready",
        safeMessage: "Chat/agent bus database path is configured.",
        remediation: "Database path is ready.",
      }),
    );
  }

  return results;
}
