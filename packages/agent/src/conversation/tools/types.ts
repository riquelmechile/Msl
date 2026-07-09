import {
  getCompanyAgent,
  type CompanyAgentRegistry,
  type CompanyDepartmentId,
  type AgentSkill,
} from "../companyAgents.js";
import type {
  AgentLearningRecord,
  AgentLessonScope,
  AgentLessonType,
} from "../companyAgentLearningStore.js";
import type {
  WorkforceCacheStatus,
  WorkforceCostCacheLedgerEntry,
} from "../workforceCostCacheLedgerStore.js";
import { LEDGER_LIMITS as workforceCostCacheLedgerLimits } from "../workforceCostCacheLedgerStore.js";

/**
 * Tool definition shape compatible with OpenAI function-calling schema.
 */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
};

/**
 * Metadata nodes returned by GraphEngine.queryByMetadata.
 */
export type MetadataNode = {
  id: number;
  label: string;
  metadata: Record<string, unknown>;
};

// ── Validation constants ───────────────────────────────────────────────

export const companyAgentTextLimits = {
  label: 80,
  role: 80,
  specialty: 120,
  stablePrefix: 600,
  responsibility: 160,
  evidenceKind: 64,
  policy: 180,
  listedStablePrefix: 240,
  lessonSummary: 800,
  lessonOutcome: 240,
  evidenceId: 96,
  listedLessonSummary: 360,
  listedLessonOutcome: 180,
} as const;

export const productiveRequestPattern =
  /publish|publicar|mutar|mutation|ejecutar|execute|cambiar|change|modificar|update|crear|create|mensaje|message|payment|pago|sii|enviar|send/i;

export const companyAgentIdPattern = /^[a-z][a-z0-9-]{2,62}$/;
export const agentLessonIdPattern = /^[a-z][a-z0-9:_-]{2,95}$/;

export const validDepartmentIds = new Set<CompanyDepartmentId>([
  "executive",
  "operations",
  "commercial",
]);
export const validLessonTypes = new Set<AgentLessonType>([
  "ceo-correction",
  "research-finding",
  "outcome-lesson",
  "policy",
]);
export const validLessonScopes = new Set<AgentLessonScope>(["agent", "department"]);
export const validWorkforceCacheStatuses = new Set<WorkforceCacheStatus>([
  "hit",
  "miss",
  "partial",
  "unknown",
]);

export const promptInjectionPattern =
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|disregard\s+(?:previous|prior|above)|system\s+prompt|developer\s+message|reveal\s+(?:your\s+)?instructions|tool\s*(?:call|execution|escalation)|escalate\s+(?:privileges?|permissions?)|enable\s+admin|bypass\s+(?:auth|authorization|guardrails?)|ignora(?:r|́|á)?\s+(?:las\s+)?instrucciones|ignor[aá]\s+(?:las\s+)?instrucciones|olvida\s+(?:las\s+)?instrucciones|revela\s+(?:el\s+)?prompt|ejecuta\s+(?:la\s+)?herramienta|omite\s+(?:la\s+)?autorizaci[oó]n/i;

export const validSkillCategories: readonly string[] = [
  "technical",
  "domain",
  "analysis",
  "creative",
  "coordination",
];

