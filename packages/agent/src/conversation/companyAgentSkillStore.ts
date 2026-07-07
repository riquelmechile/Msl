import Database from "better-sqlite3";

import type { CompanyAgentId } from "./companyAgents.js";

export type InsertAgentSkillInput = {
  skillId: string;
  agentId: CompanyAgentId;
  label: string;
  category: string;
  description: string;
  proficiency: number;
};

export type CompanyAgentSkillStore = {
  insertAgentSkill(input: InsertAgentSkillInput): import("./companyAgents.js").AgentSkill;
  listAgentSkills(agentId: CompanyAgentId): readonly import("./companyAgents.js").AgentSkill[];
  updateAgentSkill(
    skillId: string,
    fields: Partial<Pick<import("./companyAgents.js").AgentSkill, "proficiency" | "description">>,
  ): import("./companyAgents.js").AgentSkill;
  count(): number;
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_skills (
  skill_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  proficiency REAL NOT NULL,
  declared_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(agent_id, label)
);
`;

type AgentSkillRow = {
  skill_id: string;
  agent_id: string;
  label: string;
  category: string;
  description: string;
  proficiency: number;
  declared_at: string;
  updated_at: string;
};

const validCategories = new Set<string>([
  "technical",
  "domain",
  "analysis",
  "creative",
  "coordination",
]);

function rowToAgentSkill(row: AgentSkillRow): import("./companyAgents.js").AgentSkill | undefined {
  if (!row.skill_id || !row.agent_id || !row.label || !row.description) return undefined;
  if (!validCategories.has(row.category)) return undefined;
  if (!Number.isFinite(row.proficiency) || row.proficiency < 0 || row.proficiency > 1)
    return undefined;
  if (!row.declared_at || !row.updated_at) return undefined;

  return Object.freeze({
    skillId: row.skill_id,
    agentId: row.agent_id,
    label: row.label,
    category: row.category,
    description: row.description,
    proficiency: row.proficiency,
    declaredAt: row.declared_at,
    updatedAt: row.updated_at,
  });
}

export function createCompanyAgentSkillStore(db: Database.Database): CompanyAgentSkillStore {
  db.exec(SCHEMA_SQL);

  const insertStmt = db.prepare(`
    INSERT INTO agent_skills (
      skill_id,
      agent_id,
      label,
      category,
      description,
      proficiency
    ) VALUES (
      @skillId,
      @agentId,
      @label,
      @category,
      @description,
      @proficiency
    )
  `);
  const getStmt = db.prepare(`SELECT * FROM agent_skills WHERE skill_id = ?`);
  const listStmt = db.prepare(`
    SELECT * FROM agent_skills
    WHERE agent_id = @agentId
    ORDER BY category ASC, label ASC, skill_id ASC
  `);
  const updateStmt = db.prepare(`
    UPDATE agent_skills
    SET proficiency = COALESCE(@proficiency, proficiency),
        description = COALESCE(@description, description),
        updated_at = datetime('now')
    WHERE skill_id = @skillId
  `);
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM agent_skills`);

  const insertAgentSkill = (
    input: InsertAgentSkillInput,
  ): import("./companyAgents.js").AgentSkill => {
    insertStmt.run({
      skillId: input.skillId,
      agentId: input.agentId,
      label: input.label,
      category: input.category,
      description: input.description,
      proficiency: input.proficiency,
    });

    const row = getStmt.get(input.skillId) as AgentSkillRow | undefined;
    const skill = row ? rowToAgentSkill(row) : undefined;
    if (!skill) throw new Error("agent skill could not be read safely after insert");
    return skill;
  };

  const listAgentSkills = (
    agentId: CompanyAgentId,
  ): readonly import("./companyAgents.js").AgentSkill[] => {
    const rows = listStmt.all({ agentId }) as AgentSkillRow[];
    return rows.flatMap((row) => {
      const skill = rowToAgentSkill(row);
      return skill ? [skill] : [];
    });
  };

  const updateAgentSkill = (
    skillId: string,
    fields: Partial<Pick<import("./companyAgents.js").AgentSkill, "proficiency" | "description">>,
  ): import("./companyAgents.js").AgentSkill => {
    updateStmt.run({
      skillId,
      proficiency: fields.proficiency ?? null,
      description: fields.description ?? null,
    });

    const row = getStmt.get(skillId) as AgentSkillRow | undefined;
    const skill = row ? rowToAgentSkill(row) : undefined;
    if (!skill) throw new Error("agent skill not found after update");
    return skill;
  };

  const count = (): number => {
    const row = countStmt.get() as { count: number };
    return row.count;
  };

  return { insertAgentSkill, listAgentSkills, updateAgentSkill, count };
}
