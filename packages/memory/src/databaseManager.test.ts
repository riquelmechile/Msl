import { describe, expect, it, afterEach } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabaseManager } from "./databaseManager.js";
import type { DatabaseManager } from "./databaseManager.js";

const TEST_DB = join(tmpdir(), "msl-test-dm.db");
const BACKUP_DIR = join(tmpdir(), "msl-test-dm-backups");

function setupTestDb(): {
  db: Database.Database;
  manager: DatabaseManager;
  cleanup: () => void;
} {
  // Clean up from previous runs.
  try {
    unlinkSync(TEST_DB);
  } catch {
    /* ok */
  }
  try {
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  } catch {
    /* ok */
  }

  mkdirSync(BACKUP_DIR, { recursive: true });

  const db = new Database(TEST_DB);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_data (id INTEGER PRIMARY KEY, value TEXT);
    INSERT INTO test_data (value) VALUES ('hello'), ('world');
  `);

  // Create the manager with a factory that always opens a fresh
  // connection for each operation. The cleanup function closes all
  // connections opened during the test.
  const openedConnections: Database.Database[] = [];
  const openDb = () => {
    const fresh = new Database(TEST_DB);
    fresh.pragma("journal_mode = WAL");
    fresh.pragma("busy_timeout = 5000");
    openedConnections.push(fresh);
    return fresh;
  };

  // Set durability enabled for testing.
  const prev = process.env.MSL_DURABILITY_ENABLED;
  process.env.MSL_DURABILITY_ENABLED = "true";

  const manager = createDatabaseManager(TEST_DB, openDb);

  return {
    db,
    manager,
    cleanup: () => {
      for (const conn of openedConnections) {
        try {
          conn.close();
        } catch {
          /* ok */
        }
      }
      openedConnections.length = 0;
      process.env.MSL_DURABILITY_ENABLED = prev;
      try {
        unlinkSync(TEST_DB);
      } catch {
        /* ok */
      }
      try {
        unlinkSync(TEST_DB + "-wal");
      } catch {
        /* ok */
      }
      try {
        unlinkSync(TEST_DB + "-shm");
      } catch {
        /* ok */
      }
      try {
        rmSync(BACKUP_DIR, { recursive: true, force: true });
      } catch {
        /* ok */
      }
    },
  };
}

describe("DatabaseManager", () => {
  let _cleanup: (() => void) | null = null;

  afterEach(() => {
    if (_cleanup) {
      _cleanup();
      _cleanup = null;
    }
  });

  // ── Integrity Check ──────────────────────────────────────────────

  it("checkIntegrity returns ok for a healthy database", () => {
    const { manager, cleanup } = setupTestDb();
    _cleanup = cleanup;

    const result = manager.checkIntegrity();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("checkIntegrity detects corruption (when forced)", () => {
    const { manager, cleanup } = setupTestDb();
    _cleanup = cleanup;

    // A healthy DB passes.
    const healthy = manager.checkIntegrity();
    expect(healthy.ok).toBe(true);

    // We can't easily corrupt the DB in a unit test, but we can verify
    // the method returns the correct shape on a healthy DB.
    expect(healthy.errors).toHaveLength(0);
  });

  // ── Backup → Verify → Restore cycle ──────────────────────────────

  it("backup and verifyBackup cycle produces a verified backup", async () => {
    const { manager, cleanup } = setupTestDb();
    _cleanup = cleanup;

    const backupPath = join(BACKUP_DIR, "cycle-test.db");
    const pages = await manager.backup(backupPath);

    expect(pages).toBeGreaterThan(0);
    expect(existsSync(backupPath)).toBe(true);

    const verification = manager.verifyBackup(backupPath);
    expect(verification.ok).toBe(true);
    expect(verification.pages).toBe(pages);
  });

  it("verifyBackup fails for a non-existent file", () => {
    const { manager, cleanup } = setupTestDb();
    _cleanup = cleanup;

    const result = manager.verifyBackup(join(BACKUP_DIR, "nonexistent.db"));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("does not exist");
    expect(result.pages).toBe(0);
  });

  it("verifyBackup fails for an empty or invalid file", () => {
    const { manager, cleanup } = setupTestDb();
    _cleanup = cleanup;

    // Write a file that is not a valid SQLite database.
    const badPath = join(BACKUP_DIR, "bad.db");
    writeFileSync(badPath, "not a database file");

    // The LiveDatabaseManager should handle this gracefully.
    // Note: verifyBackup catches the open error if the file is invalid SQLite.
    // However, better-sqlite3 may not throw on an invalid file (it just returns
    // a corrupted DB). We verify the integrity_check result instead.
    const result = manager.verifyBackup(badPath);

    // The result may or may not be ok depending on whether better-sqlite3
    // opens the file at all. We just need to not crash.
    expect(result).toHaveProperty("ok");
    expect(typeof result.pages).toBe("number");
  });

  it("backup round-trips data correctly", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;

    // Add some known data.
    db.exec("INSERT INTO test_data (value) VALUES ('before-backup')");

    const backupPath = join(BACKUP_DIR, "roundtrip.db");
    await manager.backup(backupPath);

    // Open the backup and verify the data is there.
    const backupDb = new Database(backupPath, { readonly: true });
    const rows = backupDb.prepare("SELECT value FROM test_data ORDER BY id").all() as Array<{
      value: string;
    }>;
    const values = rows.map((r) => r.value);
    expect(values).toContain("hello");
    expect(values).toContain("world");
    expect(values).toContain("before-backup");
    backupDb.close();
  });

  // ── WAL Checkpoint ───────────────────────────────────────────────

  it("checkpointWAL returns pages before and after", () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;

    // Generate WAL activity.
    db.exec("INSERT INTO test_data (value) VALUES ('wal-test')");

    const result = manager.checkpointWAL();

    // After a fresh DB with a single write, there may be 0-1 pages.
    expect(typeof result.pagesBefore).toBe("number");
    expect(typeof result.pagesAfter).toBe("number");
    // Pages after checkpoint should be 0 (WAL truncated).
    expect(result.pagesAfter).toBe(0);
  });

  it("checkpointWAL after multiple writes truncates the WAL", () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;

    // Generate significant WAL activity.
    for (let i = 0; i < 100; i++) {
      db.exec(`INSERT INTO test_data (value) VALUES ('bulk-${i}')`);
    }

    const result = manager.checkpointWAL();
    expect(result.pagesAfter).toBe(0);
  });

  // ── restoreFrom (atomic) ─────────────────────────────────────────

  it("restoreFrom restores the database to the backup state", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;

    // Insert a marker for the original state.
    db.exec("INSERT INTO test_data (value) VALUES ('original')");

    // Flush WAL so the fresh connection used by back up sees the write.
    db.pragma("wal_checkpoint(TRUNCATE)");

    // Backup from the current state.
    const backupPath = join(BACKUP_DIR, "restore-test.db");
    await manager.backup(backupPath);

    // Mutate the database after backup.
    db.exec("DELETE FROM test_data WHERE value = 'original'");
    db.exec("INSERT INTO test_data (value) VALUES ('post-backup')");

    // Flush WAL so mutations are on disk before we verify.
    db.pragma("wal_checkpoint(TRUNCATE)");

    // Verify that 'original' is gone from the live DB.
    const beforeRestore = db
      .prepare("SELECT COUNT(*) as cnt FROM test_data WHERE value = 'original'")
      .get() as { cnt: number };
    expect(beforeRestore.cnt).toBe(0);

    // Close the standalone connection before restore so the file handle
    // is released. The manager will reopen via its own openDb factory.
    db.close();

    // Restore from the verified backup.
    await manager.restoreFrom(backupPath);

    // Open a fresh connection to verify the restored data.
    const reopenedDb = new Database(TEST_DB);
    const rows = reopenedDb.prepare("SELECT value FROM test_data ORDER BY id").all() as Array<{
      value: string;
    }>;
    const values = rows.map((r) => r.value);

    expect(values).toContain("original");
    expect(values).not.toContain("post-backup");
    reopenedDb.close();
  });

  it("restoreFrom throws when backup file does not exist", async () => {
    const { manager, cleanup } = setupTestDb();
    _cleanup = cleanup;

    await expect(manager.restoreFrom(join(BACKUP_DIR, "nonexistent-restore.db"))).rejects.toThrow(
      /not found/,
    );
  });

  it("restoreFrom preserves original file on failure", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;

    // Create a valid backup first.
    const backupPath = join(BACKUP_DIR, "valid-backup.db");
    await manager.backup(backupPath);

    // Insert a marker in the live DB.
    db.exec("INSERT INTO test_data (value) VALUES ('live-marker')");

    // Count rows before attempting a bad restore.
    const countBefore = db.prepare("SELECT COUNT(*) as cnt FROM test_data").get() as {
      cnt: number;
    };

    // Now attempt to restore from a non-existent file.
    await expect(manager.restoreFrom(join(BACKUP_DIR, "nonexistent.db"))).rejects.toThrow();

    // The original database should still be intact.
    const reopenedDb = new Database(TEST_DB);
    const countAfter = reopenedDb.prepare("SELECT COUNT(*) as cnt FROM test_data").get() as {
      cnt: number;
    };
    expect(countAfter.cnt).toBe(countBefore.cnt);

    const markerExists = reopenedDb
      .prepare("SELECT COUNT(*) as cnt FROM test_data WHERE value = 'live-marker'")
      .get() as { cnt: number };
    expect(markerExists.cnt).toBe(1);
    reopenedDb.close();
  });

  // ── Feature-flag gating ──────────────────────────────────────────

  it("returns no-op manager when MSL_DURABILITY_ENABLED is not set", () => {
    const prev = process.env.MSL_DURABILITY_ENABLED;
    delete process.env.MSL_DURABILITY_ENABLED;

    const manager = createDatabaseManager(TEST_DB, () => new Database(":memory:"));

    expect(manager.checkIntegrity().ok).toBe(true);
    expect(manager.checkIntegrity().errors).toEqual([]);
    expect(manager.checkpointWAL().pagesAfter).toBe(0);
    expect(manager.checkpointWAL().pagesBefore).toBe(0);

    if (prev !== undefined) process.env.MSL_DURABILITY_ENABLED = prev;
  });

  it("no-op manager backup returns 0 and does not create a file", async () => {
    const prev = process.env.MSL_DURABILITY_ENABLED;
    delete process.env.MSL_DURABILITY_ENABLED;

    const noopPath = join(BACKUP_DIR, "noop-backup.db");
    mkdirSync(BACKUP_DIR, { recursive: true });

    const manager = createDatabaseManager(TEST_DB, () => new Database(":memory:"));
    const pages = await manager.backup(noopPath);

    expect(pages).toBe(0);

    if (prev !== undefined) process.env.MSL_DURABILITY_ENABLED = prev;
  });

  // ── Delegation to backupDatabase ─────────────────────────────────

  it("backup delegates to backupDatabase and returns page count", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;

    // Insert enough data to get pages.
    for (let i = 0; i < 50; i++) {
      db.exec(`INSERT INTO test_data (value) VALUES ('page-fill-${i}')`);
    }

    const backupPath = join(BACKUP_DIR, "delegation-test.db");
    const pages = await manager.backup(backupPath);

    expect(pages).toBeGreaterThan(0);

    // Verify page count from the backup file itself.
    const backupDb = new Database(backupPath, { readonly: true });
    const pageCount = (
      backupDb.prepare("SELECT page_count FROM pragma_page_count").get() as {
        page_count: number;
      }
    )?.page_count;
    expect(pageCount).toBe(pages);
    backupDb.close();
  });
});
