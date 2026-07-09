import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpServerConfig } from "../index.js";
import type { CompanyAgentStore } from "@msl/agent";

import { jsonResult, unauthorizedResult } from "./utils.js";

export function registerWorkforceTools(
  server: McpServer,
  deps: {
    validateApiKey: (key?: string) => boolean;
    config: McpServerConfig;
  },
): void {
  const { validateApiKey, config } = deps;
  const wa = config.workforceAdmin;

  if (!wa) return;

  // ── Input schemas ────────────────────────────────────────────────
  const mcpListCompanyAgentsInputSchema = {
    msl_api_key: z.string().optional(),
  };

  const mcpDeclareSkillInputSchema = {
    agentId: z.string(),
    label: z.string(),
    category: z.enum(["technical", "domain", "analysis", "creative", "coordination"]),
    description: z.string(),
    proficiency: z.number().min(0).max(1).optional(),
    msl_api_key: z.string().optional(),
  };

  const mcpListAgentSkillsInputSchema = {
    agentId: z.string(),
    msl_api_key: z.string().optional(),
  };

  const mcpUpdateCompanyAgentInputSchema = {
    agentId: z.string(),
    label: z.string().optional(),
    departmentId: z.enum(["executive", "operations", "commercial"]).optional(),
    stablePrefix: z.string().optional(),
    status: z.enum(["active", "suspended", "archived"]).optional(),
    msl_api_key: z.string().optional(),
  };

  const mcpListWorkforceLedgerInputSchema = {
    agentId: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().int().positive().max(50).optional(),
    msl_api_key: z.string().optional(),
  };

  const mcpListAgentLessonsInputSchema = {
    agentId: z.string().optional(),
    limit: z.number().int().positive().max(50).optional(),
    msl_api_key: z.string().optional(),
  };

  // ── list_company_agents_mcp (read-only, API key) ──────────────
  if (wa.companyAgentRegistry) {
    server.registerTool(
      "list_company_agents_mcp",
      {
        description:
          "Lists active registered company agents with status, department, and profile metadata. Read-only.",
        inputSchema: mcpListCompanyAgentsInputSchema,
      },
      ({ msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        try {
          const agents = wa.companyAgentRegistry!.listCompanyAgents().map((agent) => ({
            id: agent.id,
            label: agent.profile.label,
            departmentId: agent.profile.departmentId,
            source: agent.source,
            status: agent.status,
            requiredEvidenceKinds: agent.profile.requiredEvidenceKinds.slice(0, 16),
          }));
          return jsonResult({ agents, count: agents.length, noMutationExecuted: true });
        } catch (error) {
          return jsonResult(
            { error: error instanceof Error ? error.message : "Failed to list agents" },
            true,
          );
        }
      },
    );

    // ── update_company_agent_mcp (mutation, API key + admin) ─────
    if (wa.companyAgentAdminAuthorized) {
      const agentStore = wa.companyAgentRegistry as CompanyAgentStore;
      if (typeof agentStore.updateCompanyAgent === "function") {
        server.registerTool(
          "update_company_agent_mcp",
          {
            description:
              "Updates a company agent's profile fields or lifecycle status. Requires admin authorization.",
            inputSchema: mcpUpdateCompanyAgentInputSchema,
          },
          ({ agentId, label, departmentId, stablePrefix, status, msl_api_key }) => {
            if (!validateApiKey(msl_api_key)) {
              return unauthorizedResult();
            }
            try {
              const fields: Record<string, string> = {};
              if (label !== undefined) fields.label = label;
              if (departmentId !== undefined) fields.departmentId = departmentId;
              if (stablePrefix !== undefined) fields.stablePrefix = stablePrefix;
              if (status !== undefined) fields.status = status;

              const updated = agentStore.updateCompanyAgent(agentId, fields);
              return jsonResult({
                status: "updated",
                agent: {
                  id: updated.id,
                  label: updated.profile.label,
                  departmentId: updated.profile.departmentId,
                  source: updated.source,
                  status: updated.status,
                },
                noExternalMutationExecuted: true,
              });
            } catch (error) {
              return jsonResult(
                {
                  status: "blocked",
                  error: error instanceof Error ? error.message : "Update failed",
                },
                true,
              );
            }
          },
        );
      }
    }
  }

  // ── Skill tools ──────────────────────────────────────────────────
  if (wa.companyAgentSkillStore) {
    // ── declare_skill_mcp (mutation, API key + admin) ────────────
    if (wa.companyAgentAdminAuthorized) {
      server.registerTool(
        "declare_skill_mcp",
        {
          description:
            "Declares a new skill for an AI company agent. Self-declared metadata per agent. Requires admin authorization.",
          inputSchema: mcpDeclareSkillInputSchema,
        },
        ({ agentId, label, category, description, proficiency, msl_api_key }) => {
          if (!validateApiKey(msl_api_key)) {
            return unauthorizedResult();
          }
          try {
            const skillId = `skill:${agentId}:${label.replace(/\s+/g, "-").toLowerCase()}:${Date.now()}`;
            const skill = wa.companyAgentSkillStore!.insertAgentSkill({
              skillId,
              agentId,
              label,
              category,
              description,
              proficiency: proficiency ?? 0.5,
            });
            return jsonResult({
              status: "declared",
              skill: {
                skillId: skill.skillId,
                agentId: skill.agentId,
                label: skill.label,
                category: skill.category,
                proficiency: skill.proficiency,
              },
              noExternalMutationExecuted: true,
            });
          } catch (error) {
            return jsonResult(
              {
                status: "blocked",
                error: error instanceof Error ? error.message : "Skill declaration failed",
              },
              true,
            );
          }
        },
      );
    }

    // ── list_agent_skills_mcp (read-only, API key) ──────────────
    server.registerTool(
      "list_agent_skills_mcp",
      {
        description: "Lists declared skills for a specific company agent. Read-only.",
        inputSchema: mcpListAgentSkillsInputSchema,
      },
      ({ agentId, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        try {
          const skills = wa.companyAgentSkillStore!.listAgentSkills(agentId).map((skill) => ({
            skillId: skill.skillId,
            agentId: skill.agentId,
            label: skill.label,
            category: skill.category,
            proficiency: skill.proficiency,
            declaredAt: skill.declaredAt,
            updatedAt: skill.updatedAt,
          }));
          return jsonResult({ skills, count: skills.length, noMutationExecuted: true });
        } catch (error) {
          return jsonResult(
            { error: error instanceof Error ? error.message : "Failed to list skills" },
            true,
          );
        }
      },
    );
  }

  // ── Ledger tools ─────────────────────────────────────────────────
  if (wa.workforceCostCacheLedgerStore) {
    // ── list_workforce_ledger_mcp (read-only, API key) ──────────
    server.registerTool(
      "list_workforce_ledger_mcp",
      {
        description:
          "Lists bounded local AI workforce cost/cache ledger entries with optional date and agent filtering. Read-only.",
        inputSchema: mcpListWorkforceLedgerInputSchema,
      },
      ({ agentId, from, to, limit, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        try {
          const entries = wa
            .workforceCostCacheLedgerStore!.listEntries({
              ...(agentId ? { agentId } : {}),
              ...(from ? { from } : {}),
              ...(to ? { to } : {}),
              limit: limit ?? 20,
            })
            .map((entry) => ({
              entryId: entry.entryId,
              agentId: entry.agentId,
              ...(entry.laneId ? { laneId: entry.laneId } : {}),
              provider: entry.provider,
              model: entry.model,
              operation: entry.operation,
              ...(entry.promptCacheHitTokens !== undefined
                ? { promptCacheHitTokens: entry.promptCacheHitTokens }
                : {}),
              ...(entry.promptCacheMissTokens !== undefined
                ? { promptCacheMissTokens: entry.promptCacheMissTokens }
                : {}),
              ...(entry.inputTokens !== undefined ? { inputTokens: entry.inputTokens } : {}),
              ...(entry.outputTokens !== undefined ? { outputTokens: entry.outputTokens } : {}),
              ...(entry.estimatedCostMicros !== undefined
                ? { estimatedCostMicros: entry.estimatedCostMicros }
                : {}),
              cacheStatus: entry.cacheStatus,
              measuredAt: entry.measuredAt,
              createdAt: entry.createdAt,
            }));
          return jsonResult({ entries, count: entries.length, noMutationExecuted: true });
        } catch (error) {
          return jsonResult(
            { error: error instanceof Error ? error.message : "Failed to list ledger entries" },
            true,
          );
        }
      },
    );
  }

  // ── Lesson tools ─────────────────────────────────────────────────
  if (wa.companyAgentLearningStore) {
    // ── list_agent_lessons_mcp (read-only, API key) ──────────────
    server.registerTool(
      "list_agent_lessons_mcp",
      {
        description: "Lists bounded active local lessons for AI company agents. Read-only.",
        inputSchema: mcpListAgentLessonsInputSchema,
      },
      ({ agentId, limit, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        try {
          const lessons = wa
            .companyAgentLearningStore!.listAgentLessons({
              ...(agentId ? { targetAgentId: agentId } : {}),
              limit: limit ?? 20,
            })
            .map((lesson) => ({
              lessonId: lesson.lessonId,
              targetAgentId: lesson.targetAgentId,
              departmentId: lesson.departmentId,
              scope: lesson.scope,
              lessonType: lesson.lessonType,
              summary: lesson.summary,
              evidenceIds: lesson.evidenceIds.slice(0, 12),
              confidence: lesson.confidence,
              impact: lesson.impact,
              ...(lesson.outcome ? { outcome: lesson.outcome } : {}),
              status: lesson.status,
              createdAt: lesson.createdAt,
              updatedAt: lesson.updatedAt,
            }));
          return jsonResult({ lessons, count: lessons.length, noMutationExecuted: true });
        } catch (error) {
          return jsonResult(
            { error: error instanceof Error ? error.message : "Failed to list lessons" },
            true,
          );
        }
      },
    );
  }
}
