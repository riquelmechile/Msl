import Database from "better-sqlite3";

import type {
  CompanyAgent,
  CompanyAgentId,
  CompanyAgentProfile,
  CompanyAgentRegistry,
  CompanyDepartmentId,
  EvidenceKind,
} from "./companyAgents.js";
import type { LaneId } from "./lanes.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS company_agents (
  id TEXT PRIMARY KEY,
  lane_id TEXT,
  label TEXT NOT NULL,
  department_id TEXT NOT NULL,
  stable_prefix TEXT NOT NULL,
  refreshable_context_provider TEXT NOT NULL,
  inputs TEXT NOT NULL,
  outputs TEXT NOT NULL,
  required_evidence_kinds TEXT NOT NULL,
  boundaries TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ceo-created',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

type CompanyAgentRow = {
  id: string;
  lane_id: string | null;
  label: string;
  department_id: CompanyDepartmentId;
  stable_prefix: string;
  refreshable_context_provider: string;
  inputs: string;
  outputs: string;
  required_evidence_kinds: string;
  boundaries: string;
  source: "ceo-created";
  status: "active" | "suspended" | "archived";
};

export type CreateCompanyAgentInput = {
  id: CompanyAgentId;
  laneId?: LaneId;
  label: string;
  departmentId: CompanyDepartmentId;
  stablePrefix: string;
  refreshableContextProvider: string;
  inputs: readonly string[];
  outputs: readonly string[];
  requiredEvidenceKinds: readonly EvidenceKind[];
  boundaries: readonly string[];
};

export type CompanyAgentStore = CompanyAgentRegistry & {
  insertCompanyAgent(input: CreateCompanyAgentInput): CompanyAgent;
  archiveCompanyAgent(agentId: string): void;
  updateCompanyAgent(
    agentId: string,
    fields: Partial<{
      label: string;
      departmentId: CompanyDepartmentId;
      stablePrefix: string;
      status: CompanyAgent["status"];
    }>,
  ): CompanyAgent;
  count(): number;
};

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

const VALID_COMPANY_AGENT_STATUSES = new Set<CompanyAgentRow["status"]>([
  "active",
  "suspended",
  "archived",
]);

function rowToCompanyAgent(row: CompanyAgentRow): CompanyAgent | undefined {
  const inputs = parseStringArray(row.inputs);
  const outputs = parseStringArray(row.outputs);
  const requiredEvidenceKinds = parseStringArray(row.required_evidence_kinds);
  const boundaries = parseStringArray(row.boundaries);

  if (!inputs || !outputs || !requiredEvidenceKinds || !boundaries) {
    return undefined;
  }

  const profile: CompanyAgentProfile = {
    agentId: row.id,
    ...(row.lane_id ? { laneId: row.lane_id as LaneId } : {}),
    label: row.label,
    departmentId: row.department_id,
    stablePrefix: row.stable_prefix,
    refreshableContextProvider: row.refreshable_context_provider,
    inputs,
    outputs,
    requiredEvidenceKinds,
    boundaries,
    noMutationBoundary: true,
  };

  return Object.freeze({
    id: row.id,
    profile: Object.freeze(profile),
    source: row.source,
    status: row.status,
    durableReady: true,
  });
}

export function createCompanyAgentStore(db: Database.Database): CompanyAgentStore {
  db.exec(SCHEMA_SQL);

  const insertStmt = db.prepare(`
    INSERT INTO company_agents (
      id,
      lane_id,
      label,
      department_id,
      stable_prefix,
      refreshable_context_provider,
      inputs,
      outputs,
      required_evidence_kinds,
      boundaries,
      source,
      status
    ) VALUES (
      @id,
      @laneId,
      @label,
      @departmentId,
      @stablePrefix,
      @refreshableContextProvider,
      @inputs,
      @outputs,
      @requiredEvidenceKinds,
      @boundaries,
      'ceo-created',
      'active'
    )
  `);

  const getStmt = db.prepare(`SELECT * FROM company_agents WHERE id = ?`);
  const listActiveStmt = db.prepare(`
    SELECT * FROM company_agents
    WHERE status = 'active'
    ORDER BY created_at ASC, id ASC
  `);
  const archiveStmt = db.prepare(`
    UPDATE company_agents
    SET status = 'archived', updated_at = datetime('now')
    WHERE id = ?
  `);
  const updateStmt = db.prepare(`
    UPDATE company_agents
    SET label = COALESCE(@label, label),
        department_id = COALESCE(@departmentId, department_id),
        stable_prefix = COALESCE(@stablePrefix, stable_prefix),
        status = COALESCE(@status, status),
        updated_at = datetime('now')
    WHERE id = @agentId
  `);
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM company_agents`);

  const getCompanyAgent = (agentId: string): CompanyAgent | undefined => {
    const row = getStmt.get(agentId) as CompanyAgentRow | undefined;
    return row ? rowToCompanyAgent(row) : undefined;
  };

  const insertCompanyAgent = (input: CreateCompanyAgentInput): CompanyAgent => {
    insertStmt.run({
      id: input.id,
      laneId: input.laneId ?? null,
      label: input.label,
      departmentId: input.departmentId,
      stablePrefix: input.stablePrefix,
      refreshableContextProvider: input.refreshableContextProvider,
      inputs: JSON.stringify(input.inputs),
      outputs: JSON.stringify(input.outputs),
      requiredEvidenceKinds: JSON.stringify(input.requiredEvidenceKinds),
      boundaries: JSON.stringify(input.boundaries),
    });
    return getCompanyAgent(String(input.id))!;
  };

  const listCompanyAgents = (): readonly CompanyAgent[] => {
    const rows = listActiveStmt.all() as CompanyAgentRow[];
    return rows.flatMap((row) => {
      const agent = rowToCompanyAgent(row);
      return agent ? [agent] : [];
    });
  };

  const archiveCompanyAgent = (agentId: string): void => {
    archiveStmt.run(agentId);
  };

  const updateCompanyAgent = (
    agentId: string,
    fields: Partial<{
      label: string;
      departmentId: CompanyDepartmentId;
      stablePrefix: string;
      status: CompanyAgent["status"];
    }>,
  ): CompanyAgent => {
    if (fields.status && !VALID_COMPANY_AGENT_STATUSES.has(fields.status)) {
      throw new Error(
        `Invalid status: "${fields.status}". Valid: ${[...VALID_COMPANY_AGENT_STATUSES].join(", ")}.`,
      );
    }

    updateStmt.run({
      agentId,
      label: fields.label ?? null,
      departmentId: fields.departmentId ?? null,
      stablePrefix: fields.stablePrefix ?? null,
      status: fields.status ?? null,
    });

    const updated = getCompanyAgent(agentId);
    if (!updated) {
      throw new Error(`Company agent "${agentId}" not found.`);
    }
    return updated;
  };

  const count = (): number => {
    const row = countStmt.get() as { count: number };
    return row.count;
  };

  return {
    insertCompanyAgent,
    getCompanyAgent,
    listCompanyAgents,
    archiveCompanyAgent,
    updateCompanyAgent,
    count,
  };
}
