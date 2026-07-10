import type {
  ConfidenceLevel,
  EvidenceLink,
  EvidenceLinkedEntityType,
  EvidenceRequestPayload,
  EvidenceResponsePayload,
  EvidenceStatus,
  EvidenceSummary,
  EvidenceTargetAgentId,
  Priority,
} from "@msl/domain";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

type RequestRow = {
  request_id: string;
  correlation_id: string;
  source_agent_id: string;
  target_agent_id: string;
  seller_id: string | null;
  candidate_id: string | null;
  projection_id: string | null;
  supplier_id: string | null;
  supplier_item_id: string | null;
  product_name: string | null;
  category: string | null;
  kind: string;
  question: string;
  reason: string | null;
  priority: string;
  status: string;
  dedupe_key: string;
  evidence_ids_json: string;
  claimed_by: string | null;
  claimed_at: string | null;
  expires_at: string | null;
  created_at: string;
  error_json: string;
};

type ResponseRow = {
  response_id: string;
  request_id: string;
  correlation_id: string;
  source_agent_id: string;
  target_agent_id: string;
  seller_id: string | null;
  candidate_id: string | null;
  status: string;
  answer: string | null;
  structured_evidence_json: string;
  evidence_ids_json: string;
  confidence: string;
  blockers_json: string;
  warnings_json: string;
  created_at: string;
};

type LinkRow = {
  request_id: string;
  linked_entity_type: string;
  linked_entity_id: string;
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EnqueueResult = {
  status: "queued" | "duplicate";
  request: EvidenceRequestPayload;
  duplicateOfRequestId?: string;
};

export type ClaimResult = {
  success: boolean;
  request?: EvidenceRequestPayload;
  reason?: string;
};

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export type EvidenceRequestStore = {
  /** Persist a new evidence request. Returns duplicate if dedupeKey matches. */
  enqueueRequest(input: EvidenceRequestPayload): EnqueueResult;

  /** CAS: atomically transition queued → claimed. Fails if request is not queued. */
  claimRequest(requestId: string, agentId: string): ClaimResult;

  /** Persist a response and transition request to answered. */
  answerRequest(response: EvidenceResponsePayload): void;

  /** Transition request to failed, recording error evidence. */
  failRequest(requestId: string, error: string): void;

  /** Mark all queued or claimed requests with expired expires_at as expired. */
  expireOldRequests(now: string): void;

  getRequest(requestId: string): EvidenceRequestPayload | null;

  getResponse(responseId: string): EvidenceResponsePayload | null;

  /** List pending (queued or claimed) requests for an agent, optionally scoped by seller. */
  listPendingRequestsForAgent(
    agentId: EvidenceTargetAgentId,
    sellerId?: string,
    limit?: number,
  ): EvidenceRequestPayload[];

  listResponsesForCorrelation(correlationId: string): EvidenceResponsePayload[];

  listRequestsForCandidate(candidateId: string): EvidenceRequestPayload[];

  /** Exact-match dedupe lookup. */
  findDuplicate(dedupeKey: string): EvidenceRequestPayload | null;

  /** Aggregate all responses for a candidate into an EvidenceSummary. */
  summarizeEvidenceForCandidate(candidateId: string): EvidenceSummary | null;

  /** Associate a request with a business entity. */
  linkRequest(requestId: string, entityType: EvidenceLinkedEntityType, entityId: string): void;

  listLinks(requestId: string): EvidenceLink[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is string => typeof v === "string");
}

function parseJsonObject(raw: string | null): Readonly<Record<string, unknown>> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Readonly<Record<string, unknown>>;
  }
  return {};
}

function requestFromRow(row: RequestRow): EvidenceRequestPayload {
  return {
    type: "evidence-request",
    requestId: row.request_id,
    correlationId: row.correlation_id,
    sourceAgentId: row.source_agent_id,
    targetAgentId: row.target_agent_id as EvidenceTargetAgentId,
    ...(row.seller_id === null ? {} : { sellerId: row.seller_id }),
    ...(row.candidate_id === null ? {} : { candidateId: row.candidate_id }),
    ...(row.projection_id === null ? {} : { projectionId: row.projection_id }),
    ...(row.supplier_id === null ? {} : { supplierId: row.supplier_id }),
    ...(row.supplier_item_id === null ? {} : { supplierItemId: row.supplier_item_id }),
    ...(row.product_name === null ? {} : { productName: row.product_name }),
    ...(row.category === null ? {} : { category: row.category }),
    kind: row.kind as EvidenceRequestPayload["kind"],
    question: row.question,
    ...(row.reason === null ? {} : { reason: row.reason }),
    priority: row.priority as Priority,
    evidenceIds: parseJsonArray(row.evidence_ids_json),
    status: row.status as EvidenceStatus,
    dedupeKey: row.dedupe_key,
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    createdAt: row.created_at,
    noMutationExecuted: true,
  };
}

