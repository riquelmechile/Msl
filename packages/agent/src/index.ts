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
export type { KpiSnapshot, DegradationEvent, AgentAccountContext } from "./conversation/types.js";

export type {
  ConverseResult,
  AgentLoopConfig,
  LlmClient,
  StrategyStore,
  OpenAiFunctionToolDefinition,
} from "./conversation/agentLoop.js";
export {
  buildConsensusContext,
  buildWorkforceCostCacheContext,
  buildWorkforceLessonContext,
  buildWorkforceSkillContext,
  createAgentLoop,
  createOpenAiToolDefinitions,
  hasRejectionPattern,
  resolveTurnOutcome,
} from "./conversation/agentLoop.js";
export { buildSystemPrompt } from "./conversation/systemPrompt.js";
export { getDeepSeekClient, resetDeepSeekClient } from "./conversation/deepseekClient.js";
export {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEEPSEEK_API_KEY_ENV,
  DEEPSEEK_BASE_URL_ENV,
  DEEPSEEK_MODEL_ENV,
  resolveDeepSeekRuntimeConfig,
  resolveDeepSeekCredentialRef,
  resolveDeepSeekUserId,
  deepSeekChatCompletionExtraBody,
  buildDeepSeekChatCompletionRequest,
} from "./conversation/deepseekRuntime.js";
export type {
  DeepSeekEnv,
  DeepSeekRuntimeConfig,
  DeepSeekRoutingInput,
} from "./conversation/deepseekRuntime.js";

// ── Reasoning Gateway ────────────────────────────────────────────────
export { DeepSeekReasoningGateway } from "./reasoning/DeepSeekReasoningGateway.js";
export { ReasoningLevel } from "./reasoning/reasoningTypes.js";
export type { ReasoningCall, ReasoningResult, CostTelemetry } from "./reasoning/reasoningTypes.js";

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

// ── Daemon scheduler ───────────────────────────────────────────────────
export { startDaemonScheduler } from "./workers/daemonScheduler.js";
export type { DaemonSchedulerConfig } from "./workers/daemonScheduler.js";
export type {
  CeoHandlerContext,
  DaemonFinding,
  DaemonResult,
  DaemonHandler,
} from "./workers/daemonTypes.js";
export { marketCatalogDaemon } from "./workers/marketCatalogDaemon.js";
export { operationsManagerDaemon } from "./workers/operationsManagerDaemon.js";
export { costSupplierDaemon } from "./workers/costSupplierDaemon.js";
export { creativeCommercialDaemon } from "./workers/creativeCommercialDaemon.js";
export { productAdsMonitorDaemon } from "./workers/productAdsMonitorDaemon.js";
export { productAdsProfitabilityDaemon } from "./workers/productAdsProfitabilityDaemon.js";
export { creativeAssetsDaemon } from "./workers/creativeAssetsDaemon.js";
export { ceoProfitabilityHandler } from "./workers/ceoProfitabilityHandler.js";
export { supplierManagerDaemon } from "./workers/supplierManagerDaemon.js";
export { morningReportDaemon } from "./workers/morningReportDaemon.js";
export { eodSummaryDaemon } from "./workers/eodSummaryDaemon.js";
export { runSystemHealthCheck } from "./workers/systemHealthDaemon.js";
export type { SystemHealthCheck } from "./workers/systemHealthDaemon.js";
export { runDlqMonitor } from "./workers/dlqMonitorDaemon.js";

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
  createDeclareAgentSkillTool,
  createListAgentLessonsTool,
  createListAgentSkillsTool,
  createListCompanyAgentsTool,
  createListWorkforceCostCacheLedgerEntriesTool,
  createRecordAgentLessonTool,
  createRecordWorkforceCostCacheLedgerEntryTool,
  createRequestAgentEvidenceTool,
  createSimulateActorTool,
  createDetectProbesTool,
  createProposeHoneyPotTool,
  createUpdateAgentSkillTool,
  createUpdateCompanyAgentTool,
  createGetAccountBrainStatusTool,
  createCompareAccountAssetsTool,
} from "./conversation/tools.js";

export type { LaneContract, LaneOutput, CacheTelemetry, LaneId } from "./conversation/lanes.js";
export { LANE_CONTRACTS, getLaneContract } from "./conversation/lanes.js";

