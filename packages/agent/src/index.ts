import {
  evaluateSpecializationReadiness,
  type RiskLevel,
  type SellerId,
  type SpecializationEvidence,
} from "@msl/domain";

// ── Conversational agent (DeepSeek) ────────────────────────────────
export type {
  ConversationMessage,
  AgentProposal,
  ConversationState,
  StreamingChunk,
  ParsedRule,
  ParseResult,
  RuleType,
  Strategy,
  ActorType,
  SimulationResult,
  ActorSimulationRecord,
  ProbeAlert,
  DecoyProposal,
  ProbeOutcome,
} from "./conversation/types.js";

export { AutonomyLevel } from "./conversation/types.js";
export type { KpiSnapshot, DegradationEvent } from "./conversation/types.js";

export type {
  ConverseResult,
  AgentLoopConfig,
  LlmClient,
  StrategyStore,
  OpenAiFunctionToolDefinition,
} from "./conversation/agentLoop.js";
export {
  createAgentLoop,
  createOpenAiToolDefinitions,
  hasRejectionPattern,
  resolveTurnOutcome,
} from "./conversation/agentLoop.js";
export { buildSystemPrompt } from "./conversation/systemPrompt.js";

// ── Observability (metrics + structured logging) ──────────────────
export {
  createMetrics,
  createLogger,
  type MetricName,
  type Metric,
  type MetricsCollector,
  type Logger,
} from "./conversation/observability.js";

export type { GuardResult } from "./conversation/guardrails.js";
export {
  spanishValidator,
  harmfulContentFilter,
  actionSafetyValidator,
  strategyValidator,
  honeyPotValidator,
  autonomyGate,
} from "./conversation/guardrails.js";

export { selfVerify } from "./conversation/selfVerify.js";
export type { VerificationResult, VerificationCheck } from "./conversation/selfVerify.js";

export { parseStrategy, classifyRuleType } from "./conversation/strategyParser.js";
export { createStrategyStore } from "./conversation/strategyStore.js";

export { createSessionStore } from "./conversation/sessionStore.js";
export type { SessionStore } from "./conversation/sessionStore.js";

export { createAutonomyEngine } from "./conversation/autonomyEngine.js";
export type { AutonomyEngine } from "./conversation/autonomyEngine.js";

// ── Background ingestion ───────────────────────────────────────────────
export { startBackgroundIngestion } from "./conversation/backgroundIngestion.js";
export type { BackgroundIngestionConfig } from "./conversation/backgroundIngestion.js";

export { EscribanoObserver } from "./conversation/escribano.js";
export type { EscribanoConfig } from "./conversation/types.js";

export { OperationalEvidenceProvider } from "./conversation/operationalEvidenceProvider.js";

// ── Tools (function-calling) ────────────────────────────────────────
export type { ToolDefinition } from "./conversation/tools.js";
export {
  createGetBusinessContextTool,
  createPrepareActionTool,
  createDelegateToSubagentTool,
  createCreateCompanyAgentTool,
  createListCompanyAgentsTool,
  createRequestAgentEvidenceTool,
  createSimulateActorTool,
  createDetectProbesTool,
  createProposeHoneyPotTool,
} from "./conversation/tools.js";

export type { LaneContract, LaneOutput, CacheTelemetry, LaneId } from "./conversation/lanes.js";
export { LANE_CONTRACTS, getLaneContract } from "./conversation/lanes.js";

export type {
  CompanyAgent,
  CompanyAgentId,
  CompanyAgentProfile,
  CompanyAgentRegistry,
  CompanyDepartmentId,
  AgentEvidenceRequest,
  AgentEvidenceResponse,
  AgentEvidenceResponseStatus,
  EvidenceKind,
} from "./conversation/companyAgents.js";
export {
  COMPANY_AGENTS,
  getCompanyAgent,
  listCompanyAgents,
} from "./conversation/companyAgents.js";
export { createCompanyAgentStore } from "./conversation/companyAgentStore.js";
export type {
  CompanyAgentStore,
  CreateCompanyAgentInput,
} from "./conversation/companyAgentStore.js";

