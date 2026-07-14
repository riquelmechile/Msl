import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createMigrationRegistry } from "./migrationRegistry.js";

describe("MigrationRegistry", () => {
  // ── Fresh DB ───────────────────────────────────────────────────

  it("applies all migrations on a fresh database", () => {
    const db = new Database(":memory:");
    const registry = createMigrationRegistry();

    const created: string[] = [];
    registry.register({
      version: 1,
      name: "create_users",
      up: (d) => {
        d.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
        created.push("v1");
      },
    });
    registry.register({
      version: 2,
      name: "add_email",
      up: (d) => {
        d.exec("ALTER TABLE users ADD COLUMN email TEXT");
        created.push("v2");
      },
    });

    const result = registry.apply(db);

    expect(result.applied).toBe(2);
    expect(result.skipped).toBe(0);
    expect(created).toEqual(["v1", "v2"]);

    // schema_version table exists with correct rows.
    const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all() as {
      version: number;
    }[];
    expect(versions).toEqual([{ version: 1 }, { version: 2 }]);

    // Tables actually exist.
    const cols = db.pragma("table_info(users)") as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("email");

    db.close();
  });

  it("creates schema_version with version 0 base when table doesn't exist", () => {
    const db = new Database(":memory:");
    const registry = createMigrationRegistry();
    registry.register({
      version: 1,
      name: "init",
      up: (d) => {
        d.exec("CREATE TABLE t (x INTEGER)");
      },
    });

    // Verify currentVersion starts at 0 before apply.
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
      .get();
    expect(exists).toBeUndefined();

    registry.apply(db);

    const existsAfter = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
      .get();
    expect(existsAfter).toBeDefined();

    db.close();
  });

  // ── Idempotent re-run ──────────────────────────────────────────

  it("skips already-applied migrations on re-run (idempotent)", () => {
    const db = new Database(":memory:");
    const registry = createMigrationRegistry();

    let callCount = 0;
    registry.register({
      version: 1,
      name: "create_t",
      up: (d) => {
        d.exec("CREATE TABLE IF NOT EXISTS t (x INTEGER)");
        callCount++;
      },
    });
    registry.register({
      version: 2,
      name: "add_y",
      up: (d) => {
        d.exec("ALTER TABLE t ADD COLUMN y INTEGER");
        callCount++;
      },
    });

    // First run.
    const r1 = registry.apply(db);
    expect(r1.applied).toBe(2);
    expect(callCount).toBe(2);

    // Second run — everything skipped.
    const r2 = registry.apply(db);
    expect(r2.applied).toBe(0);
    expect(r2.skipped).toBe(2);
    expect(callCount).toBe(2); // up() never called again.

    db.close();
  });

  it("does not re-apply partially-migrated database", () => {
    const db = new Database(":memory:");
    const registry = createMigrationRegistry();

    registry.register({
      version: 1,
      name: "create_t",
      up: (d) => {
        d.exec("CREATE TABLE t (x INTEGER)");
      },
    });
    registry.register({
      version: 2,
      name: "add_y",
      up: (d) => {
        d.exec("ALTER TABLE t ADD COLUMN y INTEGER");
      },
    });
    registry.register({
      version: 3,
      name: "add_z",
      up: (d) => {
        d.exec("ALTER TABLE t ADD COLUMN z INTEGER");
      },
    });

    // Apply all.
    const r1 = registry.apply(db);
    expect(r1.applied).toBe(3);

    // Simulate a second registry with the same steps applied to same DB.
    const registry2 = createMigrationRegistry();
    registry2.register({
      version: 1,
      name: "create_t",
      up: () => {},
    });
    registry2.register({
      version: 2,
      name: "add_y",
      up: () => {},
    });
    registry2.register({
      version: 3,
      name: "add_z",
      up: () => {},
    });

    const r2 = registry2.apply(db);
    expect(r2.applied).toBe(0);
    expect(r2.skipped).toBe(3);

    db.close();
  });

  // ── Transactional rollback ─────────────────────────────────────

  it("rolls back a failing migration step while keeping prior steps", () => {
    const db = new Database(":memory:");
    const registry = createMigrationRegistry();

    registry.register({
      version: 1,
      name: "create_t",
      up: (d) => {
        d.exec("CREATE TABLE t (name TEXT)");
        d.exec("INSERT INTO t (name) VALUES ('before-fail')");
      },
    });

    // Apply v1 alone first so it is committed before the failing step.
    const r1 = registry.apply(db);
    expect(r1.applied).toBe(1);

    // Now register v2 on the same registry and try to apply.
    registry.register({
      version: 2,
      name: "bad_alter",
      up: (d) => {
        d.exec("CREATE TABLE u (id INTEGER)"); // succeeds
        d.exec("THIS IS NOT VALID SQL"); // fails mid-transaction
      },
    });

    let thrown: Error | null = null;
    try {
      registry.apply(db);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('Migration v2 ("bad_alter") failed');

    // schema_version still at v1 — v2 was rolled back.
    const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all() as {
      version: number;
    }[];
    expect(versions).toEqual([{ version: 1 }]);

    // v1's data survived.
    const rows = db.prepare("SELECT name FROM t").all() as { name: string }[];
    expect(rows).toEqual([{ name: "before-fail" }]);

    // v2's partial work is rolled back.
    const uExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='u'")
      .get();
    expect(uExists).toBeUndefined();

    db.close();
  });

  it("keeps DB at previous version when migration fails", () => {
    const db = new Database(":memory:");
    const registry = createMigrationRegistry();

    // Two successful migrations.
    registry.register({
      version: 1,
      name: "v1",
      up: (d) => {
        d.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      },
    });
    registry.register({
      version: 2,
      name: "v2",
      up: (d) => {
        d.exec("CREATE TABLE u (id INTEGER PRIMARY KEY)");
      },
    });

    const r1 = registry.apply(db);
    expect(r1.applied).toBe(2);

    // Now add a third that always fails.
    registry.register({
      version: 3,
      name: "v3_fail",
      up: () => {
        throw new Error("simulated failure");
      },
    });

    expect(() => registry.apply(db)).toThrow(/Migration v3 \("v3_fail"\) failed/);

    // DB should still be at v2.
    const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all() as {
      version: number;
    }[];
    expect(versions.map((v) => v.version)).toEqual([1, 2]);

    // Both tables still exist.
    const tExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t'")
      .get();
    expect(tExists).toBeDefined();
    const uExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='u'")
      .get();
    expect(uExists).toBeDefined();

    db.close();
  });

  // ── expectedVersion ────────────────────────────────────────────

  it("returns expectedVersion as the highest registered version", () => {
    const registry = createMigrationRegistry();
    expect(registry.expectedVersion()).toBe(0);

    registry.register({ version: 1, name: "v1", up: () => {} });
    expect(registry.expectedVersion()).toBe(1);

    registry.register({ version: 3, name: "v3", up: () => {} });
    expect(registry.expectedVersion()).toBe(3);
  });

  // ── Monotonicity guard ─────────────────────────────────────────

  it("rejects non-monotonic registrations", () => {
    const registry = createMigrationRegistry();
    registry.register({ version: 1, name: "v1", up: () => {} });

    expect(() => {
      registry.register({ version: 1, name: "v1_dup", up: () => {} });
    }).toThrow(/monotonically increasing/);

    expect(() => {
      registry.register({ version: 0, name: "v0", up: () => {} });
    }).toThrow(/monotonically increasing/);
  });

  // ── Cortex backward compatibility — existing schema_version rows ──

  it("accepts existing schema_version rows without re-applying (Cortex compat)", () => {
    const db = new Database(":memory:");

    // Simulate an existing Cortex database at version 2.
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')));
      INSERT INTO schema_version (version) VALUES (1);
      INSERT INTO schema_version (version) VALUES (2);
    `);

    const registry = createMigrationRegistry();
    let called = false;
    registry.register({
      version: 1,
      name: "v1",
      up: () => {
        called = true;
      },
    });
    registry.register({
      version: 2,
      name: "v2",
      up: () => {
        called = true;
      },
    });
    registry.register({
      version: 3,
      name: "v3",
      up: (d) => {
        d.exec("CREATE TABLE new_t (x INTEGER)");
      },
    });

    const result = registry.apply(db);
    expect(result.applied).toBe(1); // Only v3.
    expect(result.skipped).toBe(2); // v1, v2 already present.
    expect(called).toBe(false); // v1, v2 up() never invoked.

    // Original rows still present.
    const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all() as {
      version: number;
    }[];
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);

    db.close();
  });

  // ── Empty registry ─────────────────────────────────────────────

  it("apply on empty registry is a no-op", () => {
    const db = new Database(":memory:");
    const registry = createMigrationRegistry();

    const result = registry.apply(db);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(0);

    // schema_version table created anyway (for future use).
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
      .get();
    expect(exists).toBeDefined();

    db.close();
  });

  // ── Zero registered version ────────────────────────────────────

  it("expectedVersion returns 0 for empty registry", () => {
    const registry = createMigrationRegistry();
    expect(registry.expectedVersion()).toBe(0);
  });
});
