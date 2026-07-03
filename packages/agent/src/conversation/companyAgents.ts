import { LANE_CONTRACTS, type LaneContract, type LaneId } from "./lanes.js";

export type CompanyDepartmentId = "executive" | "operations" | "commercial";

export type CompanyAgentId = string;

export type EvidenceKind = string;

export type CompanyAgentProfile = {
  agentId: CompanyAgentId;
  laneId?: LaneId;
  label: string;
  departmentId: CompanyDepartmentId;
  stablePrefix: string;
  refreshableContextProvider: string;
  inputs: readonly string[];
  outputs: readonly string[];
  requiredEvidenceKinds: readonly EvidenceKind[];
  boundaries: readonly string[];
  noMutationBoundary: true;
};

export type CompanyAgent = {
  id: CompanyAgentId;
  profile: CompanyAgentProfile;
  source: "lane-contract" | "ceo-created";
  status: "active" | "archived";
  durableReady: true;
};

export type CompanyAgentRegistry = {
  getCompanyAgent(agentId: string): CompanyAgent | undefined;
  listCompanyAgents(): readonly CompanyAgent[];
};

export type AgentEvidenceRequest = {
  targetAgent: string;
  scope: string;
  requestedEvidenceKinds: readonly EvidenceKind[];
  existingEvidenceIds: readonly string[];
};

export type AgentEvidenceResponseStatus = "evidence-ready" | "missing-inputs" | "blocked";

export type AgentEvidenceResponse = {
  status: AgentEvidenceResponseStatus;
  targetAgent: string;
  laneId?: LaneId;
  scope: string;
  requestedEvidenceKinds: readonly EvidenceKind[];
  existingEvidenceIds: readonly string[];
  requiredEvidenceKinds: readonly EvidenceKind[];
  evidenceIds: readonly string[];
  missingInputs: readonly string[];
  boundaryWarnings: readonly string[];
  noMutationExecuted: true;
};

const laneDepartments: Record<LaneId, CompanyDepartmentId> = {
  ceo: "executive",
  "cost-supplier": "operations",
  "market-catalog": "operations",
  "creative-commercial": "commercial",
};

function toCompanyAgent(contract: LaneContract): CompanyAgent {
  return {
    id: contract.laneId,
    source: "lane-contract",
    status: "active",
    durableReady: true,
    profile: {
      agentId: contract.laneId,
      laneId: contract.laneId,
      label: contract.label,
      departmentId: laneDepartments[contract.laneId],
      stablePrefix: contract.stablePrefix,
      refreshableContextProvider: contract.refreshableContextProvider,
      inputs: Object.freeze([...contract.inputs]),
      outputs: Object.freeze([...contract.outputs]),
      requiredEvidenceKinds: Object.freeze([...contract.requiredEvidenceKinds]),
      boundaries: Object.freeze([...contract.boundaries]),
      noMutationBoundary: true,
    },
  };
}

function freezeCompanyAgent(agent: CompanyAgent): CompanyAgent {
  Object.freeze(agent.profile);
  return Object.freeze(agent);
}

export const COMPANY_AGENTS: readonly CompanyAgent[] = Object.freeze(
  LANE_CONTRACTS.map(toCompanyAgent).map(freezeCompanyAgent),
);

export function listCompanyAgents(): readonly CompanyAgent[] {
  return COMPANY_AGENTS;
}

export function getCompanyAgent(agentId: string): CompanyAgent | undefined {
  return COMPANY_AGENTS.find((agent) => agent.id === agentId);
}

export const staticCompanyAgentRegistry: CompanyAgentRegistry = Object.freeze({
  getCompanyAgent,
  listCompanyAgents,
});
