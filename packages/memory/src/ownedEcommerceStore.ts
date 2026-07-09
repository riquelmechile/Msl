import type {
  ApprovalRecord,
  GuardrailResult,
  OwnedEcommerceExecutionAuditSummary,
  OwnedEcommerceExecutionOperation,
  OwnedEcommerceExecutionRequest,
  OwnedEcommerceExecutionResult,
  OwnedEcommerceRollbackRef,
  OwnedEcommerceCandidateId,
  StorefrontCandidate,
  StorefrontProjection,
  StorefrontProjectionId,
  StorefrontProjectionVersion,
} from "@msl/domain";
import Database from "better-sqlite3";

type CandidateRow = {
  id: string;
  item_ref: string;
  title: string;
  candidate_json: string;
  evidence_ids_json: string;
  blocked_reason_codes_json: string;
  redacted_reasons_json: string;
  created_at: string;
};

type ProjectionRow = {
  id: string;
  projection_version: string;
  status: string;
  projection_json: string;
  evidence_ids_json: string;
  generated_at: string;
};

type ValidationRow = {
  id: string;
  projection_id: string;
  result_json: string;
  evidence_ids_json: string;
  redacted_message: string;
  created_at: string;
};

type ApprovalRow = {
  id: string;
  projection_id: string;
  projection_version: string;
  action_id: string;
  approval_json: string;
  evidence_ids_json: string;
  redacted_reason: string;
  created_at: string;
};

type IdempotencyRow = {
  idempotency_key: string;
  projection_id: string;
  projection_version: string;
  action_id: string;
  approval_id: string;
  operation: string;
  status: string;
  audit_id: string | null;
  result_json: string | null;
  created_at: string;
};

type ExecutionRow = {
  id: string;
  idempotency_key: string;
  projection_id: string;
  projection_version: string;
  action_id: string;
  approval_id: string;
  operation: string;
  status: string;
  audit_id: string | null;
  rollback_ref: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
};

type AuditRow = OwnedEcommerceExecutionAuditRecord & {
  projection_id: string;
  projection_version: string;
  action_id: string;
  approval_id: string;
  operation: string;
  summary_json: string;
  redacted_pre_state_json: string;
  created_at: string;
};

type RollbackRow = {
  ref: string;
  projection_id: string;
  projection_version: string;
  operation: string;
  rollback_json: string;
  created_at: string;
};

export type OwnedEcommerceValidationRecord = {
  id: string;
  projectionId: StorefrontProjectionId;
  result: GuardrailResult;
  evidenceIds: string[];
  redactedMessage: string;
  createdAt: string;
};

export type OwnedEcommerceApprovalRecord = {
  id: string;
  projectionId: StorefrontProjectionId;
  projectionVersion: StorefrontProjectionVersion;
  actionId: string;
  approval: ApprovalRecord;
  evidenceIds: string[];
  redactedReason: string;
  createdAt: string;
};

export type OwnedEcommerceIdempotencyReservation = OwnedEcommerceExecutionRequest & {
  createdAt: string;
  auditId?: string;
  result?: OwnedEcommerceExecutionResult;
};

export type OwnedEcommerceIdempotencyReservationResult =
  | { status: "reserved"; reservation: OwnedEcommerceIdempotencyReservation }
  | { status: "duplicate"; reservation: OwnedEcommerceIdempotencyReservation };

export type OwnedEcommerceExecutionRecord = {
  id: string;
  request: OwnedEcommerceExecutionRequest;
  status: OwnedEcommerceExecutionResult["status"] | "started" | "failed";
  auditId?: string;
  rollbackRef?: string;
  result?: OwnedEcommerceExecutionResult;
  createdAt: string;
  updatedAt: string;
};

export type OwnedEcommerceExecutionAuditRecord = {
  id: string;
  summary: OwnedEcommerceExecutionAuditSummary;
  redactedPreState: Readonly<Record<string, unknown>>;
  createdAt: string;
};

export type OwnedEcommerceApprovalConsumptionResult =
  | { status: "consumed"; approvalRecord: OwnedEcommerceApprovalRecord }
  | { status: "already-consumed"; approvalRecord: OwnedEcommerceApprovalRecord }
  | { status: "missing" }
  | { status: "mismatch"; approvalRecord: OwnedEcommerceApprovalRecord };

