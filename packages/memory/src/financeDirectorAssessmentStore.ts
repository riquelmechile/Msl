import type {
  AssessmentType,
  EvidenceRequest,
  FinancialAssessment,
  FinancialComparison,
  FinancialRisk,
  Hypothesis,
  MissingEvidence,
  Opportunity,
  Recommendation,
} from "@msl/domain";
import type { Currency } from "@msl/domain";
import Database from "better-sqlite3";

// ── Row type ────────────────────────────────────────────────────────────────

type AssessmentRow = {
  assessment_id: string;
  seller_id: string;
  account_id: string | null;
  objective: string;
  assessment_type: string;
  generated_at: number;
  evidence_window_start: number | null;
  evidence_window_end: number | null;
  currencies_json: string;
  evidence_ids_json: string;
  outcome_ids_json: string;
  snapshot_ids_json: string;
  proposal_id: string | null;
  summary: string;
  verified_facts_json: string;
  hypotheses_json: string;
  risks_json: string;
  opportunities_json: string;
  missing_evidence_json: string;
  comparisons_json: string | null;
  expected_impact: string | null;
  confidence: number;
  uncertainty_reasons_json: string;
  recommendations_json: string;
  requests_for_evidence_json: string;
  escalation_recommendation: string | null;
  model_used: string;
  fallback_used: number;
  prompt_block_hashes_json: string;
  work_session_id: string | null;
  correlation_id: string | null;
  no_mutation_executed: number;
};

// ── Public types ────────────────────────────────────────────────────────────

export type FinanceDirectorAssessmentStore = {
  insertAssessment(
    assessment: FinancialAssessment,
    opts?: { proposalId?: string },
  ): FinancialAssessment;
  getAssessment(assessmentId: string, sellerId: string): FinancialAssessment | null;
  listBySeller(sellerId: string, opts?: { limit?: number }): FinancialAssessment[];
  listByOutcome(outcomeId: string, sellerId: string): FinancialAssessment[];
  listByProposal(proposalId: string, sellerId: string): FinancialAssessment[];
  listBySession(workSessionId: string, sellerId: string): FinancialAssessment[];
  listByCorrelationId(correlationId: string, sellerId: string): FinancialAssessment[];
  latestByType(sellerId: string, assessmentType: AssessmentType): FinancialAssessment | null;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function parseJsonArrayOfStrings(raw: string | null): string[] {
  return parseJsonArray(raw);
}

function parseHypotheses(raw: string | null): Hypothesis[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is Hypothesis =>
        typeof v === "object" &&
        v !== null &&
        "statement" in v &&
        "confidence" in v &&
        "evidence" in v,
    );
  } catch {
    return [];
  }
}

function parseRisks(raw: string | null): FinancialRisk[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is FinancialRisk =>
        typeof v === "object" &&
        v !== null &&
        "description" in v &&
        "severity" in v &&
        "probability" in v,
    );
  } catch {
    return [];
  }
}

function parseOpportunities(raw: string | null): Opportunity[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is Opportunity => typeof v === "object" && v !== null && "description" in v,
    );
  } catch {
    return [];
  }
}

function parseMissingEvidence(raw: string | null): MissingEvidence[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is MissingEvidence =>
        typeof v === "object" && v !== null && "kind" in v && "reason" in v,
    );
  } catch {
    return [];
  }
}

function parseComparisons(raw: string | null): FinancialComparison[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter(
      (v): v is FinancialComparison =>
        typeof v === "object" &&
        v !== null &&
        "accountA" in v &&
        "accountB" in v &&
        "metric" in v &&
        "finding" in v,
    );
  } catch {
    return undefined;
  }
}

function parseRecommendations(raw: string | null): Recommendation[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is Recommendation =>
        typeof v === "object" && v !== null && "action" in v && "rationale" in v,
    );
  } catch {
    return [];
  }
}

function parseEvidenceRequests(raw: string | null): EvidenceRequest[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is EvidenceRequest =>
        typeof v === "object" && v !== null && "kind" in v && "targetAgent" in v,
    );
  } catch {
    return [];
  }
}

function parseCurrencies(raw: string | null): Currency[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is Currency => v === "CLP" || v === "USD");
  } catch {
    return [];
  }
}

