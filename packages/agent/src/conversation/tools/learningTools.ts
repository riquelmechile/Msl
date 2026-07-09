import type { CompanyAgentRegistry, CompanyDepartmentId } from "../companyAgents.js";
import type {
  CompanyAgentLearningStore,
  AgentLessonScope,
  AgentLessonType,
} from "../companyAgentLearningStore.js";
import type { ToolDefinition } from "./types.js";
import {
  safeString,
  normalizeCompanyAgentText,
  validateCompanyAgentText,
  truncateCompanyAgentText,
  nonEmptyUniqueStrings,
  resolveCompanyAgent,
  summarizeAgentLesson,
  companyAgentTextLimits,
  validDepartmentIds,
  validLessonScopes,
  validLessonTypes,
  agentLessonIdPattern,
} from "./types.js";

// ── Record Agent Lesson ────────────────────────────────────────────────

export type RecordAgentLessonToolOptions = {
  authorized?: boolean;
};

export type ListAgentLessonsToolOptions = {
  authorized?: boolean;
};

export function createRecordAgentLessonTool(
  learningStore: CompanyAgentLearningStore | undefined,
  registry?: CompanyAgentRegistry,
  options: RecordAgentLessonToolOptions = {},
): ToolDefinition {
  return {
    name: "record_agent_lesson",
    description:
      "Records a durable local learning lesson for an AI company agent after CEO/admin authorization. No external systems are mutated.",
    parameters: {
      type: "object",
      properties: {
        lessonId: { type: "string", description: "Safe durable lesson id." },
        targetAgentId: { type: "string", description: "Known company agent id." },
        scope: { type: "string", enum: [...validLessonScopes] },
        lessonType: { type: "string", enum: [...validLessonTypes] },
        summary: { type: "string" },
        evidenceIds: { type: "array", items: { type: "string" } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        impact: { type: "number", minimum: 0, maximum: 1 },
        outcome: {
          type: "string",
          description: "Optional outcome/bridge field for Cortex/Darwinian use.",
        },
      },
      required: ["lessonId", "targetAgentId", "scope", "lessonType", "summary"],
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

      if (!learningStore) {
        return {
          status: "blocked",
          error: "agent learning store unavailable",
          missingInputs: ["companyAgentLearningStore"],
          noExternalMutationExecuted: true,
        };
      }

      const lessonId = safeString(args.lessonId).toLowerCase();
      const targetAgentId = safeString(args.targetAgentId);
      const scope = normalizeCompanyAgentText(args.scope) as AgentLessonScope;
      const lessonType = normalizeCompanyAgentText(args.lessonType) as AgentLessonType;
      const summary = normalizeCompanyAgentText(args.summary);
      const outcome = normalizeCompanyAgentText(args.outcome);
      const evidenceIds = nonEmptyUniqueStrings(args.evidenceIds);
      const confidence = typeof args.confidence === "number" ? args.confidence : 0.5;
      const impact = typeof args.impact === "number" ? args.impact : 0.5;

      const missingInputs: string[] = [];
      if (!lessonId) missingInputs.push("lessonId");
      if (!targetAgentId) missingInputs.push("targetAgentId");
      if (!validLessonScopes.has(scope)) missingInputs.push("scope");
      if (!validLessonTypes.has(lessonType)) missingInputs.push("lessonType");
      if (!summary) missingInputs.push("summary");
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        missingInputs.push("confidence 0..1");
      }
      if (!Number.isFinite(impact) || impact < 0 || impact > 1) missingInputs.push("impact 0..1");

      const targetAgent = resolveCompanyAgent(registry, targetAgentId);
      if (!targetAgent || targetAgent.status !== "active")
        missingInputs.push("known active targetAgentId");

      if (missingInputs.length > 0) {
        return { status: "blocked", missingInputs, noExternalMutationExecuted: true };
      }

      const unsafeInputs = [
        validateCompanyAgentText(summary, "summary", companyAgentTextLimits.lessonSummary),
        validateCompanyAgentText(outcome, "outcome", companyAgentTextLimits.lessonOutcome),
        ...evidenceIds.map((id) =>
          validateCompanyAgentText(id, "evidenceIds", companyAgentTextLimits.evidenceId),
        ),
      ].filter((issue): issue is string => Boolean(issue));
      if (!agentLessonIdPattern.test(lessonId) || lessonId.includes("..")) {
        unsafeInputs.push("safe lessonId");
      }
      if (evidenceIds.length > 16) unsafeInputs.push("evidenceIds too many");

      if (unsafeInputs.length > 0) {
        return {
          status: "blocked",
          error: "unsafe agent lesson metadata",
          missingInputs: [...new Set(unsafeInputs)],
          noExternalMutationExecuted: true,
        };
      }

      try {
        const lesson = learningStore.insertAgentLesson({
          lessonId,
          targetAgentId: targetAgent!.id,
          departmentId: targetAgent!.profile.departmentId,
          scope,
          lessonType,
          summary,
          evidenceIds,
          confidence,
          impact,
          ...(outcome ? { outcome } : {}),
        });

        return {
          status: "recorded",
          lesson: summarizeAgentLesson(lesson),
          noExternalMutationExecuted: true,
        };
      } catch {
        return {
          status: "blocked",
          error: "agent lesson could not be persisted safely",
          missingInputs: ["unique valid lesson"],
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}

export function createListAgentLessonsTool(
  learningStore: CompanyAgentLearningStore | undefined,
  options: ListAgentLessonsToolOptions = {},
): ToolDefinition {
  return {
    name: "list_agent_lessons",
    description:
      "Lists bounded active local lessons for AI company agents after CEO/admin authorization. Read-only; no external mutations.",
    parameters: {
      type: "object",
      properties: {
        targetAgentId: { type: "string" },
        departmentId: { type: "string", enum: [...validLessonScopes] },
        scope: { type: "string", enum: [...validLessonScopes] },
        limit: { type: "number", minimum: 1, maximum: 20 },
      },
      required: [],
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

      if (!learningStore) {
        return {
          lessons: [],
          storeAvailable: false,
          noExternalMutationExecuted: true,
        };
      }

      const departmentId = normalizeCompanyAgentText(args.departmentId);
      const scope = normalizeCompanyAgentText(args.scope) as AgentLessonScope;
      const limit = typeof args.limit === "number" ? args.limit : 10;
      const filter = { limit: Math.max(1, Math.min(limit, 20)) };
      const targetAgentId = safeString(args.targetAgentId);

      const lessons = learningStore.listAgentLessons({
        ...filter,
        ...(targetAgentId ? { targetAgentId } : {}),
        ...(validDepartmentIds.has(departmentId as CompanyDepartmentId)
          ? { departmentId: departmentId as CompanyDepartmentId }
          : {}),
        ...(validLessonScopes.has(scope) ? { scope } : {}),
      });

      return {
        lessons: lessons.map(summarizeAgentLesson),
        storeAvailable: true,
        noExternalMutationExecuted: true,
      };
    },
  };
}
