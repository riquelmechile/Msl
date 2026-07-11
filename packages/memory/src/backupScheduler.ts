import { statSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { DatabaseManager } from "./databaseManager.js";

// ── Types ──────────────────────────────────────────────────────────────

/**
 * Describes one managed database for the scheduler.
 *
 * The scheduler uses `manager` for all durability operations. The `dbPath`
 * is the live database file path and `dbType` identifies the database
 * kind — entries with `dbType === "oauth"` are excluded from automated
 * cycles as required by sqlite-durability spec.
 */
export interface DbEntry {
  manager: DatabaseManager;
  /** Absolute path to the live SQLite database file. */
  dbPath: string;
  /**
   * Human-readable database kind.
   * When `"oauth"` the entry is excluded from automated backup / WAL /
   * integrity cycles.
   */
  dbType: string;
}

export interface BackupSchedulerConfig {
  /** Managed databases to schedule. OAuth entries are skipped. */
  entries: DbEntry[];
  /** Directory where backup files are written. Created if absent. */
  backupDir: string;
  /** Backup interval in ms (default: 24 h). */
  backupIntervalMs?: number;
  /** How many days to keep backups (default: 7). */
  retentionDays?: number;
  /** Maximum allowed age of the last verified backup before it is
   *  considered stale (default: 48 h = 172 800 000 ms). */
  freshnessWindowMs?: number;
  /** WAL checkpoint interval in ms (default: 1 h). */
  walCheckpointIntervalMs?: number;
  /** WAL size threshold in bytes that forces an immediate checkpoint
   *  regardless of interval (default: 200 MB). */
  walSizeThresholdBytes?: number;
  /** Integrity check interval in ms (default: 6 h). */
  integrityCheckIntervalMs?: number;
}

/**
 * Lightweight metadata persisted for each managed database's most
 * recent backup. Written to `<backupDir>/_metadata.json`.
 */
export interface BackupMetadata {
  /** The dbType from the DbEntry. */
  dbName: string;
  /** ISO-8601 timestamp of the last successful backup. */
  lastBackupAt: string;
  /** ISO-8601 timestamp of the last successful verification. */
  lastVerifiedAt: string | null;
  /** Backup status. `"verified"` when the last verification passed. */
  status: "verified" | "failed" | "pending";
  /** Page count from the last verified backup. */
  pageCount: number;
  /** Absolute path to the most recent backup file. */
  backupPath: string | null;
}

// ── Defaults ────────────────────────────────────────────────────────────

const DEFAULT_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h
const DEFAULT_WAL_CHECKPOINT_INTERVAL_MS = 60 * 60 * 1000; // 1h
const DEFAULT_WAL_SIZE_THRESHOLD = 200 * 1024 * 1024; // 200 MB
const DEFAULT_INTEGRITY_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

// ── BackupScheduler ─────────────────────────────────────────────────────

/**
 * Coordinates scheduled backup, WAL checkpointing, integrity checking,
 * and retention for every managed SQLite database (except OAuth).
 *
 * All operations are gated behind `MSL_DURABILITY_ENABLED`. The
 * scheduler does **not** start automatically — callers must invoke
 * `start()` and `stop()` explicitly.
 */
export class BackupScheduler {
  private config: Required<BackupSchedulerConfig>;
  private backupTimer: ReturnType<typeof setInterval> | null = null;
  private walTimer: ReturnType<typeof setInterval> | null = null;
  private integrityTimer: ReturnType<typeof setInterval> | null = null;
  private metadataPath: string;

  constructor(config: BackupSchedulerConfig) {
    this.config = {
      backupIntervalMs: DEFAULT_BACKUP_INTERVAL_MS,
      retentionDays: DEFAULT_RETENTION_DAYS,
      freshnessWindowMs: DEFAULT_FRESHNESS_WINDOW_MS,
      walCheckpointIntervalMs: DEFAULT_WAL_CHECKPOINT_INTERVAL_MS,
      walSizeThresholdBytes: DEFAULT_WAL_SIZE_THRESHOLD,
      integrityCheckIntervalMs: DEFAULT_INTEGRITY_CHECK_INTERVAL_MS,
      ...config,
    };
    this.metadataPath = join(this.config.backupDir, "_metadata.json");
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  /**
   * Start all scheduled operations. No-op when durability is disabled
   * or the scheduler is already running.
   */
  start(): void {
    if (process.env.MSL_DURABILITY_ENABLED !== "true") return;
    if (this.backupTimer !== null) return; // already running

    const active = this.activeEntries();
    if (active.length === 0) return;

    mkdirSync(this.config.backupDir, { recursive: true });

    this.backupTimer = setInterval(() => {
      this.runBackupCycle().catch((err) => {
        console.error("[BackupScheduler] Backup cycle failed:", err);
      });
    }, this.config.backupIntervalMs);

    this.walTimer = setInterval(() => {
      this.runWalCheckpoint().catch((err) => {
        console.error("[BackupScheduler] WAL checkpoint cycle failed:", err);
      });
    }, this.config.walCheckpointIntervalMs);

    this.integrityTimer = setInterval(() => {
      this.runIntegrityCheck().catch((err) => {
        console.error("[BackupScheduler] Integrity check cycle failed:", err);
      });
    }, this.config.integrityCheckIntervalMs);
  }

  /** Stop all scheduled operations. Safe to call multiple times. */
  stop(): void {
    if (this.backupTimer !== null) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
    }
    if (this.walTimer !== null) {
      clearInterval(this.walTimer);
      this.walTimer = null;
    }
    if (this.integrityTimer !== null) {
      clearInterval(this.integrityTimer);
      this.integrityTimer = null;
    }
  }

  // ── Public (for testing & manual invocation) ───────────────────────

  /** Return entries excluding the OAuth token database. */
  activeEntries(): DbEntry[] {
    return this.config.entries.filter(
      (e) => e.dbType !== "oauth",
    );
  }

  /** Run a full backup cycle immediately (bypasses the timer). */
  async runBackupCycle(): Promise<void> {
    const entries = this.activeEntries();
    if (entries.length === 0) return;

    const metadata = this.readMetadata();
    const ts = new Date().toISOString();

    for (const entry of entries) {
      const dbName = entry.dbType;
      const backupFile = join(
        this.config.backupDir,
        `${dbName}-${Date.now()}.sqlite`,
      );

      try {
        mkdirSync(this.config.backupDir, { recursive: true });
        const pageCount = await entry.manager.backup(backupFile);

        // Verify the freshly written backup.
        const verification = entry.manager.verifyBackup(backupFile);

        const existing = metadata.find((m) => m.dbName === dbName);
        const record: BackupMetadata = {
          dbName,
          lastBackupAt: ts,
          lastVerifiedAt: verification.ok ? ts : (existing?.lastVerifiedAt ?? null),
          status: verification.ok ? "verified" : "failed",
          pageCount: verification.ok ? verification.pages : (existing?.pageCount ?? 0),
          backupPath: verification.ok ? backupFile : (existing?.backupPath ?? null),
        };

        if (!verification.ok) {
          console.error(
            `[BackupScheduler] Backup verification failed for ${dbName}: ${verification.error}`,
          );
          // Discard the corrupted backup file.
          try { unlinkSync(backupFile); } catch { /* best effort */ }
        }

        // Replace or append metadata record.
        const idx = metadata.findIndex((m) => m.dbName === dbName);
        if (idx >= 0) metadata[idx] = record;
        else metadata.push(record);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[BackupScheduler] Backup failed for ${dbName}: ${message}`);

        const existing = metadata.find((m) => m.dbName === dbName);
        if (existing) {
          existing.status = "failed";
          existing.backupPath = null;
        } else {
          metadata.push({
            dbName,
            lastBackupAt: ts,
            lastVerifiedAt: null,
            status: "failed",
            pageCount: 0,
            backupPath: null,
          });
        }
      }
    }

    this.writeMetadata(metadata);
    this.enforceRetention();
  }

  /** Run a WAL checkpoint cycle immediately. */
  async runWalCheckpoint(): Promise<void> {
    const entries = this.activeEntries();
    for (const entry of entries) {
      try {
        // Check WAL file size.
        const walPath = entry.dbPath + "-wal";
        let walSize = 0;
        try {
          walSize = statSync(walPath).size;
        } catch {
          // WAL file does not exist — nothing to checkpoint.
          continue;
        }

        // Force immediate checkpoint when WAL exceeds threshold.
        if (walSize > this.config.walSizeThresholdBytes) {
          console.warn(
            `[BackupScheduler] WAL file for ${entry.dbType} is ${(walSize / 1024 / 1024).toFixed(1)} MB — forcing checkpoint`,
          );
          entry.manager.checkpointWAL();
          continue;
        }

        // Regular periodic checkpoint.
        entry.manager.checkpointWAL();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[BackupScheduler] WAL checkpoint failed for ${entry.dbType}: ${message}`);
      }
    }
  }

  /** Run an integrity check cycle immediately. */
  async runIntegrityCheck(): Promise<void> {
    const entries = this.activeEntries();
    for (const entry of entries) {
      try {
        const result = entry.manager.checkIntegrity();
        if (!result.ok) {
          console.error(
            `[BackupScheduler] Integrity check FAILED for ${entry.dbType}: ${result.errors.join("; ")}`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[BackupScheduler] Integrity check error for ${entry.dbType}: ${message}`);
      }
    }
  }

  /** Enforce the retention policy — delete backup files older than the
   *  configured window. The most recent verified backup is always kept. */
  enforceRetention(): void {
    const metadata = this.readMetadata();
    const cutoffMs = this.config.retentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - cutoffMs;

    // Collect verified backup paths to protect.
    const protectedPaths = new Set(
      metadata
        .filter((m) => m.status === "verified" && m.backupPath)
        .map((m) => m.backupPath!),
    );

    try {
      const files = readdirSync(this.config.backupDir);
      for (const file of files) {
        if (file.startsWith("_")) continue; // skip metadata files
        const fullPath = join(this.config.backupDir, file);

        let mtimeMs: number;
        try {
          mtimeMs = statSync(fullPath).mtimeMs;
        } catch {
          continue;
        }

        if (Date.now() - mtimeMs > cutoffMs && !protectedPaths.has(fullPath)) {
          try {
            unlinkSync(fullPath);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[BackupScheduler] Failed to delete old backup ${file}: ${message}`);
          }
        }
      }
    } catch {
      // Backup directory may not exist yet.
    }
  }

  // ── Metadata persistence ───────────────────────────────────────────

  /** Read backup metadata from the JSON file. Returns empty array when
   *  the file does not exist or is unparseable. */
  readMetadata(): BackupMetadata[] {
    try {
      if (!existsSync(this.metadataPath)) return [];
      const raw = readFileSync(this.metadataPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed as BackupMetadata[];
    } catch {
      return [];
    }
  }

  /** Persist backup metadata to the JSON file atomically. */
  private writeMetadata(metadata: BackupMetadata[]): void {
    try {
      mkdirSync(this.config.backupDir, { recursive: true });
      writeFileSync(this.metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[BackupScheduler] Failed to write backup metadata: ${message}`);
    }
  }

  /**
   * Check whether a database's last verified backup is within the
   * freshness window. Used by the health daemon for backup freshness
   * checks.
   *
   * @returns `true` when the backup is fresh (or no metadata exists),
   *   `false` when stale.
   */
  isBackupFresh(dbName: string): boolean {
    const metadata = this.readMetadata();
    const record = metadata.find((m) => m.dbName === dbName);
    if (!record || record.lastVerifiedAt === null) return false;

    const lastVerified = new Date(record.lastVerifiedAt).getTime();
    return Date.now() - lastVerified <= this.config.freshnessWindowMs;
  }

  /**
   * Return the last verified timestamp for a database, or `null` if
   * no verified backup exists.
   */
  lastVerifiedAt(dbName: string): string | null {
    const metadata = this.readMetadata();
    const record = metadata.find((m) => m.dbName === dbName);
    return record?.lastVerifiedAt ?? null;
  }
}

// ── Factory ─────────────────────────────────────────────────────────────

/**
 * Create a `BackupScheduler` with sensible defaults.
 *
 * When `MSL_DURABILITY_ENABLED` is not `"true"` the returned scheduler
 * will still be valid but `start()` will be a no-op — all durability
 * operations are gated at the scheduler level.
 */
export function createBackupScheduler(config: BackupSchedulerConfig): BackupScheduler {
  return new BackupScheduler(config);
}
