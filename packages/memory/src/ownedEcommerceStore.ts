import type {
  ApprovalRecord,
  GuardrailResult,
  OwnedEcommerceCandidateId,
  StorefrontCandidate,
  StorefrontProjection,
  StorefrontProjectionId,
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
  action_id: string;
  approval_json: string;
  evidence_ids_json: string;
  redacted_reason: string;
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
  actionId: string;
  approval: ApprovalRecord;
  evidenceIds: string[];
  redactedReason: string;
  createdAt: string;
};

export type OwnedEcommerceStore = {
  upsertCandidate(candidate: StorefrontCandidate): Promise<void>;
  getCandidate(id: OwnedEcommerceCandidateId): Promise<StorefrontCandidate | null>;
  listCandidates(): Promise<StorefrontCandidate[]>;
  upsertProjection(projection: StorefrontProjection): Promise<void>;
  getProjection(id: StorefrontProjectionId): Promise<StorefrontProjection | null>;
  recordValidation(record: OwnedEcommerceValidationRecord): Promise<OwnedEcommerceValidationRecord>;
  listValidationResults(
    projectionId: StorefrontProjectionId,
  ): Promise<OwnedEcommerceValidationRecord[]>;
  recordApproval(record: OwnedEcommerceApprovalRecord): Promise<OwnedEcommerceApprovalRecord>;
  getApproval(id: string): Promise<OwnedEcommerceApprovalRecord | null>;
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
  return { ...approval, approvedAt };
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
    left.actionId === right.actionId &&
    left.redactedReason === right.redactedReason &&
    left.createdAt === right.createdAt &&
    JSON.stringify(left.evidenceIds) === JSON.stringify(right.evidenceIds) &&
    serializeApprovalRecord(left.approval) === serializeApprovalRecord(right.approval)
  );
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
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      projection_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
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
      action_id TEXT NOT NULL,
      approval_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      redacted_reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_owned_ecommerce_approvals_projection
      ON owned_ecommerce_approvals (projection_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_owned_ecommerce_approvals_projection_action
      ON owned_ecommerce_approvals (projection_id, action_id);
  `);
}

export function createSqliteOwnedEcommerceStore(db: Database.Database): OwnedEcommerceStore {
  migrateOwnedEcommerceStore(db);

  const approvalFromRow = (row: ApprovalRow): OwnedEcommerceApprovalRecord => ({
    id: row.id,
    projectionId: row.projection_id,
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
        | CandidateRow
        | undefined;
      return Promise.resolve(row ? parseJson<StorefrontCandidate>(row.candidate_json) : null);
    },

    listCandidates() {
      const rows = db
        .prepare("SELECT * FROM owned_ecommerce_candidates ORDER BY created_at DESC, id ASC")
        .all() as CandidateRow[];
      return Promise.resolve(rows.map((row) => parseJson<StorefrontCandidate>(row.candidate_json)));
    },

    upsertProjection(projection) {
      db.prepare(
        `INSERT INTO owned_ecommerce_projections (
          id, status, projection_json, evidence_ids_json, generated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          projection_json = excluded.projection_json,
          evidence_ids_json = excluded.evidence_ids_json,
          generated_at = excluded.generated_at`,
      ).run(
        projection.id,
        projection.status,
        JSON.stringify(projection),
        JSON.stringify(projection.evidenceIds),
        projection.generatedAt,
      );
      return Promise.resolve();
    },

    getProjection(id) {
      const row = db.prepare("SELECT * FROM owned_ecommerce_projections WHERE id = ?").get(id) as
        | ProjectionRow
        | undefined;
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
          "SELECT * FROM owned_ecommerce_approvals WHERE projection_id = ? AND action_id = ?",
        )
        .get(record.projectionId, record.actionId) as ApprovalRow | undefined;
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
          id, projection_id, action_id, approval_json, evidence_ids_json, redacted_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.projectionId,
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
        | ApprovalRow
        | undefined;
      try {
        return Promise.resolve(row ? approvalFromRow(row) : null);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
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
