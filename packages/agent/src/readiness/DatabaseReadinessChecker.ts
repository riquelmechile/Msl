import { createReadinessCheckResult } from "./types.js";
import type { ReadinessCheckResult } from "./types.js";
import type { ReadinessContext } from "./types.js";
import { writeFileSync, unlinkSync, accessSync, constants, statSync, existsSync } from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";

const CHECK_PREFIX = "db";

/**
 * WAL file size threshold in bytes (200 MB). When a database WAL file
 * exceeds this size at startup, the `wal-health` capability is reported
 * as `degraded`.
 */
const WAL_SIZE_THRESHOLD = 200 * 1024 * 1024; // 200 MB

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

  // Collect DB paths that exist on disk and pass the parent-directory
  // check. These are candidates for integrity and WAL checks.
  const validatedPaths: Array<{ name: string; dbPath: string; capability: string }> = [];

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
      accessSync(dirPath, constants.F_OK | constants.R_OK);
      parentExists = true;
    } catch {
      // Directory does not exist or is not readable
    }

    if (!parentExists) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}-parent-dir`,
          capability: capability as ReadinessCheckResult["capability"],
          status: "degraded",
          safeMessage: `Parent directory for ${name} does not exist or is not readable.`,
          remediation: `Create the directory for ${name} before starting MSL.`,
        }),
      );
      continue;
    }

    // ── Write permission check (create temp file) ─────────────────
    try {
      const testFile = path.join(
        dirPath,
        `.msl-readiness-test-${Date.now().toString(36)}.tmp`,
      );
      writeFileSync(testFile, "readiness-check", { encoding: "utf-8" });
      try {
        unlinkSync(testFile);
      } catch {
        // Best-effort cleanup — file may be left behind but is harmless
      }
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

      // Collect for integrity / WAL checks below.
      validatedPaths.push({ name, dbPath: trimmedPath, capability });
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

  // ── Database integrity checks (PRAGMA integrity_check) ────────────
  // Only run on validated paths where the database file already exists
  // on disk. A missing database file in a writable directory is not
  // a problem — it will be created on first use.
  if (validatedPaths.length > 0) {
    runIntegrityChecks(results, validatedPaths);
    runWalHealthChecks(results, validatedPaths);
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

// ── Internal helpers: integrity & WAL checks ──────────────────────────

interface ValidatedPath {
  name: string;
  dbPath: string;
  capability: string;
}

/**
 * Run `PRAGMA integrity_check` on every validated database that exists
 * on disk. A missing database file is expected at first startup and is
 * not flagged. A failing integrity check degrades the `database-integrity`
 * feature capability.
 */
function runIntegrityChecks(
  results: ReadinessCheckResult[],
  paths: ValidatedPath[],
): void {
  for (const { name, dbPath, capability } of paths) {
    // Skip when the database file does not exist yet (first startup).
    if (!existsSync(dbPath)) continue;

    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        const integrityResult = db.pragma("integrity_check") as Array<{
          integrity_check: string;
        }>;
        const ok = integrityResult.length === 1 && integrityResult[0]!.integrity_check === "ok";

        if (ok) {
          results.push(
            createReadinessCheckResult({
              checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}-integrity`,
              capability: capability as ReadinessCheckResult["capability"],
              status: "ready",
              safeMessage: `${name} integrity: ok`,
              remediation: "Database integrity check passed.",
            }),
          );
        } else {
          const errors = integrityResult
            .map((r) => r.integrity_check)
            .filter((s) => s !== "ok");
          results.push(
            createReadinessCheckResult({
              checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}-integrity`,
              capability: capability as ReadinessCheckResult["capability"],
              status: "degraded",
              safeMessage: `${name} integrity FAILED: ${errors.join("; ")}`,
              remediation: "Run PRAGMA integrity_check manually and consider restoring from backup.",
            }),
          );
        }
      } finally {
        db.close();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}-integrity`,
          capability: capability as ReadinessCheckResult["capability"],
          status: "degraded",
          safeMessage: `${name} integrity check failed to run: ${message}`,
          remediation: "Ensure the database file is readable and not locked.",
        }),
      );
    }
  }
}

/**
 * Check WAL file size for every validated database. A WAL file exceeding
 * 200 MB degrades the `wal-health` feature capability.
 */
function runWalHealthChecks(
  results: ReadinessCheckResult[],
  paths: ValidatedPath[],
): void {
  for (const { name, dbPath, capability } of paths) {
    const walPath = dbPath + "-wal";

    if (!existsSync(walPath)) {
      // No WAL file — database is either not in WAL mode or was cleanly
      // shut down. Not a concern.
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}-wal`,
          capability: capability as ReadinessCheckResult["capability"],
          status: "ready",
          safeMessage: `${name} WAL: no WAL file (clean shutdown or journal mode)`,
          remediation: "No action needed.",
        }),
      );
      continue;
    }

    try {
      const walSize = statSync(walPath).size;
      if (walSize > WAL_SIZE_THRESHOLD) {
        results.push(
          createReadinessCheckResult({
            checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}-wal`,
            capability: capability as ReadinessCheckResult["capability"],
            status: "degraded",
            safeMessage: `${name} WAL: ${(walSize / 1024 / 1024).toFixed(1)} MB (exceeds ${WAL_SIZE_THRESHOLD / 1024 / 1024} MB threshold)`,
            remediation: `Run PRAGMA wal_checkpoint(TRUNCATE) on ${name} to compact the WAL file.`,
          }),
        );
      } else {
        results.push(
          createReadinessCheckResult({
            checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}-wal`,
            capability: capability as ReadinessCheckResult["capability"],
            status: "ready",
            safeMessage: `${name} WAL: ${(walSize / 1024 / 1024).toFixed(1)} MB`,
            remediation: "WAL file size is within acceptable limits.",
          }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-${name.toLowerCase().replace(/_/g, "-")}-wal`,
          capability: capability as ReadinessCheckResult["capability"],
          status: "degraded",
          safeMessage: `${name} WAL check failed: ${message}`,
          remediation: "Ensure the WAL file is readable.",
        }),
      );
    }
  }
}
