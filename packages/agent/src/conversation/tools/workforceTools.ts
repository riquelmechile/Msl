import type {
  CompanyAgentRegistry,
  CompanyDepartmentId,
  CompanyAgent,
  EvidenceKind,
} from "../companyAgents.js";
import type { CompanyAgentStore } from "../companyAgentStore.js";
import { getCompanyAgent, listCompanyAgents } from "../companyAgents.js";
import type { ToolDefinition } from "./types.js";
import {
  safeString,
  normalizeCompanyAgentText,
  validateCompanyAgentText,
  nonEmptyUniqueStrings,
  isWritableCompanyAgentRegistry,
  summarizeCompanyAgent,
  resolveCompanyAgent,
  stringArray,
  companyAgentTextLimits,
  validDepartmentIds,
  companyAgentIdPattern,
  productiveRequestPattern,
} from "./types.js";
import type { AgentEvidenceResponse } from "../companyAgents.js";

// ── List Company Agents ────────────────────────────────────────────────

export function createListCompanyAgentsTool(registry?: CompanyAgentRegistry): ToolDefinition {
  return {
    name: "list_company_agents",
    description:
      "Lista agentes activos de la compañía, incluyendo lanes estáticas y agentes CEO durables cuando existe registry. No expone secretos.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: (): Record<string, unknown> => {
      const agents = new Map<string, ReturnType<CompanyAgentRegistry["getCompanyAgent"]>>();
      for (const agent of listCompanyAgents()) agents.set(agent.id, agent);
      for (const agent of registry?.listCompanyAgents() ?? []) {
        if (agent.status === "active") agents.set(agent.id, agent);
      }

      return {
        agents: [...agents.values()].map(summarizeCompanyAgent),
        registryAvailable: Boolean(registry),
        noExternalMutationExecuted: true,
      };
    },
  };
}

// ── Create Company Agent ───────────────────────────────────────────────

export type CreateCompanyAgentToolOptions = {
  authorized?: boolean;
};

