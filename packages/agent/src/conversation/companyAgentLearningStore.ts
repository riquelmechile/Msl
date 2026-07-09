import Database from "better-sqlite3";

import type { CompanyAgentId, CompanyDepartmentId } from "./companyAgents.js";

export type AgentLessonType = "ceo-correction" | "research-finding" | "outcome-lesson" | "policy";
export type AgentLessonScope = "agent" | "department";
export type AgentLessonStatus = "active" | "archived";

export type AgentLearningRecord = {
  lessonId: string;
  targetAgentId: CompanyAgentId;
  departmentId: CompanyDepartmentId;
  scope: AgentLessonScope;
  lessonType: AgentLessonType;
  summary: string;
  evidenceIds: readonly string[];
  confidence: number;
  impact: number;
  outcome?: string;
  status: AgentLessonStatus;
  /** Optional seller scoping — NULL means global. */
  sellerId?: string;
  createdAt: string;
  updatedAt: string;
};

export type RecordAgentLessonInput = {
  lessonId: string;
  targetAgentId: CompanyAgentId;
  departmentId: CompanyDepartmentId;
  scope: AgentLessonScope;
  lessonType: AgentLessonType;
  summary: string;
  evidenceIds: readonly string[];
  confidence: number;
  impact: number;
  outcome?: string;
  /** Optional seller scoping. */
  sellerId?: string;
};

export type ListAgentLessonsFilter = {
  targetAgentId?: string;
  departmentId?: CompanyDepartmentId;
  scope?: AgentLessonScope;
  /** Optional seller scoping filter. */
  sellerId?: string;
  limit?: number;
};

