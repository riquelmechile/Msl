import Database from "better-sqlite3";

// ── Schema ───────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL,
  reviewer_agent_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  rationale TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_reviews_proposal ON agent_reviews(proposal_id);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_reviewer ON agent_reviews(reviewer_agent_id);
`;

// ── Constants ────────────────────────────────────────────────────────

const VALID_VERDICTS = new Set<string>([
  "approve",
  "reject",
  "needs_more_evidence",
  "risk_warning",
]);

const HIGH_RISK_KINDS = new Set<string>([
  "listing-edit",
  "creative-publication",
  "product-ads-action",
  "cancellation",
  "refund",
  "honey-pot-deploy",
  "probe-analysis",
]);

const MIN_REVIEWS_REQUIRED = 2;

// ── Public types ─────────────────────────────────────────────────────

export type ReviewVerdict =
  | "approve"
  | "reject"
  | "needs_more_evidence"
  | "risk_warning";

export type AgentReview = {
  id: number;
  proposalId: string;
  reviewerAgentId: string;
  verdict: ReviewVerdict;
  rationale: string;
  confidence: number;
  createdAt: string;
};

export type SubmitReviewInput = {
  proposalId: string;
  reviewerAgentId: string;
  verdict: ReviewVerdict;
  rationale: string;
  confidence: number;
};

export type ConsensusResult = {
  proposalId: string;
  reviews: AgentReview[];
  verdicts: Record<string, number>;
  recommendation:
    | "approved"
    | "rejected"
    | "needs_review"
    | "insufficient_reviews";
  minReviewsRequired: number;
  hasQuorum: boolean;
};

export type AgentConsensusStore = {
  submitReview(input: SubmitReviewInput): AgentReview;
  getConsensus(proposalId: string): ConsensusResult;
  requiresConsensus(proposalKind: string, riskDelta?: number): boolean;
};

// ── Row type ─────────────────────────────────────────────────────────

type AgentReviewRow = {
  id: number;
  proposal_id: string;
  reviewer_agent_id: string;
  verdict: string;
  rationale: string;
  confidence: number;
  created_at: string;
};

// ── Row mapper ───────────────────────────────────────────────────────

function rowToAgentReview(row: AgentReviewRow): AgentReview {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    reviewerAgentId: row.reviewer_agent_id,
    verdict: row.verdict as ReviewVerdict,
    rationale: row.rationale,
    confidence: row.confidence,
    createdAt: row.created_at,
  };
}

// ── Consensus logic ──────────────────────────────────────────────────

function computeRecommendation(
  reviews: AgentReview[],
  minReviewsRequired: number,
): ConsensusResult["recommendation"] {
  if (reviews.length < minReviewsRequired) {
    return "insufficient_reviews";
  }

  const approvals = reviews.filter((r) => r.verdict === "approve").length;
  const rejections = reviews.filter((r) => r.verdict === "reject").length;

  if (approvals > rejections) return "approved";
  if (rejections > approvals) return "rejected";
  return "needs_review";
}

// ── Factory ──────────────────────────────────────────────────────────

export function createAgentConsensusStore(
  db: Database.Database,
): AgentConsensusStore {
  db.exec(SCHEMA_SQL);

  // ── Prepared statements ────────────────────────────────────

  const insertStmt = db.prepare(`
    INSERT INTO agent_reviews (proposal_id, reviewer_agent_id, verdict, rationale, confidence)
    VALUES (@proposalId, @reviewerAgentId, @verdict, @rationale, @confidence)
  `);

  const selectByProposalStmt = db.prepare(`
    SELECT * FROM agent_reviews
    WHERE proposal_id = ?
    ORDER BY created_at ASC
  `);

  const selectByIdStmt = db.prepare(`
    SELECT * FROM agent_reviews WHERE id = ?
  `);

  // ── API methods ─────────────────────────────────────────────

  const submitReview = (input: SubmitReviewInput): AgentReview => {
    if (!VALID_VERDICTS.has(input.verdict)) {
      throw new Error(
        `Invalid verdict: "${input.verdict}". Valid: ${[...VALID_VERDICTS].join(", ")}.`,
      );
    }

    if (
      typeof input.confidence !== "number" ||
      Number.isNaN(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 1
    ) {
      throw new Error(
        `Confidence must be a number between 0.0 and 1.0, got ${input.confidence}.`,
      );
    }

    if (!input.rationale || input.rationale.trim().length === 0) {
      throw new Error("Rationale is required and must not be empty.");
    }

    const info = insertStmt.run({
      proposalId: input.proposalId,
      reviewerAgentId: input.reviewerAgentId,
      verdict: input.verdict,
      rationale: input.rationale,
      confidence: input.confidence,
    });

    const row = selectByIdStmt.get(info.lastInsertRowid) as AgentReviewRow;
    return rowToAgentReview(row);
  };

  const getConsensus = (proposalId: string): ConsensusResult => {
    const rows = selectByProposalStmt.all(proposalId) as AgentReviewRow[];
    const reviews = rows.map(rowToAgentReview);

    const verdicts: Record<string, number> = {};
    for (const review of reviews) {
      verdicts[review.verdict] = (verdicts[review.verdict] ?? 0) + 1;
    }

    const recommendation = computeRecommendation(reviews, MIN_REVIEWS_REQUIRED);
    const hasQuorum = reviews.length >= MIN_REVIEWS_REQUIRED;

    return {
      proposalId,
      reviews,
      verdicts,
      recommendation,
      minReviewsRequired: MIN_REVIEWS_REQUIRED,
      hasQuorum,
    };
  };

  const requiresConsensus = (
    proposalKind: string,
    riskDelta?: number,
  ): boolean => {
    if (proposalKind === "price-change") {
      // Default: price-change requires consensus (e.g. when called from agentLoop
      // without explicit riskDelta). When riskDelta is provided, only require
      // consensus if the delta exceeds 20%.
      if (riskDelta == null) return true;
      return riskDelta > 0.2;
    }
    return HIGH_RISK_KINDS.has(proposalKind);
  };

  return { submitReview, getConsensus, requiresConsensus };
}