export function createCreateCompanyAgentTool(
  registry?: CompanyAgentRegistry,
  options: CreateCompanyAgentToolOptions = {},
): ToolDefinition {
  return {
    name: "create_company_agent",
    description:
      "Registra un agente durable creado por el CEO para operar en modo proposal/evidence-only. Persiste solo en el registry local; no muta sistemas externos.",
    parameters: {
      type: "object",
      description:
        "Provide either stablePrefix or mission. The tool blocks requests missing both fields.",
      properties: {
        agentId: { type: "string", description: "Slug seguro: minúsculas, números y guiones." },
        label: { type: "string" },
        departmentId: { type: "string", enum: [...validDepartmentIds] },
        role: { type: "string" },
        specialty: { type: "string" },
        responsibilities: { type: "array", items: { type: "string" } },
        stablePrefix: { type: "string", description: "Required when mission is omitted." },
        mission: { type: "string", description: "Required when stablePrefix is omitted." },
        allowedEvidenceKinds: { type: "array", items: { type: "string" } },
        budgetPolicy: { type: "string" },
        autonomyPolicy: { type: "string" },
      },
      required: ["agentId", "label", "departmentId", "responsibilities", "allowedEvidenceKinds"],
      anyOf: [{ required: ["stablePrefix"] }, { required: ["mission"] }],
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

      if (!isWritableCompanyAgentRegistry(registry)) {
        return {
          status: "blocked",
          error: "company-agent registry unavailable",
          missingInputs: ["writable companyAgentRegistry"],
          noExternalMutationExecuted: true,
        };
      }

      const agentId = safeString(args.agentId).toLowerCase();
      const label = normalizeCompanyAgentText(args.label);
      const departmentId = normalizeCompanyAgentText(args.departmentId) as CompanyDepartmentId;
      const role = normalizeCompanyAgentText(args.role);
      const specialty = normalizeCompanyAgentText(args.specialty);
      const responsibilities = nonEmptyUniqueStrings(args.responsibilities);
      const stablePrefix =
        normalizeCompanyAgentText(args.stablePrefix) || normalizeCompanyAgentText(args.mission);
      const evidenceKinds: EvidenceKind[] = nonEmptyUniqueStrings(args.allowedEvidenceKinds);
      const budgetPolicy = normalizeCompanyAgentText(args.budgetPolicy);
      const autonomyPolicy = normalizeCompanyAgentText(args.autonomyPolicy);

      const missingInputs: string[] = [];
      if (!agentId) missingInputs.push("agentId");
      if (!label) missingInputs.push("label");
      if (!validDepartmentIds.has(departmentId)) missingInputs.push("departmentId");
      if (!stablePrefix) missingInputs.push("stablePrefix or mission");
      if (responsibilities.length === 0) missingInputs.push("responsibilities");
      if (evidenceKinds.length === 0) missingInputs.push("allowedEvidenceKinds");

      if (missingInputs.length > 0) {
        return { status: "blocked", missingInputs, noExternalMutationExecuted: true };
      }

      const unsafeInputs = [
        validateCompanyAgentText(label, "label", companyAgentTextLimits.label),
        validateCompanyAgentText(role, "role", companyAgentTextLimits.role),
        validateCompanyAgentText(specialty, "specialty", companyAgentTextLimits.specialty),
        validateCompanyAgentText(
          stablePrefix,
          "stablePrefix or mission",
          companyAgentTextLimits.stablePrefix,
        ),
        validateCompanyAgentText(budgetPolicy, "budgetPolicy", companyAgentTextLimits.policy),
        validateCompanyAgentText(autonomyPolicy, "autonomyPolicy", companyAgentTextLimits.policy),
        ...responsibilities.map((item) =>
          validateCompanyAgentText(item, "responsibilities", companyAgentTextLimits.responsibility),
        ),
        ...evidenceKinds.map((item) =>
          validateCompanyAgentText(
            item,
            "allowedEvidenceKinds",
            companyAgentTextLimits.evidenceKind,
          ),
        ),
      ].filter((issue): issue is string => Boolean(issue));

      if (responsibilities.length > 12) unsafeInputs.push("responsibilities too many");
      if (evidenceKinds.length > 16) unsafeInputs.push("allowedEvidenceKinds too many");

      if (unsafeInputs.length > 0) {
        return {
          status: "blocked",
          error: "unsafe company agent metadata",
          missingInputs: [...new Set(unsafeInputs)],
          noExternalMutationExecuted: true,
        };
      }

      if (!companyAgentIdPattern.test(agentId) || agentId.includes("..")) {
        return {
          status: "blocked",
          error: "invalid agentId",
          missingInputs: ["safe slug agentId"],
          noExternalMutationExecuted: true,
        };
      }

      if (getCompanyAgent(agentId) || registry.getCompanyAgent(agentId)) {
        return {
          status: "blocked",
          error: "duplicate agentId",
          missingInputs: ["unique agentId"],
          noExternalMutationExecuted: true,
        };
      }

      const outputs = ["proposal", "evidence-summary"];
      const boundaries = [
        "CEO-created company agent is proposal/evidence-only for now.",
        "No external business mutation, ecommerce update, customer message, payment, or SII action is permitted.",
        ...(budgetPolicy ? [`Budget policy: ${budgetPolicy}`] : []),
        ...(autonomyPolicy ? [`Autonomy policy: ${autonomyPolicy}`] : []),
      ];

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const agent = registry.insertCompanyAgent({
          id: agentId,
          label,
          departmentId,
          stablePrefix,
          refreshableContextProvider: "ceo-created-local-registry",
          inputs: [role, specialty, ...responsibilities].filter(Boolean),
          outputs,
          requiredEvidenceKinds: evidenceKinds,
          boundaries,
        });

        return {
          status: "created",
          agent: summarizeCompanyAgent(agent), // eslint-disable-line @typescript-eslint/no-unsafe-argument
          noExternalMutationExecuted: true,
        };
      } catch {
        return {
          status: "blocked",
          error: "company agent could not be persisted safely",
          missingInputs: ["unique valid agent definition"],
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}

// ── Update Company Agent ───────────────────────────────────────────────

export type UpdateCompanyAgentToolOptions = {
  authorized?: boolean;
};

export function createUpdateCompanyAgentTool(
  registry?: CompanyAgentRegistry,
  options: UpdateCompanyAgentToolOptions = {},
): ToolDefinition {
  return {
    name: "update_company_agent",
    description:
      "Updates an existing company agent's profile or lifecycle status. Persists durably; no external systems are mutated.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Known company agent id." },
        label: { type: "string" },
        departmentId: {
          type: "string",
          enum: [...validDepartmentIds],
        },
        stablePrefix: { type: "string" },
        status: {
          type: "string",
          enum: ["active", "suspended", "archived"],
        },
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

      const store = registry as CompanyAgentStore | undefined;
      if (typeof store?.updateCompanyAgent !== "function") {
        return {
          status: "blocked",
          error: "company-agent registry unavailable or not writable",
          missingInputs: ["writable companyAgentRegistry with updateCompanyAgent"],
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

      if (!resolveCompanyAgent(registry, agentId)) {
        return {
          status: "blocked",
          error: "unknown agentId",
          missingInputs: ["known agentId"],
          noExternalMutationExecuted: true,
        };
      }

      const fields: Partial<{
        label: string;
        departmentId: CompanyDepartmentId;
        stablePrefix: string;
        status: CompanyAgent["status"];
      }> = {};

      if (typeof args.label === "string") {
        const label = normalizeCompanyAgentText(args.label);
        if (label) {
          const labelIssue = validateCompanyAgentText(label, "label", companyAgentTextLimits.label);
          if (labelIssue) {
            return {
              status: "blocked",
              error: "unsafe metadata",
              missingInputs: [labelIssue],
              noExternalMutationExecuted: true,
            };
          }
          fields.label = label;
        }
      }

      if (
        typeof args.departmentId === "string" &&
        validDepartmentIds.has(args.departmentId as CompanyDepartmentId)
      ) {
        fields.departmentId = args.departmentId as CompanyDepartmentId;
      }

      if (typeof args.stablePrefix === "string") {
        const prefix = normalizeCompanyAgentText(args.stablePrefix);
        if (prefix) {
          const prefixIssue = validateCompanyAgentText(
            prefix,
            "stablePrefix",
            companyAgentTextLimits.stablePrefix,
          );
          if (prefixIssue) {
            return {
              status: "blocked",
              error: "unsafe metadata",
              missingInputs: [prefixIssue],
              noExternalMutationExecuted: true,
            };
          }
          fields.stablePrefix = prefix;
        }
      }

      if (typeof args.status === "string") {
        const status = safeString(args.status);
        if (status === "active" || status === "suspended" || status === "archived") {
          fields.status = status;
        } else {
          return {
            status: "blocked",
            error: "invalid status",
            missingInputs: ['status must be "active", "suspended", or "archived"'],
            noExternalMutationExecuted: true,
          };
        }
      }

      if (Object.keys(fields).length === 0) {
        return {
          status: "blocked",
          error: "no updatable fields provided",
          missingInputs: ["at least one of: label, departmentId, stablePrefix, status"],
          noExternalMutationExecuted: true,
        };
      }

      try {
        const agent = store.updateCompanyAgent(agentId, fields);
        return {
          status: "updated",
          agent: summarizeCompanyAgent(agent),
          noExternalMutationExecuted: true,
        };
      } catch (error) {
        return {
          status: "blocked",
          error: error instanceof Error ? error.message : "update failed",
          missingInputs: ["valid update"],
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}

// ── Request Agent Evidence ─────────────────────────────────────────────

export function createRequestAgentEvidenceTool(registry?: CompanyAgentRegistry): ToolDefinition {
  const targetAgentIds = Array.from(
    new Set([
      ...listCompanyAgents().map((agent) => agent.id),
      ...(registry?.listCompanyAgents().map((agent) => agent.id) ?? []),
    ]),
  );

  return {
    name: "request_agent_evidence",
    description:
      "Solicita evidencia a un agente especialista de la compañía. No ejecuta acciones, " +
      "no muta sistemas externos y solo devuelve el contrato de evidencia requerido.",
    parameters: {
      type: "object",
      properties: {
        targetAgent: {
          type: "string",
          enum: targetAgentIds,
          description: "Agente/lane especialista objetivo.",
        },
        scope: { type: "string", description: "Alcance acotado de la investigación." },
        requestedEvidenceKinds: {
          type: "array",
          items: { type: "string" },
          description: "Tipos de evidencia que el agente debe preparar o validar.",
        },
        existingEvidenceIds: {
          type: "array",
          items: { type: "string" },
          description: "Evidence IDs ya disponibles para evitar trabajo duplicado.",
        },
      },
      required: ["targetAgent", "scope", "requestedEvidenceKinds"],
    },
    execute: (args: Record<string, unknown>): AgentEvidenceResponse => {
      const targetAgent = typeof args.targetAgent === "string" ? args.targetAgent : "";
      const scope = typeof args.scope === "string" ? args.scope.trim() : "";
      const requestedEvidenceKinds = stringArray(args.requestedEvidenceKinds);
      const existingEvidenceIds = stringArray(args.existingEvidenceIds);
      const warnings: string[] = [];

      const requestText = scope;
      if (productiveRequestPattern.test(requestText)) {
        warnings.push(
          "Requested productive/action intent was not executed: request_agent_evidence only asks for evidence.",
        );
      }

      const agent = resolveCompanyAgent(registry, targetAgent);
      if (!agent) {
        return {
          status: "blocked",
          targetAgent,
          scope,
          requestedEvidenceKinds,
          existingEvidenceIds,
          requiredEvidenceKinds: [],
          evidenceIds: existingEvidenceIds,
          missingInputs: ["known targetAgent"],
          boundaryWarnings: warnings,
          noMutationExecuted: true,
        };
      }

      if (agent.status !== "active") {
        return {
          status: "blocked",
          targetAgent,
          scope,
          requestedEvidenceKinds,
          existingEvidenceIds,
          requiredEvidenceKinds: agent.profile.requiredEvidenceKinds,
          evidenceIds: existingEvidenceIds,
          missingInputs: ["active targetAgent"],
          boundaryWarnings: [...agent.profile.boundaries, ...warnings],
          noMutationExecuted: true,
        };
      }

      const missingInputs: string[] = [];
      if (!scope) missingInputs.push("scope");
      if (requestedEvidenceKinds.length === 0) missingInputs.push("requestedEvidenceKinds");

      const missingEvidenceKinds = agent.profile.requiredEvidenceKinds.filter(
        (kind) => !requestedEvidenceKinds.includes(kind),
      );
      for (const kind of missingEvidenceKinds) {
        missingInputs.push(`requested evidence kind: ${kind}`);
      }

      const response: AgentEvidenceResponse = {
        status: missingInputs.length > 0 ? "missing-inputs" : "evidence-ready",
        targetAgent: agent.id,
        scope,
        requestedEvidenceKinds,
        existingEvidenceIds,
        requiredEvidenceKinds: agent.profile.requiredEvidenceKinds,
        evidenceIds: existingEvidenceIds,
        missingInputs,
        boundaryWarnings: [...agent.profile.boundaries, ...warnings],
        noMutationExecuted: true,
      };
      if (agent.profile.laneId) response.laneId = agent.profile.laneId;
      return response;
    },
  };
}