export { SupplierMirrorDeepSeekAdvisor } from "./conversation/supplierMirrorDeepSeekAdvisor.js";
export type {
  SupplierMirrorAnalysis,
  SupplierMirrorAnalysisFinding,
  SupplierMirrorAnalysisInput,
} from "./conversation/supplierMirrorDeepSeekAdvisor.js";
export { OperationsDeepSeekAdvisor } from "./conversation/operationsDeepSeekAdvisor.js";
export type {
  OperationsAnalysis,
  OperationsAnalysisFinding,
  OperationsAnalysisInput,
} from "./conversation/operationsDeepSeekAdvisor.js";
export { CatalogDeepSeekAdvisor } from "./conversation/catalogDeepSeekAdvisor.js";
export type {
  CatalogAnalysis,
  CatalogAnalysisFinding,
  CatalogAnalysisInput,
  CatalogActionableFinding,
} from "./conversation/catalogDeepSeekAdvisor.js";
export { CreativeDeepSeekAdvisor } from "./conversation/creativeDeepSeekAdvisor.js";
export type {
  CreativeEnrichment,
  CreativeEnrichmentFinding,
  CreativeEnrichmentInput,
  CreativeActionableFinding,
} from "./conversation/creativeDeepSeekAdvisor.js";
export { CostSupplierDeepSeekAdvisor } from "./conversation/costSupplierDeepSeekAdvisor.js";
export type {
  CostSupplierEnrichment,
  CostSupplierEnrichmentFinding,
  CostSupplierEnrichmentInput,
  CostSupplierActionableFinding,
} from "./conversation/costSupplierDeepSeekAdvisor.js";

export { createDaemonAdvisorsFromEnv } from "./conversation/createDaemonAdvisors.js";
export type {
  DaemonAdvisors,
  CreateDaemonAdvisorsExtra,
} from "./conversation/createDaemonAdvisors.js";

export { createCreativeJobQueueStore } from "./conversation/creativeJobQueueStore.js";
export type {
  CreativeJobQueueStore,
  CreativeJobRow,
  CreateCreativeJobInput,
} from "./conversation/creativeJobQueueStore.js";

export { MinimaxRetryPolicy } from "./workers/minimaxRetryPolicy.js";
export type { RetryPolicyConfig } from "./workers/minimaxRetryPolicy.js";

export {
  applySupplierPricingPolicy,
  createSupplierMirrorTools,
  parseSupplierPricingPolicyText,
} from "./conversation/supplierMirrorTools.js";
export type { ParsedSupplierPricingPolicy } from "./conversation/supplierMirrorTools.js";
export { createOwnedEcommerceTools } from "./conversation/ownedEcommerceTools.js";
export { createOwnedEcommerceRuntimeExecutor } from "./runtime/ownedEcommerceExecutor.js";
export type {
  OwnedEcommerceRuntimeExecutor,
  OwnedEcommerceRuntimeExecutorOptions,
  OwnedEcommerceRuntimeExecutionObserver,
} from "./runtime/ownedEcommerceExecutor.js";

// ── Ecommerce merchandising advisor ──────────────────────────────────
export { OwnedEcommerceMerchandisingAdvisor } from "./ecommerce/ownedEcommerceMerchandisingAdvisor.js";
export type {
  MerchandisingAdvisorResult,
  RankingReasoning,
  ChannelTradeoffExplanation,
  ExperimentProposal,
  MissingEvidenceReport,
  AdvisorCallContext,
} from "./ecommerce/ownedEcommerceMerchandisingAdvisor.js";
export { validate as validateAdvisorOutput } from "./ecommerce/merchandisingAdvisorValidator.js";
export type { AdvisorValidationResult } from "./ecommerce/merchandisingAdvisorValidator.js";
export { EcommerceEvidenceRequestPlanner } from "./ecommerce/ecommerceEvidenceRequestPlanner.js";
export type { EvidenceRequestMessage } from "./ecommerce/ecommerceEvidenceRequestPlanner.js";
export {
  buildStableSystemPrompt,
  buildEvidenceBlock,
  buildOutputSchema,
  buildFullPrompt,
  hashStablePrompt,
  hashEvidenceBlock,
} from "./ecommerce/ownedEcommerceAdvisorPrompt.js";
export type {
  AdvisorPromptConfig,
  FullPromptResult,
} from "./ecommerce/ownedEcommerceAdvisorPrompt.js";

export type {
  CompanyAgent,
  CompanyAgentId,
  CompanyAgentProfile,
  CompanyAgentRegistry,
  CompanyDepartmentId,
  AgentEvidenceRequest,
  AgentEvidenceResponse,
  AgentEvidenceResponseStatus,
  AgentSkill,
  EvidenceKind,
} from "./conversation/companyAgents.js";
export {
  COMPANY_AGENTS,
  getCompanyAgent,
  listCompanyAgents,
} from "./conversation/companyAgents.js";
export { createAgentMessageBusStore } from "./conversation/agentMessageBusStore.js";
export type {
  AgentMessageBusStore,
  AgentMessage,
  EnqueueAgentMessageInput,
} from "./conversation/agentMessageBusStore.js";

export { createCompanyAgentStore } from "./conversation/companyAgentStore.js";
export type {
  CompanyAgentStore,
  CreateCompanyAgentInput,
} from "./conversation/companyAgentStore.js";
export { createCompanyAgentLearningStore } from "./conversation/companyAgentLearningStore.js";

