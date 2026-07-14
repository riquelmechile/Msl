import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { backupDatabase } from "./backup.js";
import { closeSharedDb } from "./connectionPool.js";
import type { MigrationApplyResult, MigrationRegistry } from "./migrationRegistry.js";

// ── Types ──────────────────────────────────────────────────────────────

export type BackupVerifyResult = {
  /** Whether the backup passes integrity check. */
  ok: boolean;
  /** Error detail when `ok` is `false`. */
  error?: string;
  /** Page count of the verified backup file. */
  pages: number;
};

export type IntegrityResult = {
  /** Whether integrity check returns "ok". */
  ok: boolean;
  /** Error messages from PRAGMA integrity_check (empty when ok). */
  errors: string[];
};

export type WalCheckpointResult = {
  /** WAL pages before checkpoint. */
  pagesBefore: number;
  /** WAL pages after checkpoint. */
  pagesAfter: number;
};

export type DatabaseManager = {
  /**
   * Create a backup of the managed database to `targetPath` using
   * SQLite's online backup API. Delegates to {@link backupDatabase}.
   *
   * @returns the number of pages copied.
   */
  backup(targetPath: string): Promise<number>;

  /**
   * Verify a backup file by opening it and running
   * `PRAGMA integrity_check`.
   */
  verifyBackup(backupPath: string): BackupVerifyResult;

  /**
   * Restore the managed database from a verified backup file.
   *
   * **Atomic**: copies the backup to a staging directory under
   * `os.tmpdir()`, then uses `fs.renameSync` to replace the live
   * database file. On failure the original file is preserved.
   *
   * Requires coordination with {@link closeSharedDb} / {@link getSharedDb}
   * — the managed connection is closed before the restore and reopened
   * afterwards.
   */
  restoreFrom(backupPath: string): Promise<void>;

  /**
   * Run `PRAGMA integrity_check` on the managed database.
   */
  checkIntegrity(): IntegrityResult;

  /**
   * Run `PRAGMA wal_checkpoint(TRUNCATE)` on the managed database.
   * Returns WAL page counts before and after the checkpoint.
   */
  checkpointWAL(): WalCheckpointResult;

  /**
   * Apply pending migrations from the given registry against the
   * managed database.
   */
  migrate(registry: MigrationRegistry): MigrationApplyResult;
};

// ── No-op manager (returned when durability is disabled) ───────────────

function createNoopDatabaseManager(): DatabaseManager {
  return {
    backup(): Promise<number> {
      return Promise.resolve(0);
    },
    verifyBackup(): BackupVerifyResult {
      return { ok: true, pages: 0 };
    },
    restoreFrom(): Promise<void> {
      return Promise.resolve();
    },
    checkIntegrity(): IntegrityResult {
      return { ok: true, errors: [] };
    },
    checkpointWAL(): WalCheckpointResult {
      return { pagesBefore: 0, pagesAfter: 0 };
    },
    migrate(): MigrationApplyResult {
      return { applied: 0, skipped: 0 };
    },
  };
}

// ── Real manager ───────────────────────────────────────────────────────

/**
 * Wraps a `better-sqlite3` Database handle with durability operations.
 * Intended to be created via {@link getSharedManager} so the managed
 * database is the shared connection pool singleton for the given path.
 */
class LiveDatabaseManager implements DatabaseManager {
  /** Absolute path to the live SQLite database file. */
  private dbPath: string;
  private openDb: () => Database.Database;

  constructor(dbPath: string, openDb: () => Database.Database) {
    this.dbPath = dbPath;
    this.openDb = openDb;
  }

  backup(targetPath: string): Promise<number> {
    const db = this.openDb();
    return backupDatabase(db, targetPath);
  }

