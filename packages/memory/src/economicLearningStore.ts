import type {
  AppliedAdjustment,
  EconomicAttributionAssessment,
  EconomicLearningEligibility,
  EconomicLearningEvent,
  EconomicReinforcementPlan,
  LearningEventStatus,
} from "@msl/domain";
import Database from "better-sqlite3";

// ── Row types ────────────────────────────────────────────────────────────────

type EventRow = {
  event_id: string;
  idempotency_key: string;
  outcome_id: string;
  seller_id: string;
  plan_id: string;
  attribution_id: string;
  target_node_ids_json: string;
  target_edge_ids_json: string;
  adjustments_json: string;
  lessons_created_json: string;
  before_state_hash: string;
  after_state_hash: string;
  applied_at: number;
  reversed_at: number | null;
  status: string;
  error_code: string | null;
  metadata_json: string;
  reinforcement_policy_version: string;
  no_mutation_executed: number;
};

type EligibilityRow = {
  outcome_id: string;
  seller_id: string;
  eligible: number;
  reason_codes_json: string;
  evaluated_at: number;
};

type AttributionRow = {
  attribution_id: string;
  outcome_id: string;
  seller_id: string;
  target_type: string;
  target_id: string;
  strength: string;
  confidence: number;
  supporting_evidence_ids_json: string;
  contradicting_evidence_ids_json: string;
  alternative_explanations_json: string;
  created_at: number;
};

type PlanRow = {
  plan_id: string;
  outcome_id: string;
  seller_id: string;
  plan_json: string;
  status: string;
  created_at: number;
};

// ── Public type ──────────────────────────────────────────────────────────────

export type EconomicLearningStore = {
  // Event management
  insertEvent(event: EconomicLearningEvent): EconomicLearningEvent;
  getEvent(eventId: string, sellerId: string): EconomicLearningEvent | null;
  listByOutcome(outcomeId: string, sellerId: string): EconomicLearningEvent[];
  listBySeller(sellerId: string, opts?: { limit?: number }): EconomicLearningEvent[];
  listByAgent(agentId: string, sellerId: string): EconomicLearningEvent[];
  updateEventStatus(
    eventId: string,
    status: LearningEventStatus,
    errorCode?: string,
  ): EconomicLearningEvent;

  // Idempotency
  claimIdempotencyKey(key: string, sellerId: string): boolean;

  // Reversal
  reverseEvent(eventId: string, sellerId: string): EconomicLearningEvent;
  getReversedEvents(outcomeId: string, sellerId: string): EconomicLearningEvent[];

  // Eligibility/Attribution/Plan persistence (for audit trail)
  saveEligibility(eligibility: EconomicLearningEligibility): void;
  saveAttribution(assessment: EconomicAttributionAssessment): void;
  savePlan(plan: EconomicReinforcementPlan): void;
  getLatestPlan(outcomeId: string, sellerId: string): EconomicReinforcementPlan | null;

  // Read queries for audit trail
  getEligibility(outcomeId: string, sellerId: string): EconomicLearningEligibility | null;
  listAttributionsByOutcome(outcomeId: string, sellerId: string): EconomicAttributionAssessment[];

  // Query helpers
  isAlreadyProcessed(outcomeId: string, sellerId: string, policyVersion: string): boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function parseAppliedAdjustments(raw: string | null): AppliedAdjustment[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is AppliedAdjustment =>
        typeof v === "object" &&
        v !== null &&
        "nodeId" in v &&
        "delta" in v &&
        "targetType" in v &&
        "beforeValue" in v &&
        "afterValue" in v,
    );
  } catch {
    return [];
  }
}

// ── Row mappers ──────────────────────────────────────────────────────────────

function eventFromRow(row: EventRow): EconomicLearningEvent {
  return {
    eventId: row.event_id,
    idempotencyKey: row.idempotency_key,
    outcomeId: row.outcome_id,
    sellerId: row.seller_id,
    planId: row.plan_id,
    attributionId: row.attribution_id,
    targetNodeIds: parseJsonArray(row.target_node_ids_json),
    targetEdgeIds: parseJsonArray(row.target_edge_ids_json),
    adjustments: parseAppliedAdjustments(row.adjustments_json),
    lessonsCreated: parseJsonArray(row.lessons_created_json),
    beforeStateHash: row.before_state_hash,
    afterStateHash: row.after_state_hash,
    appliedAt: row.applied_at,
    ...(row.reversed_at === null ? {} : { reversedAt: row.reversed_at }),
    status: row.status as LearningEventStatus,
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    metadata: parseJsonObject(row.metadata_json),
    reinforcementPolicyVersion: row.reinforcement_policy_version,
  };
}

