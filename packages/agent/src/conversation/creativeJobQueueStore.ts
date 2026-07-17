import Database from "better-sqlite3";
import type { CreativeJobStatus, CreativeJobKind, CreativeChannel } from "@msl/creative-studio";

// ── Schema ───────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS creative_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  kind TEXT NOT NULL,
  channel TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  actual_cost_usd REAL,
  asset_paths_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cj_status ON creative_jobs(status);
CREATE INDEX IF NOT EXISTS idx_cj_job_id ON creative_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_cj_seller_status ON creative_jobs(seller_id, status);
`;

// ── Row type ─────────────────────────────────────────────────────────

export type CreativeJobRow = {
  id: number;
  job_id: string;
  request_id: string;
  seller_id: string;
  status: CreativeJobStatus;
  kind: CreativeJobKind;
  channel: CreativeChannel;
  provider: string;
  estimated_cost_usd: number;
  actual_cost_usd: number | null;
  asset_paths_json: string;
  payload_json: string;
  result_json: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
};

// ── Input type ───────────────────────────────────────────────────────

export type CreateCreativeJobInput = {
  jobId: string;
  requestId: string;
  sellerId: string;
  kind: CreativeJobKind;
  channel: CreativeChannel;
  provider?: string;
  estimatedCostUsd?: number;
  payloadJson?: string;
};

// ── Status machine ───────────────────────────────────────────────────

/**
 * Valid status transitions for creative jobs.
 * Maps current status → allowed next statuses.
 * Terminal states: published, rejected, failed — no transitions out.
 */
const VALID_TRANSITIONS: Record<CreativeJobStatus, readonly CreativeJobStatus[]> = {
  queued: ["running", "policy-review", "provider-routing", "failed"],
  "policy-review": ["provider-routing", "queued", "failed"],
  "provider-routing": ["running", "failed"],
  running: ["needs-human-review", "failed"],
  "needs-human-review": ["approved", "rejected", "failed"],
  approved: ["prepared-for-publish", "failed"],
  rejected: [],
  "prepared-for-publish": ["published", "failed"],
  published: [],
  failed: [],
};

// ── Store type ───────────────────────────────────────────────────────

export type CreativeJobQueueStore = {
  /** Insert a new job with status "queued". */
  createJob(input: CreateCreativeJobInput): CreativeJobRow;
  /** Look up a job by its job_id (cj_ prefix). */
  getJob(jobId: string): CreativeJobRow | undefined;
  /** Transition a job to a new status. Throws on invalid transition. */
  updateStatus(jobId: string, newStatus: CreativeJobStatus): CreativeJobRow;
  /** Update result data when a job completes. */
  completeJob(
    jobId: string,
    result: { actualCostUsd?: number; assetPaths?: string[]; resultJson?: string },
  ): CreativeJobRow;
  /** Record failure details. */
  failJob(jobId: string, errorJson: string): CreativeJobRow;
  /** List jobs by status. Returns newest first. */
  listByStatus(status: CreativeJobStatus): CreativeJobRow[];
  /** List all jobs. Returns newest first. */
  listAll(): CreativeJobRow[];
};

// ── Factory ──────────────────────────────────────────────────────────

export function createCreativeJobQueueStore(db: Database.Database): CreativeJobQueueStore {
  db.exec(SCHEMA_SQL);

  // ── Prepared statements ────────────────────────────────────

  const selectByJobIdStmt = db.prepare(`
    SELECT * FROM creative_jobs WHERE job_id = ?
  `);

  const insertStmt = db.prepare(`
    INSERT INTO creative_jobs (job_id, request_id, seller_id, kind, channel, provider, estimated_cost_usd, payload_json)
    VALUES (@jobId, @requestId, @sellerId, @kind, @channel, @provider, @estimatedCostUsd, @payloadJson)
  `);

  const updateStatusStmt = db.prepare(`
    UPDATE creative_jobs
    SET status = @status, updated_at = datetime('now')
    WHERE job_id = @jobId
  `);

  const completeStmt = db.prepare(`
    UPDATE creative_jobs
    SET status = @status, actual_cost_usd = @actualCostUsd,
        asset_paths_json = @assetPathsJson, result_json = @resultJson,
        updated_at = datetime('now')
    WHERE job_id = @jobId
  `);

  const failStmt = db.prepare(`
    UPDATE creative_jobs
    SET status = 'failed', error_json = @errorJson, updated_at = datetime('now')
    WHERE job_id = @jobId
  `);

  const listByStatusStmt = db.prepare(`
    SELECT * FROM creative_jobs
    WHERE status = ?
    ORDER BY created_at DESC
  `);

  const listAllStmt = db.prepare(`
    SELECT * FROM creative_jobs
    ORDER BY created_at DESC
  `);

  // ── Helpers ────────────────────────────────────────────────

  function getExisting(jobId: string): CreativeJobRow | undefined {
    return selectByJobIdStmt.get(jobId) as CreativeJobRow | undefined;
  }

  function assertExists(jobId: string): CreativeJobRow {
    const row = getExisting(jobId);
    if (!row) {
      throw new Error(`CreativeJob "${jobId}" not found`);
    }
    return row;
  }

  function assertNonEmpty(value: string, field: string): void {
    if (value.trim().length === 0) {
      throw new Error(`${field} must not be empty`);
    }
  }

  function assertValidInput(input: CreateCreativeJobInput): void {
    assertNonEmpty(input.jobId, "jobId");
    assertNonEmpty(input.requestId, "requestId");
    assertNonEmpty(input.sellerId, "sellerId");

    if (
      input.estimatedCostUsd !== undefined &&
      (!Number.isFinite(input.estimatedCostUsd) || input.estimatedCostUsd < 0)
    ) {
      throw new Error("estimatedCostUsd must be a finite non-negative number");
    }

    if (input.payloadJson !== undefined) {
      try {
        JSON.parse(input.payloadJson);
      } catch {
        throw new Error("payloadJson must contain valid JSON");
      }
    }
  }

  function assertTransition(
    jobId: string,
    currentStatus: CreativeJobStatus,
    newStatus: CreativeJobStatus,
  ): void {
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (allowed.length === 0) {
      throw new Error(
        `Cannot transition job "${jobId}" from terminal status "${currentStatus}" to "${newStatus}"`,
      );
    }
    if (!(allowed as readonly string[]).includes(newStatus)) {
      throw new Error(
        `Invalid transition: "${currentStatus}" → "${newStatus}". ` +
          `Allowed: ${allowed.join(", ")}`,
      );
    }
  }

  // ── API methods ────────────────────────────────────────────

  const createJob = (input: CreateCreativeJobInput): CreativeJobRow => {
    assertValidInput(input);
    const existing = getExisting(input.jobId);
    if (existing) {
      if (existing.request_id !== input.requestId || existing.seller_id !== input.sellerId) {
        throw new Error(`CreativeJob "${input.jobId}" already exists for a different request`);
      }
      return existing;
    }

    insertStmt.run({
      jobId: input.jobId,
      requestId: input.requestId,
      sellerId: input.sellerId,
      kind: input.kind,
      channel: input.channel,
      provider: input.provider ?? "",
      estimatedCostUsd: input.estimatedCostUsd ?? 0,
      payloadJson: input.payloadJson ?? "{}",
    });

    return assertExists(input.jobId);
  };

  const getJob = (jobId: string): CreativeJobRow | undefined => {
    return getExisting(jobId);
  };

  const updateStatus = (jobId: string, newStatus: CreativeJobStatus): CreativeJobRow => {
    const row = assertExists(jobId);
    assertTransition(jobId, row.status, newStatus);

    const info = updateStatusStmt.run({ jobId, status: newStatus });
    if (info.changes === 0) {
      throw new Error(`Job "${jobId}" not found for status update`);
    }

    return assertExists(jobId);
  };

  const completeJob = (
    jobId: string,
    result: { actualCostUsd?: number; assetPaths?: string[]; resultJson?: string },
  ): CreativeJobRow => {
    const row = assertExists(jobId);

    const status: CreativeJobStatus = "needs-human-review";
    assertTransition(jobId, row.status, status);
    const assetPathsJson = JSON.stringify(result.assetPaths ?? []);
    const resultJson = result.resultJson ?? null;

    const info = completeStmt.run({
      jobId,
      status,
      actualCostUsd: result.actualCostUsd ?? null,
      assetPathsJson,
      resultJson,
    });
    if (info.changes === 0) {
      throw new Error(`Job "${jobId}" not found for completion`);
    }

    return assertExists(jobId);
  };

  const failJob = (jobId: string, errorJson: string): CreativeJobRow => {
    const row = assertExists(jobId);
    assertTransition(jobId, row.status, "failed");

    const info = failStmt.run({ jobId, errorJson });
    if (info.changes === 0) {
      throw new Error(`Job "${jobId}" not found for fail`);
    }

    return assertExists(jobId);
  };

  const listByStatus = (status: CreativeJobStatus): CreativeJobRow[] => {
    return listByStatusStmt.all(status) as CreativeJobRow[];
  };

  const listAll = (): CreativeJobRow[] => {
    return listAllStmt.all() as CreativeJobRow[];
  };

  return {
    createJob,
    getJob,
    updateStatus,
    completeJob,
    failJob,
    listByStatus,
    listAll,
  };
}
