import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  migrateEconomicEvidenceStore,
  migrateEconomicDurabilityColumns,
} from "../src/economicEvidenceStore.js";

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

        // Apply migrations through registry
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
});
