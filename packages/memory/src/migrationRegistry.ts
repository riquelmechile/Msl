import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────

export type MigrationStep = {
  /** Monotonically increasing version number. */
  version: number;
  /** Human-readable label for diagnostics. */
  name: string;
  /** The migration function. Executed inside a transaction by the registry. */
  up: (db: Database.Database) => void;
};

export type MigrationApplyResult = {
  /** Number of migrations freshly applied in this run. */
  applied: number;
  /** Number of migrations already recorded and skipped. */
  skipped: number;
};

export type MigrationRegistry = {
  /** Register a migration step. Steps must be registered in version order. */
  register(step: MigrationStep): void;
  /**
   * Apply all pending migrations against the given database.
   *
   * Creates `schema_version` if absent, reads current version, and
   * executes each unapplied step inside a transaction.
   *
   * Idempotent — safe to call on an already-migrated database.
   */
  apply(db: Database.Database): MigrationApplyResult;
  /** Return the highest registered version (0 if none). */
  expectedVersion(): number;
};

export type EconomicDatabaseFence = {
  readonly databaseId: string;
  readonly tenantId: string;
  readonly deploymentId: string;
  readonly generation: number;
  /** Generation of the fence owner, distinct from immutable database generation. */
  readonly fenceGeneration: number;
  readonly writeEpoch: number;
  readonly state: "open" | "blocked";
  readonly tokenDigest: string;
  readonly ownerRunId: string | null;
  readonly expiresAt: number | null;
  readonly lifecycle: EconomicDatabaseFenceLifecycle;
};

export type EconomicDatabaseFenceLifecycle =
  "absent" | "active" | "expired" | "recovering" | "released" | "lost";

export const DEFAULT_ECONOMIC_DATABASE_FENCE_CONFIG = {
  ttlMs: 90_000,
  renewIntervalMs: 30_000,
  recoveryGraceMs: 15_000,
} as const;

export type EconomicDatabaseFenceHandle = {
  readonly ownerRunId: string;
  /** Returned only to the owner; SQLite retains only its SHA-256 digest. */
  readonly token: string;
  readonly generation: number;
  readonly databaseGeneration: number;
  readonly expiresAt: number;
};

export type EconomicDatabaseFenceOperationResult =
  | {
      readonly status: "acquired" | "recovered" | "renewed";
      readonly fence: EconomicDatabaseFenceHandle;
    }
  | { readonly status: "held"; readonly ownerRunId: string; readonly expiresAt: number }
  | { readonly status: "absent" | "expired" | "recovering" | "released" | "lost" };

export type EconomicWriteAdmissionReceipt = {
  readonly receiptId: string;
  /** Returned only at issue time; SQLite retains only its SHA-256 digest. */
  readonly token: string;
  readonly sellerId: string;
  readonly writerKind: string;
  readonly ownerRunId: string;
  readonly databaseGeneration: number;
  readonly fenceGeneration: number;
  readonly leaseGeneration: number;
  readonly expiresAt: number;
};

export type EconomicWriteAdmissionResult =
  | { readonly status: "issued"; readonly receipt: EconomicWriteAdmissionReceipt }
  | { readonly status: "valid" | "consumed" | "already-consumed" }
  | { readonly status: "expired" | "rejected" | "lost" | "absent" };

/** Read-only R3 admission primitive. Lease acquisition/renewal is deliberately R4 work. */
export function readEconomicDatabaseFence(
  db: Database.Database,
  now = Date.now(),
): EconomicDatabaseFence {
  const row = db
    .prepare(
      `SELECT metadata.database_id, metadata.tenant_id, metadata.deployment_id,
              metadata.generation, metadata.write_epoch, fence.generation AS fence_generation,
               fence.state, fence.fence_token_digest, fence.owner_run_id, fence.expires_at
       FROM economic_database_metadata AS metadata
       JOIN economic_database_fence AS fence ON fence.singleton = 1
       WHERE metadata.singleton = 1`,
    )
    .get() as
    | {
        database_id: string;
        tenant_id: string;
        deployment_id: string;
        generation: number;
        write_epoch: number;
        fence_generation: number;
        state: "open" | "blocked";
        fence_token_digest: string;
        owner_run_id: string | null;
        expires_at: number | null;
      }
    | undefined;
  if (!row) throw new Error("Economic database metadata and fence are required");
  return {
    databaseId: row.database_id,
    tenantId: row.tenant_id,
    deploymentId: row.deployment_id,
    generation: row.generation,
    fenceGeneration: row.fence_generation,
    writeEpoch: row.write_epoch,
    state: row.state,
    tokenDigest: row.fence_token_digest,
    ownerRunId: row.owner_run_id,
    expiresAt: row.expires_at,
    lifecycle:
      row.state !== "open"
        ? "lost"
        : row.owner_run_id === null
          ? "released"
          : row.expires_at === null || row.expires_at <= now
            ? "expired"
            : "active",
  };
}

function digestSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

function immediate<T>(db: Database.Database, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function acquireEconomicDatabaseFence(input: {
  readonly db: Database.Database;
  readonly ownerRunId: string;
  readonly now?: number;
}): EconomicDatabaseFenceOperationResult {
  const now = input.now ?? Date.now();
  return immediate(input.db, () => {
    const current = readEconomicDatabaseFence(input.db, now);
    if (current.state !== "open") return { status: "lost" };
    if (
      current.ownerRunId !== null &&
      current.expiresAt !== null &&
      current.expiresAt + DEFAULT_ECONOMIC_DATABASE_FENCE_CONFIG.recoveryGraceMs > now
    ) {
      return current.expiresAt <= now
        ? { status: "recovering" }
        : { status: "held", ownerRunId: current.ownerRunId, expiresAt: current.expiresAt };
    }
    const token = newSecret();
    const generation = current.fenceGeneration + 1;
    const expiresAt = now + DEFAULT_ECONOMIC_DATABASE_FENCE_CONFIG.ttlMs;
    const changes = input.db
      .prepare(
        `UPDATE economic_database_fence
         SET generation = ?, fence_token_digest = ?, owner_run_id = ?, expires_at = ?, updated_at = ?
         WHERE singleton = 1 AND state = 'open' AND generation = ?
           AND (owner_run_id IS NULL OR expires_at + ? <= ?)`,
      )
      .run(
        generation,
        digestSecret(token),
        input.ownerRunId,
        expiresAt,
        now,
        current.fenceGeneration,
        DEFAULT_ECONOMIC_DATABASE_FENCE_CONFIG.recoveryGraceMs,
        now,
      ).changes;
    if (changes !== 1) return { status: "lost" };
    const readback = readEconomicDatabaseFence(input.db, now);
    if (
      readback.ownerRunId !== input.ownerRunId ||
      readback.fenceGeneration !== generation ||
      readback.tokenDigest !== digestSecret(token)
    )
      throw new Error("Economic database fence acquire readback rejected");
    return {
      status: current.ownerRunId === null ? "acquired" : "recovered",
      fence: {
        ownerRunId: input.ownerRunId,
        token,
        generation,
        databaseGeneration: readback.generation,
        expiresAt,
      },
    };
  });
}

export function renewEconomicDatabaseFence(input: {
  readonly db: Database.Database;
  readonly fence: EconomicDatabaseFenceHandle;
  readonly now?: number;
}): EconomicDatabaseFenceOperationResult {
  const now = input.now ?? Date.now();
  return immediate(input.db, () => {
    const expiresAt = now + DEFAULT_ECONOMIC_DATABASE_FENCE_CONFIG.ttlMs;
    const changes = input.db
      .prepare(
        `UPDATE economic_database_fence SET expires_at = ?, updated_at = ?
       WHERE singleton = 1 AND state = 'open' AND generation = ? AND owner_run_id = ?
         AND fence_token_digest = ? AND expires_at > ?`,
      )
      .run(
        expiresAt,
        now,
        input.fence.generation,
        input.fence.ownerRunId,
        digestSecret(input.fence.token),
        now,
      ).changes;
    if (changes !== 1) {
      const current = readEconomicDatabaseFence(input.db, now);
      return current.lifecycle === "expired" ? { status: "expired" } : { status: "lost" };
    }
    return { status: "renewed", fence: { ...input.fence, expiresAt } };
  });
}

export function releaseEconomicDatabaseFence(input: {
  readonly db: Database.Database;
  readonly fence: EconomicDatabaseFenceHandle;
  readonly now?: number;
}): EconomicDatabaseFenceOperationResult {
  const now = input.now ?? Date.now();
  return immediate(input.db, () => {
    const changes = input.db
      .prepare(
        `UPDATE economic_database_fence
       SET owner_run_id = NULL, expires_at = NULL, updated_at = ?
       WHERE singleton = 1 AND state = 'open' AND generation = ? AND owner_run_id = ?
         AND fence_token_digest = ?`,
      )
      .run(
        now,
        input.fence.generation,
        input.fence.ownerRunId,
        digestSecret(input.fence.token),
      ).changes;
    if (changes === 1) return { status: "released" };
    return { status: "lost" };
  });
}

export function issueEconomicWriteAdmissionReceipt(input: {
  readonly db: Database.Database;
  readonly sellerId: string;
  readonly writerKind: string;
  readonly ownerRunId: string;
  readonly fence: EconomicDatabaseFenceHandle;
  readonly leaseGeneration: number;
  readonly ttlMs?: number;
  readonly now?: number;
}): EconomicWriteAdmissionResult {
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? 30_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("Invalid admission receipt TTL");
  return immediate(input.db, () => {
    const fence = readEconomicDatabaseFence(input.db, now);
    if (
      fence.lifecycle !== "active" ||
      fence.fenceGeneration !== input.fence.generation ||
      fence.tokenDigest !== digestSecret(input.fence.token) ||
      fence.ownerRunId !== input.ownerRunId ||
      fence.generation !== input.fence.databaseGeneration
    )
      return { status: "lost" };
    const token = newSecret();
    const receiptId = randomBytes(16).toString("hex");
    const expiresAt = now + ttlMs;
    input.db
      .prepare(
        `INSERT INTO economic_database_write_admission_receipts
       (receipt_id, receipt_token_digest, seller_id, writer_kind, owner_run_id, database_generation,
        fence_generation, lease_generation, status, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)`,
      )
      .run(
        receiptId,
        digestSecret(token),
        input.sellerId,
        input.writerKind,
        input.ownerRunId,
        input.fence.databaseGeneration,
        input.fence.generation,
        input.leaseGeneration,
        now,
        expiresAt,
      );
    return {
      status: "issued",
      receipt: {
        receiptId,
        token,
        sellerId: input.sellerId,
        writerKind: input.writerKind,
        ownerRunId: input.ownerRunId,
        databaseGeneration: input.fence.databaseGeneration,
        fenceGeneration: input.fence.generation,
        leaseGeneration: input.leaseGeneration,
        expiresAt,
      },
    };
  });
}

export function validateEconomicWriteAdmissionReceipt(input: {
  readonly db: Database.Database;
  readonly receipt: EconomicWriteAdmissionReceipt;
  readonly now?: number;
}): EconomicWriteAdmissionResult {
  const now = input.now ?? Date.now();
  const row = input.db
    .prepare(
      `SELECT status, expires_at, seller_id, writer_kind, owner_run_id, database_generation, fence_generation, lease_generation, receipt_token_digest
     FROM economic_database_write_admission_receipts WHERE receipt_id = ?`,
    )
    .get(input.receipt.receiptId) as
    | {
        status: string;
        expires_at: number;
        seller_id: string;
        writer_kind: string;
        owner_run_id: string;
        database_generation: number;
        fence_generation: number;
        lease_generation: number;
        receipt_token_digest: string;
      }
    | undefined;
  if (!row) return { status: "absent" };
  if (row.expires_at <= now) return { status: "expired" };
  if (row.status === "consumed") return { status: "already-consumed" };
  if (
    row.status !== "issued" ||
    row.receipt_token_digest !== digestSecret(input.receipt.token) ||
    row.seller_id !== input.receipt.sellerId ||
    row.writer_kind !== input.receipt.writerKind ||
    row.owner_run_id !== input.receipt.ownerRunId ||
    row.database_generation !== input.receipt.databaseGeneration ||
    row.fence_generation !== input.receipt.fenceGeneration ||
    row.lease_generation !== input.receipt.leaseGeneration
  )
    return { status: "rejected" };
  const fence = readEconomicDatabaseFence(input.db, now);
  if (
    fence.lifecycle !== "active" ||
    fence.generation !== input.receipt.databaseGeneration ||
    fence.fenceGeneration !== input.receipt.fenceGeneration ||
    fence.ownerRunId !== input.receipt.ownerRunId
  )
    return { status: "lost" };
  return { status: "valid" };
}

export function consumeEconomicWriteAdmissionReceipt(input: {
  readonly db: Database.Database;
  readonly receipt: EconomicWriteAdmissionReceipt;
  readonly now?: number;
}): EconomicWriteAdmissionResult {
  const now = input.now ?? Date.now();
  const valid = validateEconomicWriteAdmissionReceipt(input);
  if (valid.status === "already-consumed") return valid;
  if (valid.status !== "valid") return valid;
  const changes = input.db
    .prepare(
      `UPDATE economic_database_write_admission_receipts SET status = 'consumed', consumed_at = ?
     WHERE receipt_id = ? AND receipt_token_digest = ? AND status = 'issued' AND expires_at > ?`,
    )
    .run(now, input.receipt.receiptId, digestSecret(input.receipt.token), now).changes;
  return changes === 1 ? { status: "consumed" } : { status: "rejected" };
}

/**
 * Records a failed admission after its business transaction has rolled back.
 * This is receipt lifecycle coordination, not an economic write, and therefore
 * deliberately does not require another receipt or advance the write epoch.
 */
export function rejectEconomicWriteAdmissionReceipt(input: {
  readonly db: Database.Database;
  readonly receipt: EconomicWriteAdmissionReceipt;
  readonly now?: number;
}): EconomicWriteAdmissionResult {
  const now = input.now ?? Date.now();
  const changes = input.db
    .prepare(
      `UPDATE economic_database_write_admission_receipts
       SET status = 'rejected', rejected_at = ?
       WHERE receipt_id = ? AND receipt_token_digest = ? AND status = 'issued'`,
    )
    .run(now, input.receipt.receiptId, digestSecret(input.receipt.token)).changes;
  if (changes === 1) return { status: "rejected" };
  return validateEconomicWriteAdmissionReceipt(input);
}

// ── Internal helpers ───────────────────────────────────────────────────

/** SQL for the `schema_version` tracking table. */
const SCHEMA_VERSION_DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// ── Factory ────────────────────────────────────────────────────────────

export function createMigrationRegistry(): MigrationRegistry {
  const steps: MigrationStep[] = [];

  const register = (step: MigrationStep): void => {
    // Validate monotonicity.
    if (steps.length > 0) {
      const last = steps[steps.length - 1]!;
      if (step.version <= last.version) {
        throw new Error(
          `Migration version must be monotonically increasing. Got ${step.version} after ${last.version}.`,
        );
      }
    }
    steps.push(step);
  };

  const apply = (db: Database.Database): MigrationApplyResult => {
    // Ensure tracking table exists.
    db.exec(SCHEMA_VERSION_DDL);

    // schema_version is shared by independent registry users. A higher version
    // owned by another subsystem must not make this plan appear fully applied.
    const recorded = new Set(
      (db.prepare("SELECT version FROM schema_version").all() as Array<{ version: number }>).map(
        (row) => row.version,
      ),
    );
    const pending = steps.filter((step) => !recorded.has(step.version));

    if (pending.length === 0) {
      return { applied: 0, skipped: steps.length };
    }

    let applied = 0;
    let skipped = steps.length - pending.length;

    for (const step of pending) {
      // Double-check idempotency — version may have been recorded by an
      // earlier migration step inside this transaction.
      const already = db
        .prepare("SELECT version FROM schema_version WHERE version = ?")
        .get(step.version) as { version: number } | undefined;

      if (already) {
        skipped++;
        continue;
      }

      // Run the migration step inside a transaction.
      const runStep = db.transaction(() => {
        step.up(db);
        db.prepare("INSERT OR IGNORE INTO schema_version (version) VALUES (?)").run(step.version);
      });

      try {
        runStep();
        applied++;
      } catch (err) {
        // Transaction rolled back by SQLite. Log and rethrow so the
        // caller can decide how to handle the failure.
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Migration v${step.version} ("${step.name}") failed: ${message}`);
      }
    }

    return { applied, skipped };
  };

  const expectedVersion = (): number => {
    if (steps.length === 0) return 0;
    return steps[steps.length - 1]!.version;
  };

  return { register, apply, expectedVersion };
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return columns.some((candidate) => candidate.name === column);
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * The sole migration plan for the economic ingestion schema.
 *
 * Versions are intentionally above the historic per-store v2-v5 range so a
 * database with unrelated Cortex migrations cannot skip an economic stage.
 */
export function createEconomicMigrationPlan(): MigrationRegistry {
  const registry = createMigrationRegistry();

  registry.register({
    version: 1_001,
    name: "economic_core_tables",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS economic_ingestion_runs (
          id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, status TEXT NOT NULL,
          mode TEXT NOT NULL, started_at INTEGER, completed_at INTEGER,
          params TEXT, result TEXT, error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS economic_ingestion_checkpoints (
          seller_id TEXT PRIMARY KEY, last_order_date TEXT, last_order_id TEXT,
          last_run_id TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS economic_cost_components (
          id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, type TEXT NOT NULL,
          amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, source TEXT NOT NULL,
          source_record_id TEXT, occurred_at INTEGER NOT NULL, observed_at INTEGER NOT NULL,
          verification TEXT NOT NULL DEFAULT 'unverified', confidence REAL NOT NULL DEFAULT 0,
          metadata_json TEXT DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS unit_economics_snapshots (
          snapshot_id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, account_id TEXT,
          channel TEXT, order_id TEXT, item_id TEXT, sku TEXT, product TEXT,
          period TEXT, currency TEXT NOT NULL, snapshot_json TEXT NOT NULL DEFAULT '{}',
          calculated_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS economic_outcomes (
          outcome_id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, account_id TEXT,
          channel TEXT, proposal_id TEXT, prepared_action_id TEXT, execution_id TEXT,
          correlation_id TEXT, work_session_id TEXT, originating_agent_id TEXT,
          order_id TEXT, item_id TEXT, sku TEXT, expected_economic_impact TEXT,
          observed_economic_impact_id TEXT, observation_window_start INTEGER,
          observation_window_end INTEGER, baseline_reference TEXT, status TEXT NOT NULL DEFAULT 'pending',
          confidence REAL NOT NULL DEFAULT 0, completeness REAL NOT NULL DEFAULT 0,
          evidence_ids_json TEXT DEFAULT '[]', created_at INTEGER NOT NULL,
          observed_at INTEGER, verified_at INTEGER, disputed_at INTEGER, invalidated_at INTEGER,
          verification_reason TEXT, no_mutation_executed INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS economic_evidence_references (
          evidence_id TEXT PRIMARY KEY NOT NULL, seller_id TEXT NOT NULL,
          source_system TEXT NOT NULL, source_entity_type TEXT NOT NULL,
          source_record_id TEXT NOT NULL, source_field TEXT, observed_at INTEGER NOT NULL,
          occurred_at INTEGER, source_version TEXT, checksum TEXT NOT NULL,
          verification TEXT, confidence REAL, superseded_by TEXT,
          ingestion_run_id TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS economic_migration_conflicts (
          conflict_id INTEGER PRIMARY KEY, table_name TEXT NOT NULL,
          conflict_key TEXT NOT NULL, detected_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  });

  registry.register({
    version: 1_002,
    name: "economic_provenance_columns",
    up: (db) => {
      addColumnIfMissing(db, "economic_cost_components", "source_version", "TEXT");
      addColumnIfMissing(db, "economic_cost_components", "economic_meaning", "TEXT");
      addColumnIfMissing(db, "economic_cost_components", "metadata_json", "TEXT DEFAULT '{}'");
      addColumnIfMissing(db, "economic_cost_components", "superseded_at", "INTEGER");
      addColumnIfMissing(db, "economic_cost_components", "reversed_at", "INTEGER");
      addColumnIfMissing(db, "economic_cost_components", "reversed_reason", "TEXT");
      addColumnIfMissing(db, "economic_cost_components", "ingestion_run_id", "TEXT");
      addColumnIfMissing(db, "unit_economics_snapshots", "ingestion_run_id", "TEXT");
      addColumnIfMissing(db, "unit_economics_snapshots", "snapshot_id", "TEXT");
      addColumnIfMissing(db, "unit_economics_snapshots", "account_id", "TEXT");
      addColumnIfMissing(db, "unit_economics_snapshots", "channel", "TEXT");
      addColumnIfMissing(db, "unit_economics_snapshots", "sku", "TEXT");
      addColumnIfMissing(db, "unit_economics_snapshots", "product", "TEXT");
      addColumnIfMissing(db, "unit_economics_snapshots", "period", "TEXT");
      addColumnIfMissing(
        db,
        "unit_economics_snapshots",
        "snapshot_json",
        "TEXT NOT NULL DEFAULT '{}'",
      );
      addColumnIfMissing(
        db,
        "unit_economics_snapshots",
        "calculated_at",
        "INTEGER NOT NULL DEFAULT 0",
      );
      if (columnExists(db, "unit_economics_snapshots", "id")) {
        db.exec("UPDATE unit_economics_snapshots SET snapshot_id = id WHERE snapshot_id IS NULL");
      }
    },
  });

  registry.register({
    version: 1_003,
    name: "economic_identity_conflict_report",
    up: (db) => {
      db.exec(`
        INSERT INTO economic_migration_conflicts (table_name, conflict_key)
        SELECT 'economic_cost_components',
          seller_id || '|' || source || '|' || COALESCE(source_record_id, '') || '|' ||
          COALESCE(economic_meaning, '') || '|' || COALESCE(source_version, '')
        FROM economic_cost_components
        GROUP BY seller_id, source, COALESCE(source_record_id, ''),
          COALESCE(economic_meaning, ''), COALESCE(source_version, '')
        HAVING COUNT(*) > 1;
      `);
      addColumnIfMissing(
        db,
        "economic_cost_components",
        "identity_enforced",
        "INTEGER NOT NULL DEFAULT 0",
      );
      db.exec(`
        UPDATE economic_cost_components
        SET identity_enforced = 1
        WHERE id NOT IN (
          SELECT component.id
          FROM economic_cost_components AS component
          JOIN (
            SELECT seller_id, source, COALESCE(source_record_id, '') AS source_record_id,
              COALESCE(economic_meaning, '') AS economic_meaning,
              COALESCE(source_version, '') AS source_version
            FROM economic_cost_components
            GROUP BY seller_id, source, COALESCE(source_record_id, ''),
              COALESCE(economic_meaning, ''), COALESCE(source_version, '')
            HAVING COUNT(*) > 1
          ) AS duplicate
          ON component.seller_id = duplicate.seller_id
          AND component.source = duplicate.source
          AND COALESCE(component.source_record_id, '') = duplicate.source_record_id
          AND COALESCE(component.economic_meaning, '') = duplicate.economic_meaning
          AND COALESCE(component.source_version, '') = duplicate.source_version
        );
      `);
    },
  });

  registry.register({
    version: 1_004,
    name: "economic_indexes",
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_economic_ingestion_runs_seller_created ON economic_ingestion_runs(seller_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_economic_ingestion_runs_seller_status ON economic_ingestion_runs(seller_id, status);
        CREATE INDEX IF NOT EXISTS idx_economic_cost_components_seller_run ON economic_cost_components(seller_id, ingestion_run_id);
        CREATE INDEX IF NOT EXISTS idx_unit_economics_snapshots_seller_run ON unit_economics_snapshots(seller_id, ingestion_run_id);
        CREATE INDEX IF NOT EXISTS idx_evidence_seller_run ON economic_evidence_references(seller_id, ingestion_run_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_economics_snapshots_snapshot_id
          ON unit_economics_snapshots(snapshot_id) WHERE snapshot_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_component_business_key
          ON economic_cost_components(seller_id, source, COALESCE(source_record_id, ''),
            COALESCE(economic_meaning, ''), COALESCE(source_version, ''))
          WHERE identity_enforced = 1 AND reversed_at IS NULL AND superseded_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_composite_unique ON economic_evidence_references(seller_id, source_system, source_entity_type, source_record_id, source_version, checksum);
      `);
    },
  });

  registry.register({
    version: 1_005,
    name: "economic_durable_checkpoint_fields",
    up: (db) => {
      addColumnIfMissing(
        db,
        "economic_ingestion_runs",
        "checkpoint_advanced",
        "INTEGER NOT NULL DEFAULT 0",
      );
      addColumnIfMissing(db, "economic_ingestion_checkpoints", "occurred_at", "INTEGER");
      addColumnIfMissing(db, "economic_ingestion_checkpoints", "source_record_id", "TEXT");
    },
  });

  registry.register({
    version: 1_006,
    name: "economic_store_provenance_identities",
    up: (db) => {
      addColumnIfMissing(db, "unit_economics_snapshots", "source_version", "TEXT");
      addColumnIfMissing(db, "unit_economics_snapshots", "economic_algorithm_version", "TEXT");
      addColumnIfMissing(db, "unit_economics_snapshots", "economic_checksum", "TEXT");
      addColumnIfMissing(
        db,
        "unit_economics_snapshots",
        "identity_enforced",
        "INTEGER NOT NULL DEFAULT 1",
      );
      db.exec(`
        INSERT INTO economic_migration_conflicts (table_name, conflict_key)
        SELECT 'unit_economics_snapshots',
          seller_id || '|' || order_id || '|' || item_id || '|' || currency || '|' ||
          source_version || '|' || economic_algorithm_version || '|' || economic_checksum
        FROM unit_economics_snapshots
        WHERE order_id IS NOT NULL AND item_id IS NOT NULL AND source_version IS NOT NULL
          AND economic_algorithm_version IS NOT NULL AND economic_checksum IS NOT NULL
        GROUP BY seller_id, order_id, item_id, currency, source_version,
          economic_algorithm_version, economic_checksum
        HAVING COUNT(*) > 1;
        UPDATE unit_economics_snapshots
        SET identity_enforced = 0
        WHERE rowid IN (
          SELECT snapshot.rowid
          FROM unit_economics_snapshots AS snapshot
          JOIN (
            SELECT seller_id, order_id, item_id, currency, source_version,
              economic_algorithm_version, economic_checksum
            FROM unit_economics_snapshots
            WHERE order_id IS NOT NULL AND item_id IS NOT NULL AND source_version IS NOT NULL
              AND economic_algorithm_version IS NOT NULL AND economic_checksum IS NOT NULL
            GROUP BY seller_id, order_id, item_id, currency, source_version,
              economic_algorithm_version, economic_checksum
            HAVING COUNT(*) > 1
          ) AS duplicate
          ON snapshot.seller_id = duplicate.seller_id
          AND snapshot.order_id = duplicate.order_id
          AND snapshot.item_id = duplicate.item_id
          AND snapshot.currency = duplicate.currency
          AND snapshot.source_version = duplicate.source_version
          AND snapshot.economic_algorithm_version = duplicate.economic_algorithm_version
          AND snapshot.economic_checksum = duplicate.economic_checksum
        );
        DROP INDEX IF EXISTS idx_cost_component_business_key;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_component_business_key
          ON economic_cost_components(seller_id, source, COALESCE(source_record_id, ''),
            COALESCE(economic_meaning, ''), COALESCE(source_version, ''), currency, amount_minor)
          WHERE identity_enforced = 1 AND reversed_at IS NULL AND superseded_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshot_business_key
          ON unit_economics_snapshots(seller_id, order_id, item_id, currency, source_version,
            economic_algorithm_version, economic_checksum)
          WHERE identity_enforced = 1 AND order_id IS NOT NULL AND item_id IS NOT NULL AND source_version IS NOT NULL
            AND economic_algorithm_version IS NOT NULL AND economic_checksum IS NOT NULL;
      `);
    },
  });

  registry.register({
    version: 1_007,
    name: "economic_database_metadata_and_fence",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS economic_database_metadata (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          database_id TEXT NOT NULL, tenant_id TEXT NOT NULL, deployment_id TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK(generation >= 1),
          write_epoch INTEGER NOT NULL CHECK(write_epoch >= 0), updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS economic_database_fence (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          state TEXT NOT NULL CHECK(state IN ('open', 'blocked')),
          generation INTEGER NOT NULL CHECK(generation >= 1),
          fence_token_digest TEXT NOT NULL, owner_run_id TEXT,
          expires_at INTEGER, updated_at INTEGER NOT NULL
        );
      `);
      const now = Date.now();
      db.prepare(
        `INSERT OR IGNORE INTO economic_database_metadata
        (singleton, database_id, tenant_id, deployment_id, generation, write_epoch, updated_at)
        VALUES (1, 'economic-local', 'msl', 'local', 1, 0, ?)`,
      ).run(now);
      db.prepare(
        `INSERT OR IGNORE INTO economic_database_fence
        (singleton, state, generation, fence_token_digest, owner_run_id, expires_at, updated_at)
        VALUES (1, 'open', 1, 'checkpoint-writer', NULL, NULL, ?)`,
      ).run(now);
    },
  });

  registry.register({
    version: 1_008,
    name: "economic_seller_leases_and_source_checkpoints",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS economic_seller_leases (
          seller_id TEXT PRIMARY KEY,
          owner_run_id TEXT NOT NULL,
          lease_token_digest TEXT NOT NULL,
          generation INTEGER NOT NULL CHECK(generation >= 1),
          database_generation INTEGER NOT NULL CHECK(database_generation >= 1),
          fence_generation INTEGER NOT NULL CHECK(fence_generation >= 1),
          expires_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_economic_seller_leases_expiry
          ON economic_seller_leases(expires_at);
        CREATE TABLE IF NOT EXISTS economic_source_checkpoints (
          seller_id TEXT NOT NULL,
          source TEXT NOT NULL CHECK(source IN ('orders', 'claims', 'product-ads')),
          occurred_at INTEGER,
          source_record_id TEXT,
          version INTEGER NOT NULL CHECK(version >= 1),
          last_run_id TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (seller_id, source),
          CHECK((occurred_at IS NULL) = (source_record_id IS NULL))
        );
        CREATE INDEX IF NOT EXISTS idx_economic_source_checkpoints_seller_source
          ON economic_source_checkpoints(seller_id, source);
        CREATE INDEX IF NOT EXISTS idx_economic_source_checkpoints_cursor
          ON economic_source_checkpoints(seller_id, source, occurred_at, source_record_id);
      `);
    },
  });

  registry.register({
    version: 1_009,
    name: "economic_claims_retry_backlog_and_source_health",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS economic_source_retry_backlog (
          backlog_identity_key TEXT PRIMARY KEY NOT NULL,
          seller_id TEXT NOT NULL,
          source TEXT NOT NULL CHECK(source = 'claims'),
          range_from INTEGER,
          range_to INTEGER,
          cursor_occurred_at INTEGER,
          cursor_source_record_id TEXT,
          purpose TEXT NOT NULL CHECK(purpose = 'claims-recovery'),
          reason_code TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('pending', 'leased', 'retrying', 'resolved', 'dead-letter', 'administratively-cancelled')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
          next_attempt_at INTEGER NOT NULL,
          claim_owner TEXT,
          claim_token_digest TEXT,
          claim_generation INTEGER,
          claim_expires_at INTEGER,
          last_run_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          resolved_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_economic_retry_backlog_due
          ON economic_source_retry_backlog(seller_id, source, state, next_attempt_at);
        CREATE INDEX IF NOT EXISTS idx_economic_retry_backlog_expiry
          ON economic_source_retry_backlog(claim_expires_at);
        CREATE TABLE IF NOT EXISTS economic_source_retry_backlog_audit (
          audit_id INTEGER PRIMARY KEY,
          backlog_identity_key TEXT NOT NULL,
          seller_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('administratively-cancelled', 'replayed')),
          actor TEXT NOT NULL,
          approver TEXT,
          reason TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY(backlog_identity_key) REFERENCES economic_source_retry_backlog(backlog_identity_key)
        );
        CREATE TABLE IF NOT EXISTS economic_source_health (
          seller_id TEXT NOT NULL,
          source TEXT NOT NULL CHECK(source IN ('orders', 'claims', 'product-ads')),
          ready INTEGER NOT NULL CHECK(ready IN (0, 1)),
          reason_code TEXT,
          requested_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL CHECK(attempts >= 0),
          pages INTEGER NOT NULL CHECK(pages >= 0),
          records INTEGER NOT NULL CHECK(records >= 0),
          retryable INTEGER NOT NULL CHECK(retryable IN (0, 1)),
          retry_at INTEGER,
          backlog_identity_key TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(seller_id, source),
          FOREIGN KEY(backlog_identity_key) REFERENCES economic_source_retry_backlog(backlog_identity_key)
        );
        CREATE INDEX IF NOT EXISTS idx_economic_source_health_readiness
          ON economic_source_health(seller_id, ready, updated_at);
      `);
    },
  });

  registry.register({
    version: 1_010,
    name: "economic_operational_alert_intents",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS economic_operational_alert_intents (
          intent_id TEXT PRIMARY KEY NOT NULL,
          dedup_key TEXT NOT NULL UNIQUE,
          seller_id TEXT NOT NULL,
          alert_type TEXT NOT NULL CHECK(alert_type = 'claims-backlog-administratively-cancelled'),
          severity TEXT NOT NULL CHECK(severity = 'warning'),
          reason_code TEXT NOT NULL CHECK(reason_code = 'administratively-cancelled'),
          source TEXT NOT NULL CHECK(source = 'claims'),
          related_backlog_identity_key TEXT NOT NULL,
          cancellation_version INTEGER NOT NULL CHECK(cancellation_version = 1),
          metadata_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending', 'consumed')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          consumed_at INTEGER,
          FOREIGN KEY(related_backlog_identity_key)
            REFERENCES economic_source_retry_backlog(backlog_identity_key)
        );
        CREATE INDEX IF NOT EXISTS idx_economic_operational_alert_intents_seller_pending
          ON economic_operational_alert_intents(seller_id, status, created_at, intent_id);
        CREATE INDEX IF NOT EXISTS idx_economic_operational_alert_intents_backlog
          ON economic_operational_alert_intents(related_backlog_identity_key);
        CREATE TRIGGER IF NOT EXISTS trg_economic_operational_alert_intents_seller_insert
        BEFORE INSERT ON economic_operational_alert_intents
        FOR EACH ROW WHEN NOT EXISTS (
          SELECT 1 FROM economic_source_retry_backlog
          WHERE backlog_identity_key = NEW.related_backlog_identity_key
            AND seller_id = NEW.seller_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'operational alert intent seller/backlog mismatch');
        END;
      `);
    },
  });

  registry.register({
    version: 1_011,
    name: "economic_database_write_admission_receipts",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS economic_database_write_admission_receipts (
          receipt_id TEXT PRIMARY KEY NOT NULL,
          receipt_token_digest TEXT NOT NULL UNIQUE,
          seller_id TEXT NOT NULL,
          writer_kind TEXT NOT NULL,
          owner_run_id TEXT NOT NULL,
          database_generation INTEGER NOT NULL CHECK(database_generation >= 1),
          fence_generation INTEGER NOT NULL CHECK(fence_generation >= 1),
          lease_generation INTEGER NOT NULL CHECK(lease_generation >= 1),
          status TEXT NOT NULL CHECK(status IN ('issued', 'consumed', 'expired', 'rejected')),
          issued_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL CHECK(expires_at > issued_at),
          consumed_at INTEGER,
          rejected_at INTEGER,
          CHECK((status = 'consumed') = (consumed_at IS NOT NULL)),
          CHECK((status = 'rejected') = (rejected_at IS NOT NULL))
        );
        CREATE INDEX IF NOT EXISTS idx_economic_write_admission_receipts_binding
          ON economic_database_write_admission_receipts
          (seller_id, writer_kind, owner_run_id, database_generation, fence_generation, lease_generation, status, expires_at);
        CREATE INDEX IF NOT EXISTS idx_economic_write_admission_receipts_expiry
          ON economic_database_write_admission_receipts(status, expires_at);
      `);
    },
  });

  return registry;
}