export type OwnedEcommerceStore = {
  upsertCandidate(candidate: StorefrontCandidate): Promise<void>;
  getCandidate(id: OwnedEcommerceCandidateId): Promise<StorefrontCandidate | null>;
  listCandidates(): Promise<StorefrontCandidate[]>;
  upsertProjection(projection: StorefrontProjection): Promise<void>;
  getProjection(id: StorefrontProjectionId): Promise<StorefrontProjection | null>;
  getProjectionRevision(
    id: StorefrontProjectionId,
    projectionVersion: StorefrontProjectionVersion,
  ): Promise<StorefrontProjection | null>;
  recordValidation(record: OwnedEcommerceValidationRecord): Promise<OwnedEcommerceValidationRecord>;
  listValidationResults(
    projectionId: StorefrontProjectionId,
  ): Promise<OwnedEcommerceValidationRecord[]>;
  recordApproval(record: OwnedEcommerceApprovalRecord): Promise<OwnedEcommerceApprovalRecord>;
  getApproval(id: string): Promise<OwnedEcommerceApprovalRecord | null>;
  consumeExecutionApproval(
    request: OwnedEcommerceExecutionRequest,
  ): Promise<OwnedEcommerceApprovalConsumptionResult>;
  reserveExecutionIdempotency(
    reservation: OwnedEcommerceIdempotencyReservation,
  ): Promise<OwnedEcommerceIdempotencyReservationResult>;
  recordExecution(record: OwnedEcommerceExecutionRecord): Promise<OwnedEcommerceExecutionRecord>;
  recordExecutionAudit(
    record: OwnedEcommerceExecutionAuditRecord,
  ): Promise<OwnedEcommerceExecutionAuditRecord>;
  recordRollbackRef(record: OwnedEcommerceRollbackRef): Promise<OwnedEcommerceRollbackRef>;
  resolveRollbackRef(ref: string): Promise<OwnedEcommerceRollbackRef | null>;
  listEvidenceIdsForProjection(projectionId: StorefrontProjectionId): Promise<string[]>;
};

function parseJson<TValue>(raw: string): TValue {
  return JSON.parse(raw) as TValue;
}

function auditIntegrityError(approvalId: string, reason: string): Error {
  return new Error(`Owned ecommerce audit integrity error for approval ${approvalId}: ${reason}`);
}

function assertValidApprovalDate(approvalId: string, approvedAt: Date): void {
  if (!(approvedAt instanceof Date) || Number.isNaN(approvedAt.getTime())) {
    throw auditIntegrityError(approvalId, "invalid approvedAt");
  }
}

function reviveApprovalDate(approvalId: string, approvedAt: unknown): Date {
  if (typeof approvedAt !== "string" || approvedAt.length === 0) {
    throw new Error(
      `Owned ecommerce audit integrity error for approval ${approvalId}: invalid approvedAt`,
    );
  }
  const revived = new Date(approvedAt);
  assertValidApprovalDate(approvalId, revived);
  return revived;
}

function parseApprovalRecord(raw: string): ApprovalRecord {
  const approval = parseJson<Omit<ApprovalRecord, "approvedAt"> & { approvedAt?: unknown }>(raw);
  const approvedAt = reviveApprovalDate(approval.id, approval.approvedAt);
  if (!approval.ownedEcommerceBinding) {
    return { ...approval, approvedAt };
  }
  return {
    ...approval,
    approvedAt,
    ownedEcommerceBinding: {
      ...approval.ownedEcommerceBinding,
      expiresAt: reviveApprovalDate(approval.id, approval.ownedEcommerceBinding.expiresAt),
    },
  };
}

function serializeApprovalRecord(approval: ApprovalRecord): string {
  assertValidApprovalDate(approval.id, approval.approvedAt);
  return JSON.stringify({ ...approval, approvedAt: approval.approvedAt.toISOString() });
}