function eligibilityFromRow(row: EligibilityRow): EconomicLearningEligibility {
  return {
    outcomeId: row.outcome_id,
    sellerId: row.seller_id,
    eligible: row.eligible === 1,
    reasonCodes: parseJsonArray(
      row.reason_codes_json,
    ) as EconomicLearningEligibility["reasonCodes"],
    // Fields not stored are filled with defaults for reconstruction
    outcomeStatus: "verified",
    completeness: 0,
    confidence: 0,
    evidenceQuality: 0,
    hasVerifiedEconomicImpact: false,
    hasAttributionTargets: false,
    currencies: [],
    evaluatedAt: row.evaluated_at,
  };
}

function attributionFromRow(row: AttributionRow): EconomicAttributionAssessment {
  return {
    attributionId: row.attribution_id,
    outcomeId: row.outcome_id,
    sellerId: row.seller_id,
    targetType: row.target_type as EconomicAttributionAssessment["targetType"],
    targetId: row.target_id,
    strength: row.strength as EconomicAttributionAssessment["strength"],
    confidence: row.confidence,
    supportingEvidenceIds: parseJsonArray(row.supporting_evidence_ids_json),
    contradictingEvidenceIds: parseJsonArray(row.contradicting_evidence_ids_json),
    alternativeExplanations: parseJsonArray(row.alternative_explanations_json),
    evaluator: "",
    createdAt: row.created_at,
    noMutationExecuted: true as const,
  };
}

function planFromRow(row: PlanRow): EconomicReinforcementPlan {
  const parsed = parseJsonObject(row.plan_json);
  return {
    ...parsed,
    planId: row.plan_id,
    outcomeId: row.outcome_id,
    sellerId: row.seller_id,
    status: row.status,
    createdAt: row.created_at,
    noExternalMutationExecuted: true as const,
  } as unknown as EconomicReinforcementPlan;
}

// ── Migration ────────────────────────────────────────────────────────────────

