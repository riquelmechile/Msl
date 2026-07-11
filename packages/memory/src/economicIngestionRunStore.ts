import type { EconomicIngestionRun, IngestionRunMode, IngestionRunStatus } from "@msl/domain";
import Database from "better-sqlite3";

// ── Row types ──────────────────────────────────────────────────────────────

type RunRow = {
  id: string;
  seller_id: string;
  status: string;
  mode: string;
  started_at: number | null;
  completed_at: number | null;
  params: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
};

type CheckpointRow = {
  seller_id: string;
  last_order_date: string | null;
  last_order_id: string | null;
  last_run_id: string | null;
  updated_at: string;
};

// ── Public types ───────────────────────────────────────────────────────────

export type Checkpoint = {
  sellerId: string;
  lastOrderDate: string | null;
  lastOrderId: string | null;
  lastRunId: string | null;
  updatedAt: string;
};

export type CreateRunInput = {
  runId: string;
  sellerId: string;
  mode: IngestionRunMode;
  status: IngestionRunStatus;
  startedAt?: number;
  completedAt?: number;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
};

export type UpdateRunInput = {
  status?: IngestionRunStatus;
  completedAt?: number;
  result?: Record<string, unknown>;
  error?: string;
};

export type EconomicIngestionRunStore = {
  createRun(run: CreateRunInput): Promise<EconomicIngestionRun>;
  updateRun(id: string, updates: UpdateRunInput): Promise<EconomicIngestionRun>;
  getRun(id: string): Promise<EconomicIngestionRun | null>;
  getLastRunBySeller(sellerId: string): Promise<EconomicIngestionRun | null>;
  listRunsBySeller(sellerId: string, limit?: number): Promise<EconomicIngestionRun[]>;
  getActiveRun(sellerId: string): Promise<EconomicIngestionRun | null>;
  recoverAbandonedRun(sellerId: string): Promise<void>;
  getCheckpoint(sellerId: string): Promise<Checkpoint | null>;
  updateCheckpoint(
    sellerId: string,
    data: { lastOrderDate?: string; lastOrderId?: string; lastRunId?: string },
  ): Promise<void>;
};

// ── Sanitization ───────────────────────────────────────────────────────────

/**
 * Strip file paths and stack traces from error strings.
 * Stack traces that reveal local filesystem paths are not exported.
 */
function sanitizeError(raw: string): string {
  // Remove stack traces that contain file paths (lines starting with whitespace
  // followed by "at " and a path string).
  const lines = raw.split("\n");
  const cleaned = lines
    .filter((line) => {
      const trimmed = line.trimStart();
      // Strip typical stack trace lines
      if (trimmed.startsWith("at ") && (trimmed.includes("/") || trimmed.includes("\\"))) {
        return false;
      }
      // Strip "at ..." lines generally
      if (trimmed.startsWith("at ")) {
        return false;
      }
      return true;
    })
    .join("\n");
  return cleaned.trim();
}

// ── Row → domain conversion ────────────────────────────────────────────────