export { createAgentConsensusStore } from "./conversation/agentConsensusStore.js";
export type {
  AgentConsensusStore,
  AgentReview,
  ConsensusResult,
  ReviewVerdict,
  SubmitReviewInput,
} from "./conversation/agentConsensusStore.js";
export type {
  AgentLearningRecord,
  AgentLessonScope,
  AgentLessonStatus,
  AgentLessonType,
  CompanyAgentLearningStore,
  ListAgentLessonsFilter,
  RecordAgentLessonInput,
} from "./conversation/companyAgentLearningStore.js";
export { createCompanyAgentSkillStore } from "./conversation/companyAgentSkillStore.js";
export type {
  CompanyAgentSkillStore,
  InsertAgentSkillInput,
} from "./conversation/companyAgentSkillStore.js";
export { createWorkforceCostCacheLedgerStore } from "./conversation/workforceCostCacheLedgerStore.js";
export {
  buildSupplierMirrorDeepSeekPromptPlan,
  estimateSupplierMirrorDeepSeekCostMicros,
  selectSupplierMirrorDeepSeekModel,
  SUPPLIER_MIRROR_DEEPSEEK_PRICING,
  SUPPLIER_MIRROR_DEEPSEEK_PROVIDER,
  SUPPLIER_MIRROR_DEEPSEEK_V4_FLASH,
  SUPPLIER_MIRROR_DEEPSEEK_V4_PRO,
} from "./conversation/supplierMirrorDeepSeekPolicy.js";
export type {
  SupplierMirrorDeepSeekModel,
  SupplierMirrorDeepSeekOperation,
  SupplierMirrorDeepSeekPricing,
  SupplierMirrorDeepSeekPromptPlan,
  SupplierMirrorDeepSeekPromptPlanInput,
} from "./conversation/supplierMirrorDeepSeekPolicy.js";
export type {
  ListWorkforceCostCacheLedgerEntriesFilter,
  RecordWorkforceCostCacheLedgerEntryInput,
  WorkforceCacheStatus,
  WorkforceCostCacheLedgerEntry,
  WorkforceCostCacheLedgerStore,
} from "./conversation/workforceCostCacheLedgerStore.js";

export { createCeoInboxStore } from "./conversation/ceoInboxStore.js";
export type {
  CeoInboxStore,
  InsertAgentProposalInput,
  AgentProposalRow,
} from "./conversation/ceoInboxStore.js";

export { createAccountAssetStore } from "./conversation/accountAssetStore.js";
export type { AccountAssetStore } from "./conversation/accountAssetStore.js";

export { AccountBrainService } from "./conversation/accountBrainService.js";
export type {
  AccountBrainStatusInput,
  AccountBrainStatus,
  CompareAccountAssetsInput,
  AccountAssetComparison,
  AgentActivitySummary,
  CostCacheSummary,
} from "./conversation/accountBrainService.js";

// ── Runtime env validation ───────────────────────────────────────────
export { validateRuntimeEnv } from "./conversation/validateEnv.js";
export type { EnvValidation } from "./conversation/validateEnv.js";

// ── Production secrets validation ───────────────────────────────────
export {
  validateProductionSecrets,
  formatProductionValidation,
} from "./conversation/validateProductionSecrets.js";
export type {
  ProductionValidation,
  SecretCheck,
  ProductionSecretStatus,
} from "./conversation/validateProductionSecrets.js";

// ── DeepSeek Transport (abstracted LLM client) ──────────────────────
export { createDeepSeekProviderFromEnv } from "./conversation/transports/deepseekFactory.js";
export {
  DeepSeekRealTransport,
  DeepSeekFakeTransport,
  DeepSeekFixtureTransport,
} from "./conversation/transports/deepseekTransport.js";
export type {
  DeepSeekTransport,
  DeepSeekModel,
  DeepSeekChatRequest,
  DeepSeekChatResponse,
  DeepSeekStreamChunk,
} from "./conversation/transports/deepseekTransport.js";
export {
  DeepSeekRequestError,
  classifyDeepSeekError,
} from "./conversation/transports/deepseekErrors.js";
export type { DeepSeekErrorCategory } from "./conversation/transports/deepseekErrors.js";

// ── Webhook ingestor ─────────────────────────────────────────────────
export { createWebhookIngestor } from "./conversation/webhookIngestor.js";
export type {
  WebhookIngestor,
  WebhookEvent,
  WebhookResponse,
} from "./conversation/webhookIngestor.js";

// ── Learning pipeline ────────────────────────────────────────────────
export { runLearningPipeline, scoreMessage } from "./conversation/learningPipeline.js";
export type {
  LearningPipelineOptions,
  ScoredOutcome,
  LearningPipelineResult,
} from "./conversation/learningPipeline.js";

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