function approvalRecordsMatch(
  left: OwnedEcommerceApprovalRecord,
  right: OwnedEcommerceApprovalRecord,
): boolean {
  return (
    left.projectionId === right.projectionId &&
    left.projectionVersion === right.projectionVersion &&
    left.actionId === right.actionId &&
    left.redactedReason === right.redactedReason &&
    left.createdAt === right.createdAt &&
    JSON.stringify(left.evidenceIds) === JSON.stringify(right.evidenceIds) &&
    serializeApprovalRecord(left.approval) === serializeApprovalRecord(right.approval)
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function projectionRecordsMatch(left: StorefrontProjection, right: StorefrontProjection): boolean {
  return stableJson(left) === stableJson(right);
}

function auditRecordsMatch(
  left: OwnedEcommerceExecutionAuditRecord,
  right: OwnedEcommerceExecutionAuditRecord,
): boolean {
  return stableJson(left) === stableJson(right);
}

function rollbackRecordsMatch(
  left: OwnedEcommerceRollbackRef,
  right: OwnedEcommerceRollbackRef,
): boolean {
  return stableJson(left) === stableJson(right);
}

function initialProjectionVersion(projection: StorefrontProjection): StorefrontProjectionVersion {
  return projection.projectionVersion || `initial:${projection.generatedAt}`;
}

function idempotencyReservationFromRow(row: IdempotencyRow): OwnedEcommerceIdempotencyReservation {
  return {
    idempotencyKey: row.idempotency_key,
    projectionId: row.projection_id,
    projectionVersion: row.projection_version,
    actionId: row.action_id,
    approvalId: row.approval_id,
    operation: row.operation as OwnedEcommerceExecutionOperation,
    createdAt: row.created_at,
    ...(row.audit_id ? { auditId: row.audit_id } : {}),
    ...(row.result_json
      ? { result: parseJson<OwnedEcommerceExecutionResult>(row.result_json) }
      : {}),
  };
}

function finalIdempotencyReservationFromRow(
  row: IdempotencyRow,
): OwnedEcommerceIdempotencyReservation | null {
  if (row.result_json) {
    return idempotencyReservationFromRow(row);
  }
  if (row.status === "executed" && row.audit_id) {
    return idempotencyReservationFromRow(row);
  }
  return null;
}

function executionRecordFromRow(row: ExecutionRow): OwnedEcommerceExecutionRecord {
  return {
    id: row.id,
    request: {
      idempotencyKey: row.idempotency_key,
      projectionId: row.projection_id,
      projectionVersion: row.projection_version,
      actionId: row.action_id,
      approvalId: row.approval_id,
      operation: row.operation as OwnedEcommerceExecutionOperation,
    },
    status: row.status as OwnedEcommerceExecutionRecord["status"],
    ...(row.audit_id ? { auditId: row.audit_id } : {}),
    ...(row.rollback_ref ? { rollbackRef: row.rollback_ref } : {}),
    ...(row.result_json
      ? { result: parseJson<OwnedEcommerceExecutionResult>(row.result_json) }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function executionRecordFromFinalReservation(
  record: OwnedEcommerceExecutionRecord,
  reservation: OwnedEcommerceIdempotencyReservation,
): OwnedEcommerceExecutionRecord {
  const result = reservation.result;
  if (result?.status === "executed") {
    return {
      ...record,
      status: "executed",
      auditId: result.auditId,
      rollbackRef: result.rollbackRef,
      result,
    };
  }
  if (result) {
    return {
      id: record.id,
      request: record.request,
      status: result.status,
      ...(result.auditId ? { auditId: result.auditId } : {}),
      result,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
  return {
    id: record.id,
    request: record.request,
    status: "executed",
    ...(reservation.auditId ? { auditId: reservation.auditId } : {}),
    ...(record.rollbackRef ? { rollbackRef: record.rollbackRef } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function executionRollbackRef(record: OwnedEcommerceExecutionRecord): string | null {
  if (record.result?.status === "executed") {
    return record.result.rollbackRef;
  }
  if (record.status === "executed") {
    return record.rollbackRef ?? null;
  }
  return null;
}

function executionAuditId(record: OwnedEcommerceExecutionRecord): string | null {
  if (record.result?.status === "executed") {
    if (record.auditId && record.auditId !== record.result.auditId) {
      throw new Error(
        `Owned ecommerce execution audit evidence mismatch for ${record.result.auditId}`,
      );
    }
    return record.result.auditId;
  }
  if (record.status === "executed") {
    return record.auditId ?? null;
  }
  return null;
}

function executionResultForIdempotency(
  record: OwnedEcommerceExecutionRecord,
  rollbackRef: string | null,
): OwnedEcommerceExecutionResult | undefined {
  if (record.result && record.result.status !== record.status) {
    throw new Error(
      `Owned ecommerce execution result/status mismatch for ${record.request.idempotencyKey}`,
    );
  }
  if (record.status === "executed") {
    const auditId = record.result?.status === "executed" ? record.result.auditId : record.auditId;
    if (!auditId) {
      throw new Error(
        `Owned ecommerce execution evidence incomplete for ${record.request.idempotencyKey}`,
      );
    }
    if (!rollbackRef) {
      throw new Error(
        `Owned ecommerce execution evidence incomplete for ${record.request.idempotencyKey}`,
      );
    }
    return record.result ?? { status: "executed", auditId, rollbackRef };
  }
  if (record.result) {
    return record.result;
  }
  return undefined;
}

function rollbackRefMatchesRequest(
  row: RollbackRow,
  request: OwnedEcommerceExecutionRequest,
): boolean {
  return (
    row.projection_id === request.projectionId &&
    row.projection_version === request.projectionVersion &&
    row.operation === request.operation
  );
}

function auditRowMatchesRequest(row: AuditRow, request: OwnedEcommerceExecutionRequest): boolean {
  return (
    row.projection_id === request.projectionId &&
    row.projection_version === request.projectionVersion &&
    row.action_id === request.actionId &&
    row.approval_id === request.approvalId &&
    row.operation === request.operation
  );
}

function idempotencyRowMatchesRequest(
  row: IdempotencyRow,
  request: OwnedEcommerceExecutionRequest,
): boolean {
  return (
    row.projection_id === request.projectionId &&
    row.projection_version === request.projectionVersion &&
    row.action_id === request.actionId &&
    row.approval_id === request.approvalId &&
    row.operation === request.operation
  );
}

function executionRowMatchesRequest(
  row: ExecutionRow,
  request: OwnedEcommerceExecutionRequest,
): boolean {
  return (
    row.idempotency_key === request.idempotencyKey &&
    row.projection_id === request.projectionId &&
    row.projection_version === request.projectionVersion &&
    row.action_id === request.actionId &&
    row.approval_id === request.approvalId &&
    row.operation === request.operation
  );
}

function assertExecutionEvidence(
  db: Database.Database,
  request: OwnedEcommerceExecutionRequest,
  auditId: string | null,
  rollbackRef: string | null,
): void {
  if (auditId) {
    const auditRow = db
      .prepare("SELECT * FROM owned_ecommerce_execution_audits WHERE id = ?")
      .get(auditId) as AuditRow | undefined;
    if (!auditRow) {
      throw new Error(`Owned ecommerce execution audit evidence missing for ${auditId}`);
    }
    if (!auditRowMatchesRequest(auditRow, request)) {
      throw new Error(`Owned ecommerce execution audit evidence mismatch for ${auditId}`);
    }
    const summary = parseJson<OwnedEcommerceExecutionAuditSummary>(auditRow.summary_json);
    if (summary.auditId !== auditId || summary.status !== "executed") {
      throw new Error(`Owned ecommerce execution audit evidence mismatch for ${auditId}`);
    }
    if (rollbackRef && summary.rollbackRef !== rollbackRef) {
      throw new Error(`Owned ecommerce execution audit evidence mismatch for ${auditId}`);
    }
  }
  if (rollbackRef) {
    const rollbackRow = db
      .prepare("SELECT * FROM owned_ecommerce_rollback_refs WHERE ref = ?")
      .get(rollbackRef) as RollbackRow | undefined;
    if (!rollbackRow) {
      throw new Error(`Owned ecommerce execution rollback evidence missing for ${rollbackRef}`);
    }
    if (!rollbackRefMatchesRequest(rollbackRow, request)) {
      throw new Error(`Owned ecommerce execution rollback evidence mismatch for ${rollbackRef}`);
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function migrateOwnedEcommerceStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS owned_ecommerce_candidates (
      id TEXT PRIMARY KEY,
      item_ref TEXT NOT NULL,
      title TEXT NOT NULL,
      candidate_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      blocked_reason_codes_json TEXT NOT NULL,
      redacted_reasons_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS owned_ecommerce_projections (
      id TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      status TEXT NOT NULL,
      projection_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      PRIMARY KEY (id, projection_version)
    );

    CREATE TABLE IF NOT EXISTS owned_ecommerce_validation_results (
      id TEXT PRIMARY KEY,
      projection_id TEXT NOT NULL,
      result_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      redacted_message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_owned_ecommerce_validation_projection
      ON owned_ecommerce_validation_results (projection_id);

    CREATE TABLE IF NOT EXISTS owned_ecommerce_approvals (
      id TEXT PRIMARY KEY,
      projection_id TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      action_id TEXT NOT NULL,
      approval_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      redacted_reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_owned_ecommerce_approvals_projection
      ON owned_ecommerce_approvals (projection_id);

    CREATE TABLE IF NOT EXISTS owned_ecommerce_execution_idempotency (
      idempotency_key TEXT PRIMARY KEY,
      projection_id TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      action_id TEXT NOT NULL,
      approval_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      status TEXT NOT NULL,
      audit_id TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS owned_ecommerce_executions (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL,
      projection_id TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      action_id TEXT NOT NULL,
      approval_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      status TEXT NOT NULL,
      audit_id TEXT,
      rollback_ref TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS owned_ecommerce_execution_audits (
      id TEXT PRIMARY KEY,
      projection_id TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      action_id TEXT NOT NULL,
      approval_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      redacted_pre_state_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS owned_ecommerce_rollback_refs (
      ref TEXT PRIMARY KEY,
      projection_id TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      operation TEXT NOT NULL,
      rollback_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  migrateProjectionVersions(db);
  migrateApprovalProjectionVersions(db);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_owned_ecommerce_approvals_projection_action
      ON owned_ecommerce_approvals (projection_id, projection_version, action_id);
  `);
}

function tableColumns(db: Database.Database, tableName: string): string[] {
  return (db.pragma(`table_info(${tableName})`) as Array<{ name: string }>).map((row) => row.name);
}

function migrateProjectionVersions(db: Database.Database): void {
  const columns = tableColumns(db, "owned_ecommerce_projections");
  if (columns.includes("projection_version")) return;

  db.exec(`
    CREATE TABLE owned_ecommerce_projections_v2 (
      id TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      status TEXT NOT NULL,
      projection_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      PRIMARY KEY (id, projection_version)
    );
  `);
  const rows = db.prepare("SELECT * FROM owned_ecommerce_projections").all() as Array<
    Omit<ProjectionRow, "projection_version">
  >;
  const insert = db.prepare(
    `INSERT INTO owned_ecommerce_projections_v2 (
      id, projection_version, status, projection_json, evidence_ids_json, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    const projection = parseJson<StorefrontProjection>(row.projection_json);
    const projectionVersion = initialProjectionVersion(projection);
    insert.run(
      row.id,
      projectionVersion,
      row.status,
      JSON.stringify({ ...projection, projectionVersion }),
      row.evidence_ids_json,
      row.generated_at,
    );
  }
  db.exec(`
    DROP TABLE owned_ecommerce_projections;
    ALTER TABLE owned_ecommerce_projections_v2 RENAME TO owned_ecommerce_projections;
  `);
}

function migrateApprovalProjectionVersions(db: Database.Database): void {
  const columns = tableColumns(db, "owned_ecommerce_approvals");
  if (columns.includes("projection_version")) return;

  db.exec(`DROP INDEX IF EXISTS idx_owned_ecommerce_approvals_projection_action;`);
  db.exec(`
    CREATE TABLE owned_ecommerce_approvals_v2 (
      id TEXT PRIMARY KEY,
      projection_id TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      action_id TEXT NOT NULL,
      approval_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      redacted_reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const rows = db.prepare("SELECT * FROM owned_ecommerce_approvals").all() as Array<
    Omit<ApprovalRow, "projection_version">
  >;
  const insert = db.prepare(
    `INSERT INTO owned_ecommerce_approvals_v2 (
      id, projection_id, projection_version, action_id, approval_json, evidence_ids_json,
      redacted_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    const approval = parseApprovalRecord(row.approval_json);
    const projectionVersion =
      approval.ownedEcommerceBinding?.projectionVersion ?? "legacy-unversioned";
    insert.run(
      row.id,
      row.projection_id,
      projectionVersion,
      row.action_id,
      serializeApprovalRecord(approval),
      row.evidence_ids_json,
      row.redacted_reason,
      row.created_at,
    );
  }
  db.exec(`
    DROP TABLE owned_ecommerce_approvals;
    ALTER TABLE owned_ecommerce_approvals_v2 RENAME TO owned_ecommerce_approvals;
    CREATE INDEX IF NOT EXISTS idx_owned_ecommerce_approvals_projection
      ON owned_ecommerce_approvals (projection_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_owned_ecommerce_approvals_projection_action
      ON owned_ecommerce_approvals (projection_id, projection_version, action_id);
  `);
}

export function createSqliteOwnedEcommerceStore(db: Database.Database): OwnedEcommerceStore {
  migrateOwnedEcommerceStore(db);

  const approvalFromRow = (row: ApprovalRow): OwnedEcommerceApprovalRecord => ({
    id: row.id,
    projectionId: row.projection_id,
    projectionVersion: row.projection_version,
    actionId: row.action_id,
    approval: parseApprovalRecord(row.approval_json),
    evidenceIds: parseJson<string[]>(row.evidence_ids_json),
    redactedReason: row.redacted_reason,
    createdAt: row.created_at,
  });

  const listApprovalsForProjection = (projectionId: StorefrontProjectionId) => {
    const rows = db
      .prepare(
        "SELECT * FROM owned_ecommerce_approvals WHERE projection_id = ? ORDER BY created_at ASC, id ASC",
      )
      .all(projectionId) as ApprovalRow[];
    return rows.map(approvalFromRow);
  };

  return {
    upsertCandidate(candidate) {
      db.prepare(
        `INSERT INTO owned_ecommerce_candidates (
          id, item_ref, title, candidate_json, evidence_ids_json,
          blocked_reason_codes_json, redacted_reasons_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          item_ref = excluded.item_ref,
          title = excluded.title,
          candidate_json = excluded.candidate_json,
          evidence_ids_json = excluded.evidence_ids_json,
          blocked_reason_codes_json = excluded.blocked_reason_codes_json,
          redacted_reasons_json = excluded.redacted_reasons_json,
          created_at = excluded.created_at`,
      ).run(
        candidate.id,
        candidate.itemRef,
        candidate.title,
        JSON.stringify(candidate),
        JSON.stringify(candidate.evidenceIds),
        JSON.stringify(candidate.blockedReasons),
        JSON.stringify(candidate.redactedReasons),
        candidate.createdAt,
      );
      return Promise.resolve();
    },

    getCandidate(id) {
      const row = db.prepare("SELECT * FROM owned_ecommerce_candidates WHERE id = ?").get(id) as
        CandidateRow | undefined;
      return Promise.resolve(row ? parseJson<StorefrontCandidate>(row.candidate_json) : null);
    },

    listCandidates() {
      const rows = db
        .prepare("SELECT * FROM owned_ecommerce_candidates ORDER BY created_at DESC, id ASC")
        .all() as CandidateRow[];
      return Promise.resolve(rows.map((row) => parseJson<StorefrontCandidate>(row.candidate_json)));
    },

    upsertProjection(projection) {
      const existing = db
        .prepare(
          "SELECT * FROM owned_ecommerce_projections WHERE id = ? AND projection_version = ?",
        )
        .get(projection.id, projection.projectionVersion) as ProjectionRow | undefined;
      if (existing) {
        const existingProjection = parseJson<StorefrontProjection>(existing.projection_json);
        if (!projectionRecordsMatch(existingProjection, projection)) {
          return Promise.reject(
            new Error(
              `Owned ecommerce projection revision collision for ${projection.id}@${projection.projectionVersion}: existing revision differs`,
            ),
          );
        }
        return Promise.resolve();
      }

      db.prepare(
        `INSERT INTO owned_ecommerce_projections (
          id, projection_version, status, projection_json, evidence_ids_json, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        projection.id,
        projection.projectionVersion,
        projection.status,
        JSON.stringify(projection),
        JSON.stringify(projection.evidenceIds),
        projection.generatedAt,
      );
      return Promise.resolve();
    },

    getProjection(id) {
      const row = db
        .prepare(
          "SELECT * FROM owned_ecommerce_projections WHERE id = ? ORDER BY generated_at DESC, projection_version DESC LIMIT 1",
        )
        .get(id) as ProjectionRow | undefined;
      return Promise.resolve(row ? parseJson<StorefrontProjection>(row.projection_json) : null);
    },

    getProjectionRevision(id, projectionVersion) {
      const row = db
        .prepare(
          "SELECT * FROM owned_ecommerce_projections WHERE id = ? AND projection_version = ?",
        )
        .get(id, projectionVersion) as ProjectionRow | undefined;
      return Promise.resolve(row ? parseJson<StorefrontProjection>(row.projection_json) : null);
    },

    recordValidation(record) {
      db.prepare(
        `INSERT INTO owned_ecommerce_validation_results (
          id, projection_id, result_json, evidence_ids_json, redacted_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          projection_id = excluded.projection_id,
          result_json = excluded.result_json,
          evidence_ids_json = excluded.evidence_ids_json,
          redacted_message = excluded.redacted_message,
          created_at = excluded.created_at`,
      ).run(
        record.id,
        record.projectionId,
        JSON.stringify(record.result),
        JSON.stringify(record.evidenceIds),
        record.redactedMessage,
        record.createdAt,
      );
      return Promise.resolve(record);
    },

    listValidationResults(projectionId) {
      const rows = db
        .prepare(
          "SELECT * FROM owned_ecommerce_validation_results WHERE projection_id = ? ORDER BY created_at ASC, id ASC",
        )
        .all(projectionId) as ValidationRow[];
      return Promise.resolve(
        rows.map((row) => ({
          id: row.id,
          projectionId: row.projection_id,
          result: parseJson<GuardrailResult>(row.result_json),
          evidenceIds: parseJson<string[]>(row.evidence_ids_json),
          redactedMessage: row.redacted_message,
          createdAt: row.created_at,
        })),
      );
    },

    recordApproval(record) {
      const existingRow = db
        .prepare("SELECT * FROM owned_ecommerce_approvals WHERE id = ?")
        .get(record.id) as ApprovalRow | undefined;
      if (existingRow) {
        const existing = approvalFromRow(existingRow);
        if (!approvalRecordsMatch(existing, record)) {
          return Promise.reject(
            new Error(
              `Owned ecommerce approval id collision for ${record.id}: existing audit record differs`,
            ),
          );
        }
        return Promise.resolve(existing);
      }

      const existingActionRow = db
        .prepare(
          "SELECT * FROM owned_ecommerce_approvals WHERE projection_id = ? AND projection_version = ? AND action_id = ?",
        )
        .get(record.projectionId, record.projectionVersion, record.actionId) as
        ApprovalRow | undefined;
      if (existingActionRow) {
        const existing = approvalFromRow(existingActionRow);
        if (approvalRecordsMatch(existing, record)) {
          return Promise.resolve(existing);
        }
        return Promise.reject(
          new Error(
            `Owned ecommerce approval action collision for ${record.actionId}: existing audit record differs`,
          ),
        );
      }

      db.prepare(
        `INSERT INTO owned_ecommerce_approvals (
          id, projection_id, projection_version, action_id, approval_json, evidence_ids_json,
          redacted_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.projectionId,
        record.projectionVersion,
        record.actionId,
        serializeApprovalRecord(record.approval),
        JSON.stringify(record.evidenceIds),
        record.redactedReason,
        record.createdAt,
      );
      return Promise.resolve(record);
    },

    getApproval(id) {
      const row = db.prepare("SELECT * FROM owned_ecommerce_approvals WHERE id = ?").get(id) as
        ApprovalRow | undefined;
      try {
        return Promise.resolve(row ? approvalFromRow(row) : null);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },

    consumeExecutionApproval(request) {
      const transaction = db.transaction((): OwnedEcommerceApprovalConsumptionResult => {
        const row = db
          .prepare("SELECT * FROM owned_ecommerce_approvals WHERE id = ?")
          .get(request.approvalId) as ApprovalRow | undefined;
        if (!row) {
          return { status: "missing" };
        }

        const approvalRecord = approvalFromRow(row);
        if (
          approvalRecord.projectionId !== request.projectionId ||
          approvalRecord.projectionVersion !== request.projectionVersion ||
          approvalRecord.actionId !== request.actionId
        ) {
          return { status: "mismatch", approvalRecord };
        }
        if (approvalRecord.approval.executionStatus === "executed") {
          return { status: "already-consumed", approvalRecord };
        }

        const consumedApproval = {
          ...approvalRecord.approval,
          executionStatus: "executed" as const,
        };
        db.prepare(
          `UPDATE owned_ecommerce_approvals
           SET approval_json = ?
           WHERE id = ?`,
        ).run(serializeApprovalRecord(consumedApproval), request.approvalId);

        return {
          status: "consumed",
          approvalRecord: { ...approvalRecord, approval: consumedApproval },
        };
      });
      try {
        return Promise.resolve(transaction());
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },

    reserveExecutionIdempotency(reservation) {
      try {
        const existing = db
          .prepare("SELECT * FROM owned_ecommerce_execution_idempotency WHERE idempotency_key = ?")
          .get(reservation.idempotencyKey) as IdempotencyRow | undefined;
        if (existing) {
          if (!idempotencyRowMatchesRequest(existing, reservation)) {
            throw new Error(
              `Owned ecommerce execution idempotency reservation mismatch for ${reservation.idempotencyKey}`,
            );
          }
          return Promise.resolve({
            status: "duplicate",
            reservation: idempotencyReservationFromRow(existing),
          });
        }

        const executedResult =
          reservation.result?.status === "executed" ? reservation.result : null;
        if (executedResult) {
          if (reservation.auditId && reservation.auditId !== executedResult.auditId) {
            throw new Error(
              `Owned ecommerce execution audit evidence mismatch for ${executedResult.auditId}`,
            );
          }
          assertExecutionEvidence(
            db,
            reservation,
            executedResult.auditId,
            executedResult.rollbackRef,
          );
        }

        db.prepare(
          `INSERT INTO owned_ecommerce_execution_idempotency (
            idempotency_key, projection_id, projection_version, action_id, approval_id, operation,
            status, audit_id, result_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          reservation.idempotencyKey,
          reservation.projectionId,
          reservation.projectionVersion,
          reservation.actionId,
          reservation.approvalId,
          reservation.operation,
          reservation.result?.status ?? "reserved",
          executedResult?.auditId ?? reservation.auditId ?? null,
          reservation.result ? JSON.stringify(reservation.result) : null,
          reservation.createdAt,
        );
        return Promise.resolve({ status: "reserved", reservation });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },

    recordExecution(record) {
      const transaction = db.transaction(() => {
        const existingIdempotency = db
          .prepare("SELECT * FROM owned_ecommerce_execution_idempotency WHERE idempotency_key = ?")
          .get(record.request.idempotencyKey) as IdempotencyRow | undefined;
        if (!existingIdempotency) {
          throw new Error(
            `Owned ecommerce execution idempotency reservation missing for ${record.request.idempotencyKey}`,
          );
        }
        if (!idempotencyRowMatchesRequest(existingIdempotency, record.request)) {
          throw new Error(
            `Owned ecommerce execution idempotency reservation mismatch for ${record.request.idempotencyKey}`,
          );
        }
        const existingExecutionById = db
          .prepare("SELECT * FROM owned_ecommerce_executions WHERE id = ?")
          .get(record.id) as ExecutionRow | undefined;
        if (
          existingExecutionById &&
          !executionRowMatchesRequest(existingExecutionById, record.request)
        ) {
          throw new Error(`Owned ecommerce execution id collision for ${record.id}`);
        }
        const finalReservation = finalIdempotencyReservationFromRow(existingIdempotency);
        if (finalReservation) {
          const existingExecution =
            existingExecutionById ??
            (db
              .prepare(
                `SELECT * FROM owned_ecommerce_executions
                 WHERE idempotency_key = ?
                 ORDER BY updated_at DESC
                 LIMIT 1`,
              )
              .get(record.request.idempotencyKey) as ExecutionRow | undefined);
          if (existingExecution) {
            const storedExecution = executionRecordFromRow(existingExecution);
            return storedExecution.result
              ? storedExecution
              : executionRecordFromFinalReservation(storedExecution, finalReservation);
          }
          return executionRecordFromFinalReservation(record, finalReservation);
        }

        const requiredRollbackRef = executionRollbackRef(record);
        const requiredAuditId = executionAuditId(record);
        const idempotencyResult = executionResultForIdempotency(record, requiredRollbackRef);
        if (requiredRollbackRef) {
          if (record.rollbackRef && record.rollbackRef !== requiredRollbackRef) {
            throw new Error(
              `Owned ecommerce execution rollback evidence mismatch for ${requiredRollbackRef}`,
            );
          }
        }
        assertExecutionEvidence(db, record.request, requiredAuditId, requiredRollbackRef);

        db.prepare(
          `INSERT INTO owned_ecommerce_executions (
          id, idempotency_key, projection_id, projection_version, action_id, approval_id,
          operation, status, audit_id, rollback_ref, result_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          audit_id = excluded.audit_id,
          rollback_ref = excluded.rollback_ref,
          result_json = excluded.result_json,
          updated_at = excluded.updated_at`,
        ).run(
          record.id,
          record.request.idempotencyKey,
          record.request.projectionId,
          record.request.projectionVersion,
          record.request.actionId,
          record.request.approvalId,
          record.request.operation,
          record.status,
          requiredAuditId,
          requiredRollbackRef,
          record.result ? JSON.stringify(record.result) : null,
          record.createdAt,
          record.updatedAt,
        );
        db.prepare(
          `UPDATE owned_ecommerce_execution_idempotency
          SET status = ?, audit_id = ?, result_json = ?
          WHERE idempotency_key = ?`,
        ).run(
          idempotencyResult?.status ?? record.status,
          requiredAuditId,
          idempotencyResult ? JSON.stringify(idempotencyResult) : null,
          record.request.idempotencyKey,
        );
        if (idempotencyResult?.status === "executed") {
          const approvalRow = db
            .prepare("SELECT * FROM owned_ecommerce_approvals WHERE id = ?")
            .get(record.request.approvalId) as ApprovalRow | undefined;
          if (!approvalRow) {
            throw new Error(
              `Owned ecommerce approval missing for executed request ${record.request.approvalId}`,
            );
          }
          const approvalRecord = approvalFromRow(approvalRow);
          if (
            approvalRecord.projectionId !== record.request.projectionId ||
            approvalRecord.projectionVersion !== record.request.projectionVersion ||
            approvalRecord.actionId !== record.request.actionId
          ) {
            throw new Error(
              `Owned ecommerce approval execution context mismatch for ${record.request.approvalId}`,
            );
          }
          db.prepare(
            `UPDATE owned_ecommerce_approvals
             SET approval_json = ?
             WHERE id = ?`,
          ).run(
            serializeApprovalRecord({
              ...approvalRecord.approval,
              executionStatus: "executed",
            }),
            record.request.approvalId,
          );
        }
        return record;
      });
      try {
        return Promise.resolve(transaction());
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },

    recordExecutionAudit(record) {
      const existing = db
        .prepare("SELECT * FROM owned_ecommerce_execution_audits WHERE id = ?")
        .get(record.id) as AuditRow | undefined;
      if (existing) {
        const existingRecord: OwnedEcommerceExecutionAuditRecord = {
          id: record.id,
          summary: parseJson<OwnedEcommerceExecutionAuditSummary>(existing.summary_json),
          redactedPreState: parseJson<Readonly<Record<string, unknown>>>(
            existing.redacted_pre_state_json,
          ),
          createdAt: existing.created_at,
        };
        if (!auditRecordsMatch(existingRecord, record)) {
          return Promise.reject(
            new Error(
              `Owned ecommerce execution audit collision for ${record.id}: existing audit record differs`,
            ),
          );
        }
        return Promise.resolve(existingRecord);
      }

      db.prepare(
        `INSERT INTO owned_ecommerce_execution_audits (
          id, projection_id, projection_version, action_id, approval_id, operation, summary_json,
          redacted_pre_state_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.summary.projectionId,
        record.summary.projectionVersion,
        record.summary.actionId,
        record.summary.approvalId,
        record.summary.operation,
        JSON.stringify(record.summary),
        JSON.stringify(record.redactedPreState),
        record.createdAt,
      );
      return Promise.resolve(record);
    },

    recordRollbackRef(record) {
      const existing = db
        .prepare("SELECT * FROM owned_ecommerce_rollback_refs WHERE ref = ?")
        .get(record.ref) as RollbackRow | undefined;
      if (existing) {
        const existingRecord = parseJson<OwnedEcommerceRollbackRef>(existing.rollback_json);
        if (!rollbackRecordsMatch(existingRecord, record)) {
          return Promise.reject(
            new Error(
              `Owned ecommerce rollback ref collision for ${record.ref}: existing rollback record differs`,
            ),
          );
        }
        return Promise.resolve(existingRecord);
      }

      db.prepare(
        `INSERT INTO owned_ecommerce_rollback_refs (
          ref, projection_id, projection_version, operation, rollback_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        record.ref,
        record.projectionId,
        record.projectionVersion,
        record.operation,
        JSON.stringify(record),
        record.createdAt,
      );
      return Promise.resolve(record);
    },

    resolveRollbackRef(ref) {
      const row = db
        .prepare("SELECT * FROM owned_ecommerce_rollback_refs WHERE ref = ?")
        .get(ref) as RollbackRow | undefined;
      return Promise.resolve(row ? parseJson<OwnedEcommerceRollbackRef>(row.rollback_json) : null);
    },

    async listEvidenceIdsForProjection(projectionId) {
      const projection = await this.getProjection(projectionId);
      const validation = await this.listValidationResults(projectionId);
      const approvals = listApprovalsForProjection(projectionId);
      if (!projection) {
        return unique([
          ...validation.flatMap((record) => record.evidenceIds),
          ...validation.flatMap((record) => record.result.evidenceIds),
          ...approvals.flatMap((record) => record.evidenceIds),
        ]);
      }

      const candidateIds = new Set(projection.candidateIds);
      const candidateRows = db
        .prepare("SELECT * FROM owned_ecommerce_candidates ORDER BY created_at ASC, id ASC")
        .all() as CandidateRow[];
      const candidateEvidenceIds = candidateRows
        .map((row) => parseJson<StorefrontCandidate>(row.candidate_json))
        .filter((candidate) => candidateIds.has(candidate.id))
        .flatMap((candidate) => [
          ...candidate.evidenceIds,
          ...candidate.provenance.evidenceIds,
          ...candidate.evidenceState.evidenceIds,
          ...(candidate.stock.evidenceId ? [candidate.stock.evidenceId] : []),
          ...(candidate.margin ? [candidate.margin.evidenceId] : []),
        ]);

      return unique([
        ...projection.evidenceIds,
        ...candidateEvidenceIds,
        ...projection.catalog.products.flatMap((product) => [
          ...product.evidenceIds,
          ...product.variants.flatMap((variant) => variant.evidenceIds),
        ]),
        ...projection.content.claims.flatMap((claim) => claim.evidenceIds),
        ...projection.media.flatMap((media) => media.evidenceIds),
        ...projection.readiness.checks.flatMap((check) => check.evidenceIds),
        ...validation.flatMap((record) => record.evidenceIds),
        ...validation.flatMap((record) => record.result.evidenceIds),
        ...approvals.flatMap((record) => record.evidenceIds),
      ]);
    },
  };
}