// ── Sync tools ──────────────────────────────────────────────────────
export {
  createSyncProductTool,
  createSyncAllTool,
  createCheckAccountTool,
  createCalculateListingFeesTool,
  createReadMyListingsTool,
  createFindPausedListingsTool,
  createCheckListingVisitsTool,
  createProductAdsInsightsTool,
  createReadMyOrdersTool,
  createCheckListingQualityTool,
  createAuditAllQualityTool,
  createRelistListingTool,
  createFindRelistOpportunitiesTool,
  createDiagnoseImageTool,
  createUploadImageTool,
  createReadSellerNoticesTool,
  createCheckImageModerationTool,
  createCheckClaimsTool,
  createCheckClaimDetailTool,
  createCheckShipmentStatusTool,
  createCheckClaimMessagesTool,
  createCheckClaimResolutionsTool,
  createCheckClaimReputationTool,
  createCheckClaimHistoryTool,
  createPrepareAnswerTool,
  createPrepareImageFlowTool,
} from "./conversation/syncTools.js";

// ── Actor simulation ────────────────────────────────────────────────
export {
  simulateActor,
  getActorPrompt,
  COMPRADOR_PROMPT,
  PROVEEDOR_PROMPT,
  COMPETIDOR_PROMPT,
} from "./conversation/actorSimulator.js";

// ── Probe detection & honey-pot ─────────────────────────────────────
export { analyzeQuestions, detectViewAnomalies } from "./conversation/probeDetector.js";
export { proposeDecoy } from "./conversation/honeyPotProposer.js";

export type AgentTopic =
  | "margin"
  | "profit"
  | "customer-treatment"
  | "claims"
  | "reputation"
  | "daily-priorities"
  | "automation";

export type LearnedPreference = {
  topic: AgentTopic;
  preference: string;
  learnedFrom: "correction" | "case" | "explicit-instruction";
  riskLevel: RiskLevel;
};

export type BusinessContext = {
  sellerId: SellerId;
  knownFacts: ReadonlyArray<string>;
  learnedPreferences: ReadonlyArray<LearnedPreference>;
  specializationEvidence?: SpecializationEvidence;
};

export type AgentRequest = {
  sellerId: SellerId;
  question: string;
  topic: AgentTopic;
  availableContext: ReadonlyArray<string>;
  requiredContext: ReadonlyArray<string>;
  correction?: LearnedPreference;
  proposedPreference?: LearnedPreference;
  asksForSpecializedAgent?: boolean;
};

export type AgentResponse = {
  language: "es";
  answer: string;
  recommendation: string | null;
  rationale: ReadonlyArray<string>;
  missingContextQuestions: ReadonlyArray<string>;
  learnedPreferences: ReadonlyArray<LearnedPreference>;
  safetyConflict: string | null;
  specializationCandidate: {
    status: "not-requested" | "needs-more-evidence" | "candidate-ready";
    evidence: ReadonlyArray<string>;
  };
};

const riskyTopics = new Set<AgentTopic>(["claims", "reputation", "customer-treatment"]);
const highRiskLevels = new Set<RiskLevel>(["high", "critical"]);
const missingContextLabels: Readonly<Record<string, string>> = {
  claims: "reclamos",
  "current price": "precio actual",
  margin: "margen",
  reputation: "reputación",
  sales: "ventas",
  "supplier cost": "costo del proveedor",
  workflow: "flujo de trabajo",
};

