import type { EconomicEvidenceReference } from "@msl/domain";
import Database from "better-sqlite3";
import { createMigrationRegistry } from "./migrationRegistry.js";

// ── Row type ────────────────────────────────────────────────────────────────

type EvidenceRow = {
  evidence_id: string;
  seller_id: string;
  source_system: string;
  source_entity_type: string;
  source_record_id: string;
  source_field: string | null;
  observed_at: number;
  occurred_at: number | null;
  source_version: string | null;
  checksum: string;
  verification: string | null;
  confidence: number | null;
  superseded_by: string | null;
  ingestion_run_id: string;
  created_at: number;
};

// ── Public types ────────────────────────────────────────────────────────────

export type ListEvidenceOptions = {
  ingestionRunId?: string;
  verification?: string;
  limit?: number;
};

export type EconomicEvidenceStore = {
  /** Insert a new evidence reference. Throws on composite key conflict. */
  insertEvidence(ref: EconomicEvidenceReference): void;

  /**
   * Upsert an evidence reference.
   * Uses INSERT ON CONFLICT DO NOTHING for idempotency.
   * Returns the existing row if a conflict is detected, null if inserted.
   */
  upsertEvidence(ref: EconomicEvidenceReference): EconomicEvidenceReference | null;

  /** Get a single evidence reference by ID, scoped to seller. */
  getEvidence(evidenceId: string, sellerId: string): EconomicEvidenceReference | null;

  /** List evidence refs for a seller, with optional filters. */
  listBySeller(sellerId: string, opts?: ListEvidenceOptions): EconomicEvidenceReference[];

  /** List evidence refs produced by a specific ingestion run, scoped to seller. */
  listByRun(ingestionRunId: string, sellerId: string): EconomicEvidenceReference[];

  /** List evidence refs originating from a specific source record, scoped to seller. */
  listBySourceRecord(sourceRecordId: string, sellerId: string): EconomicEvidenceReference[];

  /** Mark an evidence reference as superseded by another. */
  markSuperseded(evidenceId: string, supersededBy: string): void;

  /** Count evidence refs for a specific ingestion run. */
  countByRun(ingestionRunId: string): number;
};

// ── Row → domain conversion ─────────────────────────────────────────────────

function evidenceFromRow(row: EvidenceRow): EconomicEvidenceReference {
  return {
    evidenceId: row.evidence_id,
    sellerId: row.seller_id,
    sourceSystem: row.source_system,
    sourceEntityType: row.source_entity_type,
    sourceRecordId: row.source_record_id,
    ...(row.source_field !== null ? { sourceField: row.source_field } : {}),
    observedAt: row.observed_at,
    occurredAt: row.occurred_at ?? 0,
    sourceVersion: row.source_version ?? "",
    checksum: row.checksum,
    verification: (row.verification ?? "unverified") as EconomicEvidenceReference["verification"],
    confidence: row.confidence ?? 0,
    ingestionRunId: row.ingestion_run_id,
  };
}

// ── Migration ───────────────────────────────────────────────────────────────

export function migrateEconomicEvidenceStore(db: Database.Database): void {
  if (process.env.MSL_MIGRATION_ENABLED === "true") {
    const registry = createMigrationRegistry();
    registry.register({
      version: 5,
      name: "economic_evidence_references",
      up: (d) => {
        d.exec(`
          CREATE TABLE IF NOT EXISTS economic_evidence_references (
            evidence_id TEXT PRIMARY KEY NOT NULL,
            seller_id TEXT NOT NULL,
            source_system TEXT NOT NULL,
            source_entity_type TEXT NOT NULL,
            source_record_id TEXT NOT NULL,
            source_field TEXT,
            observed_at INTEGER NOT NULL,
            occurred_at INTEGER,
            source_version TEXT,
            checksum TEXT NOT NULL,
            verification TEXT,
            confidence REAL,
            superseded_by TEXT,
            ingestion_run_id TEXT NOT NULL,
            created_at INTEGER NOT NULL
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_composite_unique
            ON economic_evidence_references(seller_id, source_system, source_entity_type, source_record_id, source_version, checksum);

          CREATE INDEX IF NOT EXISTS idx_evidence_ingestion_run
            ON economic_evidence_references(ingestion_run_id);

          CREATE INDEX IF NOT EXISTS idx_evidence_seller
            ON economic_evidence_references(seller_id);

          CREATE INDEX IF NOT EXISTS idx_evidence_source_record
            ON economic_evidence_references(source_record_id);
        `);
      },
    });
    registry.apply(db);
    return;
  }

  // Legacy path (MSL_MIGRATION_ENABLED !== "true")
  db.exec(`
    CREATE TABLE IF NOT EXISTS economic_evidence_references (
      evidence_id TEXT PRIMARY KEY NOT NULL,
      seller_id TEXT NOT NULL,
      source_system TEXT NOT NULL,
      source_entity_type TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      source_field TEXT,
      observed_at INTEGER NOT NULL,
      occurred_at INTEGER,
      source_version TEXT,
      checksum TEXT NOT NULL,
      verification TEXT,
      confidence REAL,
      superseded_by TEXT,
      ingestion_run_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_composite_unique
      ON economic_evidence_references(seller_id, source_system, source_entity_type, source_record_id, source_version, checksum);

    CREATE INDEX IF NOT EXISTS idx_evidence_ingestion_run
      ON economic_evidence_references(ingestion_run_id);

    CREATE INDEX IF NOT EXISTS idx_evidence_seller
      ON economic_evidence_references(seller_id);

    CREATE INDEX IF NOT EXISTS idx_evidence_source_record
      ON economic_evidence_references(source_record_id);
  `);
}

