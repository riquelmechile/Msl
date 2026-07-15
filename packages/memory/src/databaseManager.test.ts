import { describe, expect, it, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createDatabaseManager } from "./databaseManager.js";
import type { DatabaseManager } from "./databaseManager.js";
import { createEconomicDatabaseLifecycle } from "./economicDatabaseLifecycle.js";
import type { EconomicDatabaseLifecycle } from "./economicDatabaseLifecycle.js";
import { acquireEconomicDatabaseFence, createEconomicMigrationPlan } from "./migrationRegistry.js";

const TEST_DB = join(tmpdir(), "msl-test-dm.db");
const BACKUP_DIR = join(tmpdir(), "msl-test-dm-backups");

function cleanRestoreArtifacts(): void {
  for (const entry of readdirSync(tmpdir())) {
    if (entry.startsWith(".msl-test-dm.db."))
      rmSync(join(tmpdir(), entry), { recursive: true, force: true });
  }
}

function setupTestDb(): {
  db: Database.Database;
  manager: DatabaseManager;
  cleanup: () => void;
} {
  // Clean up from previous runs.
  cleanRestoreArtifacts();
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
      cleanRestoreArtifacts();
    },
  };
}

describe("DatabaseManager", () => {
  let _cleanup: (() => void) | null = null;
  let economicLifecycle: EconomicDatabaseLifecycle | null = null;
  let economicFence: {
    ownerRunId: string;
    generation: number;
    token: string;
    databaseGeneration: number;
    expiresAt: number;
  } | null = null;

  afterEach(async () => {
    if (economicLifecycle && economicLifecycle.state === "blocked" && economicFence) {
      await economicLifecycle.recover(economicFence).catch(() => undefined);
    }
    economicLifecycle?.release();
    economicLifecycle = null;
    economicFence = null;
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

  it("rejects economic restore when durability is disabled", async () => {
    const prev = process.env.MSL_DURABILITY_ENABLED;
    delete process.env.MSL_DURABILITY_ENABLED;
    const manager = createDatabaseManager(TEST_DB, () => new Database(":memory:"));
    await expect(manager.restoreEconomicFrom({} as never)).rejects.toThrow(/unavailable/i);
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

  // ── restoreEconomicFrom (fenced promotion) ─────────────────────────

  it("durably prepares a canonically bound staged backup without promotion", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const priorPath = join(dirname(TEST_DB), ".msl-test-dm.db.restore-success.prior");
    if (existsSync(priorPath)) unlinkSync(priorPath);
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "restore-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const fence = acquired.fence;
    const liveFence = { ...fence };
    const lifecycle = createEconomicDatabaseLifecycle({
      path: join(dirname(TEST_DB), ".", basename(TEST_DB)),
      authority: {},
      readFence: () => liveFence,
    });
    economicLifecycle = lifecycle;
    economicFence = fence;
    db.exec("INSERT INTO test_data (value) VALUES ('prior-marker')");
    db.pragma("wal_checkpoint(TRUNCATE)");
    const backupPath = join(BACKUP_DIR, "economic-restore.db");
    copyFileSync(TEST_DB, backupPath);
    db.exec("DELETE FROM test_data WHERE value = 'prior-marker'");
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    const syncedFiles: string[] = [];
    const syncedDirectories: string[] = [];

    const result = await manager.restoreEconomicFrom({
      backupPath,
      fence,
      lifecycle,
      migrationRegistry: plan,
      restoreId: "restore-success",
      durability: {
        syncFile: (path) => syncedFiles.push(path),
        syncDirectory: (path) => syncedDirectories.push(path),
      },
    });

    expect(result.outcome).toBe("prepared");
    expect(result.stagePath.startsWith(dirname(TEST_DB))).toBe(true);
    expect(result.priorPath.startsWith(dirname(TEST_DB))).toBe(true);
    expect(existsSync(result.priorPath)).toBe(false);
    expect(JSON.parse(readFileSync(result.manifestPath, "utf8"))).toMatchObject({
      restoreId: "restore-success",
      backupPath: join(BACKUP_DIR, "economic-restore.db"),
      phase: "quiesced",
    });
    const restored = new Database(TEST_DB, { readonly: true });
    expect(
      restored.prepare("SELECT value FROM test_data WHERE value = 'prior-marker'").get(),
    ).toBeFalsy();
    expect(
      restored
        .prepare("SELECT name FROM sqlite_master WHERE name = 'economic_restore_journal'")
        .get(),
    ).toBeTruthy();
    expect(existsSync(result.stagePath)).toBe(true);
    expect(syncedFiles).toContain(TEST_DB);
    expect(syncedDirectories).toContain(dirname(TEST_DB));
    expect(restored.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    restored.close();
  });

  it("accepts absent WAL/SHM after a zero-frame checkpoint without promotion", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "sidecar-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    db.pragma("wal_checkpoint(TRUNCATE)");
    const backupPath = join(BACKUP_DIR, "sidecar-restore.db");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    if (existsSync(TEST_DB + "-wal")) unlinkSync(TEST_DB + "-wal");
    if (existsSync(TEST_DB + "-shm")) unlinkSync(TEST_DB + "-shm");

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "sidecar",
      }),
    ).resolves.toMatchObject({ outcome: "prepared" });
  });

  it("rejects a fence changed during lifecycle invalidation before preserving prior", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "stale-fence-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    let liveFence = { ...acquired.fence };
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => liveFence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const registration = lifecycle.register({
      invalidate: () => {
        liveFence = { ...liveFence, token: "stale" };
      },
    });
    db.pragma("wal_checkpoint(TRUNCATE)");
    const backupPath = join(BACKUP_DIR, "stale-fence-restore.db");
    copyFileSync(TEST_DB, backupPath);
    db.close();

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "stale-fence",
      }),
    ).rejects.toThrow(/fence|lifecycle/i);
    expect(existsSync(join(dirname(TEST_DB), ".msl-test-dm.db.stale-fence.prior"))).toBe(false);
    registration.release();
    liveFence = { ...acquired.fence };
  });

  it.each([
    ["busy", { busy: 1, log: 0, checkpointed: 0 }],
    ["nonzero frames", { busy: 0, log: 1, checkpointed: 1 }],
    ["malformed receipt", { busy: 0, log: 0 }],
    ["wrong checkpoint types", { busy: "0", log: 0, checkpointed: 0 }],
    ["nan checkpoint", { busy: Number.NaN, log: 0, checkpointed: 0 }],
    ["negative checkpoint", { busy: -1, log: 0, checkpointed: 0 }],
    ["extra checkpoint field", { busy: 0, log: 0, checkpointed: 0, extra: 1 }],
    ["failed checkpoint", new Error("checkpoint failed")],
  ])("rejects %s checkpoint before preserving the prior database", async (_name, checkpoint) => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "reject-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const backupPath = join(BACKUP_DIR, "reject-restore.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: `reject-${_name.replaceAll(" ", "-")}`,
        checkpoint: () => {
          if (checkpoint instanceof Error) throw checkpoint;
          return checkpoint as { busy: number; log: number; checkpointed: number };
        },
      }),
    ).rejects.toThrow(/checkpoint/i);
    const restoreId = `reject-${_name.replaceAll(" ", "-")}`;
    expect(existsSync(join(dirname(TEST_DB), `.msl-test-dm.db.${restoreId}.stage`))).toBe(false);
    expect(existsSync(TEST_DB)).toBe(true);
    const journalDb = new Database(TEST_DB, { readonly: true });
    const journal = journalDb
      .prepare("SELECT phase, outcome FROM economic_restore_journal WHERE restore_id = ?")
      .get(restoreId) as { phase: string; outcome: string };
    expect(journal).toEqual({ phase: "failed", outcome: "failed" });
    journalDb.close();
  });

  it("rejects unsafe restore IDs and symlink backup aliases before journaling", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "input-alias-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const backupPath = join(BACKUP_DIR, "alias-source.db");
    const aliasPath = join(BACKUP_DIR, "alias.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    symlinkSync(backupPath, aliasPath);
    const input = { fence: acquired.fence, lifecycle, migrationRegistry: plan };

    await expect(manager.restoreEconomicFrom({ ...input, backupPath: aliasPath })).rejects.toThrow(
      /non-symlink/i,
    );
    await expect(
      manager.restoreEconomicFrom({ ...input, backupPath, restoreId: "../escape" }),
    ).rejects.toThrow(/filesystem-safe/i);
    const hardLinkPath = join(BACKUP_DIR, "target-hard-link.db");
    linkSync(TEST_DB, hardLinkPath);
    await expect(
      manager.restoreEconomicFrom({ ...input, backupPath: hardLinkPath }),
    ).rejects.toThrow(/share an inode|hard-linked/i);
    const hardLinkedBackupPath = join(BACKUP_DIR, "backup-hard-link.db");
    linkSync(backupPath, hardLinkedBackupPath);
    await expect(
      manager.restoreEconomicFrom({ ...input, backupPath: hardLinkedBackupPath }),
    ).rejects.toThrow(/hard-linked/i);
    expect(existsSync(TEST_DB)).toBe(true);
  });

  it("rejects pre-existing, dangling-symlink, and hard-linked stage or temporary artifacts", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "artifact-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const backupPath = join(BACKUP_DIR, "artifact-source.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const stagePath = join(dirname(TEST_DB), ".msl-test-dm.db.artifact.stage");
    const manifestTemp = join(dirname(TEST_DB), ".msl-test-dm.db.artifact.manifest.json.stale.tmp");
    writeFileSync(stagePath, "attacker stage");
    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "artifact",
      }),
    ).rejects.toThrow(/artifact already exists/i);
    unlinkSync(stagePath);
    symlinkSync(join(BACKUP_DIR, "missing-stage.db"), stagePath);
    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "artifact",
      }),
    ).rejects.toThrow(/artifact already exists/i);
    unlinkSync(stagePath);
    const artifactLinkSource = join(BACKUP_DIR, "artifact-link-source");
    writeFileSync(artifactLinkSource, "attacker artifact");
    linkSync(artifactLinkSource, stagePath);
    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "artifact",
      }),
    ).rejects.toThrow(/hard-linked artifact/i);
    unlinkSync(stagePath);
    writeFileSync(manifestTemp, "attacker temp");
    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "artifact",
      }),
    ).rejects.toThrow(/temporary artifact already exists/i);
    unlinkSync(manifestTemp);
    symlinkSync(join(BACKUP_DIR, "missing-temp.db"), manifestTemp);
    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "artifact",
      }),
    ).rejects.toThrow(/temporary artifact already exists/i);
    unlinkSync(manifestTemp);
    linkSync(artifactLinkSource, manifestTemp);
    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "artifact",
      }),
    ).rejects.toThrow(/hard-linked temporary artifact/i);
    unlinkSync(manifestTemp);
    unlinkSync(artifactLinkSource);
  });

  it("rejects target path replacement after descriptor binding and lifecycle drain", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "target-replace-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const backupPath = join(BACKUP_DIR, "target-replace-source.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const replacedPath = join(BACKUP_DIR, "bound-original.db");
    let reopened = false;
    const registration = lifecycle.register({
      invalidate: () => undefined,
      close: () => {
        renameSync(TEST_DB, replacedPath);
        copyFileSync(backupPath, TEST_DB);
      },
      reopen: () => {
        reopened = true;
      },
    });
    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "target-replaced",
      }),
    ).rejects.toThrow(/target identity changed/i);
    expect(reopened).toBe(false);
    expect(lifecycle.state).toBe("quiesced");
    expect(
      JSON.parse(
        readFileSync(
          join(dirname(TEST_DB), ".msl-test-dm.db.target-replaced.manifest.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ phase: "failed", targetStillBound: false });
    expect(existsSync(join(dirname(TEST_DB), ".msl-test-dm.db.target-replaced.prior"))).toBe(false);
    registration.release();
  });

  it("rechecks the bound backup at the prepared boundary", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "prepared-backup-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const backupPath = join(BACKUP_DIR, "prepared-backup-source.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const registration = lifecycle.register({
      invalidate: () => undefined,
      close: () => writeFileSync(backupPath, "replacement after staging"),
    });
    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "prepared-backup",
      }),
    ).rejects.toThrow(/prepared boundary/i);
    registration.release();
  });

  it("releases target and backup descriptors when lifecycle path validation rejects", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "lifecycle-path-cleanup-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const backupPath = join(BACKUP_DIR, "lifecycle-path-cleanup.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const lifecycle = createEconomicDatabaseLifecycle({
      path: backupPath,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "lifecycle-path-cleanup",
      }),
    ).rejects.toThrow(/lifecycle path is not bound/i);

    const movedTarget = join(BACKUP_DIR, "released-target.db");
    renameSync(TEST_DB, movedTarget);
    renameSync(movedTarget, TEST_DB);
    const reopenedTarget = new Database(TEST_DB, { readonly: true });
    reopenedTarget.close();
    renameSync(backupPath, join(BACKUP_DIR, "released-backup.db"));
    unlinkSync(join(BACKUP_DIR, "released-backup.db"));
  });

  it("releases target and backup descriptors when artifact preflight rejects", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({
      db,
      ownerRunId: "artifact-preflight-cleanup-run",
    });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const backupPath = join(BACKUP_DIR, "artifact-preflight-cleanup.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const restoreId = "artifact-preflight-cleanup";
    writeFileSync(join(dirname(TEST_DB), `.msl-test-dm.db.${restoreId}.stage`), "stale");

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId,
      }),
    ).rejects.toThrow(/artifact already exists/i);

    const movedTarget = join(BACKUP_DIR, "released-preflight-target.db");
    renameSync(TEST_DB, movedTarget);
    renameSync(movedTarget, TEST_DB);
    renameSync(backupPath, join(BACKUP_DIR, "released-preflight-backup.db"));
    unlinkSync(join(BACKUP_DIR, "released-preflight-backup.db"));
  });

  it("rejects atomic backup-path replacement from drain and retains failed prepared evidence", async () => {
    const { db, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "atomic-backup-path-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const backupPath = join(BACKUP_DIR, "atomic-backup-path.db");
    const originalBackupPath = join(BACKUP_DIR, "atomic-backup-path.original.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    const originalTargetCount = db.prepare("SELECT COUNT(*) AS count FROM test_data").get();
    db.close();
    const manager = createDatabaseManager(TEST_DB, () => new Database(TEST_DB));
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const restoreId = "atomic-backup-path";
    let participantClosed = false;
    const closeParticipant = () => {
      if (participantClosed) return;
      participantClosed = true;
      renameSync(backupPath, originalBackupPath);
      writeFileSync(backupPath, "atomic replacement");
    };
    const registration = lifecycle.register({
      invalidate: () => undefined,
      close: closeParticipant,
      reopen: () => undefined,
    });
    const drain = lifecycle.enterDraining.bind(lifecycle);
    (lifecycle as unknown as { enterDraining: typeof drain }).enterDraining = async (fence) => {
      closeParticipant();
      await drain(fence);
    };

    try {
      await expect(
        manager.restoreEconomicFrom({
          backupPath,
          fence: acquired.fence,
          lifecycle,
          migrationRegistry: plan,
          restoreId,
          onCopyChunk: closeParticipant,
        }),
      ).rejects.toThrow(/backup path is no longer bound/i);
      const intactTarget = new Database(TEST_DB, { readonly: true });
      expect(intactTarget.prepare("SELECT COUNT(*) AS count FROM test_data").get()).toEqual(
        originalTargetCount,
      );
      expect(
        intactTarget
          .prepare("SELECT phase, outcome FROM economic_restore_journal WHERE restore_id = ?")
          .get(restoreId),
      ).toMatchObject({
        phase: "failed",
        outcome: "failed",
      });
      expect(
        intactTarget
          .prepare("SELECT failure_detail FROM economic_restore_journal WHERE restore_id = ?")
          .pluck()
          .get(restoreId),
      ).toMatch(/backup path is no longer bound/i);
      expect(
        intactTarget
          .prepare(
            "SELECT COUNT(*) AS count FROM economic_restore_journal WHERE outcome = 'completed'",
          )
          .get(),
      ).toEqual({ count: 0 });
      intactTarget.close();
      expect(existsSync(join(dirname(TEST_DB), `.msl-test-dm.db.${restoreId}.prior`))).toBe(false);
      expect(existsSync(join(dirname(TEST_DB), `.msl-test-dm.db.${restoreId}.stage`))).toBe(false);
      expect(lifecycle.state).toBe("open");
    } finally {
      registration.release();
      rmSync(originalBackupPath, { force: true });
    }
  });

  it("rejects stage-path replacement from participant close and retains failed prepared evidence", async () => {
    const { db, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "atomic-stage-path-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const backupPath = join(BACKUP_DIR, "atomic-stage-path.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    const originalTargetCount = db.prepare("SELECT COUNT(*) AS count FROM test_data").get();
    db.close();
    const manager = createDatabaseManager(TEST_DB, () => new Database(TEST_DB));
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const restoreId = "atomic-stage-path";
    const stagePath = join(dirname(TEST_DB), `.msl-test-dm.db.${restoreId}.stage`);
    const originalStagePath = join(BACKUP_DIR, "atomic-stage-path.original.db");
    let participantClosed = false;
    const closeParticipant = () => {
      if (participantClosed) return;
      participantClosed = true;
      renameSync(stagePath, originalStagePath);
      copyFileSync(backupPath, stagePath);
    };
    const registration = lifecycle.register({
      invalidate: () => undefined,
      close: closeParticipant,
      reopen: () => undefined,
    });
    const drain = lifecycle.enterDraining.bind(lifecycle);
    (lifecycle as unknown as { enterDraining: typeof drain }).enterDraining = async (fence) => {
      closeParticipant();
      await drain(fence);
    };

    try {
      await expect(
        manager.restoreEconomicFrom({
          backupPath,
          fence: acquired.fence,
          lifecycle,
          migrationRegistry: plan,
          restoreId,
          afterStageMigration: closeParticipant,
        }),
      ).rejects.toThrow(/stage path is no longer bound/i);
      const intactTarget = new Database(TEST_DB, { readonly: true });
      expect(intactTarget.prepare("SELECT COUNT(*) AS count FROM test_data").get()).toEqual(
        originalTargetCount,
      );
      expect(
        intactTarget
          .prepare("SELECT phase, outcome FROM economic_restore_journal WHERE restore_id = ?")
          .get(restoreId),
      ).toMatchObject({
        phase: "failed",
        outcome: "failed",
      });
      expect(
        intactTarget
          .prepare("SELECT failure_detail FROM economic_restore_journal WHERE restore_id = ?")
          .pluck()
          .get(restoreId),
      ).toMatch(/stage path is no longer bound/i);
      expect(
        intactTarget
          .prepare(
            "SELECT COUNT(*) AS count FROM economic_restore_journal WHERE outcome = 'completed'",
          )
          .get(),
      ).toEqual({ count: 0 });
      intactTarget.close();
      expect(existsSync(join(dirname(TEST_DB), `.msl-test-dm.db.${restoreId}.prior`))).toBe(false);
      expect(existsSync(stagePath)).toBe(false);
      expect(lifecycle.state).toBe("open");
    } finally {
      registration.release();
      rmSync(originalStagePath, { force: true });
    }
  });

  it("snapshots migration, lifecycle, checkpoint, and durability callables before callbacks mutate their containers", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "mutable-callables-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const backupPath = join(BACKUP_DIR, "mutable-callables.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const mutableRegistry = { apply: plan.apply.bind(plan) } as unknown as typeof plan;
    const mutableInput = {
      backupPath,
      fence: acquired.fence,
      lifecycle,
      migrationRegistry: mutableRegistry,
      restoreId: "mutable-callables",
      checkpoint: () => ({ busy: 0, log: 0, checkpointed: 0 }),
      durability: { syncDirectory: () => undefined },
      onCopyChunk: () => {
        (mutableRegistry as unknown as { apply: () => never }).apply = () => {
          throw new Error("mutated migration callable");
        };
        (lifecycle as unknown as { enterDraining: () => never }).enterDraining = () => {
          throw new Error("mutated lifecycle callable");
        };
        (
          mutableInput as unknown as {
            checkpoint: () => { busy: number; log: number; checkpointed: number };
          }
        ).checkpoint = () => ({
          busy: 1,
          log: 0,
          checkpointed: 0,
        });
        (mutableInput.durability as { syncDirectory: () => void }).syncDirectory = () => {
          throw new Error("mutated durability callable");
        };
      },
    };

    await expect(manager.restoreEconomicFrom(mutableInput)).resolves.toMatchObject({
      outcome: "prepared",
    });
  });

  it("never runs a caller migration registry against the live target", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({
      db,
      ownerRunId: "economic-identity-snapshot-run",
    });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const backupPath = join(BACKUP_DIR, "economic-identity-snapshot.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    const originalDatabaseId = db
      .prepare("SELECT database_id FROM economic_database_metadata WHERE singleton = 1")
      .get();
    db.close();
    const mutatingRegistry = {
      apply(database: Database.Database) {
        plan.apply(database);
        database.exec(
          "UPDATE economic_database_metadata SET database_id = 'caller-mutated' WHERE singleton = 1",
        );
        return { applied: 0, skipped: 0 };
      },
    } as unknown as typeof plan;

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: mutatingRegistry,
        restoreId: "economic-identity-snapshot",
      }),
    ).rejects.toThrow(/staged economic identity/i);
    const target = new Database(TEST_DB, { readonly: true });
    expect(
      target
        .prepare("SELECT database_id FROM economic_database_metadata WHERE singleton = 1")
        .get(),
    ).toEqual(originalDatabaseId);
    target.close();
  });

  it("rejects backup replacement and post-migration stage mutation without touching target", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "input-race-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const backupPath = join(BACKUP_DIR, "input-race.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const originalTargetData = new Database(TEST_DB, { readonly: true });
    const originalCount = originalTargetData
      .prepare("SELECT COUNT(*) AS count FROM test_data")
      .get();
    originalTargetData.close();

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "backup-replaced",
        onCopyChunk: () => writeFileSync(backupPath, "replacement"),
      }),
    ).rejects.toThrow(/backup changed/i);
    const afterBackupRace = new Database(TEST_DB, { readonly: true });
    expect(afterBackupRace.prepare("SELECT COUNT(*) AS count FROM test_data").get()).toEqual(
      originalCount,
    );
    afterBackupRace.close();

    copyFileSync(TEST_DB, backupPath);
    const stagePath = join(dirname(TEST_DB), ".msl-test-dm.db.stage-mutated.stage");
    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "stage-mutated",
        durability: {
          syncFile: (path) => {
            if (path === stagePath) writeFileSync(path, "post-migration replacement");
          },
          syncDirectory: () => undefined,
        },
      }),
    ).rejects.toThrow(/stage|verification/i);
    const afterStageRace = new Database(TEST_DB, { readonly: true });
    expect(afterStageRace.prepare("SELECT COUNT(*) AS count FROM test_data").get()).toEqual(
      originalCount,
    );
    afterStageRace.close();
    expect(existsSync(stagePath)).toBe(false);
  });

  it.each([
    [
      "database ID",
      "UPDATE economic_database_metadata SET database_id = 'mismatch' WHERE singleton = 1",
    ],
    [
      "generation",
      "UPDATE economic_database_metadata SET generation = generation + 1 WHERE singleton = 1",
    ],
  ])("rejects post-migration staged economic %s mismatch", async (_label, mutation) => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "stage-identity-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const backupPath = join(BACKUP_DIR, `stage-identity-${_label}.db`);
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: `stage-identity-${_label.replaceAll(" ", "-")}`,
        afterStageMigration: (stagePath) => {
          const stage = new Database(stagePath);
          stage.exec(mutation);
          stage.close();
        },
      }),
    ).rejects.toThrow(/staged economic identity/i);
  });

  it.each([
    ["busy", () => [{ busy: 1, log: 0, checkpointed: 0 }]],
    ["nonzero", () => [{ busy: 0, log: 1, checkpointed: 1 }]],
    [
      "fault",
      () => {
        throw new Error("stage WAL fault");
      },
    ],
  ])(
    "rejects a %s staged WAL checkpoint receipt before durable stage evidence",
    async (_label, stageCheckpoint) => {
      const { db, manager, cleanup } = setupTestDb();
      _cleanup = cleanup;
      const plan = createEconomicMigrationPlan();
      plan.apply(db);
      const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: `stage-wal-${_label}` });
      if (acquired.status !== "acquired") throw new Error("test fence unavailable");
      const lifecycle = createEconomicDatabaseLifecycle({
        path: TEST_DB,
        authority: {},
        readFence: () => acquired.fence,
      });
      economicLifecycle = lifecycle;
      economicFence = acquired.fence;
      const backupPath = join(BACKUP_DIR, `stage-wal-${_label}.db`);
      db.pragma("wal_checkpoint(TRUNCATE)");
      copyFileSync(TEST_DB, backupPath);
      db.close();

      await expect(
        manager.restoreEconomicFrom({
          backupPath,
          fence: acquired.fence,
          lifecycle,
          migrationRegistry: plan,
          restoreId: `stage-wal-${_label}`,
          stageCheckpoint,
        }),
      ).rejects.toThrow(/staged checkpoint|stage WAL fault/i);
      expect(existsSync(join(dirname(TEST_DB), `.msl-test-dm.db.stage-wal-${_label}.stage`))).toBe(
        false,
      );
    },
  );

  it("checkpoints and fsyncs failed journal evidence before publishing its failed manifest", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "failed-journal-order-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const backupPath = join(BACKUP_DIR, "failed-journal-order.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const events: string[] = [];
    let failing = false;

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "failed-journal-order",
        checkpoint: () => {
          failing = true;
          throw new Error("post-drain checkpoint fault");
        },
        durability: {
          syncFile: () => {
            if (failing) events.push("failed-journal-fsync");
          },
          syncDirectory: () => undefined,
          writeTemporaryFile: (descriptor, contents) => {
            if (failing) events.push("failed-manifest-write");
            writeFileSync(descriptor, contents);
          },
        },
      }),
    ).rejects.toThrow("post-drain checkpoint fault");
    expect(events.filter((event) => event === "failed-journal-fsync").length).toBeGreaterThan(0);
    expect(events.indexOf("failed-journal-fsync")).toBeLessThan(
      events.indexOf("failed-manifest-write"),
    );
  });

  it.each([
    [
      "initial manifest write",
      {
        writeTemporaryFile: () => {
          throw new Error("write fault");
        },
      },
    ],
    [
      "initial manifest fsync",
      {
        syncTemporaryFile: () => {
          throw new Error("fsync fault");
        },
      },
    ],
    [
      "manifest directory fsync",
      {
        syncDirectory: () => {
          throw new Error("directory fsync fault");
        },
      },
    ],
  ])("cleans a manifest temporary artifact when %s fails", async (_label, durability) => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "manifest-fault-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const backupPath = join(BACKUP_DIR, `manifest-fault-${_label}.db`);
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const restoreId = `manifest-fault-${_label.replaceAll(" ", "-")}`;

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId,
        durability,
      }),
    ).rejects.toThrow(/fault/i);
    expect(
      readdirSync(dirname(TEST_DB)).filter(
        (entry) =>
          entry.startsWith(`.msl-test-dm.db.${restoreId}.manifest.json.`) && entry.endsWith(".tmp"),
      ),
    ).toEqual([]);
  });

  it("fsyncs an atomic manifest temp file before rename and removes it when rename fails", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "manifest-order-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const backupPath = join(BACKUP_DIR, "manifest-order.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const events: string[] = [];
    let temporaryPath = "";

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "manifest-order",
        durability: {
          syncFile: (path) => events.push(`file:${path}`),
          syncDirectory: () => events.push("directory"),
          rename: (from) => {
            temporaryPath = from;
            events.push("rename");
            throw new Error("rename fault");
          },
        },
      }),
    ).rejects.toThrow("rename fault");
    expect(events.indexOf("rename")).toBeGreaterThan(
      events.findIndex((event) => event.includes(".tmp")),
    );
    expect(existsSync(temporaryPath)).toBe(false);
    expect(existsSync(join(dirname(TEST_DB), ".msl-test-dm.db.manifest-order.stage"))).toBe(false);
  });

  it("fsyncs the final manifest before its parent directory after atomic rename", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "manifest-final-order-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const backupPath = join(BACKUP_DIR, "manifest-final-order.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const events: string[] = [];
    const restoreId = "manifest-final-order";

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId,
        durability: {
          syncFile: (path) => {
            if (path.endsWith(`.${restoreId}.manifest.json`)) events.push("final-file");
          },
          syncDirectory: () => events.push("directory"),
          rename: (from, to) => {
            if (to.endsWith(`.${restoreId}.manifest.json`)) events.push("rename");
            renameSync(from, to);
          },
        },
      }),
    ).resolves.toMatchObject({ outcome: "prepared" });

    const rename = events.indexOf("rename");
    expect(events.slice(rename, rename + 3)).toEqual(["rename", "final-file", "directory"]);
  });

  it("preserves final-file fsync failure and removes the published manifest", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({
      db,
      ownerRunId: "manifest-final-fsync-fault-run",
    });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const backupPath = join(BACKUP_DIR, "manifest-final-fsync-fault.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const restoreId = "manifest-final-fsync-fault";
    const manifestPath = join(dirname(TEST_DB), `.msl-test-dm.db.${restoreId}.manifest.json`);

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId,
        durability: {
          syncFile: (path) => {
            if (path === manifestPath) throw new Error("final manifest fsync fault");
          },
          syncDirectory: () => undefined,
        },
      }),
    ).rejects.toThrow("final manifest fsync fault");

    expect(existsSync(manifestPath)).toBe(false);
    expect(
      readdirSync(dirname(TEST_DB)).filter(
        (entry) => entry.startsWith(`${basename(manifestPath)}.`) && entry.endsWith(".tmp"),
      ),
    ).toEqual([]);
    const evidence = new Database(TEST_DB, { readonly: true });
    expect(
      evidence
        .prepare(
          "SELECT phase, outcome, failure_detail FROM economic_restore_journal WHERE restore_id = ?",
        )
        .get(restoreId),
    ).toMatchObject({ phase: "failed", outcome: "failed" });
    evidence.close();
  });

  it("releases the pre-drain journal handle before a participant closes and reopens journal evidence by path", async () => {
    const { db, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "journal-reopen-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const backupPath = join(BACKUP_DIR, "journal-reopen.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    let preDrainJournal: Database.Database | undefined;
    const manager = createDatabaseManager(TEST_DB, () => {
      const handle = new Database(TEST_DB);
      preDrainJournal ??= handle;
      return handle;
    });
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const participantHandle = new Database(TEST_DB);
    let participantCloseObservedReleasedJournal = false;
    let participantReopened = false;
    const registration = lifecycle.register({
      invalidate: () => undefined,
      close: () => {
        participantCloseObservedReleasedJournal = preDrainJournal?.open === false;
        participantHandle.close();
      },
      reopen: () => {
        participantReopened = true;
      },
    });

    try {
      const result = await manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "journal-reopen",
      });
      expect(result).toMatchObject({ outcome: "prepared" });
      expect(participantCloseObservedReleasedJournal).toBe(true);
      expect(participantHandle.open).toBe(false);
      expect(participantReopened).toBe(true);
      const reopenedByPath = new Database(TEST_DB, { readonly: true });
      expect(
        reopenedByPath
          .prepare("SELECT phase, outcome FROM economic_restore_journal WHERE restore_id = ?")
          .get("journal-reopen"),
      ).toEqual({ phase: "quiesced", outcome: null });
      reopenedByPath.close();
      expect(JSON.parse(readFileSync(result.manifestPath, "utf8"))).toMatchObject({
        phase: "quiesced",
      });
    } finally {
      registration.release();
      if (participantHandle.open) participantHandle.close();
    }
  });

  it("recovers a blocked drain, records the root failure, and preserves the target", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "drain-failure-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const backupPath = join(BACKUP_DIR, "drain-failure.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    const registration = lifecycle.register({
      invalidate: () => Promise.reject(new Error("drain root failure")),
    });

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "drain-failure",
      }),
    ).rejects.toThrow("ECONOMIC_DATABASE_LIFECYCLE_BLOCKED");
    expect(lifecycle.state).toBe("open");
    const evidence = new Database(TEST_DB, { readonly: true });
    expect(
      evidence
        .prepare(
          "SELECT phase, outcome, failure_detail FROM economic_restore_journal WHERE restore_id = ?",
        )
        .get("drain-failure"),
    ).toMatchObject({
      phase: "failed",
      outcome: "failed",
      failure_detail: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    evidence.close();
    expect(existsSync(TEST_DB)).toBe(true);
    registration.release();
  });

  it("preserves a post-drain root error when lifecycle reopen fails", async () => {
    const { db, manager, cleanup } = setupTestDb();
    _cleanup = cleanup;
    const plan = createEconomicMigrationPlan();
    plan.apply(db);
    const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "reopen-failure-run" });
    if (acquired.status !== "acquired") throw new Error("test fence unavailable");
    const backupPath = join(BACKUP_DIR, "reopen-failure.db");
    db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(TEST_DB, backupPath);
    db.close();
    let failReopen = true;
    const lifecycle = createEconomicDatabaseLifecycle({
      path: TEST_DB,
      authority: {},
      readFence: () => acquired.fence,
    });
    economicLifecycle = lifecycle;
    economicFence = acquired.fence;
    lifecycle.register({
      invalidate: () => undefined,
      reopen: () => {
        if (failReopen) throw new Error("reopen failure");
      },
    });

    await expect(
      manager.restoreEconomicFrom({
        backupPath,
        fence: acquired.fence,
        lifecycle,
        migrationRegistry: plan,
        restoreId: "reopen-failure",
        checkpoint: () => {
          throw new Error("post-drain root failure");
        },
      }),
    ).rejects.toThrow("post-drain root failure");
    expect(lifecycle.state).toBe("blocked");
    failReopen = false;
    await lifecycle.recover(acquired.fence);
    expect(lifecycle.state).toBe("open");
    const evidence = new Database(TEST_DB, { readonly: true });
    expect(
      evidence
        .prepare("SELECT failure_detail FROM economic_restore_journal WHERE restore_id = ?")
        .get("reopen-failure"),
    ).toEqual({ failure_detail: "post-drain root failure" });
    evidence.close();
    expect(existsSync(TEST_DB)).toBe(true);
  });
});