export function answerBusinessQuestion(input: {
  context: BusinessContext;
  request: AgentRequest;
}): AgentResponse {
  const missingContext = input.request.requiredContext.filter(
    (required) => !input.request.availableContext.includes(required),
  );
  const learnedPreferences = applyCorrection(
    input.context.learnedPreferences,
    input.request.correction,
  );
  const safetyConflict = detectSafetyConflict(input.request.proposedPreference);

  if (missingContext.length > 0) {
    return {
      language: "es",
      answer: "Necesito más contexto antes de recomendar una acción confiable.",
      recommendation: null,
      rationale: ["Evito adivinar cuando faltan datos operativos relevantes."],
      missingContextQuestions: missingContext.map(
        (field) => `¿Puede confirmar ${spanishMissingContextLabel(field)}?`,
      ),
      learnedPreferences,
      safetyConflict,
      specializationCandidate: specializationStatus(
        input.context,
        input.request.asksForSpecializedAgent,
      ),
    };
  }

  if (safetyConflict) {
    return {
      language: "es",
      answer: "Puedo considerar esa preferencia, pero primero hay un conflicto de seguridad.",
      recommendation: "Revisá el riesgo y confirmá una alternativa más segura antes de aplicarla.",
      rationale: [
        safetyConflict,
        "Las preferencias aprendidas no pueden saltarse reputación, reclamos o cumplimiento.",
      ],
      missingContextQuestions: [],
      learnedPreferences,
      safetyConflict,
      specializationCandidate: specializationStatus(
        input.context,
        input.request.asksForSpecializedAgent,
      ),
    };
  }

  const matchingPreference = learnedPreferences.find(
    (preference) => preference.topic === input.request.topic,
  );

  return {
    language: "es",
    answer: "Recomendación preparada con la información disponible.",
    recommendation: buildRecommendation(input.request.topic, matchingPreference),
    rationale: [
      "Usé el contexto operativo disponible y las preferencias aprendidas del vendedor.",
      ...(matchingPreference ? [`Preferencia aplicada: ${matchingPreference.preference}.`] : []),
    ],
    missingContextQuestions: [],
    learnedPreferences,
    safetyConflict: null,
    specializationCandidate: specializationStatus(
      input.context,
      input.request.asksForSpecializedAgent,
    ),
  };
}

function spanishMissingContextLabel(field: string): string {
  return missingContextLabels[field] ?? "el dato operativo faltante";
}

function applyCorrection(
  existing: ReadonlyArray<LearnedPreference>,
  correction: LearnedPreference | undefined,
): ReadonlyArray<LearnedPreference> {
  if (!correction) {
    return existing;
  }

  return [...existing.filter((preference) => preference.topic !== correction.topic), correction];
}

function detectSafetyConflict(preference: LearnedPreference | undefined): string | null {
  if (!preference) {
    return null;
  }

  if (riskyTopics.has(preference.topic) || highRiskLevels.has(preference.riskLevel)) {
    return `La preferencia "${preference.preference}" puede aumentar riesgo de reputación, reclamos o cumplimiento.`;
  }

  return null;
}

function buildRecommendation(topic: AgentTopic, preference: LearnedPreference | undefined): string {
  if (topic === "automation") {
    return "Primero sigamos reuniendo evidencia del flujo antes de automatizar o delegar.";
  }

  if (preference) {
    return `Priorizá ${preference.preference} y validá el impacto antes de ejecutar cambios.`;
  }

  return "Priorizá la acción con mejor equilibrio entre utilidad, urgencia y riesgo reputacional.";
}

function specializationStatus(
  context: BusinessContext,
  requested: boolean | undefined,
): AgentResponse["specializationCandidate"] {
  if (!requested) {
    return { status: "not-requested", evidence: [] };
  }

  if (!context.specializationEvidence) {
    return {
      status: "needs-more-evidence",
      evidence: [
        "Falta evidencia de workflows repetidos, criterios de decisión y límites de seguridad.",
      ],
    };
  }

  const readiness = evaluateSpecializationReadiness(context.specializationEvidence);

  if (!readiness.ready) {
    return { status: "needs-more-evidence", evidence: readiness.requiredEvidence };
  }

  return {
    status: "candidate-ready",
    evidence: [
      `Workflow observado: ${readiness.scope}.`,
      "La propuesta sigue siendo evidencia para una extensión futura; no crea agentes automáticamente.",
    ],
  };
}
