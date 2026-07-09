import type { CompanyAgentSkillStore } from "../companyAgentSkillStore.js";
import type { AgentSkill } from "../companyAgents.js";
import { resolveCompanyAgent } from "./types.js";
import type { ToolDefinition } from "./types.js";
import {
  safeString,
  normalizeCompanyAgentText,
  validateCompanyAgentText,
  truncateCompanyAgentText,  // eslint-disable-line @typescript-eslint/no-unused-vars
  summarizeAgentSkill,
  companyAgentTextLimits,
  validSkillCategories,
} from "./types.js";

// ── Options ────────────────────────────────────────────────────────────

export type SkillToolOptions = {
  authorized?: boolean;
};

// ── Declare Agent Skill ────────────────────────────────────────────────

export function createDeclareAgentSkillTool(
  skillStore: CompanyAgentSkillStore | undefined,
  options: SkillToolOptions = {},
): ToolDefinition {
  return {
    name: "declare_agent_skill",
    description:
      "Declares a new skill for an AI company agent. Self-declared metadata per agent — no CEO-defined catalog. Persists durably; no external systems are mutated.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Known company agent id." },
        label: { type: "string" },
        category: {
          type: "string",
          enum: [...validSkillCategories],
        },
        description: { type: "string" },
        proficiency: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["agentId", "label", "category", "description"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      if (!options.authorized) {
        return {
          status: "blocked",
          error: "unauthorized",
          missingInputs: ["authorized CEO/admin runtime"],
          noExternalMutationExecuted: true,
        };
      }

      if (!skillStore) {
        return {
          status: "blocked",
          error: "agent skill store unavailable",
          missingInputs: ["companyAgentSkillStore"],
          noExternalMutationExecuted: true,
        };
      }

      const agentId = safeString(args.agentId);
      const label = normalizeCompanyAgentText(args.label);
      const category = safeString(args.category).toLowerCase();
      const description = normalizeCompanyAgentText(args.description);
      const proficiency = typeof args.proficiency === "number" ? args.proficiency : 0.5;

      const missingInputs: string[] = [];
      if (!agentId) missingInputs.push("agentId");
      if (!label) missingInputs.push("label");
      if (!validSkillCategories.includes(category)) missingInputs.push("category");
      if (!description) missingInputs.push("description");

      if (!resolveCompanyAgent(undefined, agentId)) {
        missingInputs.push("known agentId");
      }

      if (missingInputs.length > 0) {
        return { status: "blocked", missingInputs, noExternalMutationExecuted: true };
      }

      const unsafeInputs = [
        validateCompanyAgentText(label, "label", companyAgentTextLimits.label),
        validateCompanyAgentText(description, "description", 360),
      ].filter((issue): issue is string => Boolean(issue));

      if (unsafeInputs.length > 0) {
        return {
          status: "blocked",
          error: "unsafe skill metadata",
          missingInputs: [...new Set(unsafeInputs)],
          noExternalMutationExecuted: true,
        };
      }

      const skillId = `skill:${agentId}:${label.replace(/\s+/g, "-").toLowerCase()}:${Date.now()}`;

      try {
        const skill = skillStore.insertAgentSkill({
          skillId,
          agentId,
          label,
          category,
          description,
          proficiency,
        });

        return {
          status: "declared",
          skill: summarizeAgentSkill(skill),
          noExternalMutationExecuted: true,
        };
      } catch {
        return {
          status: "blocked",
          error: "agent skill could not be persisted safely",
          missingInputs: ["unique valid skill"],
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}

// ── List Agent Skills ──────────────────────────────────────────────────

export function createListAgentSkillsTool(
  skillStore: CompanyAgentSkillStore | undefined,
  options: SkillToolOptions = {},
): ToolDefinition {
  return {
    name: "list_agent_skills",
    description:
      "Lists declared skills for a company agent. Read-only; no external systems are mutated.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Known company agent id." },
      },
      required: ["agentId"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      if (!options.authorized) {
        return {
          status: "blocked",
          error: "unauthorized",
          missingInputs: ["authorized CEO/admin runtime"],
          noExternalMutationExecuted: true,
        };
      }

      if (!skillStore) {
        return {
          skills: [],
          storeAvailable: false,
          noExternalMutationExecuted: true,
        };
      }

      const agentId = safeString(args.agentId);
      if (!agentId) {
        return {
          status: "blocked",
          missingInputs: ["agentId"],
          noExternalMutationExecuted: true,
        };
      }

      const skills = skillStore.listAgentSkills(agentId);

      return {
        skills: skills.map(summarizeAgentSkill),
        storeAvailable: true,
        noExternalMutationExecuted: true,
      };
    },
  };
}

// ── Update Agent Skill ─────────────────────────────────────────────────

export function createUpdateAgentSkillTool(
  skillStore: CompanyAgentSkillStore | undefined,
  options: SkillToolOptions = {},
): ToolDefinition {
  return {
    name: "update_agent_skill",
    description:
      "Updates an existing agent skill's proficiency or description. Persists durably; no external systems are mutated.",
    parameters: {
      type: "object",
      properties: {
        skillId: { type: "string", description: "Durable skill id." },
        proficiency: { type: "number", minimum: 0, maximum: 1 },
        description: { type: "string" },
      },
      required: ["skillId"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      if (!options.authorized) {
        return {
          status: "blocked",
          error: "unauthorized",
          missingInputs: ["authorized CEO/admin runtime"],
          noExternalMutationExecuted: true,
        };
      }

      if (!skillStore) {
        return {
          status: "blocked",
          error: "agent skill store unavailable",
          missingInputs: ["companyAgentSkillStore"],
          noExternalMutationExecuted: true,
        };
      }

      const skillId = safeString(args.skillId);
      if (!skillId) {
        return {
          status: "blocked",
          missingInputs: ["skillId"],
          noExternalMutationExecuted: true,
        };
      }

      const fields: Partial<Pick<AgentSkill, "proficiency" | "description">> = {};
      if (typeof args.proficiency === "number") {
        if (!Number.isFinite(args.proficiency) || args.proficiency < 0 || args.proficiency > 1) {
          return {
            status: "blocked",
            missingInputs: ["proficiency 0..1"],
            noExternalMutationExecuted: true,
          };
        }
        fields.proficiency = args.proficiency;
      }
      if (typeof args.description === "string") {
        const description = normalizeCompanyAgentText(args.description);
        if (description) fields.description = description;
      }

      try {
        const skill = skillStore.updateAgentSkill(skillId, fields);
        return {
          status: "updated",
          skill: summarizeAgentSkill(skill),
          noExternalMutationExecuted: true,
        };
      } catch {
        return {
          status: "blocked",
          error: "agent skill could not be updated safely",
          missingInputs: ["valid skillId"],
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}