function responseFromRow(row: ResponseRow): EvidenceResponsePayload {
  return {
    type: "evidence-response",
    responseId: row.response_id,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    sourceAgentId: row.source_agent_id as EvidenceTargetAgentId,
    targetAgentId: row.target_agent_id,
    ...(row.seller_id === null ? {} : { sellerId: row.seller_id }),
    ...(row.candidate_id === null ? {} : { candidateId: row.candidate_id }),
    status: row.status as EvidenceStatus,
    ...(row.answer === null ? {} : { answer: row.answer }),
    structuredEvidence: parseJsonObject(row.structured_evidence_json),
    evidenceIds: parseJsonArray(row.evidence_ids_json),
    confidence: row.confidence as ConfidenceLevel,
    blockers: parseJsonArray(row.blockers_json),
    warnings: parseJsonArray(row.warnings_json),
    createdAt: row.created_at,
    noMutationExecuted: true,
  };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export function migrateEvidenceStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_requests (
      request_id TEXT PRIMARY KEY,
      correlation_id TEXT NOT NULL,
      source_agent_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      seller_id TEXT,
      candidate_id TEXT,
      projection_id TEXT,
      supplier_id TEXT,
      supplier_item_id TEXT,
      product_name TEXT,
      category TEXT,
      kind TEXT NOT NULL,
      question TEXT NOT NULL,
      reason TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'queued',
      dedupe_key TEXT NOT NULL UNIQUE,
      evidence_ids_json TEXT NOT NULL DEFAULT '[]',
      claimed_by TEXT,
      claimed_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      error_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS evidence_responses (
      response_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES evidence_requests(request_id),
      correlation_id TEXT NOT NULL,
      source_agent_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      seller_id TEXT,
      candidate_id TEXT,
      status TEXT NOT NULL,
      answer TEXT,
      structured_evidence_json TEXT NOT NULL DEFAULT '{}',
      evidence_ids_json TEXT NOT NULL DEFAULT '[]',
      confidence TEXT NOT NULL DEFAULT 'low',
      blockers_json TEXT NOT NULL DEFAULT '[]',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence_request_links (
      request_id TEXT NOT NULL,
      linked_entity_type TEXT NOT NULL,
      linked_entity_id TEXT NOT NULL,
      PRIMARY KEY (request_id, linked_entity_type, linked_entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_requests_correlation
      ON evidence_requests(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_requests_target_agent
      ON evidence_requests(target_agent_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_requests_seller
      ON evidence_requests(seller_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_requests_candidate
      ON evidence_requests(candidate_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_requests_dedupe
      ON evidence_requests(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_evidence_requests_status
      ON evidence_requests(status);
    CREATE INDEX IF NOT EXISTS idx_evidence_requests_created
      ON evidence_requests(created_at);

    CREATE INDEX IF NOT EXISTS idx_evidence_responses_request
      ON evidence_responses(request_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_responses_correlation
      ON evidence_responses(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_responses_seller
      ON evidence_responses(seller_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_responses_candidate
      ON evidence_responses(candidate_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_responses_status
      ON evidence_responses(status);

    CREATE INDEX IF NOT EXISTS idx_evidence_request_links_entity
      ON evidence_request_links(linked_entity_type, linked_entity_id);
  `);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSqliteEvidenceRequestStore(db: Database.Database): EvidenceRequestStore {
  migrateEvidenceStore(db);

  const insertRequestStmt = db.prepare(`
    INSERT INTO evidence_requests
      (request_id, correlation_id, source_agent_id, target_agent_id,
       seller_id, candidate_id, projection_id, supplier_id, supplier_item_id,
       product_name, category, kind, question, reason, priority, status,
       dedupe_key, evidence_ids_json, claimed_by, claimed_at, expires_at,
       created_at, error_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getRequestStmt = db.prepare("SELECT * FROM evidence_requests WHERE request_id = ?");

  const getRequestByDedupeStmt = db.prepare("SELECT * FROM evidence_requests WHERE dedupe_key = ?");

  const claimRequestStmt = db.prepare(`
    UPDATE evidence_requests
    SET status = 'claimed', claimed_by = ?, claimed_at = ?
    WHERE request_id = ? AND status = 'queued'
  `);

  const insertResponseStmt = db.prepare(`
    INSERT INTO evidence_responses
      (response_id, request_id, correlation_id, source_agent_id, target_agent_id,
       seller_id, candidate_id, status, answer, structured_evidence_json,
       evidence_ids_json, confidence, blockers_json, warnings_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateRequestAnsweredStmt = db.prepare(`
    UPDATE evidence_requests
    SET status = 'answered'
    WHERE request_id = ? AND status = 'claimed'
  `);

  const updateRequestFailedStmt = db.prepare(`
    UPDATE evidence_requests
    SET status = 'failed', error_json = ?
    WHERE request_id = ?
  `);

  const expireRequestsStmt = db.prepare(`
    UPDATE evidence_requests
    SET status = 'expired'
    WHERE status IN ('queued', 'claimed')
      AND expires_at IS NOT NULL
      AND expires_at < ?
  `);

  const listPendingStmt = db.prepare(`
    SELECT * FROM evidence_requests
    WHERE target_agent_id = ?
      AND status IN ('queued', 'claimed')
      AND (@sellerId IS NULL OR seller_id = @sellerId)
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      created_at ASC
    LIMIT @limit
  `);

  const getResponseStmt = db.prepare("SELECT * FROM evidence_responses WHERE response_id = ?");

  const listResponsesByCorrelationStmt = db.prepare(`
    SELECT * FROM evidence_responses WHERE correlation_id = ? ORDER BY created_at ASC
  `);

  const listRequestsByCandidateStmt = db.prepare(`
    SELECT * FROM evidence_requests WHERE candidate_id = ? ORDER BY created_at ASC
  `);

  const listResponsesByCandidateStmt = db.prepare(`
    SELECT * FROM evidence_responses WHERE candidate_id = ? ORDER BY created_at ASC
  `);

  const countRequestsByCandidateStmt = db.prepare(`
    SELECT status, COUNT(*) as cnt
    FROM evidence_requests
    WHERE candidate_id = ?
    GROUP BY status
  `);

  const insertLinkStmt = db.prepare(`
    INSERT OR IGNORE INTO evidence_request_links
      (request_id, linked_entity_type, linked_entity_id)
    VALUES (?, ?, ?)
  `);

  const listLinksStmt = db.prepare(`
    SELECT * FROM evidence_request_links WHERE request_id = ?
  `);

  return {
    enqueueRequest(input) {
      // Try insert; UNIQUE on dedupe_key prevents duplicates
      try {
        insertRequestStmt.run(
          input.requestId,
          input.correlationId,
          input.sourceAgentId,
          input.targetAgentId,
          input.sellerId ?? null,
          input.candidateId ?? null,
          input.projectionId ?? null,
          input.supplierId ?? null,
          input.supplierItemId ?? null,
          input.productName ?? null,
          input.category ?? null,
          input.kind,
          input.question,
          input.reason ?? null,
          input.priority,
          "queued",
          input.dedupeKey,
          JSON.stringify(input.evidenceIds),
          null,
          null,
          input.expiresAt ?? null,
          input.createdAt,
          "{}",
        );

        return {
          status: "queued",
          request: {
            ...input,
            noMutationExecuted: true,
          },
        };
      } catch {
        // UNIQUE constraint violation — dedupe hit
        const existing = getRequestByDedupeStmt.get(input.dedupeKey) as RequestRow | undefined;
        if (existing) {
          return {
            status: "duplicate",
            request: requestFromRow(existing),
            duplicateOfRequestId: existing.request_id,
          };
        }

        // Fallback: re-read our own insert (race-resistant)
        const self = getRequestStmt.get(input.requestId) as RequestRow | undefined;
        if (self) {
          return {
            status: "duplicate",
            request: requestFromRow(self),
            duplicateOfRequestId: self.request_id,
          };
        }

        throw new Error(
          `Failed to enqueue evidence request ${input.requestId}: insert conflict without matching row`,
        );
      }
    },

    claimRequest(requestId, agentId) {
      const now = new Date().toISOString();
      const result = claimRequestStmt.run(agentId, now, requestId);

      if (result.changes === 0) {
        const existing = getRequestStmt.get(requestId) as RequestRow | undefined;
        return {
          success: false,
          reason: existing
            ? `Request ${requestId} is in status '${existing.status}' — cannot claim`
            : `Request ${requestId} not found`,
        };
      }

      const updated = getRequestStmt.get(requestId) as RequestRow;
      return {
        success: true,
        request: requestFromRow(updated),
      };
    },

    answerRequest(response) {
      const insertTx = db.transaction(() => {
        insertResponseStmt.run(
          response.responseId,
          response.requestId,
          response.correlationId,
          response.sourceAgentId,
          response.targetAgentId,
          response.sellerId ?? null,
          response.candidateId ?? null,
          response.status,
          response.answer ?? null,
          JSON.stringify(response.structuredEvidence),
          JSON.stringify(response.evidenceIds),
          response.confidence,
          JSON.stringify(response.blockers),
          JSON.stringify(response.warnings),
          response.createdAt,
        );

        updateRequestAnsweredStmt.run(response.requestId);
      });

      insertTx();
    },

    failRequest(requestId, error) {
      const errorJson = JSON.stringify({ error, failedAt: new Date().toISOString() });
      updateRequestFailedStmt.run(errorJson, requestId);
    },

    expireOldRequests(now) {
      expireRequestsStmt.run(now);
    },

    getRequest(requestId) {
      const row = getRequestStmt.get(requestId) as RequestRow | undefined;
      return row ? requestFromRow(row) : null;
    },

    getResponse(responseId) {
      const row = getResponseStmt.get(responseId) as ResponseRow | undefined;
      return row ? responseFromRow(row) : null;
    },

    listPendingRequestsForAgent(agentId, sellerId, limit = 50) {
      const effectiveLimit = Math.max(1, Math.min(limit, 200));
      return (
        listPendingStmt.all(
          {
            sellerId: sellerId ?? null,
            limit: effectiveLimit,
          },
          agentId,
        ) as RequestRow[]
      ).map(requestFromRow);
    },

    listResponsesForCorrelation(correlationId) {
      return (listResponsesByCorrelationStmt.all(correlationId) as ResponseRow[]).map(
        responseFromRow,
      );
    },

    listRequestsForCandidate(candidateId) {
      return (listRequestsByCandidateStmt.all(candidateId) as RequestRow[]).map(requestFromRow);
    },

    findDuplicate(dedupeKey) {
      const row = getRequestByDedupeStmt.get(dedupeKey) as RequestRow | undefined;
      return row ? requestFromRow(row) : null;
    },

    summarizeEvidenceForCandidate(candidateId) {
      const responses = (listResponsesByCandidateStmt.all(candidateId) as ResponseRow[]).map(
        responseFromRow,
      );

      if (responses.length === 0) return null;

      const counts = countRequestsByCandidateStmt.all(candidateId) as Array<{
        status: string;
        cnt: number;
      }>;

      const countMap: Record<string, number> = {};
      for (const { status, cnt } of counts) {
        countMap[status] = cnt;
      }

      const totalRequests = Object.values(countMap).reduce((a, b) => a + b, 0);
      const answeredCount = countMap.answered ?? 0;
      const pendingCount = (countMap.queued ?? 0) + (countMap.claimed ?? 0);
      const failedCount =
        (countMap.failed ?? 0) + (countMap.expired ?? 0) + (countMap.unsupported ?? 0);

      // Overall confidence = minimum across response confidences
      const confidenceOrder: Record<ConfidenceLevel, number> = { low: 1, medium: 2, high: 3 };
      let minConfidence: ConfidenceLevel = "high";
      for (const r of responses) {
        if ((confidenceOrder[r.confidence] ?? 0) < (confidenceOrder[minConfidence] ?? 3)) {
          minConfidence = r.confidence;
        }
      }

      const allBlockers: string[] = [];
      for (const r of responses) {
        allBlockers.push(...r.blockers);
      }

      return {
        candidateId,
        totalRequests,
        answeredCount,
        pendingCount,
        failedCount,
        responses,
        overallConfidence: responses.length > 0 ? minConfidence : null,
        blockers: allBlockers,
        updatedAt: responses.reduce(
          (latest, r) => (r.createdAt > latest ? r.createdAt : latest),
          "",
        ),
      };
    },

    linkRequest(requestId, entityType, entityId) {
      insertLinkStmt.run(requestId, entityType, entityId);
    },

    listLinks(requestId) {
      return (listLinksStmt.all(requestId) as LinkRow[]).map((row): EvidenceLink => ({
        requestId: row.request_id,
        linkedEntityType: row.linked_entity_type as EvidenceLinkedEntityType,
        linkedEntityId: row.linked_entity_id,
      }));
    },
  };
}
