import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupScheduler } from "./backupScheduler.js";
import type { BackupSchedulerConfig, DbEntry } from "./backupScheduler.js";
import { createDatabaseManager } from "./databaseManager.js";
import type { DatabaseManager } from "./databaseManager.js";

const BACKUP_DIR = join(tmpdir(), "msl-test-backup-scheduler");
const TEST_DB_A = join(tmpdir(), "msl-test-bs-a.db");
const TEST_DB_B = join(tmpdir(), "msl-test-bs-b.db");

function createTestDb(dbPath: string): { db: Database.Database; manager: DatabaseManager; cleanup: () => void } {
  try { unlinkSync(dbPath); } catch { /* ok */ }
  try { unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
  try { unlinkSync(dbPath + "-shm"); } catch { /* ok */ }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS test_data (id INTEGER PRIMARY KEY, value TEXT);`);
  db.exec(`INSERT INTO test_data (value) VALUES ('hello'), ('world');`);

  const openDb = () => new Database(dbPath);
  const manager = createDatabaseManager(dbPath, openDb);

  return {
    db,
    manager,
    cleanup: () => {
      db.close();
      try { unlinkSync(dbPath); } catch { /* ok */ }
      try { unlinkSync(dbPath + "-wal"); } catch { /* ok */ }
      try { unlinkSync(dbPath + "-shm"); } catch { /* ok */ }
    },
  };
}

function makeConfig(overrides?: Partial<BackupSchedulerConfig>): BackupSchedulerConfig {
  return {
    entries: [],
    backupDir: BACKUP_DIR,
    ...overrides,
  };
}

function makeEntry(
  dbPath: string,
  manager: DatabaseManager,
  dbType: string,
): DbEntry {
  return { dbPath, manager, dbType };
}

describe("BackupScheduler", () => {
  beforeEach(() => {
    process.env.MSL_DURABILITY_ENABLED = "true";
    rmSync(BACKUP_DIR, { recursive: true, force: true });
    mkdirSync(BACKUP_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env.MSL_DURABILITY_ENABLED;
  });

  // ── activeEntries ────────────────────────────────────────────────

  describe("activeEntries", () => {
    it("returns only non-oauth entries", () => {
      const dbA = createTestDb(TEST_DB_A);
      const dbB = createTestDb(TEST_DB_B);

      try {
        const scheduler = new BackupScheduler(
          makeConfig({
            entries: [
              makeEntry(TEST_DB_A, dbA.manager, "cortex"),
              makeEntry(TEST_DB_B, dbB.manager, "oauth"),
            ],
          }),
        );

        const active = scheduler.activeEntries();
        expect(active).toHaveLength(1);
        expect(active[0]!.dbType).toBe("cortex");
      } finally {
        dbA.cleanup();
        dbB.cleanup();
      }
    });
  });

  // ── Backup cycle ─────────────────────────────────────────────────

  describe("backup cycle", () => {
    it("creates a backup file and metadata for a healthy database", async () => {
      const dbA = createTestDb(TEST_DB_A);

      try {
        const scheduler = new BackupScheduler(
          makeConfig({
            entries: [makeEntry(TEST_DB_A, dbA.manager, "cortex")],
            backupIntervalMs: 100,
          }),
        );

        await scheduler.runBackupCycle();

        // Check that a backup file was created.
        const files = existsSync(BACKUP_DIR) ? require("node:fs").readdirSync(BACKUP_DIR) : [];
        const backupFiles = files.filter((f: string) => f.endsWith(".sqlite"));
        expect(backupFiles.length).toBeGreaterThanOrEqual(1);

        // Check metadata.
        const metadata = scheduler.readMetadata();
        const cortexMeta = metadata.find((m) => m.dbName === "cortex");
        expect(cortexMeta).toBeDefined();
        expect(cortexMeta!.status).toBe("verified");
        expect(cortexMeta!.lastBackupAt).toBeTruthy();
        expect(cortexMeta!.lastVerifiedAt).toBeTruthy();
        expect(cortexMeta!.pageCount).toBeGreaterThan(0);
      } finally {
        dbA.cleanup();
      }
    });

    it("marks backup as failed when verification fails", async () => {
      const dbA = createTestDb(TEST_DB_A);

      try {
        // Create a wrapper manager whose verifyBackup always fails.
        // Methods are on the prototype, so spread alone won't copy them.
        const real = dbA.manager;
        const badManager: DatabaseManager = {
          backup: (targetPath: string) => real.backup(targetPath),
          verifyBackup: () => ({ ok: false, error: "simulated failure", pages: 0 }),
          restoreFrom: (backupPath: string) => real.restoreFrom(backupPath),
          checkIntegrity: () => real.checkIntegrity(),
          checkpointWAL: () => real.checkpointWAL(),
          migrate: (registry) => real.migrate(registry),
        };

        const scheduler = new BackupScheduler(
          makeConfig({
            entries: [makeEntry(TEST_DB_A, badManager, "cortex")],
          }),
        );

        await scheduler.runBackupCycle();

        const metadata = scheduler.readMetadata();
        const cortexMeta = metadata.find((m) => m.dbName === "cortex");
        expect(cortexMeta).toBeDefined();
        expect(cortexMeta!.status).toBe("failed");
      } finally {
        dbA.cleanup();
      }
    });

    it("skips oauth databases", async () => {
      const dbA = createTestDb(TEST_DB_A);

      try {
        const scheduler = new BackupScheduler(
          makeConfig({
            entries: [makeEntry(TEST_DB_A, dbA.manager, "oauth")],
          }),
        );

        await scheduler.runBackupCycle();

        // No backup files should be created for oauth.
        const metadata = scheduler.readMetadata();
        expect(metadata).toHaveLength(0);
      } finally {
        dbA.cleanup();
      }
    });
  });

  // ── WAL checkpoint ───────────────────────────────────────────────

  describe("WAL checkpoint", () => {
    it("runs wal_checkpoint on active entries", async () => {
      const dbA = createTestDb(TEST_DB_A);

      try {
        let checkpointCalled = false;
        const real = dbA.manager;
        const trackingManager: DatabaseManager = {
          backup: (p) => real.backup(p),
          verifyBackup: (p) => real.verifyBackup(p),
          restoreFrom: (p) => real.restoreFrom(p),
          checkIntegrity: () => real.checkIntegrity(),
          checkpointWAL: () => {
            checkpointCalled = true;
            return { pagesBefore: 5, pagesAfter: 0 };
          },
          migrate: (r) => real.migrate(r),
        };

        const scheduler = new BackupScheduler(
          makeConfig({
            entries: [makeEntry(TEST_DB_A, trackingManager, "cortex")],
          }),
        );

        await scheduler.runWalCheckpoint();
        expect(checkpointCalled).toBe(true);
      } finally {
        dbA.cleanup();
      }
    });

    it("forces checkpoint when WAL exceeds threshold", async () => {
      const dbA = createTestDb(TEST_DB_A);

      try {
        // Create a large WAL-like file to trigger the threshold.
        const walPath = TEST_DB_A + "-wal";
        require("node:fs").writeFileSync(
          walPath,
          Buffer.alloc(201 * 1024 * 1024), // 201 MB
        );

        let checkpointCalled = false;
        const real = dbA.manager;
        const trackingManager: DatabaseManager = {
          backup: (p) => real.backup(p),
          verifyBackup: (p) => real.verifyBackup(p),
          restoreFrom: (p) => real.restoreFrom(p),
          checkIntegrity: () => real.checkIntegrity(),
          checkpointWAL: () => {
            checkpointCalled = true;
            return { pagesBefore: 1000, pagesAfter: 0 };
          },
          migrate: (r) => real.migrate(r),
        };

        const scheduler = new BackupScheduler(
          makeConfig({
            entries: [makeEntry(TEST_DB_A, trackingManager, "cortex")],
            walSizeThresholdBytes: 200 * 1024 * 1024,
          }),
        );

        await scheduler.runWalCheckpoint();
        expect(checkpointCalled).toBe(true);

        // Clean up the large WAL file.
        try { unlinkSync(walPath); } catch { /* ok */ }
      } finally {
        dbA.cleanup();
      }
    });
  });

  // ── Integrity check ──────────────────────────────────────────────

  describe("integrity check", () => {
    it("runs integrity_check on active entries", async () => {
      const dbA = createTestDb(TEST_DB_A);

      try {
        let integrityCalled = false;
        const real = dbA.manager;
        const trackingManager: DatabaseManager = {
          backup: (p) => real.backup(p),
          verifyBackup: (p) => real.verifyBackup(p),
          restoreFrom: (p) => real.restoreFrom(p),
          checkIntegrity: () => {
            integrityCalled = true;
            return { ok: true, errors: [] };
          },
          checkpointWAL: () => real.checkpointWAL(),
          migrate: (r) => real.migrate(r),
        };

        const scheduler = new BackupScheduler(
          makeConfig({
            entries: [makeEntry(TEST_DB_A, trackingManager, "cortex")],
          }),
        );

        await scheduler.runIntegrityCheck();
        expect(integrityCalled).toBe(true);
      } finally {
        dbA.cleanup();
      }
    });
  });

  // ── Retention ────────────────────────────────────────────────────

  describe("retention", () => {
    it("deletes backups older than retention period", async () => {
      const dbA = createTestDb(TEST_DB_A);

      try {
        const scheduler = new BackupScheduler(
          makeConfig({
            entries: [makeEntry(TEST_DB_A, dbA.manager, "cortex")],
            retentionDays: 0, // immediately prune
          }),
        );

        // Create a backup.
        await scheduler.runBackupCycle();

        // Manually create an old backup file.
        const oldFile = join(BACKUP_DIR, "old-backup.sqlite");
        require("node:fs").writeFileSync(oldFile, "dummy");

        // Force mtime to be old.
        const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        require("node:fs").utimesSync(oldFile, oldTime, oldTime);

        scheduler.enforceRetention();

        // The old file should be deleted.
        expect(existsSync(oldFile)).toBe(false);
      } finally {
        dbA.cleanup();
      }
    });

    it("preserves the last verified backup regardless of age", async () => {
      const dbA = createTestDb(TEST_DB_A);

      try {
        const scheduler = new BackupScheduler(
          makeConfig({
            entries: [makeEntry(TEST_DB_A, dbA.manager, "cortex")],
            retentionDays: 0, // immediately prune
          }),
        );

        // Run a backup cycle and capture backup path.
        await scheduler.runBackupCycle();
        const metadata = scheduler.readMetadata();
        const cortexMeta = metadata.find((m) => m.dbName === "cortex");
        expect(cortexMeta?.status).toBe("verified");
        expect(cortexMeta?.backupPath).toBeTruthy();

        const verifiedPath = cortexMeta!.backupPath!;

        scheduler.enforceRetention();

        // The verified backup must still exist.
        expect(existsSync(verifiedPath)).toBe(true);
      } finally {
        dbA.cleanup();
      }
    });
  });

  // ── Metadata persistence ─────────────────────────────────────────

  describe("metadata persistence", () => {
    it("persists and reads backup metadata", async () => {
      const dbA = createTestDb(TEST_DB_A);

      try {
        const scheduler = new BackupScheduler(
          makeConfig({
            entries: [makeEntry(TEST_DB_A, dbA.manager, "cortex")],
          }),
        );

        await scheduler.runBackupCycle();

        const metadata = scheduler.readMetadata();
        expect(metadata).toHaveLength(1);
        expect(metadata[0]!.dbName).toBe("cortex");
        expect(metadata[0]!.status).toBe("verified");
        expect(metadata[0]!.lastBackupAt).toBeTruthy();
        expect(metadata[0]!.lastVerifiedAt).toBeTruthy();
        expect(metadata[0]!.pageCount).toBeGreaterThan(0);
      } finally {
        dbA.cleanup();
      }
    });
  });

  // ── Backup freshness ─────────────────────────────────────────────

  describe("isBackupFresh", () => {
    it("returns true for a fresh backup", async () => {
      const dbA = createTestDb(TEST_DB_A);

      try {
        const scheduler = new BackupScheduler(
          makeConfig({
            entries: [makeEntry(TEST_DB_A, dbA.manager, "cortex")],
            freshnessWindowMs: 999_999_999, // huge window
          }),
        );

        await scheduler.runBackupCycle();
        expect(scheduler.isBackupFresh("cortex")).toBe(true);
      } finally {
        dbA.cleanup();
      }
    });

    it("returns false when no metadata exists", () => {
      const scheduler = new BackupScheduler(makeConfig());
      expect(scheduler.isBackupFresh("nonexistent")).toBe(false);
    });

    it("returns false for stale backup", async () => {
      const dbA = createTestDb(TEST_DB_A);

      try {
        const scheduler = new BackupScheduler(
          makeConfig({
            entries: [makeEntry(TEST_DB_A, dbA.manager, "cortex")],
            freshnessWindowMs: 1, // 1ms — effectively immediate staleness
          }),
        );

        await scheduler.runBackupCycle();

        // Small delay to ensure it's past the 1ms window.
        await new Promise((resolve) => setTimeout(resolve, 5));

        expect(scheduler.isBackupFresh("cortex")).toBe(false);
      } finally {
        dbA.cleanup();
      }
    });
  });

  // ── Start / stop ─────────────────────────────────────────────────

  describe("start / stop", () => {
    it("start is a no-op when durability is disabled", () => {
      delete process.env.MSL_DURABILITY_ENABLED;
      const scheduler = new BackupScheduler(makeConfig());
      scheduler.start();
      scheduler.stop();
      // Should not throw.
    });

    it("stop is safe to call multiple times", () => {
      const scheduler = new BackupScheduler(makeConfig());
      scheduler.stop();
      scheduler.stop();
      // Should not throw.
    });

    it("does not auto-start", () => {
      const scheduler = new BackupScheduler(makeConfig());
      // The constructor should not start any timers — verified by no
      // error when we don't provide entries with valid paths.
      expect(() => scheduler.stop()).not.toThrow();
    });
  });
});
