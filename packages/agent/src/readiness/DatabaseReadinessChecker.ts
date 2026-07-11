import { createReadinessCheckResult } from "./types.js";
import type { ReadinessCheckResult } from "./types.js";
import type { ReadinessContext } from "./types.js";
import { writeFileSync, unlinkSync, accessSync, constants } from "node:fs";
import * as path from "node:path";

const CHECK_PREFIX = "db";

/**
 * List of SQLite-related env vars to check.
 * Each entry maps to a production capability.
 */
const SQLITE_PATH_VARS: { name: string; capability: string }[] = [
  { name: "MSL_APPROVAL_QUEUE_DB_PATH", capability: "mcp-server" },
  { name: "MSL_CHAT_SQLITE_PATH", capability: "web-chat" },
  { name: "MSL_AGENT_BUS_DB_PATH", capability: "web-chat" },
  { name: "MSL_CORTEX_SQLITE_PATH", capability: "economic-truth" },
  { name: "MSL_MERCADOLIBRE_OAUTH_DB_PATH", capability: "mercadolibre-read-plasticov" },
  { name: "MSL_TELEGRAM_SQLITE_PATH", capability: "telegram-ceo" },
  { name: "MSL_TELEGRAM_CORTEX_SQLITE_PATH", capability: "telegram-ceo" },
  { name: "MSL_SUPPLIER_MIRROR_DB_PATH", capability: "supplier-mirror" },
  { name: "MSL_CREATIVE_STUDIO_DB_PATH", capability: "creative-studio" },
];

export function checkDatabaseReadiness(ctx: ReadinessContext): ReadinessCheckResult[] {
  const results: ReadinessCheckResult[] = [];
  const { env, runtimeMode } = ctx;
  const isProduction = runtimeMode === "production";

  for (const { name, capability } of SQLITE_PATH_VARS) {
    const dbPath = env[name];

    if (!dbPath || dbPath.trim() === "") {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}`,
          capability: capability as ReadinessCheckResult["capability"],
          status: "not-applicable",
          safeMessage: `${name} is not set — skipping database check.`,
          remediation: `Set ${name} to enable this database.`,
        }),
      );
      continue;
    }

    const trimmedPath = dbPath.trim();

    // ── :memory: in production is blocked ─────────────────────────
    if (trimmedPath === ":memory:") {
      if (isProduction) {
        results.push(
          createReadinessCheckResult({
            checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}-memory`,
            capability: capability as ReadinessCheckResult["capability"],
            status: "blocked",
            safeMessage: `${name} is ":memory:" — in-memory databases are not allowed in production.`,
            remediation: `Set ${name} to a file path for durable storage.`,
          }),
        );
      } else {
        results.push(
          createReadinessCheckResult({
            checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}-memory`,
            capability: capability as ReadinessCheckResult["capability"],
            status: "ready",
            safeMessage: `${name} is ":memory:" — acceptable in development mode.`,
            remediation: "In-memory database is fine for dev. Switch to a file path for production.",
          }),
        );
      }
      continue;
    }

    // ── Test paths in production are blocked ──────────────────────
    if (isProduction && /test|mock|fake/i.test(trimmedPath)) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}-test-path`,
          capability: capability as ReadinessCheckResult["capability"],
          status: "blocked",
          safeMessage: `${name} appears to point to a test path — not allowed in production.`,
          remediation: `Set ${name} to a real file path for production.`,
        }),
      );
      continue;
    }

    // ── Parent directory check ────────────────────────────────────
    const dirPath = path.dirname(trimmedPath);

    let parentExists = false;
    let parentWritable = false;
    try {
      accessSync(dirPath, constants.F_OK);
      parentExists = true;
    } catch {
      // Directory does not exist
    }

    if (!parentExists) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}-parent-dir`,
          capability: capability as ReadinessCheckResult["capability"],
          status: "degraded",
          safeMessage: `Parent directory for ${name} does not exist.`,
          remediation: `Create the directory for ${name} before starting MSL.`,
        }),
      );
      continue;
    }

    // ── Write permission check (create temp file) ─────────────────
    try {
      const testFile = path.join(dirPath, `.msl-readiness-test-${Date.now().toString(36)}.tmp`);
      writeFileSync(testFile, "readiness-check", { encoding: "utf-8" });
      unlinkSync(testFile);
      parentWritable = true;
    } catch {
      parentWritable = false;
    }

    if (parentWritable) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}`,
          capability: capability as ReadinessCheckResult["capability"],
          status: "ready",
          safeMessage: `${name} is configured and the parent directory is accessible and writable.`,
          remediation: "Database path is ready.",
        }),
      );
    } else {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}"`,
          capability: capability as ReadinessCheckResult["capability"],
          status: "blocked",
          safeMessage: `${name}: parent directory exists but is not writable.`,
          remediation: `Ensure the process has write permission to the directory for ${name}.`,
        }),
      );
    }
  }

  // ── Shared path cross-seller conflict detection ─────────────────
  const chatPath = env.MSL_CHAT_SQLITE_PATH?.trim();
  const busPath = env.MSL_AGENT_BUS_DB_PATH?.trim();
  const teleCortexPath = env.MSL_TELEGRAM_CORTEX_SQLITE_PATH?.trim();
  const cortexPath = env.MSL_CORTEX_SQLITE_PATH?.trim();

  // Check that chat and agent bus paths are not identical (if both are set)
  if (chatPath && busPath && chatPath === busPath) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-chat-bus-conflict`,
        capability: "web-chat",
        status: "blocked",
        safeMessage: "MSL_CHAT_SQLITE_PATH and MSL_AGENT_BUS_DB_PATH point to the same file.",
        remediation: "Use different paths for chat and agent bus databases.",
      }),
    );
  }

  // Check that telegram and cortex are not the same
  if (teleCortexPath && cortexPath && teleCortexPath === cortexPath) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-telegram-cortex-conflict`,
        capability: "telegram-ceo",
        status: "degraded",
        safeMessage: "MSL_TELEGRAM_CORTEX_SQLITE_PATH and MSL_CORTEX_SQLITE_PATH point to the same file.",
        remediation: "Use different paths for Telegram Cortex and shared Cortex databases.",
      }),
    );
  }

  return results;
}