function parsePromptBlockHashes(raw: string | null): {
  readonly blockA?: string;
  readonly blockB?: string;
  readonly blockC?: string;
  readonly blockD?: string;
} {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function assessmentFromRow(row: AssessmentRow): FinancialAssessment {
  return {
    assessmentId: row.assessment_id,
    sellerId: row.seller_id,
    ...(row.account_id === null ? {} : { accountId: row.account_id }),
    objective: row.objective,
    assessmentType: row.assessment_type as AssessmentType,
    generatedAt: row.generated_at,
    ...(row.evidence_window_start === null || row.evidence_window_end === null
      ? {}
      : {
          evidenceWindow: {
            start: row.evidence_window_start,
            end: row.evidence_window_end,
          },
        }),
    currencies: parseCurrencies(row.currencies_json),
    evidenceIds: parseJsonArrayOfStrings(row.evidence_ids_json),
    outcomeIds: parseJsonArrayOfStrings(row.outcome_ids_json),
    snapshotIds: parseJsonArrayOfStrings(row.snapshot_ids_json),
    summary: row.summary,
    verifiedFacts: parseJsonArrayOfStrings(row.verified_facts_json),
    hypotheses: parseHypotheses(row.hypotheses_json),
    risks: parseRisks(row.risks_json),
    opportunities: parseOpportunities(row.opportunities_json),
    missingEvidence: parseMissingEvidence(row.missing_evidence_json),
    ...(() => {
      const c = parseComparisons(row.comparisons_json);
      return c !== undefined ? { comparisons: c } : {};
    })(),
    ...(row.expected_impact === null ? {} : { expectedImpact: row.expected_impact }),
    confidence: row.confidence,
    uncertaintyReasons: parseJsonArrayOfStrings(row.uncertainty_reasons_json),
    recommendations: parseRecommendations(row.recommendations_json),
    requestsForEvidence: parseEvidenceRequests(row.requests_for_evidence_json),
    ...(row.escalation_recommendation === null
      ? {}
      : { escalationRecommendation: row.escalation_recommendation }),
    modelUsed: row.model_used,
    fallbackUsed: row.fallback_used === 1,
    promptBlockHashes: parsePromptBlockHashes(row.prompt_block_hashes_json),
    ...(row.work_session_id === null ? {} : { workSessionId: row.work_session_id }),
    ...(row.correlation_id === null ? {} : { correlationId: row.correlation_id }),
    noMutationExecuted: true as const,
  };
}

// ── Migration ───────────────────────────────────────────────────────────────

export function migrateFinanceDirectorAssessmentStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_director_assessments (
      assessment_id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      account_id TEXT,
      objective TEXT NOT NULL,
      assessment_type TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      evidence_window_start INTEGER,
      evidence_window_end INTEGER,
      currencies_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      outcome_ids_json TEXT NOT NULL,
      snapshot_ids_json TEXT NOT NULL,
      proposal_id TEXT,
      summary TEXT NOT NULL,
      verified_facts_json TEXT NOT NULL,
      hypotheses_json TEXT NOT NULL,
      risks_json TEXT NOT NULL,
      opportunities_json TEXT NOT NULL,
      missing_evidence_json TEXT NOT NULL,
      comparisons_json TEXT,
      expected_impact TEXT,
      confidence REAL NOT NULL,
      uncertainty_reasons_json TEXT NOT NULL,
      recommendations_json TEXT NOT NULL,
      requests_for_evidence_json TEXT NOT NULL,
      escalation_recommendation TEXT,
      model_used TEXT NOT NULL,
      fallback_used INTEGER NOT NULL DEFAULT 0,
      prompt_block_hashes_json TEXT NOT NULL,
      work_session_id TEXT,
      correlation_id TEXT,
      no_mutation_executed INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_fda_seller ON finance_director_assessments(seller_id);
    CREATE INDEX IF NOT EXISTS idx_fda_outcome ON finance_director_assessments(seller_id, outcome_ids_json);
    CREATE INDEX IF NOT EXISTS idx_fda_proposal ON finance_director_assessments(seller_id, proposal_id);
    CREATE INDEX IF NOT EXISTS idx_fda_session ON finance_director_assessments(work_session_id);
    CREATE INDEX IF NOT EXISTS idx_fda_correlation ON finance_director_assessments(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_fda_type ON finance_director_assessments(seller_id, assessment_type);
  `);
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createSqliteFinanceDirectorAssessmentStore(
  db: Database.Database,
): FinanceDirectorAssessmentStore {
  migrateFinanceDirectorAssessmentStore(db);

  // ── Prepared statements ────────────────────────────────────────────────

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO finance_director_assessments
      (assessment_id, seller_id, account_id, objective, assessment_type,
       generated_at, evidence_window_start, evidence_window_end,
       currencies_json, evidence_ids_json, outcome_ids_json, snapshot_ids_json,
       proposal_id, summary, verified_facts_json, hypotheses_json, risks_json,
       opportunities_json, missing_evidence_json, comparisons_json,
       expected_impact, confidence, uncertainty_reasons_json,
       recommendations_json, requests_for_evidence_json,
       escalation_recommendation, model_used, fallback_used,
       prompt_block_hashes_json, work_session_id, correlation_id,
       no_mutation_executed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getStmt = db.prepare(`
    SELECT * FROM finance_director_assessments
    WHERE assessment_id = ? AND seller_id = ?
  `);

  const listBySellerStmt = db.prepare(`
    SELECT * FROM finance_director_assessments
    WHERE seller_id = ?
    ORDER BY generated_at DESC
    LIMIT ?
  `);

  const listByOutcomeStmt = db.prepare(`
    SELECT * FROM finance_director_assessments
    WHERE seller_id = ?
      AND EXISTS (SELECT 1 FROM json_each(outcome_ids_json) WHERE value = ?)
    ORDER BY generated_at DESC
    LIMIT 50
  `);

  const listByProposalStmt = db.prepare(`
    SELECT * FROM finance_director_assessments
    WHERE proposal_id = ? AND seller_id = ?
    ORDER BY generated_at DESC
    LIMIT 50
  `);

  const listBySessionStmt = db.prepare(`
    SELECT * FROM finance_director_assessments
    WHERE work_session_id = ? AND seller_id = ?
    ORDER BY generated_at DESC
    LIMIT 50
  `);

  const listByCorrelationStmt = db.prepare(`
    SELECT * FROM finance_director_assessments
    WHERE correlation_id = ? AND seller_id = ?
    ORDER BY generated_at DESC
    LIMIT 50
  `);

  const latestByTypeStmt = db.prepare(`
    SELECT * FROM finance_director_assessments
    WHERE seller_id = ? AND assessment_type = ?
    ORDER BY generated_at DESC
    LIMIT 1
  `);

  return {
    insertAssessment(assessment, opts) {
      const tx = db.transaction(() => {
        insertStmt.run(
          assessment.assessmentId,
          assessment.sellerId,
          assessment.accountId ?? null,
          assessment.objective,
          assessment.assessmentType,
          assessment.generatedAt,
          assessment.evidenceWindow?.start ?? null,
          assessment.evidenceWindow?.end ?? null,
          JSON.stringify(assessment.currencies),
          JSON.stringify(assessment.evidenceIds),
          JSON.stringify(assessment.outcomeIds),
          JSON.stringify(assessment.snapshotIds),
          opts?.proposalId ?? null,
          assessment.summary,
          JSON.stringify(assessment.verifiedFacts),
          JSON.stringify(assessment.hypotheses),
          JSON.stringify(assessment.risks),
          JSON.stringify(assessment.opportunities),
          JSON.stringify(assessment.missingEvidence),
          assessment.comparisons ? JSON.stringify(assessment.comparisons) : null,
          assessment.expectedImpact ?? null,
          assessment.confidence,
          JSON.stringify(assessment.uncertaintyReasons),
          JSON.stringify(assessment.recommendations),
          JSON.stringify(assessment.requestsForEvidence),
          assessment.escalationRecommendation ?? null,
          assessment.modelUsed,
          assessment.fallbackUsed ? 1 : 0,
          JSON.stringify(assessment.promptBlockHashes),
          assessment.workSessionId ?? null,
          assessment.correlationId ?? null,
          1,
        );
      });

      tx();
      return assessment;
    },

    getAssessment(assessmentId, sellerId) {
      const row = getStmt.get(assessmentId, sellerId) as AssessmentRow | undefined;
      return row ? assessmentFromRow(row) : null;
    },

    listBySeller(sellerId, opts = {}) {
      const limit = Math.max(1, Math.min(opts.limit ?? 50, 1000));
      return (listBySellerStmt.all(sellerId, limit) as AssessmentRow[]).map(assessmentFromRow);
    },

    listByOutcome(outcomeId, sellerId) {
      return (listByOutcomeStmt.all(sellerId, outcomeId) as AssessmentRow[]).map(assessmentFromRow);
    },

    listByProposal(proposalId, sellerId) {
      return (listByProposalStmt.all(proposalId, sellerId) as AssessmentRow[]).map(
        assessmentFromRow,
      );
    },

    listBySession(workSessionId, sellerId) {
      return (listBySessionStmt.all(workSessionId, sellerId) as AssessmentRow[]).map(
        assessmentFromRow,
      );
    },

    listByCorrelationId(correlationId, sellerId) {
      return (listByCorrelationStmt.all(correlationId, sellerId) as AssessmentRow[]).map(
        assessmentFromRow,
      );
    },

    latestByType(sellerId, assessmentType) {
      const row = latestByTypeStmt.get(sellerId, assessmentType) as AssessmentRow | undefined;
      return row ? assessmentFromRow(row) : null;
    },
  };
}
