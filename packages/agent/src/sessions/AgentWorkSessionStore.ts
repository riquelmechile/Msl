import Database from "better-sqlite3";

import type {
  AgentWorkSession,
  AgentObservation,
  AgentLesson,
  SessionStatus,
  ObservationKind,
  ShiftSummary,
} from "@msl/domain";

// ── Public store type ───────────────────────────────────────────────────────

export type AgentWorkSessionStore = {
  startSession(session: AgentWorkSession): AgentWorkSession;
  getSession(sessionId: string, sellerId: string): AgentWorkSession | undefined;
  completeSession(sessionId: string, sellerId: string, summaryJson: string): void;
  failSession(sessionId: string, sellerId: string, errorJson: string): void;
  skipSession(sessionId: string, sellerId: string, reason: string): void;
  listRecentSessionsByAgent(sellerId: string, agentId: string, limit?: number): AgentWorkSession[];
  getLastSessionForSignals(
    sellerId: string,
    agentId: string,
    signalsHash: string,
  ): AgentWorkSession | undefined;
  addObservation(obs: AgentObservation): void;
  addProposalLink(sessionId: string, proposalId: string, sellerId: string): void;
  addLesson(lesson: AgentLesson): void;
  listRecentLessons(sellerId: string, agentId: string, limit?: number): AgentLesson[];
  summarizeShift(sellerId: string, since: string): ShiftSummary;
};

// ── Limits ──────────────────────────────────────────────────────────────────

export const SESSION_LIMITS = Object.freeze({
  defaultListLimit: 20,
  maxListLimit: 50,
  maxSessionIdLength: 64,
  maxSellerIdLength: 64,
  maxAgentIdLength: 96,
  maxLaneIdLength: 64,
  maxHashLength: 128,
  maxLessonTextLength: 2048,
  maxSummaryJsonLength: 8192,
  maxErrorJsonLength: 4096,
  maxProposalIdLength: 64,
  maxObservationSummaryLength: 1024,
});

// ── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_work_sessions (
  session_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  lane_id TEXT NOT NULL,
  status TEXT NOT NULL,
  signals_hash TEXT NOT NULL,
  stable_prompt_hash TEXT,
  evidence_hash TEXT,
  started_at TEXT,
  ended_at TEXT,
  last_active_at TEXT,
  cycle_count INTEGER DEFAULT 0,
  summary_json TEXT DEFAULT '{}',
  error_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_aws_seller ON agent_work_sessions(seller_id);
CREATE INDEX IF NOT EXISTS idx_aws_agent ON agent_work_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_aws_lane ON agent_work_sessions(lane_id);
CREATE INDEX IF NOT EXISTS idx_aws_signals_hash ON agent_work_sessions(seller_id, agent_id, signals_hash);
CREATE INDEX IF NOT EXISTS idx_aws_created ON agent_work_sessions(created_at);

CREATE TABLE IF NOT EXISTS agent_observations (
  observation_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES agent_work_sessions(session_id),
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  severity TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ao_seller ON agent_observations(seller_id);
CREATE INDEX IF NOT EXISTS idx_ao_session ON agent_observations(session_id);
CREATE INDEX IF NOT EXISTS idx_ao_kind ON agent_observations(kind);

CREATE TABLE IF NOT EXISTS agent_session_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(session_id, proposal_id)
);