function parseParams(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reconstruct an EconomicIngestionRun from a database row.
 *
 * Bypasses the domain factory because rows persisted to the store were already
 * validated on creation. Reconstruction should faithfully reflect what was stored
 * regardless of intermediate statuses (e.g., "running" is valid at the persistence
 * layer even though the domain type narrows to specific statuses).
 */
function runFromRow(row: RunRow): EconomicIngestionRun {
  const parsedParams = parseParams(row.params);
  const parsedResult = parseParams(row.result);

  return {
    runId: row.id,
    sellerId: row.seller_id,
    mode: row.mode as IngestionRunMode,
    sourceKinds: (parsedParams?.sourceKinds as readonly string[]) ?? ["orders", "items", "claims", "ads"],
    startedAt: row.started_at ?? 0,
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
    recordsFetched: (parsedResult?.recordsFetched as number) ?? 0,
    recordsNormalized: (parsedResult?.recordsNormalized as number) ?? 0,
    componentsCreated: (parsedResult?.componentsCreated as number) ?? 0,
    snapshotsCreated: (parsedResult?.snapshotsCreated as number) ?? 0,
    duplicatesIgnored: (parsedResult?.duplicatesIgnored as number) ?? 0,
    partialSnapshots: (parsedResult?.partialSnapshots as number) ?? 0,
    disputedSnapshots: (parsedResult?.disputedSnapshots as number) ?? 0,
    errors: [],
    status: row.status as IngestionRunStatus,
    noExternalMutationExecuted: true,
  } as EconomicIngestionRun;
}

function checkpointFromRow(row: CheckpointRow): Checkpoint {
  return {
    sellerId: row.seller_id,
    lastOrderDate: row.last_order_date,
    lastOrderId: row.last_order_id,
    lastRunId: row.last_run_id,
    updatedAt: row.updated_at,
  };
}

// ── Migration ──────────────────────────────────────────────────────────────

export function migrateEconomicIngestionRunStore(db: Database.Database): void {
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

    CREATE TABLE IF NOT EXISTS economic_ingestion_checkpoints (
      seller_id TEXT PRIMARY KEY,
      last_order_date TEXT,
      last_order_id TEXT,
      last_run_id TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Indices for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_economic_ingestion_runs_seller
      ON economic_ingestion_runs(seller_id);
    CREATE INDEX IF NOT EXISTS idx_economic_ingestion_runs_seller_status
      ON economic_ingestion_runs(seller_id, status);
  `);
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createSqliteEconomicIngestionRunStore(
  db: Database.Database,
): EconomicIngestionRunStore {
  migrateEconomicIngestionRunStore(db);

  // ── Prepared statements ────────────────────────────────────────────────

  const insertRunStmt = db.prepare(`
    INSERT INTO economic_ingestion_runs
      (id, seller_id, status, mode, started_at, completed_at, params, result, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateRunStmt = db.prepare(`
    UPDATE economic_ingestion_runs
    SET status = COALESCE(?, status),
        completed_at = COALESCE(?, completed_at),
        result = COALESCE(?, result),
        error = COALESCE(?, error)
    WHERE id = ?
  `);

  const getRunStmt = db.prepare(
    "SELECT * FROM economic_ingestion_runs WHERE id = ?",
  );

  const getLastRunStmt = db.prepare(`
    SELECT * FROM economic_ingestion_runs
    WHERE seller_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const listRunsStmt = db.prepare(`
    SELECT * FROM economic_ingestion_runs
    WHERE seller_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const getActiveRunStmt = db.prepare(`
    SELECT * FROM economic_ingestion_runs
    WHERE seller_id = ? AND status IN ('pending', 'fetching', 'normalizing', 'adapting', 'computing', 'persisting')
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const recoverAbandonedRunsStmt = db.prepare(`
    UPDATE economic_ingestion_runs
    SET status = 'failed',
        error = 'Recovered: previous run was abandoned (process restart).',
        completed_at = strftime('%s', 'now') * 1000
    WHERE seller_id = ? AND status IN ('pending', 'fetching', 'normalizing', 'adapting', 'computing', 'persisting')
  `);

  const getCheckpointStmt = db.prepare(`
    SELECT * FROM economic_ingestion_checkpoints
    WHERE seller_id = ?
  `);

  const upsertCheckpointStmt = db.prepare(`
    INSERT INTO economic_ingestion_checkpoints
      (seller_id, last_order_date, last_order_id, last_run_id, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(seller_id) DO UPDATE SET
      last_order_date = COALESCE(excluded.last_order_date, economic_ingestion_checkpoints.last_order_date),
      last_order_id = COALESCE(excluded.last_order_id, economic_ingestion_checkpoints.last_order_id),
      last_run_id = COALESCE(excluded.last_run_id, economic_ingestion_checkpoints.last_run_id),
      updated_at = excluded.updated_at
  `);

  // ── Store implementation ─────────────────────────────────────────────────

  return {
    async createRun(input: CreateRunInput): Promise<EconomicIngestionRun> {
      const now = new Date().toISOString();
      const error = input.error ? sanitizeError(input.error) : null;
      const paramsJson = input.params ? JSON.stringify(input.params) : null;
      const resultJson = input.result ? JSON.stringify(input.result) : null;

      insertRunStmt.run(
        input.runId,
        input.sellerId,
        input.status,
        input.mode,
        input.startedAt ?? null,
        input.completedAt ?? null,
        paramsJson,
        resultJson,
        error,
        now,
      );

      const row = getRunStmt.get(input.runId) as RunRow | undefined;
      if (!row) {
        throw new Error(`Failed to create ingestion run: ${input.runId}`);
      }

      return runFromRow(row);
    },

    async updateRun(id: string, updates: UpdateRunInput): Promise<EconomicIngestionRun> {
      const error = updates.error ? sanitizeError(updates.error) : null;
      const resultJson = updates.result ? JSON.stringify(updates.result) : null;

      updateRunStmt.run(
        updates.status ?? null,
        updates.completedAt ?? null,
        resultJson,
        error,
        id,
      );

      const row = getRunStmt.get(id) as RunRow | undefined;
      if (!row) {
        throw new Error(`Ingestion run not found: ${id}`);
      }

      return runFromRow(row);
    },

    async getRun(id: string): Promise<EconomicIngestionRun | null> {
      const row = getRunStmt.get(id) as RunRow | undefined;
      if (!row) return null;
      return runFromRow(row);
    },

    async getLastRunBySeller(sellerId: string): Promise<EconomicIngestionRun | null> {
      const row = getLastRunStmt.get(sellerId) as RunRow | undefined;
      if (!row) return null;
      return runFromRow(row);
    },

    async listRunsBySeller(sellerId: string, limit = 20): Promise<EconomicIngestionRun[]> {
      const rows = listRunsStmt.all(sellerId, limit) as RunRow[];
      return rows.map(runFromRow);
    },

    async getActiveRun(sellerId: string): Promise<EconomicIngestionRun | null> {
      const row = getActiveRunStmt.get(sellerId) as RunRow | undefined;
      if (!row) return null;
      return runFromRow(row);
    },

    async recoverAbandonedRun(sellerId: string): Promise<void> {
      recoverAbandonedRunsStmt.run(sellerId);
    },

    async getCheckpoint(sellerId: string): Promise<Checkpoint | null> {
      const row = getCheckpointStmt.get(sellerId) as CheckpointRow | undefined;
      if (!row) return null;
      return checkpointFromRow(row);
    },

    async updateCheckpoint(
      sellerId: string,
      data: { lastOrderDate?: string; lastOrderId?: string; lastRunId?: string },
    ): Promise<void> {
      upsertCheckpointStmt.run(
        sellerId,
        data.lastOrderDate ?? null,
        data.lastOrderId ?? null,
        data.lastRunId ?? null,
        new Date().toISOString(),
      );
    },
  };
}