// ── Migration v2-v4: add columns and indexes to existing tables ─────────────

export function migrateEconomicDurabilityColumns(db: Database.Database): void {
  if (process.env.MSL_MIGRATION_ENABLED === "true") {
    const registry = createMigrationRegistry();
    // v2: ingestion run indexes
    registry.register({
      version: 2,
      name: "economic_ingestion_runs_indexes",
      up: (d) => {
        d.exec(`
          CREATE INDEX IF NOT EXISTS idx_economic_ingestion_runs_seller_created
            ON economic_ingestion_runs(seller_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_economic_ingestion_runs_seller_status
            ON economic_ingestion_runs(seller_id, status);
          CREATE INDEX IF NOT EXISTS idx_economic_ingestion_runs_seller_id
            ON economic_ingestion_runs(seller_id, id);
        `);
      },
    });
    // v3: ingestion_run_id on cost_components
    registry.register({
      version: 3,
      name: "cost_components_ingestion_run_id",
      up: (d) => {
        d.exec(
          `ALTER TABLE economic_cost_components ADD COLUMN ingestion_run_id TEXT`,
        );
      },
    });
    // v4: ingestion_run_id on snapshots
    registry.register({
      version: 4,
      name: "snapshots_ingestion_run_id",
      up: (d) => {
        d.exec(
          `ALTER TABLE unit_economics_snapshots ADD COLUMN ingestion_run_id TEXT`,
        );
      },
    });
    registry.apply(db);
    return;
  }

  // Legacy path — add columns and indexes idempotently
  // v2: ingestion run indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_economic_ingestion_runs_seller_created
      ON economic_ingestion_runs(seller_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_economic_ingestion_runs_seller_status
      ON economic_ingestion_runs(seller_id, status);
    CREATE INDEX IF NOT EXISTS idx_economic_ingestion_runs_seller_id
      ON economic_ingestion_runs(seller_id, id);
  `);

  // v3: ingestion_run_id on cost_components
  try {
    db.exec(`ALTER TABLE economic_cost_components ADD COLUMN ingestion_run_id TEXT`);
  } catch {
    // Column already exists — ignore.
  }

  // v4: ingestion_run_id on snapshots
  try {
    db.exec(`ALTER TABLE unit_economics_snapshots ADD COLUMN ingestion_run_id TEXT`);
  } catch {
    // Column already exists — ignore.
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createSqliteEconomicEvidenceStore(
  db: Database.Database,
): EconomicEvidenceStore {
  migrateEconomicEvidenceStore(db);

  // ── Prepared statements ───────────────────────────────────────────────

  const insertStmt = db.prepare(`
    INSERT INTO economic_evidence_references
      (evidence_id, seller_id, source_system, source_entity_type, source_record_id,
       source_field, observed_at, occurred_at, source_version, checksum,
       verification, confidence, superseded_by, ingestion_run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);

  const upsertStmt = db.prepare(`
    INSERT INTO economic_evidence_references
      (evidence_id, seller_id, source_system, source_entity_type, source_record_id,
       source_field, observed_at, occurred_at, source_version, checksum,
       verification, confidence, superseded_by, ingestion_run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(seller_id, source_system, source_entity_type, source_record_id, source_version, checksum)
    DO NOTHING
  `);

  const findExistingStmt = db.prepare(`
    SELECT * FROM economic_evidence_references
    WHERE seller_id = ?
      AND source_system = ?
      AND source_entity_type = ?
      AND source_record_id = ?
      AND source_version = ?
      AND checksum = ?
    LIMIT 1
  `);

  const getEvidenceStmt = db.prepare(
    "SELECT * FROM economic_evidence_references WHERE evidence_id = ? AND seller_id = ?",
  );

  const listBySellerStmt = db.prepare(`
    SELECT * FROM economic_evidence_references
    WHERE seller_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const listBySellerAndRunStmt = db.prepare(`
    SELECT * FROM economic_evidence_references
    WHERE seller_id = ? AND ingestion_run_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const listBySellerAndVerificationStmt = db.prepare(`
    SELECT * FROM economic_evidence_references
    WHERE seller_id = ? AND verification = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const listBySellerRunVerificationStmt = db.prepare(`
    SELECT * FROM economic_evidence_references
    WHERE seller_id = ? AND ingestion_run_id = ? AND verification = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const listByRunStmt = db.prepare(`
    SELECT * FROM economic_evidence_references
    WHERE ingestion_run_id = ? AND seller_id = ?
    ORDER BY created_at DESC
  `);

  const listBySourceRecordStmt = db.prepare(`
    SELECT * FROM economic_evidence_references
    WHERE source_record_id = ? AND seller_id = ?
    ORDER BY created_at DESC
  `);

  const markSupersededStmt = db.prepare(`
    UPDATE economic_evidence_references
    SET superseded_by = ?
    WHERE evidence_id = ?
  `);

  const countByRunStmt = db.prepare(
    "SELECT COUNT(*) as cnt FROM economic_evidence_references WHERE ingestion_run_id = ?",
  );

  // ── Store implementation ──────────────────────────────────────────────

  return {
    insertEvidence(ref: EconomicEvidenceReference): void {
      insertStmt.run(
        ref.evidenceId,
        ref.sellerId,
        ref.sourceSystem,
        ref.sourceEntityType,
        ref.sourceRecordId,
        ref.sourceField ?? null,
        ref.observedAt,
        ref.occurredAt,
        ref.sourceVersion,
        ref.checksum,
        ref.verification,
        ref.confidence,
        ref.ingestionRunId,
        Date.now(),
      );
    },

    upsertEvidence(ref: EconomicEvidenceReference): EconomicEvidenceReference | null {
      const existing = findExistingStmt.get(
        ref.sellerId,
        ref.sourceSystem,
        ref.sourceEntityType,
        ref.sourceRecordId,
        ref.sourceVersion,
        ref.checksum,
      ) as EvidenceRow | undefined;

      if (existing) {
        // Already exists — return the existing row (idempotent).
        return evidenceFromRow(existing);
      }

      upsertStmt.run(
        ref.evidenceId,
        ref.sellerId,
        ref.sourceSystem,
        ref.sourceEntityType,
        ref.sourceRecordId,
        ref.sourceField ?? null,
        ref.observedAt,
        ref.occurredAt,
        ref.sourceVersion,
        ref.checksum,
        ref.verification,
        ref.confidence,
        ref.ingestionRunId,
        Date.now(),
      );

      // Check if the upsert succeeded or was a conflict
      const afterRow = findExistingStmt.get(
        ref.sellerId,
        ref.sourceSystem,
        ref.sourceEntityType,
        ref.sourceRecordId,
        ref.sourceVersion,
        ref.checksum,
      ) as EvidenceRow | undefined;

      // If the row's evidence_id matches ours, it was inserted.
      // If different, it was a conflict and upsertStmt did NOTHING.
      if (afterRow && afterRow.evidence_id === ref.evidenceId) {
        return null; // Inserted successfully
      }
      return afterRow ? evidenceFromRow(afterRow) : null;
    },

    getEvidence(evidenceId: string, sellerId: string): EconomicEvidenceReference | null {
      const row = getEvidenceStmt.get(evidenceId, sellerId) as EvidenceRow | undefined;
      return row ? evidenceFromRow(row) : null;
    },

    listBySeller(sellerId: string, opts: ListEvidenceOptions = {}): EconomicEvidenceReference[] {
      const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));

      let rows: EvidenceRow[];
      if (opts.ingestionRunId && opts.verification) {
        rows = listBySellerRunVerificationStmt.all(
          sellerId, opts.ingestionRunId, opts.verification, limit,
        ) as EvidenceRow[];
      } else if (opts.ingestionRunId) {
        rows = listBySellerAndRunStmt.all(
          sellerId, opts.ingestionRunId, limit,
        ) as EvidenceRow[];
      } else if (opts.verification) {
        rows = listBySellerAndVerificationStmt.all(
          sellerId, opts.verification, limit,
        ) as EvidenceRow[];
      } else {
        rows = listBySellerStmt.all(sellerId, limit) as EvidenceRow[];
      }

      return rows.map(evidenceFromRow);
    },

    listByRun(ingestionRunId: string, sellerId: string): EconomicEvidenceReference[] {
      const rows = listByRunStmt.all(ingestionRunId, sellerId) as EvidenceRow[];
      return rows.map(evidenceFromRow);
    },

    listBySourceRecord(sourceRecordId: string, sellerId: string): EconomicEvidenceReference[] {
      const rows = listBySourceRecordStmt.all(sourceRecordId, sellerId) as EvidenceRow[];
      return rows.map(evidenceFromRow);
    },

    markSuperseded(evidenceId: string, supersededBy: string): void {
      markSupersededStmt.run(supersededBy, evidenceId);
    },

    countByRun(ingestionRunId: string): number {
      const row = countByRunStmt.get(ingestionRunId) as { cnt: number } | undefined;
      return row?.cnt ?? 0;
    },
  };
}