CREATE TABLE IF NOT EXISTS agent_session_lessons (
  lesson_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  lesson TEXT NOT NULL,
  transferable INTEGER DEFAULT 0,
  learned_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_asl_seller ON agent_session_lessons(seller_id);
CREATE INDEX IF NOT EXISTS idx_asl_session ON agent_session_lessons(session_id);
CREATE INDEX IF NOT EXISTS idx_asl_transferable ON agent_session_lessons(transferable);

CREATE TABLE IF NOT EXISTS agent_shift_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  shift_start TEXT NOT NULL,
  shift_end TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ass_seller ON agent_shift_summaries(seller_id);
CREATE INDEX IF NOT EXISTS idx_ass_kind ON agent_shift_summaries(kind);
`;

// ── Row types ───────────────────────────────────────────────────────────────

type SessionRow = {
  session_id: string;
  seller_id: string;
  agent_id: string;
  lane_id: string;
  status: string;
  signals_hash: string;
  stable_prompt_hash: string | null;
  evidence_hash: string | null;
  started_at: string | null;
  ended_at: string | null;
  last_active_at: string | null;
  cycle_count: number;
  summary_json: string;
  error_json: string | null;
  created_at: string;
};

type LessonRow = {
  lesson_id: string;
  seller_id: string;
  agent_id: string;
  session_id: string;
  lesson: string;
  transferable: number;
  learned_at: string;
};

// ── Validation helpers ──────────────────────────────────────────────────────

const validStatuses = new Set<SessionStatus>([
  "planned",
  "running",
  "completed",
  "skipped",
  "failed",
]);

const validObservationKinds = new Set<ObservationKind>([
  "new_signal",
  "risk",
  "opportunity",
  "missing_data",
  "repeated_pattern",
  "no_change",
]);

const validSeverities = new Set(["info", "warning", "critical"]);

const sessionIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const sellerIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const agentIdPattern = /^[a-zA-Z0-9_-]{1,96}$/;
const hashPattern = /^[a-f0-9]{16,128}$/i;

function isValidTimestamp(value: string | null): boolean {
  if (!value) return true; // nullable timestamps are ok
  return !Number.isNaN(Date.parse(value));
}

function rowToSession(row: SessionRow): AgentWorkSession | undefined {
  if (!sessionIdPattern.test(row.session_id)) return undefined;
  if (!sellerIdPattern.test(row.seller_id)) return undefined;
  if (!agentIdPattern.test(row.agent_id)) return undefined;
  if (!validStatuses.has(row.status as SessionStatus)) return undefined;
  if (!hashPattern.test(row.signals_hash)) return undefined;
  if (row.stable_prompt_hash && !hashPattern.test(row.stable_prompt_hash)) return undefined;
  if (row.evidence_hash && !hashPattern.test(row.evidence_hash)) return undefined;
  if (!isValidTimestamp(row.started_at)) return undefined;
  if (!isValidTimestamp(row.ended_at)) return undefined;
  if (!isValidTimestamp(row.last_active_at)) return undefined;
  if (typeof row.cycle_count !== "number" || row.cycle_count < 0) return undefined;

  const session: AgentWorkSession = {
    sessionId: row.session_id,
    sellerId: row.seller_id,
    agentId: row.agent_id,
    laneId: row.lane_id,
    status: row.status as SessionStatus,
    signalsHash: row.signals_hash,
    stablePromptHash: row.stable_prompt_hash ?? "",
    evidenceHash: row.evidence_hash ?? "",
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
    ...(row.last_active_at ? { lastActiveAt: row.last_active_at } : {}),
    cycleCount: row.cycle_count,
    summaryJson: row.summary_json,
    ...(row.error_json ? { errorJson: row.error_json } : {}),
  };
  return Object.freeze(session);
}

function rowToLesson(row: LessonRow): AgentLesson | undefined {
  if (!sessionIdPattern.test(row.lesson_id)) return undefined;
  if (!sellerIdPattern.test(row.seller_id)) return undefined;
  if (!agentIdPattern.test(row.agent_id)) return undefined;
  if (row.lesson.length > SESSION_LIMITS.maxLessonTextLength) return undefined;

  return Object.freeze({
    lessonId: row.lesson_id,
    sellerId: row.seller_id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    lesson: row.lesson,
    transferable: row.transferable === 1,
    learnedAt: row.learned_at,
  });
}

// ── Store factory ───────────────────────────────────────────────────────────

export function createAgentWorkSessionStore(db: Database.Database): AgentWorkSessionStore {
  db.exec(SCHEMA_SQL);

  // ── Prepared statements ────────────────────────────────────────

  const insertSessionStmt = db.prepare(`
    INSERT INTO agent_work_sessions (
      session_id, seller_id, agent_id, lane_id, status,
      signals_hash, stable_prompt_hash, evidence_hash,
      started_at, ended_at, last_active_at,
      cycle_count, summary_json, error_json
    ) VALUES (
      @sessionId, @sellerId, @agentId, @laneId, @status,
      @signalsHash, @stablePromptHash, @evidenceHash,
      @startedAt, @endedAt, @lastActiveAt,
      @cycleCount, @summaryJson, @errorJson
    )
  `);

  const getSessionStmt = db.prepare(`
    SELECT * FROM agent_work_sessions
    WHERE session_id = ? AND seller_id = ?
  `);

  const updateStatusStmt = db.prepare(`
    UPDATE agent_work_sessions
    SET status = @status,
        ended_at = @endedAt,
        summary_json = COALESCE(@summaryJson, summary_json),
        error_json = COALESCE(@errorJson, error_json)
    WHERE session_id = @sessionId AND seller_id = @sellerId
  `);

  const listRecentSessionsStmt = db.prepare(`
    SELECT * FROM agent_work_sessions
    WHERE seller_id = @sellerId AND agent_id = @agentId
    ORDER BY created_at DESC, session_id DESC
    LIMIT @limit
  `);

  const getLastSessionForSignalsStmt = db.prepare(`
    SELECT * FROM agent_work_sessions
    WHERE seller_id = @sellerId
      AND agent_id = @agentId
      AND signals_hash = @signalsHash
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  `);

  const insertObservationStmt = db.prepare(`
    INSERT INTO agent_observations (
      observation_id, seller_id, agent_id, session_id,
      kind, summary, severity, metadata_json
    ) VALUES (
      @observationId, @sellerId, @agentId, @sessionId,
      @kind, @summary, @severity, @metadataJson
    )
  `);

  const insertProposalLinkStmt = db.prepare(`
    INSERT OR IGNORE INTO agent_session_proposals (session_id, proposal_id, seller_id)
    VALUES (@sessionId, @proposalId, @sellerId)
  `);

  const insertLessonStmt = db.prepare(`
    INSERT INTO agent_session_lessons (
      lesson_id, seller_id, agent_id, session_id,
      lesson, transferable, learned_at
    ) VALUES (
      @lessonId, @sellerId, @agentId, @sessionId,
      @lesson, @transferable, @learnedAt
    )
  `);

  const listRecentLessonsStmt = db.prepare(`
    SELECT * FROM agent_session_lessons
    WHERE seller_id = @sellerId AND agent_id = @agentId
    ORDER BY learned_at DESC, lesson_id DESC
    LIMIT @limit
  `);

  const countObservationsByKindStmt = db.prepare(`
    SELECT kind, COUNT(*) as count FROM agent_observations
    WHERE seller_id = @sellerId AND created_at >= @since
    GROUP BY kind
  `);

  const countProposalsStmt = db.prepare(`
    SELECT COUNT(*) as count FROM agent_session_proposals
    WHERE seller_id = @sellerId AND created_at >= @since
  `);

  const countLessonsStmt = db.prepare(`
    SELECT COUNT(*) as count FROM agent_session_lessons
    WHERE seller_id = @sellerId AND learned_at >= @since
  `);

  const listCompletedSessionsStmt = db.prepare(`
    SELECT session_id, status FROM agent_work_sessions
    WHERE seller_id = @sellerId
      AND (created_at >= @since OR ended_at >= @since)
    ORDER BY created_at DESC
  `);

  // ── API methods ────────────────────────────────────────────────

  const startSession = (session: AgentWorkSession): AgentWorkSession => {
    const now = new Date().toISOString();
    const startedAt = session.startedAt ?? now;
    const lastActiveAt = session.lastActiveAt ?? now;

    insertSessionStmt.run({
      sessionId: session.sessionId,
      sellerId: session.sellerId,
      agentId: session.agentId,
      laneId: session.laneId,
      status: "running",
      signalsHash: session.signalsHash,
      stablePromptHash: session.stablePromptHash || null,
      evidenceHash: session.evidenceHash || null,
      startedAt,
      endedAt: null,
      lastActiveAt,
      cycleCount: session.cycleCount,
      summaryJson: session.summaryJson,
      errorJson: null,
    });

    const row = getSessionStmt.get(session.sessionId, session.sellerId) as SessionRow | undefined;
    const result = row ? rowToSession(row) : undefined;
    if (!result) throw new Error("session read-back failed after insert");
    return result;
  };

  const getSession = (sessionId: string, sellerId: string): AgentWorkSession | undefined => {
    const row = getSessionStmt.get(sessionId, sellerId) as SessionRow | undefined;
    if (!row) return undefined;
    return rowToSession(row);
  };

  const completeSession = (sessionId: string, sellerId: string, summaryJson: string): void => {
    updateStatusStmt.run({
      status: "completed",
      endedAt: new Date().toISOString(),
      summaryJson,
      errorJson: null,
      sessionId,
      sellerId,
    });
  };

  const failSession = (sessionId: string, sellerId: string, errorJson: string): void => {
    updateStatusStmt.run({
      status: "failed",
      endedAt: new Date().toISOString(),
      summaryJson: null,
      errorJson,
      sessionId,
      sellerId,
    });
  };

  const skipSession = (sessionId: string, sellerId: string, reason: string): void => {
    updateStatusStmt.run({
      status: "skipped",
      endedAt: new Date().toISOString(),
      summaryJson: JSON.stringify({ reason }),
      errorJson: null,
      sessionId,
      sellerId,
    });
  };

  const listRecentSessionsByAgent = (
    sellerId: string,
    agentId: string,
    limit = SESSION_LIMITS.defaultListLimit,
  ): AgentWorkSession[] => {
    const clampedLimit = Math.max(1, Math.min(limit, SESSION_LIMITS.maxListLimit));
    const rows = listRecentSessionsStmt.all({
      sellerId,
      agentId,
      limit: clampedLimit,
    }) as SessionRow[];
    return rows.flatMap((row) => {
      const session = rowToSession(row);
      return session ? [session] : [];
    });
  };

  const getLastSessionForSignals = (
    sellerId: string,
    agentId: string,
    signalsHash: string,
  ): AgentWorkSession | undefined => {
    const row = getLastSessionForSignalsStmt.get({
      sellerId,
      agentId,
      signalsHash,
    }) as SessionRow | undefined;
    if (!row) return undefined;
    return rowToSession(row);
  };

  const addObservation = (obs: AgentObservation): void => {
    if (!validObservationKinds.has(obs.kind)) throw new Error("invalid observation kind");
    if (!validSeverities.has(obs.severity)) throw new Error("invalid observation severity");

    insertObservationStmt.run({
      observationId: obs.observationId,
      sellerId: obs.sellerId,
      agentId: obs.agentId,
      sessionId: obs.sessionId,
      kind: obs.kind,
      summary: obs.summary,
      severity: obs.severity,
      metadataJson: obs.metadataJson,
    });
  };

  const addProposalLink = (sessionId: string, proposalId: string, sellerId: string): void => {
    insertProposalLinkStmt.run({ sessionId, proposalId, sellerId });
  };

  const addLesson = (lesson: AgentLesson): void => {
    insertLessonStmt.run({
      lessonId: lesson.lessonId,
      sellerId: lesson.sellerId,
      agentId: lesson.agentId,
      sessionId: lesson.sessionId,
      lesson: lesson.lesson,
      transferable: lesson.transferable ? 1 : 0,
      learnedAt: lesson.learnedAt,
    });
  };

  const listRecentLessons = (
    sellerId: string,
    agentId: string,
    limit = SESSION_LIMITS.defaultListLimit,
  ): AgentLesson[] => {
    const clampedLimit = Math.max(1, Math.min(limit, SESSION_LIMITS.maxListLimit));
    const rows = listRecentLessonsStmt.all({
      sellerId,
      agentId,
      limit: clampedLimit,
    }) as LessonRow[];
    return rows.flatMap((row) => {
      const lesson = rowToLesson(row);
      return lesson ? [lesson] : [];
    });
  };

  const summarizeShift = (sellerId: string, since: string): ShiftSummary => {
    const until = new Date().toISOString();

    // Observation counts per kind
    const kindRows = countObservationsByKindStmt.all({ sellerId, since }) as {
      kind: string;
      count: number;
    }[];
    const observationCounts: Record<ObservationKind, number> = {
      new_signal: 0,
      risk: 0,
      opportunity: 0,
      missing_data: 0,
      repeated_pattern: 0,
      no_change: 0,
    };
    for (const row of kindRows) {
      if (validObservationKinds.has(row.kind as ObservationKind)) {
        observationCounts[row.kind as ObservationKind] = row.count;
      }
    }

    // Proposal count
    const proposalRow = countProposalsStmt.get({ sellerId, since }) as { count: number };
    const proposalCount = proposalRow?.count ?? 0;

    // Lesson count
    const lessonRow = countLessonsStmt.get({ sellerId, since }) as { count: number };
    const lessonCount = lessonRow?.count ?? 0;

    // Session count + completed session IDs
    const sessionRows = listCompletedSessionsStmt.all({ sellerId, since }) as {
      session_id: string;
      status: string;
    }[];
    const sessionCount = sessionRows.length;
    const completedSessionIds = sessionRows
      .filter((r) => r.status === "completed")
      .map((r) => r.session_id);

    return {
      sellerId,
      since,
      until,
      sessionCount,
      observationCounts,
      proposalCount,
      lessonCount,
      completedSessionIds,
    };
  };

  return {
    startSession,
    getSession,
    completeSession,
    failSession,
    skipSession,
    listRecentSessionsByAgent,
    getLastSessionForSignals,
    addObservation,
    addProposalLink,
    addLesson,
    listRecentLessons,
    summarizeShift,
  };
}
