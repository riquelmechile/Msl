import type { GraphEngine, DatabaseManager, MigrationRegistry } from "@msl/memory";
import type { AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";
import Database from "better-sqlite3";
import { statSync, existsSync } from "node:fs";

export type SystemHealthCheck = {
  ok: boolean;
  checks: { name: string; status: "ok" | "warning" | "critical"; detail: string }[];
};

/**
 * Describes a managed database for health-check purposes.
 */
export interface HealthDbEntry {
  manager: DatabaseManager;
  /** Human-readable name for the database (e.g. "cortex", "bus"). */
  name: string;
  /** Absolute path to the live SQLite database file. */
  dbPath: string;
  /** Optional migration registry to compare schema version against. */
  migrationRegistry?: MigrationRegistry;
}

/**
 * A callback that returns whether a database's backup is fresh.
 * Receives the database name and returns `true` when the last
 * verified backup is within the freshness window.
 */
export type BackupFreshnessChecker = (dbName: string) => boolean;

/**
 * Run a system health check across the agent message bus, Cortex,
 * and optionally managed SQLite databases (when durability is enabled).
 *
 * Checks:
 * 1. Message bus backlog (pending messages)
 * 2. Failed messages (DLQ)
 * 3. Cortex node count (approximate)
 * 4. DB integrity (per managed database) — only when `dbEntries` is provided
 * 5. WAL status (file size) — only when `dbEntries` is provided
 * 6. Migration version — only when `dbEntries` is provided
 * 7. Backup freshness — only when `backupFreshness` checker is provided
 *
 * Returns a summary of all checks and an overall `ok` status.
 */
export function runSystemHealthCheck(
  bus: AgentMessageBusStore,
  cortex: GraphEngine,
  dbEntries?: HealthDbEntry[],
  backupFreshness?: BackupFreshnessChecker,
): SystemHealthCheck {
  const checks: SystemHealthCheck["checks"] = [];

  // 1. Check message bus backlog
  try {
    const pendingCount = bus.getPendingCount?.() ?? 0;
    if (pendingCount > 100) {
      checks.push({
        name: "bus-backlog",
        status: "critical",
        detail: `${pendingCount} pending messages`,
      });
    } else if (pendingCount > 20) {
      checks.push({
        name: "bus-backlog",
        status: "warning",
        detail: `${pendingCount} pending messages`,
      });
    } else {
      checks.push({ name: "bus-backlog", status: "ok", detail: `${pendingCount} pending` });
    }
  } catch (e) {
    checks.push({
      name: "bus-backlog",
      status: "warning",
      detail: `could not check: ${String(e)}`,
    });
  }

  // 2. Check failed messages
  try {
    const failed = bus.getFailedMessages?.(100) ?? [];
    if (failed.length > 0) {
      checks.push({
        name: "bus-failed",
        status: "warning",
        detail: `${failed.length} failed messages`,
      });
    } else {
      checks.push({ name: "bus-failed", status: "ok", detail: "0 failed" });
    }
  } catch (e) {
    checks.push({ name: "bus-failed", status: "warning", detail: `could not check: ${String(e)}` });
  }

  // 3. Check Cortex node count (approximate via queryByMetadata)
  try {
    const nodes = cortex.queryByMetadata({});
    if (nodes.length > 100000) {
      checks.push({
        name: "cortex-size",
        status: "warning",
        detail: `${nodes.length}+ nodes — consider pruning`,
      });
    } else {
      checks.push({ name: "cortex-size", status: "ok", detail: `${nodes.length}+ nodes` });
    }
  } catch (e) {
    checks.push({
      name: "cortex-size",
      status: "warning",
      detail: `could not check: ${String(e)}`,
    });
  }

  // 4–7. DB durability health checks (only when dbEntries provided)
  if (dbEntries && dbEntries.length > 0) {
    runDbHealthChecks(checks, dbEntries, backupFreshness);
  }

  const ok = checks.every((c) => c.status === "ok");
  return { ok, checks };
}

// ── Internal: DB health checks ──────────────────────────────────────────

const WAL_SIZE_THRESHOLD = 200 * 1024 * 1024; // 200 MB

function runDbHealthChecks(
  checks: SystemHealthCheck["checks"],
  entries: HealthDbEntry[],
  backupFreshness?: BackupFreshnessChecker,
): void {
  // 4. DB integrity check
  for (const entry of entries) {
    try {
      const result = entry.manager.checkIntegrity();
      if (result.ok) {
        checks.push({
          name: `db-integrity-${entry.name}`,
          status: "ok",
          detail: `${entry.name} integrity: ok`,
        });
      } else {
        checks.push({
          name: `db-integrity-${entry.name}`,
          status: "critical",
          detail: `${entry.name} integrity FAILED: ${result.errors.join("; ")}`,
        });
      }
    } catch (e) {
      checks.push({
        name: `db-integrity-${entry.name}`,
        status: "warning",
        detail: `${entry.name} integrity check error: ${String(e)}`,
      });
    }
  }

  // 5. WAL status check
  for (const entry of entries) {
    try {
      const walPath = entry.dbPath + "-wal";
      if (existsSync(walPath)) {
        const walSize = statSync(walPath).size;
        if (walSize > WAL_SIZE_THRESHOLD) {
          checks.push({
            name: `wal-status-${entry.name}`,
            status: "warning",
            detail: `${entry.name} WAL: ${(walSize / 1024 / 1024).toFixed(1)} MB (exceeds ${WAL_SIZE_THRESHOLD / 1024 / 1024} MB threshold)`,
          });
        } else {
          checks.push({
            name: `wal-status-${entry.name}`,
            status: "ok",
            detail: `${entry.name} WAL: ${(walSize / 1024 / 1024).toFixed(1)} MB`,
          });
        }
      } else {
        checks.push({
          name: `wal-status-${entry.name}`,
          status: "ok",
          detail: `${entry.name} WAL: no WAL file`,
        });
      }
    } catch (e) {
      checks.push({
        name: `wal-status-${entry.name}`,
        status: "warning",
        detail: `${entry.name} WAL check error: ${String(e)}`,
      });
    }
  }

  // 6. Migration version check
  for (const entry of entries) {
    if (!entry.migrationRegistry) continue;
    try {
      const expected = entry.migrationRegistry.expectedVersion();
      // The DatabaseManager manages a shared DB, so we open the managed
      // connection and query schema_version through a temporary read-only
      // connection — a non-mutating operation.
      let current = 0;
      let backupDb: Database.Database | null = null;
      try {
        backupDb = new Database(entry.dbPath, { readonly: true });
        const row = backupDb
          .prepare("SELECT MAX(version) as v FROM schema_version")
          .get() as { v: number | null } | undefined;
        current = row?.v ?? 0;
      } finally {
        backupDb?.close();
      }

      if (current === expected) {
        checks.push({
          name: `migration-version-${entry.name}`,
          status: "ok",
          detail: `${entry.name} schema v${current} (expected v${expected})`,
        });
      } else {
        checks.push({
          name: `migration-version-${entry.name}`,
          status: "warning",
          detail: `${entry.name} schema v${current} outdated — expected v${expected}`,
        });
      }
    } catch (e) {
      checks.push({
        name: `migration-version-${entry.name}`,
        status: "warning",
        detail: `${entry.name} migration version check error: ${String(e)}`,
      });
    }
  }

  // 7. Backup freshness check
  if (backupFreshness) {
    for (const entry of entries) {
      try {
        const fresh = backupFreshness(entry.name);
        if (fresh) {
          checks.push({
            name: `backup-freshness-${entry.name}`,
            status: "ok",
            detail: `${entry.name} backup: fresh`,
          });
        } else {
          checks.push({
            name: `backup-freshness-${entry.name}`,
            status: "warning",
            detail: `${entry.name} backup: stale (last verified outside freshness window)`,
          });
        }
      } catch (e) {
        checks.push({
          name: `backup-freshness-${entry.name}`,
          status: "warning",
          detail: `${entry.name} backup freshness check error: ${String(e)}`,
        });
      }
    }
  }
}