export type CompanyAgentLearningStore = {
  insertAgentLesson(input: RecordAgentLessonInput): AgentLearningRecord;
  listAgentLessons(filter?: ListAgentLessonsFilter): readonly AgentLearningRecord[];
  getLessonsBySeller(sellerId: string): readonly AgentLearningRecord[];
  count(): number;
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS company_agent_lessons (
  lesson_id TEXT PRIMARY KEY,
  target_agent_id TEXT NOT NULL,
  department_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  lesson_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_ids TEXT NOT NULL,
  confidence REAL NOT NULL,
  impact REAL NOT NULL,
  outcome TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

type AgentLessonRow = {
  lesson_id: string;
  target_agent_id: string;
  department_id: string;
  scope: string;
  lesson_type: string;
  summary: string;
  evidence_ids: string;
  confidence: number;
  impact: number;
  outcome: string | null;
  seller_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const lessonTypes = new Set<AgentLessonType>([
  "ceo-correction",
  "research-finding",
  "outcome-lesson",
  "policy",
]);
const scopes = new Set<AgentLessonScope>(["agent", "department"]);
const statuses = new Set<AgentLessonStatus>(["active", "archived"]);
const departments = new Set<CompanyDepartmentId>(["executive", "operations", "commercial"]);

function parseStringArray(value: string): readonly string[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? Object.freeze(parsed.filter((item): item is string => typeof item === "string"))
      : undefined;
  } catch {
    return undefined;
  }
}

function rowToAgentLesson(row: AgentLessonRow): AgentLearningRecord | undefined {
  const evidenceIds = parseStringArray(row.evidence_ids);
  if (!evidenceIds) return undefined;
  if (!lessonTypes.has(row.lesson_type as AgentLessonType)) return undefined;
  if (!scopes.has(row.scope as AgentLessonScope)) return undefined;
  if (!departments.has(row.department_id as CompanyDepartmentId)) return undefined;
  if (!statuses.has(row.status as AgentLessonStatus)) return undefined;
  if (!Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1)
    return undefined;
  if (!Number.isFinite(row.impact) || row.impact < 0 || row.impact > 1) return undefined;
  if (!row.lesson_id || !row.target_agent_id || !row.summary) return undefined;

  return Object.freeze({
    lessonId: row.lesson_id,
    targetAgentId: row.target_agent_id,
    departmentId: row.department_id as CompanyDepartmentId,
    scope: row.scope as AgentLessonScope,
    lessonType: row.lesson_type as AgentLessonType,
    summary: row.summary,
    evidenceIds,
    confidence: row.confidence,
    impact: row.impact,
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.seller_id ? { sellerId: row.seller_id } : {}),
    status: row.status as AgentLessonStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/**
 * Check whether a column exists in a table (idempotent migration guard).
 */
function columnExists(db: Database.Database, table: string, column: string): boolean {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return info.some((col) => col.name === column);
}

export function createCompanyAgentLearningStore(db: Database.Database): CompanyAgentLearningStore {
  db.exec(SCHEMA_SQL);

  // ── Idempotent migration: add seller_id column ──────────────
  if (!columnExists(db, "company_agent_lessons", "seller_id")) {
    db.exec(`ALTER TABLE company_agent_lessons ADD COLUMN seller_id TEXT`);
  }

  const insertStmt = db.prepare(`
    INSERT INTO company_agent_lessons (
      lesson_id,
      target_agent_id,
      department_id,
      scope,
      lesson_type,
      summary,
      evidence_ids,
      confidence,
      impact,
      outcome,
      seller_id,
      status
    ) VALUES (
      @lessonId,
      @targetAgentId,
      @departmentId,
      @scope,
      @lessonType,
      @summary,
      @evidenceIds,
      @confidence,
      @impact,
      @outcome,
      @sellerId,
      'active'
    )
  `);
  const getStmt = db.prepare(`SELECT * FROM company_agent_lessons WHERE lesson_id = ?`);
  const listStmt = db.prepare(`
    SELECT * FROM company_agent_lessons
    WHERE status = 'active'
      AND (@targetAgentId IS NULL OR target_agent_id = @targetAgentId)
      AND (@departmentId IS NULL OR department_id = @departmentId)
      AND (@scope IS NULL OR scope = @scope)
      AND (@sellerId IS NULL OR seller_id = @sellerId OR seller_id IS NULL)
    ORDER BY updated_at DESC, created_at DESC, lesson_id ASC
    LIMIT @limit
  `);
  const listBySellerStmt = db.prepare(`
    SELECT * FROM company_agent_lessons
    WHERE seller_id = @sellerId
    ORDER BY updated_at DESC, created_at DESC, lesson_id ASC
    LIMIT @limit
  `);
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM company_agent_lessons`);

  const insertAgentLesson = (input: RecordAgentLessonInput): AgentLearningRecord => {
    insertStmt.run({
      lessonId: input.lessonId,
      targetAgentId: input.targetAgentId,
      departmentId: input.departmentId,
      scope: input.scope,
      lessonType: input.lessonType,
      summary: input.summary,
      evidenceIds: JSON.stringify(input.evidenceIds),
      confidence: input.confidence,
      impact: input.impact,
      outcome: input.outcome ?? null,
      sellerId: input.sellerId ?? null,
    });

    const row = getStmt.get(input.lessonId) as AgentLessonRow | undefined;
    const lesson = row ? rowToAgentLesson(row) : undefined;
    if (!lesson) throw new Error("agent lesson could not be read safely after insert");
    return lesson;
  };

  const listAgentLessons = (
    filter: ListAgentLessonsFilter = {},
  ): readonly AgentLearningRecord[] => {
    const rows = listStmt.all({
      targetAgentId: filter.targetAgentId ?? null,
      departmentId: filter.departmentId ?? null,
      scope: filter.scope ?? null,
      sellerId: filter.sellerId ?? null,
      limit: Math.max(1, Math.min(filter.limit ?? 20, 50)),
    }) as AgentLessonRow[];
    return rows.flatMap((row) => {
      const lesson = rowToAgentLesson(row);
      return lesson ? [lesson] : [];
    });
  };

  /**
   * Return all lessons scoped to a specific seller account.
   */
  const getLessonsBySeller = (
    sellerId: string,
    limit = 50,
  ): readonly AgentLearningRecord[] => {
    const rows = listBySellerStmt.all({
      sellerId,
      limit: Math.max(1, Math.min(limit, 50)),
    }) as AgentLessonRow[];
    return rows.flatMap((row) => {
      const lesson = rowToAgentLesson(row);
      return lesson ? [lesson] : [];
    });
  };

  const count = (): number => {
    const row = countStmt.get() as { count: number };
    return row.count;
  };

  return { insertAgentLesson, listAgentLessons, getLessonsBySeller, count };
}