  verifyBackup(backupPath: string): BackupVerifyResult {
    if (!existsSync(backupPath)) {
      return { ok: false, error: "Backup file does not exist", pages: 0 };
    }

    let backupDb: Database.Database;
    try {
      backupDb = new Database(backupPath, { readonly: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Cannot open backup: ${message}`, pages: 0 };
    }

    try {
      const result = backupDb.pragma("integrity_check") as Array<{ integrity_check: string }>;
      const ok = result.length === 1 && result[0]!.integrity_check === "ok";

      const pages =
        (
          backupDb.prepare("SELECT page_count FROM pragma_page_count").get() as {
            page_count: number;
          }
        )?.page_count ?? 0;

      if (!ok) {
        const errors = result.map((r) => r.integrity_check).filter((s) => s !== "ok");
        return { ok: false, error: errors.join("; "), pages };
      }

      return { ok: true, pages };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Verification failed: ${message}`, pages: 0 };
    } finally {
      backupDb.close();
    }
  }

  restoreFrom(backupPath: string): Promise<void> {
    try {
      this.restoreFromSync(backupPath);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private restoreFromSync(backupPath: string): void {
    if (!existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    // 1. Verify the backup before attempting restore.
    const verification = this.verifyBackup(backupPath);
    if (!verification.ok) {
      throw new Error(`Backup verification failed: ${verification.error ?? "unknown error"}`);
    }

    // 2. Close the managed connection so the file is not locked.
    closeSharedDb();

    // 3. Copy backup to a staging file under os.tmpdir() for atomic rename.
    const stageDir = join(tmpdir(), "msl-restore");
    mkdirSync(stageDir, { recursive: true });
    const stageFile = join(stageDir, basename(this.dbPath));

    try {
      copyFileSync(backupPath, stageFile);
    } catch (err) {
      this.openDb(); // reopen before throwing
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to stage backup: ${message}`);
    }

    // 4. Atomically replace the live database with the staged backup.
    try {
      renameSync(stageFile, this.dbPath);
    } catch (err) {
      // Clean up the stage file and reopen.
      try {
        unlinkSync(stageFile);
      } catch {
        // Best effort cleanup.
      }
      this.openDb();
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Atomic restore failed: ${message}`);
    }

    // 5. Reopen the shared connection against the restored file.
    this.openDb();

    // 6. Final verification of the restored database.
    const restoredVerification = this.checkIntegrity();
    if (!restoredVerification.ok) {
      throw new Error(
        `Restored database fails integrity check: ${restoredVerification.errors.join("; ")}`,
      );
    }
  }

  checkIntegrity(): IntegrityResult {
    const db = this.openDb();
    const result = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
    const ok = result.length === 1 && result[0]!.integrity_check === "ok";
    const errors = result.map((r) => r.integrity_check).filter((s) => s !== "ok");
    return { ok, errors };
  }

  checkpointWAL(): WalCheckpointResult {
    const db = this.openDb();

    // Read WAL page count before checkpoint.
    const before = this.readWalPages(db);

    // Force a blocking checkpoint that truncates the WAL.
    db.pragma("wal_checkpoint(TRUNCATE)");

    const after = this.readWalPages(db);

    return { pagesBefore: before, pagesAfter: after };
  }

  migrate(registry: MigrationRegistry): MigrationApplyResult {
    const db = this.openDb();
    return registry.apply(db);
  }

  /**
   * Query the number of pages in the WAL file.
   * Returns 0 when the database is not in WAL mode or the WAL file
   * does not exist.
   */
  private readWalPages(db: Database.Database): number {
    try {
      const row = db.pragma("wal_checkpoint(PASSIVE)") as Array<{
        busy: number;
        log: number;
        checkpointed: number;
      }>;
      // The log column of a PASSIVE checkpoint call reports the total
      // number of frames in the WAL.
      return row[0]?.log ?? 0;
    } catch {
      return 0;
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────

/**
 * Create a `DatabaseManager` wrapping the shared connection pool for
 * the given database path.
 *
 * When `MSL_DURABILITY_ENABLED` is `"true"`, returns a fully
 * operational manager. Otherwise returns a no-op implementation that
 * performs no mutations.
 *
 * @param dbPath — absolute path to the SQLite database file.
 * @param openDb — factory that returns (or reopens) the shared
 *   `better-sqlite3` Database handle.
 */
export function createDatabaseManager(
  dbPath: string,
  openDb: () => Database.Database,
): DatabaseManager {
  if (process.env.MSL_DURABILITY_ENABLED === "true") {
    return new LiveDatabaseManager(dbPath, openDb);
  }
  return createNoopDatabaseManager();
}
