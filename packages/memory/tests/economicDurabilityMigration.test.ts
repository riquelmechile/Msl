import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migrateEconomicEvidenceStore,
  migrateEconomicDurabilityColumns,
  createSqliteEconomicEvidenceStore,
} from "../src/economicEvidenceStore.js";
import { createEconomicMigrationPlan } from "../src/migrationRegistry.js";
import { createSqliteEconomicOutcomeStore } from "../src/economicOutcomeStore.js";
import {
  createSqliteEconomicIngestionRunStore,
  migrateEconomicIngestionRunStore,
} from "../src/economicIngestionRunStore.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Create a database with only v1 tables (old DDL, no evidence, no new columns). */
function createV1Database(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS economic_ingestion_runs (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      params TEXT,
      result TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS economic_cost_components (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount_minor INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CLP',
      source TEXT NOT NULL,
      source_record_id TEXT,
      source_version TEXT,
      source_entity_type TEXT,
      source_field TEXT,
      source_amount_minor REAL,
      source_currency TEXT,
      occurred_at INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      verification TEXT NOT NULL DEFAULT 'unverified',
      confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS unit_economics_snapshots (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      correlation_id TEXT,
      currency TEXT NOT NULL DEFAULT 'CLP',
      gross_revenue INTEGER NOT NULL DEFAULT 0,
      marketplace_fees INTEGER NOT NULL DEFAULT 0,
      seller_shipping_cost INTEGER NOT NULL DEFAULT 0,
      advertising_cost INTEGER NOT NULL DEFAULT 0,
      seller_discounts INTEGER NOT NULL DEFAULT 0,
      refunds INTEGER NOT NULL DEFAULT 0,
      product_cost INTEGER NOT NULL DEFAULT 0,
      landed_cost INTEGER NOT NULL DEFAULT 0,
      taxes INTEGER NOT NULL DEFAULT 0,
      financing_cost INTEGER NOT NULL DEFAULT 0,
      packaging_cost INTEGER NOT NULL DEFAULT 0,
      other_costs INTEGER NOT NULL DEFAULT 0,
      contribution_profit INTEGER NOT NULL DEFAULT 0,
      net_profit INTEGER NOT NULL DEFAULT 0,
      contribution_margin REAL NOT NULL DEFAULT 0,
      net_margin REAL NOT NULL DEFAULT 0,
      missing_inputs TEXT,
      calculation_status TEXT NOT NULL DEFAULT 'complete',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS economic_ingestion_checkpoints (
      seller_id TEXT PRIMARY KEY,
      last_order_date TEXT,
      last_order_id TEXT,
      last_run_id TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Insert a test row to verify data preservation
  db.prepare(
    `
    INSERT INTO economic_ingestion_runs (id, seller_id, status, mode, started_at, created_at)
    VALUES ('test-run-v1', 'plasticov', 'completed', 'incremental', 1700000000000, '2024-01-01')
  `,
  ).run();

  db.prepare(
    `
    INSERT INTO economic_cost_components (id, seller_id, type, source, occurred_at, observed_at)
    VALUES ('cc-v1', 'plasticov', 'marketplace_fee', 'mercadolibre', 1700000000000, 1700000000000)
  `,
  ).run();

  return db;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Economic Durability Migration", () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  });

  describe("v1 → v5 upgrade", () => {
    it("creates all new columns and tables (v2-v5)", () => {
      db = createV1Database();

      // Apply v2-v4 (column additions + indexes)
      migrateEconomicDurabilityColumns(db);
      // Apply v5 (evidence table)
      migrateEconomicEvidenceStore(db);

      // Verify v2: run indexes exist
      const runIndexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND name LIKE 'idx_economic_ingestion_runs_%'
      `,
        )
        .all() as Array<{ name: string }>;
      expect(runIndexes.length).toBeGreaterThanOrEqual(1);

      // Verify v3: ingestion_run_id on cost_components
      const ccCols = db.prepare("PRAGMA table_info(economic_cost_components)").all() as Array<{
        name: string;
      }>;
      const ccColNames = ccCols.map((c) => c.name);
      expect(ccColNames).toContain("ingestion_run_id");

      // Verify v4: ingestion_run_id on snapshots
      const snapCols = db.prepare("PRAGMA table_info(unit_economics_snapshots)").all() as Array<{
        name: string;
      }>;
      const snapColNames = snapCols.map((c) => c.name);
      expect(snapColNames).toContain("ingestion_run_id");

      // Verify v5: evidence table exists with all columns
      const evCols = db.prepare("PRAGMA table_info(economic_evidence_references)").all() as Array<{
        name: string;
      }>;
      const evColNames = evCols.map((c) => c.name);
      expect(evColNames).toContain("evidence_id");
      expect(evColNames).toContain("seller_id");
      expect(evColNames).toContain("source_system");
      expect(evColNames).toContain("source_entity_type");
      expect(evColNames).toContain("source_record_id");
      expect(evColNames).toContain("checksum");
      expect(evColNames).toContain("superseded_by");
      expect(evColNames).toContain("ingestion_run_id");
      expect(evColNames).toContain("created_at");

      // Verify evidence indexes exist
      const evIndexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND name LIKE 'idx_evidence_%'
      `,
        )
        .all() as Array<{ name: string }>;
      expect(evIndexes.length).toBeGreaterThanOrEqual(3);
    });

    it("preserves existing data through migration", () => {
      db = createV1Database();

      migrateEconomicDurabilityColumns(db);
      migrateEconomicEvidenceStore(db);

      // Existing run preserved
      const run = db
        .prepare("SELECT id, seller_id, status FROM economic_ingestion_runs WHERE id = ?")
        .get("test-run-v1") as { id: string; seller_id: string; status: string };
      expect(run).not.toBeNull();
      expect(run.id).toBe("test-run-v1");
      expect(run.status).toBe("completed");

      // Existing cost component preserved
      const cc = db
        .prepare("SELECT id, seller_id, type FROM economic_cost_components WHERE id = ?")
        .get("cc-v1") as { id: string; seller_id: string; type: string };
      expect(cc).not.toBeNull();
      expect(cc.id).toBe("cc-v1");
      expect(cc.type).toBe("marketplace_fee");

      // New column should be NULL for existing rows (not dropped)
      const ccNewCol = db
        .prepare("SELECT ingestion_run_id FROM economic_cost_components WHERE id = ?")
        .get("cc-v1") as { ingestion_run_id: string | null };
      expect(ccNewCol.ingestion_run_id).toBeNull();
    });
  });

  describe("idempotent re-run", () => {
    it("applying migrations at v5 should skip all steps", () => {
      db = createV1Database();

      // First migration
      migrateEconomicDurabilityColumns(db);
      migrateEconomicEvidenceStore(db);

      // Second migration — should be idempotent (no errors)
      expect(() => {
        migrateEconomicDurabilityColumns(db);
        migrateEconomicEvidenceStore(db);
      }).not.toThrow();

      // Tables should still exist
      const evTable = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='economic_evidence_references'",
        )
        .get() as { name: string };
      expect(evTable).not.toBeNull();

      // No duplicate columns
      const ccCols = db.prepare("PRAGMA table_info(economic_cost_components)").all() as Array<{
        name: string;
      }>;
      const ccColNames = ccCols.map((c) => c.name);
      // ingestion_run_id should appear exactly once
      const occurrences = ccColNames.filter((n) => n === "ingestion_run_id").length;
      expect(occurrences).toBe(1);
    });
  });

  describe("evidence table creation", () => {
    it("creates evidence table with correct structure", () => {
      db = new Database(":memory:");
      db.pragma("journal_mode = WAL");

      migrateEconomicEvidenceStore(db);

      // Table exists
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='economic_evidence_references'",
        )
        .get() as { name: string };
      expect(table).not.toBeNull();

      // Can insert evidence
      db.prepare(
        `
        INSERT INTO economic_evidence_references
          (evidence_id, seller_id, source_system, source_entity_type, source_record_id,
           source_field, observed_at, occurred_at, source_version, checksum,
           verification, confidence, superseded_by, ingestion_run_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `,
      ).run(
        "ev-test-1",
        "plasticov",
        "mercadolibre",
        "order",
        "order-001",
        null,
        Date.now(),
        Date.now() - 86400000,
        "2026-01-01",
        "sha256:abc",
        "verified",
        0.95,
        "run-001",
        Date.now(),
      );

      // Can query
      const row = db
        .prepare("SELECT * FROM economic_evidence_references WHERE evidence_id = ?")
        .get("ev-test-1") as Record<string, unknown>;
      expect(row).not.toBeNull();
    });
  });

  describe("migration registry integration", () => {
    it("migration registry tracks applied versions when MSL_MIGRATION_ENABLED=true", () => {
      const original = process.env.MSL_MIGRATION_ENABLED;
      process.env.MSL_MIGRATION_ENABLED = "true";

      try {
        db = new Database(":memory:");
        db.pragma("journal_mode = WAL");

        // Create base tables that v2-v5 migrations expect to exist
        db.exec(`
          CREATE TABLE IF NOT EXISTS economic_ingestion_runs (
            id TEXT PRIMARY KEY,
            seller_id TEXT NOT NULL,
            status TEXT NOT NULL,
            mode TEXT NOT NULL,
            started_at INTEGER,
            completed_at INTEGER,
            params TEXT,
            result TEXT,
            error TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE TABLE IF NOT EXISTS economic_cost_components (
            id TEXT PRIMARY KEY,
            seller_id TEXT NOT NULL,
            type TEXT NOT NULL,
            amount_minor INTEGER NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'CLP',
            source TEXT NOT NULL,
            source_record_id TEXT,
            source_version TEXT,
            occurred_at INTEGER NOT NULL,
            observed_at INTEGER NOT NULL,
            verification TEXT NOT NULL DEFAULT 'unverified',
            confidence REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE TABLE IF NOT EXISTS unit_economics_snapshots (
            id TEXT PRIMARY KEY,
            seller_id TEXT NOT NULL,
            order_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CLP',
            gross_revenue INTEGER NOT NULL DEFAULT 0,
            marketplace_fees INTEGER NOT NULL DEFAULT 0,
            seller_shipping_cost INTEGER NOT NULL DEFAULT 0,
            advertising_cost INTEGER NOT NULL DEFAULT 0,
            seller_discounts INTEGER NOT NULL DEFAULT 0,
            refunds INTEGER NOT NULL DEFAULT 0,
            product_cost INTEGER NOT NULL DEFAULT 0,
            landed_cost INTEGER NOT NULL DEFAULT 0,
            taxes INTEGER NOT NULL DEFAULT 0,
            financing_cost INTEGER NOT NULL DEFAULT 0,
            packaging_cost INTEGER NOT NULL DEFAULT 0,
            other_costs INTEGER NOT NULL DEFAULT 0,
            contribution_profit INTEGER NOT NULL DEFAULT 0,
            net_profit INTEGER NOT NULL DEFAULT 0,
            contribution_margin REAL NOT NULL DEFAULT 0,
            net_margin REAL NOT NULL DEFAULT 0,
            missing_inputs TEXT,
            calculation_status TEXT NOT NULL DEFAULT 'complete',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `);

        // The runtime applies the canonical plan before stores prepare statements.
        createEconomicMigrationPlan().apply(db);
        migrateEconomicDurabilityColumns(db);
        migrateEconomicEvidenceStore(db);

        // schema_version table should exist
        const svTable = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
          .get() as { name: string } | undefined;
        expect(svTable).not.toBeNull();

        // Should have recorded at least one migration version
        const versions = db.prepare("SELECT COUNT(*) as cnt FROM schema_version").get() as {
          cnt: number;
        };
        expect(versions.cnt).toBeGreaterThanOrEqual(1);
      } finally {
        process.env.MSL_MIGRATION_ENABLED = original!;
      }
    });
  });

  describe("canonical economic migration plan", () => {
    it("creates the full schema once on a fresh database", () => {
      db = new Database(":memory:");

      const first = createEconomicMigrationPlan().apply(db);
      const second = createEconomicMigrationPlan().apply(db);

      expect(first.applied).toBe(12);
      expect(second).toEqual({ applied: 0, skipped: 12 });
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='economic_evidence_references'",
          )
          .get(),
      ).toBeDefined();
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='economic_operational_alert_intents'",
          )
          .get(),
      ).toBeDefined();
    });

    it("applies 1013 after 1011 once and preserves earlier migration records on rerun", () => {
      db = new Database(":memory:");

      const first = createEconomicMigrationPlan().apply(db);
      const second = createEconomicMigrationPlan().apply(db);
      const versions = db
        .prepare(
          "SELECT version FROM schema_version WHERE version BETWEEN 1007 AND 1013 ORDER BY version",
        )
        .all();

      expect(first).toEqual({ applied: 12, skipped: 0 });
      expect(second).toEqual({ applied: 0, skipped: 12 });
      expect(versions).toEqual([
        { version: 1007 },
        { version: 1008 },
        { version: 1009 },
        { version: 1010 },
        { version: 1011 },
        { version: 1013 },
      ]);
      expect(
        db.prepare("SELECT version FROM schema_version WHERE version = 1012").get(),
      ).toBeUndefined();
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'economic_restore_journal'",
          )
          .get(),
      ).toBeDefined();
    });

    it("rolls back 1013 journal objects and its version record when its schema cannot apply", () => {
      db = new Database(":memory:");
      createEconomicMigrationPlan().apply(db);
      db.exec(`
        DROP TRIGGER trg_economic_restore_journal_immutable_identity;
        DROP INDEX idx_economic_restore_journal_phase;
        DROP TABLE economic_restore_journal;
      `);
      db.prepare("DELETE FROM schema_version WHERE version = 1013").run();
      db.exec("CREATE TABLE economic_restore_journal (restore_id TEXT PRIMARY KEY)");

      expect(() => createEconomicMigrationPlan().apply(db)).toThrow(/Migration v1013/);
      expect(
        db.prepare("SELECT version FROM schema_version WHERE version = 1013").get(),
      ).toBeUndefined();
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_economic_restore_journal_phase'",
          )
          .get(),
      ).toBeUndefined();

      db.exec("DROP TABLE economic_restore_journal");
      expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 1, skipped: 11 });
    });

    it("enforces journal identity, lifecycle integrity, and immutable bindings", () => {
      db = new Database(":memory:");
      createEconomicMigrationPlan().apply(db);
      const insertJournal = db.prepare(`
        INSERT INTO economic_restore_journal (
          restore_id, database_id, database_generation, backup_identity, backup_sha256,
          backup_page_count, owner_run_id, fence_generation, fence_token_digest, write_epoch, phase
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertJournal.run(
        "restore-1",
        "economic-local",
        1,
        "backup-1",
        "a".repeat(64),
        10,
        "restore-run-1",
        2,
        "token-digest",
        3,
        "fence-acquired",
      );

      expect(() => {
        insertJournal.run(
          "restore-invalid-phase",
          "economic-local",
          1,
          "backup-2",
          "b".repeat(64),
          1,
          "restore-run-2",
          2,
          "token-digest",
          3,
          "unknown",
        );
      }).toThrow();
      expect(() => {
        db.prepare(
          "UPDATE economic_restore_journal SET database_id = 'other' WHERE restore_id = 'restore-1'",
        ).run();
      }).toThrow(/immutable/);
      expect(() => {
        db.prepare(
          "UPDATE economic_restore_journal SET restore_id = 'restore-2' WHERE restore_id = 'restore-1'",
        ).run();
      }).toThrow(/immutable/);
      expect(() => {
        db.prepare(
          "UPDATE economic_restore_journal SET phase = 'failed', outcome = 'failed' WHERE restore_id = 'restore-1'",
        ).run();
      }).toThrow();

      db.prepare(
        "UPDATE economic_restore_journal SET phase = 'completed', outcome = 'completed' WHERE restore_id = 'restore-1'",
      ).run();
      expect(
        db
          .prepare(
            "SELECT phase, outcome FROM economic_restore_journal WHERE restore_id = 'restore-1'",
          )
          .get(),
      ).toEqual({ phase: "completed", outcome: "completed" });
    });

    it("delegates legacy run-store migration to the canonical 1001–1010 plan", () => {
      db = new Database(":memory:");

      expect(() => migrateEconomicIngestionRunStore(db)).not.toThrow();
      expect(
        db
          .prepare(
            "SELECT version FROM schema_version WHERE version IN (1007, 1008, 1010) ORDER BY version",
          )
          .all(),
      ).toEqual([{ version: 1007 }, { version: 1008 }, { version: 1010 }]);
      expect(() => migrateEconomicIngestionRunStore(db)).not.toThrow();
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM schema_version WHERE version IN (1007, 1008, 1010)",
          )
          .get(),
      ).toEqual({ count: 3 });
    });

    it("preserves null legacy provenance while adding run columns", () => {
      db = createV1Database();

      createEconomicMigrationPlan().apply(db);

      const row = db
        .prepare("SELECT ingestion_run_id FROM economic_cost_components WHERE id = 'cc-v1'")
        .get() as { ingestion_run_id: string | null };
      expect(row.ingestion_run_id).toBeNull();
    });

    it("reports duplicate legacy component identities without deleting rows", () => {
      db = createV1Database();
      db.prepare(
        `
        INSERT INTO economic_cost_components
          (id, seller_id, type, source, source_record_id, occurred_at, observed_at)
        VALUES ('cc-v1-duplicate', 'plasticov', 'marketplace_fee', 'mercadolibre', 'same-order', 1, 1)
      `,
      ).run();
      db.prepare(
        "UPDATE economic_cost_components SET source_record_id = 'same-order' WHERE id = 'cc-v1'",
      ).run();

      createEconomicMigrationPlan().apply(db);

      const components = db
        .prepare(
          "SELECT COUNT(*) AS count FROM economic_cost_components WHERE source_record_id = 'same-order'",
        )
        .get() as { count: number };
      const conflicts = db
        .prepare("SELECT COUNT(*) AS count FROM economic_migration_conflicts")
        .get() as { count: number };
      expect(components.count).toBe(2);
      expect(conflicts.count).toBe(1);

      expect(() => {
        db.prepare(
          `INSERT INTO economic_cost_components
            (id, seller_id, type, amount_minor, currency, source, source_record_id,
             occurred_at, observed_at, verification, confidence, identity_enforced)
           VALUES ('new-component', 'plasticov', 'marketplace_fee', 1, 'CLP', 'mercadolibre',
             'new-order', 1, 1, 'unverified', 0, 1)`,
        ).run();
        db.prepare(
          `INSERT INTO economic_cost_components
            (id, seller_id, type, amount_minor, currency, source, source_record_id,
             occurred_at, observed_at, verification, confidence, identity_enforced)
           VALUES ('new-conflict', 'plasticov', 'marketplace_fee', 1, 'CLP', 'mercadolibre',
             'new-order', 1, 1, 'unverified', 0, 1)`,
        ).run();
      }).toThrow();

      expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 0, skipped: 12 });
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM economic_migration_conflicts").get(),
      ).toEqual({ count: 1 });
    });

    it("quarantines duplicate legacy snapshot identities, reports them, and preserves them on rerun", () => {
      db = new Database(":memory:");
      createEconomicMigrationPlan().apply(db);
      db.exec("DROP INDEX idx_snapshot_business_key");
      db.prepare("DELETE FROM schema_version WHERE version = 1006").run();

      const insertLegacy = db.prepare(`
        INSERT INTO unit_economics_snapshots
          (snapshot_id, seller_id, order_id, item_id, currency, snapshot_json, calculated_at,
           source_version, economic_algorithm_version, economic_checksum)
        VALUES (?, 'plasticov', 'legacy-order', 'legacy-item', 'CLP', '{}', 1,
          'legacy-v1', 'economic-v1', 'legacy-checksum')
      `);
      insertLegacy.run("legacy-snapshot-a");
      insertLegacy.run("legacy-snapshot-b");

      expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 1, skipped: 11 });
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM unit_economics_snapshots WHERE order_id = 'legacy-order'",
          )
          .get(),
      ).toEqual({ count: 2 });
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM economic_migration_conflicts WHERE table_name = 'unit_economics_snapshots'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM unit_economics_snapshots WHERE identity_enforced = 0",
          )
          .get(),
      ).toEqual({ count: 2 });
      expect(() => {
        db.prepare(
          `
          INSERT INTO unit_economics_snapshots
            (snapshot_id, seller_id, order_id, item_id, currency, snapshot_json, calculated_at,
             source_version, economic_algorithm_version, economic_checksum, identity_enforced)
          VALUES ('new-snapshot-a', 'plasticov', 'new-order', 'new-item', 'CLP', '{}', 1,
            'v1', 'economic-v1', 'checksum', 1)
        `,
        ).run();
        db.prepare(
          `
          INSERT INTO unit_economics_snapshots
            (snapshot_id, seller_id, order_id, item_id, currency, snapshot_json, calculated_at,
             source_version, economic_algorithm_version, economic_checksum, identity_enforced)
          VALUES ('new-snapshot-b', 'plasticov', 'new-order', 'new-item', 'CLP', '{}', 1,
            'v1', 'economic-v1', 'checksum', 1)
        `,
        ).run();
      }).toThrow();
      expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 0, skipped: 12 });
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM economic_migration_conflicts WHERE table_name = 'unit_economics_snapshots'",
          )
          .get(),
      ).toEqual({ count: 1 });
    });

    it("does not let an unrelated higher global version skip economic ownership", () => {
      db = new Database(":memory:");
      db.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT)");
      db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
        9_999,
        "now",
      );

      expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 12, skipped: 0 });
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM schema_version WHERE version BETWEEN 1001 AND 1005",
          )
          .get(),
      ).toEqual({ count: 5 });
    });

    it("does not let an unrelated exact 1013 record suppress the restore journal", () => {
      db = new Database(":memory:");
      db.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT)");
      db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
        1_013,
        "unrelated-owner",
      );

      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'economic_restore_journal'",
          )
          .get(),
      ).toBeUndefined();
      expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 12, skipped: 0 });
      expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 0, skipped: 12 });
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'economic_restore_journal'",
          )
          .get(),
      ).toBeDefined();
      expect(
        db.prepare("SELECT applied_at FROM schema_version WHERE version = 1013").get(),
      ).toEqual({
        applied_at: "unrelated-owner",
      });
      expect(
        db.prepare("SELECT version FROM schema_version WHERE version = 1012").get(),
      ).toBeUndefined();
    });

    it("rejects an exact 1013 record paired with a malformed same-name journal", () => {
      db = new Database(":memory:");
      db.exec(`
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT);
        INSERT INTO schema_version (version, applied_at) VALUES (1013, 'unrelated-owner');
        CREATE TABLE economic_restore_journal (restore_id TEXT PRIMARY KEY);
      `);

      expect(() => createEconomicMigrationPlan().apply(db)).toThrow(
        /Migration v1013 \("economic_restore_journal"\) failed/,
      );
      expect(
        db.prepare("SELECT applied_at FROM schema_version WHERE version = 1013").get(),
      ).toEqual({ applied_at: "unrelated-owner" });
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name = 'idx_economic_restore_journal_phase'",
          )
          .get(),
      ).toBeUndefined();
    });

    it("keeps migration-mode store constructors preparation-only", () => {
      const original = process.env.MSL_MIGRATION_ENABLED;
      process.env.MSL_MIGRATION_ENABLED = "true";
      db = new Database(":memory:");

      try {
        migrateEconomicDurabilityColumns(db);
        migrateEconomicEvidenceStore(db);
        expect(
          db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
            .get(),
        ).toBeUndefined();
      } finally {
        process.env.MSL_MIGRATION_ENABLED = original;
      }
    });

    it("upgrades legacy snapshots without loss and supports migration-mode store reads and writes", async () => {
      const original = process.env.MSL_MIGRATION_ENABLED;
      process.env.MSL_MIGRATION_ENABLED = "true";
      db = createV1Database();
      db.prepare(
        `INSERT INTO unit_economics_snapshots (id, seller_id, order_id, item_id, currency)
         VALUES ('legacy-snapshot', 'plasticov', 'legacy-order', 'legacy-item', 'CLP')`,
      ).run();

      try {
        createEconomicMigrationPlan().apply(db);
        const outcomeStore = createSqliteEconomicOutcomeStore(db);
        const runStore = createSqliteEconomicIngestionRunStore(db);
        createSqliteEconomicEvidenceStore(db);

        expect(outcomeStore.listUnitEconomicsSnapshots("plasticov")[0]?.snapshotId).toBe(
          "legacy-snapshot",
        );
        outcomeStore.insertUnitEconomicsSnapshot({
          snapshotId: "current-snapshot",
          sellerId: "plasticov",
          currency: "CLP",
          calculatedAt: 42,
          orderId: "current-order",
          itemId: "current-item",
        } as never);
        expect(
          outcomeStore.listUnitEconomicsSnapshots("plasticov", { snapshotId: "current-snapshot" }),
        ).toHaveLength(1);

        await runStore.updateCheckpoint("plasticov", {
          occurredAt: 42,
          sourceRecordId: "order-42",
        });
        await expect(runStore.getCheckpoint("plasticov")).resolves.toMatchObject({
          occurredAt: 42,
          sourceRecordId: "order-42",
        });
        await runStore.createRun({
          runId: "checkpoint-result-run",
          sellerId: "plasticov",
          mode: "incremental",
          status: "completed",
          checkpointAdvanced: true,
        });
        expect(
          db
            .prepare("SELECT checkpoint_advanced FROM economic_ingestion_runs WHERE id = ?")
            .get("checkpoint-result-run"),
        ).toEqual({ checkpoint_advanced: 1 });
        await runStore.updateRun("checkpoint-result-run", { checkpointAdvanced: false });
        expect(
          db
            .prepare("SELECT checkpoint_advanced FROM economic_ingestion_runs WHERE id = ?")
            .get("checkpoint-result-run"),
        ).toEqual({ checkpoint_advanced: 0 });
      } finally {
        process.env.MSL_MIGRATION_ENABLED = original;
      }
    });

    it("migrates an isolated temporary database without touching shared state", () => {
      const directory = mkdtempSync(join(tmpdir(), "msl-economic-migration-"));
      const databasePath = join(directory, "economic.sqlite");

      try {
        db = new Database(databasePath);
        expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 12, skipped: 0 });
        expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 0, skipped: 12 });
        db.close();

        const reopened = new Database(databasePath, { readonly: true });
        const result = reopened
          .prepare(
            "SELECT COUNT(*) AS count FROM schema_version WHERE version BETWEEN 1001 AND 1005",
          )
          .get() as { count: number };
        const journal = reopened
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'economic_restore_journal'",
          )
          .get();
        reopened.close();
        expect(result.count).toBe(5);
        expect(journal).toBeDefined();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });
});