export function migrateEconomicLearningStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS economic_learning_events (
      event_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL,
      outcome_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      attribution_id TEXT NOT NULL,
      target_node_ids_json TEXT NOT NULL DEFAULT '[]',
      target_edge_ids_json TEXT NOT NULL DEFAULT '[]',
      adjustments_json TEXT NOT NULL DEFAULT '[]',
      lessons_created_json TEXT NOT NULL DEFAULT '[]',
      before_state_hash TEXT NOT NULL DEFAULT '',
      after_state_hash TEXT NOT NULL DEFAULT '',
      applied_at INTEGER NOT NULL,
      reversed_at INTEGER,
      status TEXT NOT NULL DEFAULT 'processed',
      error_code TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      reinforcement_policy_version TEXT NOT NULL DEFAULT '',
      no_mutation_executed INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_ele_seller ON economic_learning_events(seller_id);
    CREATE INDEX IF NOT EXISTS idx_ele_outcome ON economic_learning_events(outcome_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ele_idempotency ON economic_learning_events(idempotency_key);

    CREATE TABLE IF NOT EXISTS economic_learning_idempotency (
      idempotency_key TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      claimed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS economic_learning_eligibility (
      outcome_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      eligible INTEGER NOT NULL,
      reason_codes_json TEXT NOT NULL DEFAULT '[]',
      evaluated_at INTEGER NOT NULL,
      PRIMARY KEY (outcome_id, seller_id)
    );

    CREATE TABLE IF NOT EXISTS economic_attribution_assessments (
      attribution_id TEXT PRIMARY KEY,
      outcome_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      strength TEXT NOT NULL,
      confidence REAL NOT NULL,
      supporting_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
      contradicting_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
      alternative_explanations_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_eaa_seller ON economic_attribution_assessments(seller_id);
    CREATE INDEX IF NOT EXISTS idx_eaa_outcome ON economic_attribution_assessments(outcome_id);

    CREATE TABLE IF NOT EXISTS economic_reinforcement_plans (
      plan_id TEXT PRIMARY KEY,
      outcome_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_erp_seller ON economic_reinforcement_plans(seller_id);
    CREATE INDEX IF NOT EXISTS idx_erp_outcome ON economic_reinforcement_plans(outcome_id);
  `);
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createSqliteEconomicLearningStore(db: Database.Database): EconomicLearningStore {
  migrateEconomicLearningStore(db);

  // ── Prepared statements ────────────────────────────────────────────────

  const insertEventStmt = db.prepare(`
    INSERT OR REPLACE INTO economic_learning_events
      (event_id, idempotency_key, outcome_id, seller_id, plan_id,
       attribution_id, target_node_ids_json, target_edge_ids_json,
       adjustments_json, lessons_created_json, before_state_hash,
       after_state_hash, applied_at, reversed_at, status, error_code,
       metadata_json, reinforcement_policy_version, no_mutation_executed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getEventStmt = db.prepare(
    "SELECT * FROM economic_learning_events WHERE event_id = ? AND seller_id = ?",
  );

  const listByOutcomeStmt = db.prepare(`
    SELECT * FROM economic_learning_events
    WHERE outcome_id = ? AND seller_id = ?
    ORDER BY applied_at DESC
    LIMIT 100
  `);

  const listBySellerStmt = db.prepare(`
    SELECT * FROM economic_learning_events
    WHERE seller_id = ?
    ORDER BY applied_at DESC
    LIMIT ?
  `);

  const listByAgentStmt = db.prepare(`
    SELECT * FROM economic_learning_events
    WHERE seller_id = ?
      AND EXISTS (
        SELECT 1 FROM economic_attribution_assessments
        WHERE economic_attribution_assessments.attribution_id = economic_learning_events.attribution_id
          AND economic_attribution_assessments.target_id = ?
      )
    ORDER BY applied_at DESC
    LIMIT 100
  `);

  const updateStatusStmt = db.prepare(`
    UPDATE economic_learning_events
    SET status = ?, error_code = ?
    WHERE event_id = ? AND seller_id = ?
  `);

  const getEventByIdStmt = db.prepare("SELECT * FROM economic_learning_events WHERE event_id = ?");

  const claimIdempotencyStmt = db.prepare(`
    INSERT OR IGNORE INTO economic_learning_idempotency
      (idempotency_key, seller_id, claimed_at)
    VALUES (?, ?, ?)
  `);

  const reverseStmt = db.prepare(`
    UPDATE economic_learning_events
    SET reversed_at = ?, status = 'reversed'
    WHERE event_id = ? AND seller_id = ?
  `);

  const getReversedStmt = db.prepare(`
    SELECT * FROM economic_learning_events
    WHERE outcome_id = ? AND seller_id = ? AND status = 'reversed'
    ORDER BY reversed_at DESC
    LIMIT 100
  `);

  const insertEligibilityStmt = db.prepare(`
    INSERT OR REPLACE INTO economic_learning_eligibility
      (outcome_id, seller_id, eligible, reason_codes_json, evaluated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertAttributionStmt = db.prepare(`
    INSERT OR REPLACE INTO economic_attribution_assessments
      (attribution_id, outcome_id, seller_id, target_type, target_id,
       strength, confidence, supporting_evidence_ids_json,
       contradicting_evidence_ids_json, alternative_explanations_json,
       created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPlanStmt = db.prepare(`
    INSERT OR REPLACE INTO economic_reinforcement_plans
      (plan_id, outcome_id, seller_id, plan_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const getLatestPlanStmt = db.prepare(`
    SELECT * FROM economic_reinforcement_plans
    WHERE outcome_id = ? AND seller_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const isAlreadyProcessedStmt = db.prepare(`
    SELECT 1 FROM economic_learning_events
    WHERE outcome_id = ? AND seller_id = ? AND reinforcement_policy_version = ?
    LIMIT 1
  `);

  const getEligibilityStmt = db.prepare(`
    SELECT * FROM economic_learning_eligibility
    WHERE outcome_id = ? AND seller_id = ?
  `);

  const listAttributionsByOutcomeStmt = db.prepare(`
    SELECT * FROM economic_attribution_assessments
    WHERE outcome_id = ? AND seller_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `);

  return {
    // ── Event management ─────────────────────────────────────────────────

    insertEvent(event) {
      const tx = db.transaction(() => {
        insertEventStmt.run(
          event.eventId,
          event.idempotencyKey,
          event.outcomeId,
          event.sellerId,
          event.planId,
          event.attributionId,
          JSON.stringify(event.targetNodeIds),
          JSON.stringify(event.targetEdgeIds),
          JSON.stringify(event.adjustments),
          JSON.stringify(event.lessonsCreated),
          event.beforeStateHash,
          event.afterStateHash,
          event.appliedAt,
          event.reversedAt ?? null,
          event.status,
          event.errorCode ?? null,
          JSON.stringify(event.metadata),
          event.reinforcementPolicyVersion,
          1,
        );
      });

      tx();
      return event;
    },

    getEvent(eventId, sellerId) {
      const row = getEventStmt.get(eventId, sellerId) as EventRow | undefined;
      return row ? eventFromRow(row) : null;
    },

    listByOutcome(outcomeId, sellerId) {
      return (listByOutcomeStmt.all(outcomeId, sellerId) as EventRow[]).map(eventFromRow);
    },

    listBySeller(sellerId, opts = {}) {
      const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
      return (listBySellerStmt.all(sellerId, limit) as EventRow[]).map(eventFromRow);
    },

    listByAgent(agentId, sellerId) {
      return (listByAgentStmt.all(sellerId, agentId) as EventRow[]).map(eventFromRow);
    },

    updateEventStatus(eventId, status, errorCode) {
      const row = getEventByIdStmt.get(eventId) as EventRow | undefined;
      if (!row) {
        throw new Error(`EconomicLearningEvent ${eventId} not found`);
      }

      updateStatusStmt.run(status, errorCode ?? null, eventId, row.seller_id);

      return {
        ...eventFromRow(row),
        status,
        ...(errorCode === undefined ? {} : { errorCode }),
      };
    },

    // ── Idempotency ──────────────────────────────────────────────────────

    claimIdempotencyKey(key, sellerId) {
      const result = claimIdempotencyStmt.run(key, sellerId, Date.now());
      return result.changes > 0;
    },

    // ── Reversal ─────────────────────────────────────────────────────────

    reverseEvent(eventId, sellerId) {
      const row = getEventStmt.get(eventId, sellerId) as EventRow | undefined;
      if (!row) {
        throw new Error(`EconomicLearningEvent ${eventId} not found`);
      }

      const now = Date.now();
      reverseStmt.run(now, eventId, sellerId);

      return {
        ...eventFromRow(row),
        reversedAt: now,
        status: "reversed",
      };
    },

    getReversedEvents(outcomeId, sellerId) {
      return (getReversedStmt.all(outcomeId, sellerId) as EventRow[]).map(eventFromRow);
    },

    // ── Eligibility ──────────────────────────────────────────────────────

    saveEligibility(eligibility) {
      const tx = db.transaction(() => {
        insertEligibilityStmt.run(
          eligibility.outcomeId,
          eligibility.sellerId,
          eligibility.eligible ? 1 : 0,
          JSON.stringify(eligibility.reasonCodes),
          eligibility.evaluatedAt,
        );
      });

      tx();
    },

    // ── Attribution ──────────────────────────────────────────────────────

    saveAttribution(assessment) {
      const tx = db.transaction(() => {
        insertAttributionStmt.run(
          assessment.attributionId,
          assessment.outcomeId,
          assessment.sellerId,
          assessment.targetType,
          assessment.targetId,
          assessment.strength,
          assessment.confidence,
          JSON.stringify(assessment.supportingEvidenceIds),
          JSON.stringify(assessment.contradictingEvidenceIds),
          JSON.stringify(assessment.alternativeExplanations),
          assessment.createdAt,
        );
      });

      tx();
    },

    // ── Plan ─────────────────────────────────────────────────────────────

    savePlan(plan) {
      // Store full plan as JSON, but exclude the fields stored as columns
      const {
        planId,
        outcomeId,
        sellerId,
        status: _status,
        createdAt: _createdAt,
        noExternalMutationExecuted: _nm,
        ...rest
      } = plan;
      const planData = { ...rest, planId, outcomeId, sellerId };

      const tx = db.transaction(() => {
        insertPlanStmt.run(
          plan.planId,
          plan.outcomeId,
          plan.sellerId,
          JSON.stringify(planData),
          plan.status,
          plan.createdAt,
        );
      });

      tx();
    },

    getLatestPlan(outcomeId, sellerId) {
      const row = getLatestPlanStmt.get(outcomeId, sellerId) as PlanRow | undefined;
      return row ? planFromRow(row) : null;
    },

    // ── Read queries ───────────────────────────────────────────────────

    getEligibility(outcomeId, sellerId) {
      const row = getEligibilityStmt.get(outcomeId, sellerId) as EligibilityRow | undefined;
      return row ? eligibilityFromRow(row) : null;
    },

    listAttributionsByOutcome(outcomeId, sellerId) {
      return (listAttributionsByOutcomeStmt.all(outcomeId, sellerId) as AttributionRow[]).map(
        attributionFromRow,
      );
    },

    // ── Query helpers ────────────────────────────────────────────────────

    isAlreadyProcessed(outcomeId, sellerId, policyVersion) {
      const row = isAlreadyProcessedStmt.get(outcomeId, sellerId, policyVersion);
      return row !== undefined;
    },
  };
}