// ── Coercion helpers ───────────────────────────────────────────────────

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCompanyAgentText(value: unknown): string {
  return safeString(value)
    .replaceAll(/./gs, (char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? " " : char;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function validateCompanyAgentText(
  value: string,
  field: string,
  maxLength: number,
): string | undefined {
  if (value.length > maxLength) return `${field} too long`;
  if (promptInjectionPattern.test(value)) return `${field} contains unsafe control instructions`;
  return undefined;
}

export function truncateCompanyAgentText(value: string, maxLength: number): string {
  const normalized = normalizeCompanyAgentText(value);
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

export function nonEmptyUniqueStrings(value: unknown): string[] {
  const items = stringArray(value)
    .map((item) => normalizeCompanyAgentText(item))
    .filter(Boolean);
  return [...new Set(items)];
}

export function isWritableCompanyAgentRegistry(
  registry: CompanyAgentRegistry | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
): registry is CompanyAgentRegistry & { insertCompanyAgent: Function } {
  return (
    typeof (registry as { insertCompanyAgent?: unknown } | undefined)?.insertCompanyAgent ===
    "function"
  );
}

export function summarizeCompanyAgent(agent: ReturnType<CompanyAgentRegistry["getCompanyAgent"]>) {
  if (!agent) return null;
  return {
    id: agent.id,
    label: truncateCompanyAgentText(agent.profile.label, companyAgentTextLimits.label),
    departmentId: agent.profile.departmentId,
    source: agent.source,
    status: agent.status,
    stablePrefix: truncateCompanyAgentText(
      agent.profile.stablePrefix,
      companyAgentTextLimits.listedStablePrefix,
    ),
    requiredEvidenceKinds: agent.profile.requiredEvidenceKinds
      .slice(0, 16)
      .map((kind) => truncateCompanyAgentText(kind, companyAgentTextLimits.evidenceKind)),
    noMutationBoundary: agent.profile.noMutationBoundary,
  };
}

export function resolveCompanyAgent(registry: CompanyAgentRegistry | undefined, agentId: string) {
  return getCompanyAgent(agentId) ?? registry?.getCompanyAgent(agentId);
}

export function summarizeAgentLesson(lesson: AgentLearningRecord) {
  return {
    lessonId: truncateCompanyAgentText(lesson.lessonId, 96),
    targetAgentId: truncateCompanyAgentText(lesson.targetAgentId, 96),
    departmentId: lesson.departmentId,
    scope: lesson.scope,
    lessonType: lesson.lessonType,
    summary: truncateCompanyAgentText(lesson.summary, companyAgentTextLimits.listedLessonSummary),
    evidenceIds: lesson.evidenceIds
      .slice(0, 12)
      .map((id) => truncateCompanyAgentText(id, companyAgentTextLimits.evidenceId)),
    confidence: lesson.confidence,
    impact: lesson.impact,
    ...(lesson.outcome
      ? {
          outcome: truncateCompanyAgentText(
            lesson.outcome,
            companyAgentTextLimits.listedLessonOutcome,
          ),
        }
      : {}),
    status: lesson.status,
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
  };
}

export function summarizeWorkforceCostCacheLedgerEntry(entry: WorkforceCostCacheLedgerEntry) {
  return {
    entryId: truncateCompanyAgentText(
      entry.entryId,
      workforceCostCacheLedgerLimits.maxEntryIdLength,
    ),
    agentId: truncateCompanyAgentText(
      entry.agentId,
      workforceCostCacheLedgerLimits.maxAgentIdLength,
    ),
    ...(entry.laneId ? { laneId: entry.laneId } : {}),
    provider: truncateCompanyAgentText(
      entry.provider,
      workforceCostCacheLedgerLimits.maxSlugLength,
    ),
    model: truncateCompanyAgentText(entry.model, workforceCostCacheLedgerLimits.maxSlugLength),
    operation: truncateCompanyAgentText(
      entry.operation,
      workforceCostCacheLedgerLimits.maxSlugLength,
    ),
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
    ...(entry.currency ? { currency: entry.currency } : {}),
    cacheStatus: entry.cacheStatus,
    metadata: entry.metadata,
    measuredAt: entry.measuredAt,
    createdAt: entry.createdAt,
  };
}

export function summarizeAgentSkill(skill: AgentSkill) {
  return {
    skillId: truncateCompanyAgentText(skill.skillId, 96),
    agentId: truncateCompanyAgentText(skill.agentId, 96),
    label: truncateCompanyAgentText(skill.label, companyAgentTextLimits.label),
    category: skill.category,
    description: truncateCompanyAgentText(skill.description, 360),
    proficiency: skill.proficiency,
    declaredAt: skill.declaredAt,
    updatedAt: skill.updatedAt,
  };
}
