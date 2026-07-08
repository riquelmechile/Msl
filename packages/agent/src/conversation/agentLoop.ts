import OpenAI from "openai";
import { getDeepSeekClient as getSharedDeepSeekClient } from "./deepseekClient.js";
import {
  buildDeepSeekChatCompletionRequest,
  resolveDeepSeekRuntimeConfig,
  resolveDeepSeekUserId,
  type DeepSeekRuntimeConfig,
} from "./deepseekRuntime.js";
import type { GraphEngine, OwnedEcommerceStore, SupplierMirrorStore } from "@msl/memory";
import type { MlClient, MlcApiClient, ProductSyncEngine } from "@msl/mercadolibre";
import type {
  AgentProposal,
  ConversationMessage,
  ConversationState,
  DecoyProposal,
  ParsedRule,
  RuleType,
  Strategy,
  StreamingChunk,
} from "./types.js";
import { AutonomyLevel, type TurnOutcome } from "./types.js";
import {
  spanishValidator,
  harmfulContentFilter,
  strategyValidator,
  honeyPotValidator,
  autonomyGate,
} from "./guardrails.js";
import type { AutonomyEngine } from "./autonomyEngine.js";
import type { AgentConsensusStore } from "./agentConsensusStore.js";
import { selfVerify } from "./selfVerify.js";
import { parseStrategy } from "./strategyParser.js";
import type { ToolDefinition } from "./tools.js";
import {
  createDelegateToSubagentTool,
  createDetectProbesTool,
  createCreateCompanyAgentTool,
  createDeclareAgentSkillTool,
  createGetBusinessContextTool,
  createListAgentLessonsTool,
  createListAgentSkillsTool,
  createListCompanyAgentsTool,
  createListWorkforceCostCacheLedgerEntriesTool,
  createProposeHoneyPotTool,
  createRecordAgentLessonTool,
  createRecordWorkforceCostCacheLedgerEntryTool,
  createRequestAgentEvidenceTool,
  createUpdateAgentSkillTool,
  createUpdateCompanyAgentTool,
} from "./tools.js";
import { proposeDecoy } from "./honeyPotProposer.js";
import {
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
  createCheckPriceIntelligenceTool,
  createFindAutomatedPriceItemsTool,
  createReadSellerPromotionsTool,
  createReadItemPromotionsTool,
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
  createCreateListingTool,
  createUpdateListingTool,
  createChangeItemStatusTool,
  createManageVariationsTool,
  createReadMyCatalogTool,
} from "./syncTools.js";
import type { MetricsCollector } from "./observability.js";
import type { CacheTelemetry, LaneId, LaneOutput } from "./lanes.js";
import type { OperationalReadModelReader } from "@msl/memory";
import type { OperationalEvidenceProvider } from "./operationalEvidenceProvider.js";
import { buildDailyAggregates, injectCortexContext } from "./cacheBlocks.js";
import { OperationalDailyDataSource } from "./operationalDataSource.js";
import type { CompanyAgentId, CompanyAgentRegistry } from "./companyAgents.js";
import type {
  AgentLearningRecord,
  CompanyAgentLearningStore,
} from "./companyAgentLearningStore.js";
import type { CompanyAgentSkillStore } from "./companyAgentSkillStore.js";
import type { WorkforceCostCacheLedgerStore } from "./workforceCostCacheLedgerStore.js";
import { SupplierMirrorDeepSeekAdvisor } from "./supplierMirrorDeepSeekAdvisor.js";
import { createSupplierMirrorTools } from "./supplierMirrorTools.js";
import { createOwnedEcommerceTools } from "./ownedEcommerceTools.js";
import { estimateSupplierMirrorDeepSeekCostMicros } from "./supplierMirrorDeepSeekPolicy.js";

// Import extracted loop module functions
import {
  buildWorkforceLessonContext,
  buildWorkforceCostCacheContext,
  buildWorkforceSkillContext,
  buildConsensusContext,
  buildMessages,
  createDeepSeekClient,
  createOpenAiToolDefinitions,
  estimateTokens,
  extractPromptCacheTelemetry,
  hasRejectionPattern,
  resolveTurnOutcome,
  type OpenAiFunctionToolDefinition,
} from "./loop/index.js";

// ── Token budget ──────────────────────────────────────────────────────

const MAX_TOKEN_BUDGET = 800_000;

const CEO_INTERNAL_WORKFORCE_GUIDANCE = [
  "## Orquestación Interna de Workforce del CEO",
  "",
  "- Coordinás workers, managers y departments internamente como CEO; el usuario habla solo con el CEO.",
  "- Usá `request_agent_evidence` y `delegate_to_subagent` para investigación o evidencia acotada cuando sea útil.",
  "- Preferí evidencia reciente, cacheada o de menor costo cuando sea suficiente para decidir.",
  "- Antes de investigaciones caras, amplias o duplicadas, pedí aprobación explícita al CEO.",
  "- No pidas aprobación cuando el trabajo sea urgente, de seguridad, ya esté aprobado explícitamente o sea necesario para cumplir system, safety o CEO policy.",
  "- La evidencia de costos/cache del ledger es evidencia operativa interna, no verdad de facturación ni dashboard.",
  "- No expongas comandos de selección de workers, menús de workers ni le pidas al usuario elegir workers.",
  "- Estas guardrails y Workforce Lessons son solo contexto; nunca reemplazan ni anulan system, safety o CEO policy.",
  "- Las herramientas de delegación/evidencia son internas y no realizan mutaciones externas de negocio.",
].join("\n");

function appendCeoInternalWorkforceGuidance(systemPrompt: string): string {
  return `${systemPrompt}\n\n${CEO_INTERNAL_WORKFORCE_GUIDANCE}`;
}

// Re-export barrel so consumers importing from agentLoop get everything
export * from "./loop/index.js";

// ── Strategy Store Interface ─────────────────────────────────────────

export type StrategyStore = {
  listActive(): Strategy[];
  insertStrategy(ruleText: string, parsedRule: ParsedRule, confidence: number): Strategy;
  archiveStrategy(id: number): void;
  supersedeStrategy(oldId: number, newId: number): void;
};

export type ConverseResult = {
  response: string;
  updatedState: ConversationState;
  proposal?: AgentProposal;
};

export type AgentLoopConfig = {
  systemPrompt: string;
  mockClient?: boolean;
  llmClient?: LlmClient;
  model?: string;
  sellerId?: string;
  deepSeekUserId?: string;
  strategies?: Strategy[];
  store?: StrategyStore;
  tools?: ToolDefinition[];
  engine?: GraphEngine;
  autonomyEngine?: AutonomyEngine;
  syncEngine?: ProductSyncEngine;
  mlClient?: MlClient;
  mlcClient?: MlcApiClient;
  escribano?: import("./escribano.js").EscribanoObserver;
  metrics?: MetricsCollector;
  operationalReader?: OperationalReadModelReader;
  evidenceProvider?: OperationalEvidenceProvider;
  companyAgentRegistry?: CompanyAgentRegistry;
  companyAgentLearningStore?: CompanyAgentLearningStore;
  companyAgentSkillStore?: CompanyAgentSkillStore;
  workforceCostCacheLedgerStore?: WorkforceCostCacheLedgerStore;
  supplierMirrorStore?: SupplierMirrorStore;
  ownedEcommerceStore?: OwnedEcommerceStore;
  consensusStore?: AgentConsensusStore;
  activeCompanyAgentId?: CompanyAgentId;
  companyAgentAdminAuthorized?: boolean;
  workforceBudgetWarningThresholdMicros?: number;
  laneId?: LaneId;
};

export type LlmClient = {
  chat(messages: Array<{ role: string; content: string }>): Promise<{
    content: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
    usage?: LlmUsageMetadata;
  }>;
  stream(messages: Array<{ role: string; content: string }>): AsyncIterable<StreamingChunk>;
};

export type LlmUsageMetadata = {
  provider: string;
  model: string;
  usage: Record<string, unknown>;
};

// Also export OpenAiFunctionToolDefinition from the barrel
export type { OpenAiFunctionToolDefinition };

// ── createAgentLoop ────────────────────────────────────────────────────

export function createAgentLoop(config: AgentLoopConfig) {
  const deepSeekRuntime = resolveDeepSeekRuntimeConfig();
  const model = config.model ?? deepSeekRuntime.model;
  const deepSeekRouting = {
    laneId: config.laneId ?? "ceo",
    ...(config.sellerId ? { sellerId: config.sellerId } : {}),
    ...(config.activeCompanyAgentId ? { agentId: config.activeCompanyAgentId } : {}),
  };
  const deepSeekUserId = config.deepSeekUserId ?? resolveDeepSeekUserId(deepSeekRouting);
  const openai = config.mockClient ? null : createDeepSeekClient(deepSeekRuntime);
  const tools = config.tools ?? [];
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  let pendingDecoyProposal: DecoyProposal | null = null;

  if (!toolMap.has("detect_probes")) {
    toolMap.set("detect_probes", createDetectProbesTool());
  }
  if (!toolMap.has("propose_honey_pot")) {
    toolMap.set(
      "propose_honey_pot",
      createProposeHoneyPotTool(
        proposeDecoy,
        honeyPotValidator,
        () => getActiveStrategies(),
        (proposal) => {
          pendingDecoyProposal = proposal;
        },
      ),
    );
  }
  if (!toolMap.has("delegate_to_subagent")) {
    toolMap.set("delegate_to_subagent", createDelegateToSubagentTool());
  }
  if (!toolMap.has("request_agent_evidence")) {
    toolMap.set(
      "request_agent_evidence",
      createRequestAgentEvidenceTool(config.companyAgentRegistry),
    );
  }
  if (!toolMap.has("list_company_agents")) {
    toolMap.set("list_company_agents", createListCompanyAgentsTool(config.companyAgentRegistry));
  }
  if (
    config.companyAgentLearningStore &&
    config.companyAgentAdminAuthorized === true &&
    !toolMap.has("list_agent_lessons")
  ) {
    toolMap.set(
      "list_agent_lessons",
      createListAgentLessonsTool(config.companyAgentLearningStore, { authorized: true }),
    );
  }
  if (
    config.companyAgentRegistry &&
    config.companyAgentAdminAuthorized === true &&
    !toolMap.has("create_company_agent")
  ) {
    toolMap.set(
      "create_company_agent",
      createCreateCompanyAgentTool(config.companyAgentRegistry, { authorized: true }),
    );
  }
  if (
    config.companyAgentLearningStore &&
    config.companyAgentAdminAuthorized === true &&
    !toolMap.has("record_agent_lesson")
  ) {
    toolMap.set(
      "record_agent_lesson",
      createRecordAgentLessonTool(config.companyAgentLearningStore, config.companyAgentRegistry, {
        authorized: true,
      }),
    );
  }
  if (config.companyAgentSkillStore && config.companyAgentAdminAuthorized === true) {
    if (!toolMap.has("declare_agent_skill")) {
      toolMap.set(
        "declare_agent_skill",
        createDeclareAgentSkillTool(config.companyAgentSkillStore, { authorized: true }),
      );
    }
    if (!toolMap.has("list_agent_skills")) {
      toolMap.set(
        "list_agent_skills",
        createListAgentSkillsTool(config.companyAgentSkillStore, { authorized: true }),
      );
    }
    if (!toolMap.has("update_agent_skill")) {
      toolMap.set(
        "update_agent_skill",
        createUpdateAgentSkillTool(config.companyAgentSkillStore, { authorized: true }),
      );
    }
  }
  if (config.companyAgentRegistry && config.companyAgentAdminAuthorized === true) {
    if (!toolMap.has("update_company_agent")) {
      toolMap.set(
        "update_company_agent",
        createUpdateCompanyAgentTool(config.companyAgentRegistry, { authorized: true }),
      );
    }
  }
  if (
    config.workforceCostCacheLedgerStore &&
    !toolMap.has("list_workforce_cost_cache_ledger_entries")
  ) {
    toolMap.set(
      "list_workforce_cost_cache_ledger_entries",
      createListWorkforceCostCacheLedgerEntriesTool(config.workforceCostCacheLedgerStore),
    );
  }
  if (
    config.workforceCostCacheLedgerStore &&
    config.companyAgentAdminAuthorized === true &&
    !toolMap.has("record_workforce_cost_cache_ledger_entry")
  ) {
    toolMap.set(
      "record_workforce_cost_cache_ledger_entry",
      createRecordWorkforceCostCacheLedgerEntryTool(config.workforceCostCacheLedgerStore, {
        authorized: true,
      }),
    );
  }
  if (config.supplierMirrorStore) {
    let advisor: SupplierMirrorDeepSeekAdvisor | undefined;
    if (openai && config.sellerId && config.workforceCostCacheLedgerStore) {
      advisor = new SupplierMirrorDeepSeekAdvisor({
        store: config.supplierMirrorStore,
        openai,
        sellerIds: [config.sellerId],
        ledger: config.workforceCostCacheLedgerStore,
      });
    }
    for (const tool of createSupplierMirrorTools(config.supplierMirrorStore, advisor)) {
      if (!toolMap.has(tool.name)) toolMap.set(tool.name, tool);
    }
  }
  if (config.ownedEcommerceStore) {
    for (const tool of createOwnedEcommerceTools(config.ownedEcommerceStore)) {
      if (!toolMap.has(tool.name)) toolMap.set(tool.name, tool);
    }
  }

  if (config.mlClient && !toolMap.has("create_listing")) {
    toolMap.set("create_listing", createCreateListingTool(config.mlClient, config.engine));
  }
  if (config.mlClient && !toolMap.has("update_listing")) {
    toolMap.set("update_listing", createUpdateListingTool(config.mlClient, config.engine));
  }
  if (config.mlClient && !toolMap.has("change_item_status")) {
    toolMap.set("change_item_status", createChangeItemStatusTool(config.mlClient, config.engine));
  }
  if (config.mlClient && !toolMap.has("manage_variations")) {
    toolMap.set("manage_variations", createManageVariationsTool(config.mlClient, config.engine));
  }
  if (config.operationalReader && !toolMap.has("read_my_catalog")) {
    toolMap.set("read_my_catalog", createReadMyCatalogTool(config.operationalReader));
  }
  if (config.syncEngine) {
    if (!toolMap.has("sync_product")) {
      toolMap.set("sync_product", createSyncProductTool(config.syncEngine, config.engine));
    }
    if (!toolMap.has("sync_all")) {
      toolMap.set("sync_all", createSyncAllTool(config.syncEngine, config.engine));
    }
  }
  if (config.mlClient && !toolMap.has("check_account")) {
    toolMap.set("check_account", createCheckAccountTool(config.mlClient));
  }
  if (config.mlcClient && !toolMap.has("calculate_listing_fees")) {
    toolMap.set("calculate_listing_fees", createCalculateListingFeesTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("read_my_listings")) {
    toolMap.set("read_my_listings", createReadMyListingsTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("find_paused_listings")) {
    toolMap.set("find_paused_listings", createFindPausedListingsTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("check_listing_visits")) {
    toolMap.set("check_listing_visits", createCheckListingVisitsTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("read_product_ads_insights")) {
    toolMap.set("read_product_ads_insights", createProductAdsInsightsTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("read_my_orders")) {
    toolMap.set("read_my_orders", createReadMyOrdersTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("check_listing_quality")) {
    toolMap.set("check_listing_quality", createCheckListingQualityTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("check_price_intelligence")) {
    toolMap.set("check_price_intelligence", createCheckPriceIntelligenceTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("find_automated_price_items")) {
    toolMap.set("find_automated_price_items", createFindAutomatedPriceItemsTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("read_seller_promotions")) {
    toolMap.set("read_seller_promotions", createReadSellerPromotionsTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("read_item_promotions")) {
    toolMap.set("read_item_promotions", createReadItemPromotionsTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("relist_listing")) {
    toolMap.set("relist_listing", createRelistListingTool(config.mlcClient));
  }
  if (config.engine && !toolMap.has("audit_all_quality")) {
    toolMap.set("audit_all_quality", createAuditAllQualityTool(config.engine));
  }
  if (config.engine && !toolMap.has("find_relist_opportunities")) {
    toolMap.set("find_relist_opportunities", createFindRelistOpportunitiesTool(config.engine));
  }
  if (config.mlcClient && !toolMap.has("diagnose_image")) {
    toolMap.set("diagnose_image", createDiagnoseImageTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("upload_image")) {
    toolMap.set("upload_image", createUploadImageTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("read_seller_notices")) {
    toolMap.set("read_seller_notices", createReadSellerNoticesTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("check_image_moderation")) {
    toolMap.set("check_image_moderation", createCheckImageModerationTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("check_claims")) {
    toolMap.set("check_claims", createCheckClaimsTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("check_claim_detail")) {
    toolMap.set("check_claim_detail", createCheckClaimDetailTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("check_shipment_status")) {
    toolMap.set("check_shipment_status", createCheckShipmentStatusTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("check_claim_messages")) {
    toolMap.set("check_claim_messages", createCheckClaimMessagesTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("check_claim_resolutions")) {
    toolMap.set("check_claim_resolutions", createCheckClaimResolutionsTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("check_claim_reputation")) {
    toolMap.set("check_claim_reputation", createCheckClaimReputationTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("check_claim_history")) {
    toolMap.set("check_claim_history", createCheckClaimHistoryTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("prepare_answer")) {
    toolMap.set("prepare_answer", createPrepareAnswerTool(config.mlcClient));
  }
  if (config.mlcClient && !toolMap.has("prepare_image_flow")) {
    toolMap.set("prepare_image_flow", createPrepareImageFlowTool(config.mlcClient));
  }
  if (config.engine && !toolMap.has("get_business_context")) {
    toolMap.set("get_business_context", createGetBusinessContextTool(config.engine));
  }

  const client: LlmClient =
    config.llmClient ??
    (openai && !config.mockClient
      ? createRealClient(openai, model, toolMap, deepSeekUserId, config.sellerId)
      : config.mockClient
        ? createMockClient(toolMap)
        : createNoopClient());
  let llmCallIndex = 0;

  function recordLlmUsage(llmResponse: { usage?: LlmUsageMetadata }): void {
    if (!config.workforceCostCacheLedgerStore || !llmResponse.usage) return;

    const callIndex = llmCallIndex;
    llmCallIndex += 1;

    try {
      let departmentId: string | undefined;
      if (config.activeCompanyAgentId && config.companyAgentRegistry) {
        const agent = config.companyAgentRegistry.getCompanyAgent(config.activeCompanyAgentId);
        departmentId = agent?.profile.departmentId;
      }

      const laneId = config.laneId ?? "ceo";
      const tokenUsage = extractLedgerTokenUsage(llmResponse.usage.usage);
      const estimatedCostMicros = estimateSupplierMirrorDeepSeekCostMicros({
        model: llmResponse.usage.model,
        ...(tokenUsage.promptCacheHitTokens === undefined
          ? {}
          : { promptCacheHitTokens: tokenUsage.promptCacheHitTokens }),
        ...(tokenUsage.promptCacheMissTokens === undefined
          ? {}
          : { promptCacheMissTokens: tokenUsage.promptCacheMissTokens }),
        ...(tokenUsage.outputTokens === undefined ? {} : { outputTokens: tokenUsage.outputTokens }),
      });
      config.workforceCostCacheLedgerStore.insertEntry({
        entryId: `llm:${Date.now()}:${callIndex}`,
        agentId: laneId,
        laneId,
        ...(departmentId ? { departmentId } : {}),
        provider: llmResponse.usage.provider,
        model: llmResponse.usage.model,
        operation: "chat.completion",
        ...tokenUsage,
        ...(estimatedCostMicros === undefined ? {} : { estimatedCostMicros, currency: "USD" }),
        metadata: {
          source: "agent_loop",
          callIndex,
          deepSeekUserId,
          deepSeekRoutingRef: deepSeekUserId,
        },
      });
    } catch {
      // Telemetry must never break the seller conversation.
    }
  }

  let activeStrategies = config.strategies ?? [];

  function getActiveStrategies(): Strategy[] {
    if (config.store) {
      return config.store.listActive();
    }
    return activeStrategies;
  }

  function getSystemPrompt(): string {
    let prompt = appendCeoInternalWorkforceGuidance(config.systemPrompt);

    if (config.autonomyEngine) {
      const level = config.autonomyEngine.getCurrentLevel();
      const name = AutonomyLevel[level] ?? "DESCONOCIDO";

      let levelDesc: string;
      switch (level) {
        case AutonomyLevel.CONSULTA:
          levelDesc =
            "Solo respondés preguntas. No podés ejecutar acciones bajo ninguna circunstancia.";
          break;
        case AutonomyLevel.SUGIERE:
          levelDesc =
            'Proponés acciones pero SIEMPRE requerís confirmación explícita ("dale"). ' +
            "Nunca auto-ejecutés.";
          break;
        case AutonomyLevel.PREPARA:
          levelDesc = 'Proponés acciones con detalles pre-llenados. Requerís "dale" para ejecutar.';
          break;
        case AutonomyLevel.BAJO_RIESGO:
          levelDesc =
            'Podés auto-ejecutar acciones de bajo riesgo sin "dale". ' +
            "Acciones de medio y alto riesgo requieren confirmación.";
          break;
        case AutonomyLevel.MEDIO_RIESGO:
          levelDesc =
            'Podés auto-ejecutar acciones de bajo y medio riesgo sin "dale". ' +
            "Solo acciones de alto riesgo requieren confirmación.";
          break;
        case AutonomyLevel.FULL:
          levelDesc =
            "Podés auto-ejecutar todas las acciones salvo las de riesgo crítico. " +
            "Notificás después de ejecutar.";
          break;
        default:
          levelDesc = "";
          break;
      }

      prompt = `${prompt}

## Nivel de Autonomía Actual: ${name} (${level})
Actualmente te encuentro en nivel ${name}. ${levelDesc}`;
    }

    const strategies = getActiveStrategies();
    if (strategies.length === 0) {
      return prompt;
    }
    const strategyLines = strategies.map((s) => `- [${s.ruleType}] ${s.ruleText}`);
    return `${prompt}

## Estrategias del CEO
Las siguientes son estrategias definidas por el dueño. DEBÉS seguirlas en cada recomendación:
${strategyLines.join("\n")}`;
  }

  let _blockB: string | null = null;
  let _blockBFetchedAt = 0;
  const DAILY_TTL_MS = 24 * 60 * 60 * 1000;

  async function refreshBlockB(): Promise<string> {
    const now = Date.now();
    if (_blockB !== null && now - _blockBFetchedAt < DAILY_TTL_MS) return _blockB;
    try {
      if (config.operationalReader && config.sellerId) {
        const ds = await OperationalDailyDataSource.create(config.operationalReader, config.sellerId);
        _blockB = buildDailyAggregates(ds);
      } else {
        _blockB = buildDailyAggregates();
      }
    } catch {
      _blockB = buildDailyAggregates();
    }
    _blockBFetchedAt = now;
    return _blockB;
  }

  function appendBlockCSection(blockC: string, section: string): string {
    if (!section) return blockC;
    return blockC ? `${blockC}\n\n${section}` : section;
  }

  async function buildBlockCContext(
    config: AgentLoopConfig,
    state: ConversationState,
    userMessage: string,
  ): Promise<string> {
    let blockC = "";
    if (config.engine) {
      blockC = injectCortexContext(userMessage, config.engine);
    }
    if (config.evidenceProvider && config.laneId) {
      const operationalEvidence = await config.evidenceProvider.getEvidenceForLane(
        config.laneId,
        state.sessionMetadata.sellerId,
      );
      if (operationalEvidence) {
        blockC = appendBlockCSection(blockC, `## Evidencia operacional\n\n${operationalEvidence}`);
      }
    }
    blockC = appendBlockCSection(
      blockC,
      buildWorkforceCostCacheContext(
        config.workforceCostCacheLedgerStore,
        config.workforceBudgetWarningThresholdMicros,
      ),
    );
    blockC = appendBlockCSection(
      blockC,
      buildWorkforceSkillContext(config.companyAgentSkillStore, config.activeCompanyAgentId),
    );
    return appendBlockCSection(
      blockC,
      buildWorkforceLessonContext(
        config.companyAgentLearningStore,
        config.activeCompanyAgentId,
        config.companyAgentRegistry,
      ),
    );
  }

  return {
    async converse(userMessage: string, state: ConversationState): Promise<ConverseResult> {
      const turnStart = Date.now();
      const metrics = config.metrics;

      const spanishCheck = spanishValidator(userMessage);
      if (!spanishCheck.passed) {
        metrics?.record("guardrail.block", 1, { reason: "spanish" });
        return blockAndRespond(state, userMessage, spanishCheck.reason);
      }

      const harmfulCheck = harmfulContentFilter(userMessage);
      if (!harmfulCheck.passed) {
        metrics?.record("guardrail.block", 1, { reason: "harmful" });
        return blockAndRespond(state, userMessage, harmfulCheck.reason);
      }

      let degradationMsg: string | null = null;
      if (config.autonomyEngine) {
        const deg = config.autonomyEngine.evaluateDegradation();
        if (deg) {
          metrics?.record("autonomy.degradation", 1, {
            from: String(deg.from),
            to: String(deg.to),
          });
          degradationMsg =
            `⚠️ Tu nivel de autonomía bajó de ${AutonomyLevel[deg.from]} (${deg.from}) ` +
            `a ${AutonomyLevel[deg.to]} (${deg.to}). Motivo: ${deg.reason}`;
        }
      }

      if (config.store) {
        const strategyIntent = detectStrategyIntent(userMessage);
        if (strategyIntent.intent !== "none") {
          return handleStrategyCommand(strategyIntent, config.store, state, userMessage);
        }
      }

      const blockB = await refreshBlockB();
      const sysPrompt = degradationMsg
        ? `${getSystemPrompt()}\n\n${degradationMsg}`
        : getSystemPrompt();
      const systemPrompt = `${sysPrompt}\n\n${blockB}`;

      const blockC = await buildBlockCContext(config, state, userMessage);

      const llmMessages = buildMessages(systemPrompt, state, userMessage, blockC);

      let llmResponse = await client.chat(llmMessages);
      recordLlmUsage(llmResponse);

      while (
        llmResponse.toolCalls &&
        llmResponse.toolCalls.some((tc) => tc.name !== "prepare_action")
      ) {
        const toolResults = await Promise.all(
          llmResponse.toolCalls.map(async (tc) => {
            if (tc.name === "prepare_action") return null;

            const tool = toolMap.get(tc.name);
            if (!tool) return null;

            if (
              (tc.name === "sync_product" || tc.name === "sync_all") &&
              getActiveStrategies().length === 0
            ) {
              return {
                content: JSON.stringify({
                  error:
                    "No hay estrategias de CEO activas. " +
                    "Definí al menos una estrategia (margen, filtro de categoría, stock o regla de precio) " +
                    "antes de sincronizar productos. Ej: 'cambiá margen mínimo a 50%'.",
                }),
              };
            }

            if (tc.name === "sync_product" || tc.name === "sync_all") {
              metrics?.record("sync.product", 1, { tool: tc.name });
            }
            metrics?.record("tool.call", 1, { name: tc.name });

            try {
              const result = await tool.execute(tc.arguments);
              recordReturnedToolIssue(metrics, tc.name, result);
              if (config.escribano) {
                void config.escribano.observeToolResult(tc.name, result);
              }
              return { content: JSON.stringify(result) };
            } catch {
              metrics?.record("tool.call", 1, { name: tc.name, status: "error" });
              return {
                content: JSON.stringify({
                  error: `Tool execution failed for ${tc.name}`,
                }),
              };
            }
          }),
        );

        for (const result of toolResults) {
          if (!result) continue;
          llmMessages.push({
            role: "tool",
            content: result.content,
          });
        }

        llmResponse = await client.chat(llmMessages);
        recordLlmUsage(llmResponse);
      }

      let responseText = llmResponse.content;
      let proposal: AgentProposal | undefined;

      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        const toolCall = llmResponse.toolCalls[0]!;
        if (toolCall.name === "prepare_action") {
          proposal = parseProposalFromToolCall(toolCall.arguments);
        }
      }

      if (proposal && !isConfirmation(userMessage) && config.autonomyEngine) {
        const gateResult = autonomyGate({ riskLevel: proposal.riskLevel }, config.autonomyEngine);

        if (!gateResult.reason) {
          const level = config.autonomyEngine.getCurrentLevel();
          const levelName = AutonomyLevel[level] ?? "DESCONOCIDO";

          config.autonomyEngine.recordKpi({
            level,
            marginCompliance: 1,
            successRate: 1,
            safetyViolations: 0,
            responseAccuracy: 0,
            timestamp: new Date().toISOString(),
          });

          const updatedState = appendMessages(state, userMessage, responseText);
          return {
            response:
              `${responseText}\n\n` +
              `✅ Acción auto-aprobada (nivel ${levelName}, sin "dale"). ` +
              `Audit registrado.`,
            updatedState,
            proposal,
          };
        }
      }

      if (isConfirmation(userMessage)) {
        const pendingProposal = extractPendingProposal(state.messages);
        if (pendingProposal) {
          proposal = pendingProposal;
          responseText = buildPhaseOneNoMutationResponse(pendingProposal.naturalSummary);
        }
      }

      if (proposal) {
        const strategyCheck = strategyValidator(proposal, getActiveStrategies());
        if (!strategyCheck.passed) {
          return blockAndRespond(state, userMessage, strategyCheck.reason);
        }

        if (
          (proposal.action.kind === "honey-pot-deploy" ||
            proposal.action.kind === "probe-analysis") &&
          pendingDecoyProposal
        ) {
          const honeyPotCheck = honeyPotValidator(pendingDecoyProposal, getActiveStrategies());
          if (!honeyPotCheck.passed) {
            return blockAndRespond(state, userMessage, honeyPotCheck.reason);
          }

          if (isConfirmation(userMessage)) {
            pendingDecoyProposal = null;
          }
        }

        {
          const currentLevel = config.autonomyEngine
            ? (AutonomyLevel[config.autonomyEngine.getCurrentLevel()] ?? "SUGIERE")
            : "SUGIERE";
          const verifyResult = selfVerify(proposal, getActiveStrategies(), {
            sellerId: state.sessionMetadata.sellerId,
            currentLevel,
          });

          if (!verifyResult.passed) {
            const blockingReasons = verifyResult.checks
              .filter((c) => c.severity === "blocking" && !c.passed)
              .map((c) => `- ${c.name}: ${c.detail}`)
              .join("\n");
            return blockAndRespond(
              state,
              userMessage,
              `Verificación de confianza calibrada falló:\n${blockingReasons}`,
            );
          }

          if (verifyResult.requiresHumanReview) {
            const warnings = verifyResult.checks
              .filter((c) => c.severity === "warning" && !c.passed)
              .map((c) => `- ${c.name}: ${c.detail}`)
              .join("\n");
            responseText = `⚠️ Requiere tu revisión\n\n${warnings}\n\n---\n\n${responseText}`;
          }
        }

        if (proposal && config.consensusStore && !isConfirmation(userMessage)) {
          const consensusContext = buildConsensusContext(proposal, config.consensusStore);
          if (consensusContext) {
            responseText = `${responseText}\n\n${consensusContext}`;
          }
        }

        if (isConfirmation(userMessage) && config.autonomyEngine) {
          config.autonomyEngine.recordKpi({
            level: config.autonomyEngine.getCurrentLevel(),
            marginCompliance: 1,
            successRate: 1,
            safetyViolations: 0,
            responseAccuracy: 0,
            timestamp: new Date().toISOString(),
          });
        }
      }

      const updatedState = appendMessages(state, userMessage, responseText);

      if (config.escribano && config.engine) {
        const outcome = resolveTurnOutcome(userMessage, proposal, responseText, state);
        config.escribano.observeTurn(state, updatedState, responseText, proposal, outcome);
        metrics?.record("escribano.observation", 1, { outcome });
      }

      if (config.autonomyEngine && !proposal) {
        const promotion = config.autonomyEngine.evaluatePromotion();
        if (promotion.recommend) {
          config.autonomyEngine.setLevel(promotion.to, "KPI thresholds met — auto-promotion");
          metrics?.record("autonomy.promotion", 1, { from: String(promotion.to - 1), to: String(promotion.to) });
        }
      }

      const durationMs = Date.now() - turnStart;
      metrics?.record("conversation.turn", 1);
      metrics?.record("conversation.duration_ms", durationMs);

      return {
        response: responseText,
        updatedState,
        ...(proposal !== undefined ? { proposal } : {}),
      };
    },

    async *converseStream(
      userMessage: string,
      state: ConversationState,
    ): AsyncIterable<StreamingChunk> {
      const spanishCheck = spanishValidator(userMessage);
      if (!spanishCheck.passed) {
        yield { delta: `⛔ ${spanishCheck.reason}`, done: true };
        return;
      }

      const harmfulCheck = harmfulContentFilter(userMessage);
      if (!harmfulCheck.passed) {
        yield { delta: `⛔ ${harmfulCheck.reason}`, done: true };
        return;
      }

      let degradationMsg: string | null = null;
      if (config.autonomyEngine) {
        const deg = config.autonomyEngine.evaluateDegradation();
        if (deg) {
          degradationMsg =
            `⚠️ Tu nivel de autonomía bajó de ${AutonomyLevel[deg.from]} (${deg.from}) ` +
            `a ${AutonomyLevel[deg.to]} (${deg.to}). Motivo: ${deg.reason}`;
        }
      }

      const blockB = await refreshBlockB();
      const sysPrompt = degradationMsg
        ? `${getSystemPrompt()}\n\n${degradationMsg}`
        : getSystemPrompt();
      const systemPrompt = `${sysPrompt}\n\n${blockB}`;

      const blockC = await buildBlockCContext(config, state, userMessage);

      const llmMessages = buildMessages(systemPrompt, state, userMessage, blockC);

      for await (const chunk of client.stream(llmMessages)) {
        yield chunk;
      }
    },

    updateStrategy(text: string) {
      const parsed = parseStrategy(text);
      const newStrategies: Strategy[] = parsed.rules.map((rule, i) => ({
        id: -(i + 1),
        ruleType: rule.ruleType,
        ruleText: rule.originalText,
        parsedRule: rule,
        confidence: parsed.confidence,
        status: "active" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      activeStrategies = [...activeStrategies, ...newStrategies];
      return parsed;
    },
    getToolNames(): string[] {
      return Array.from(toolMap.keys());
    },
  };
}

// ---------------------------------------------------------------------------
// Strategy CRUD intent routing
// ---------------------------------------------------------------------------

type StrategyIntent =
  | { intent: "list" }
  | { intent: "update"; ruleType: RuleType; newValue: string }
  | { intent: "archive"; ruleType: RuleType }
  | { intent: "none" };

function detectStrategyIntent(userMessage: string): StrategyIntent {
  const lower = userMessage.toLowerCase().trim();

  if (
    /(?:list[aá]|mostr[aá]|ver)\s+(?:mis\s+)?(?:estrategias?|reglas?)/i.test(lower) ||
    /(?:estrategias?|reglas?)\s+(?:activas|qu[ée]\s+(?:tengo|hay))/i.test(lower) ||
    /qu[ée]\s+(?:estrategias?|reglas?)\s+(?:tengo|hay|est[aá]n\s+activas)/i.test(lower)
  ) {
    return { intent: "list" };
  }

  if (
    /(?:dej[aá]|elimin[aá]|sac[aá]|quit[aá]|borr[aá]|archiv[aá]|no\s+(?:quiero|necesito|uso)\s+m[aá]s)(?:\s|$|[.,!?])/i.test(
      lower,
    ) &&
    /estrategia|regla|prioriz|stock|margen|precio|categor/i.test(lower)
  ) {
    const ruleType = extractRuleTypeFromMessage(lower);
    if (ruleType) return { intent: "archive", ruleType };
  }

  if (
    /(?:cambi[aá]|actualiz[aá]|modific[aá]|sub[ií]|baj[aá]|aument[aá]|reduc[ií])(?:\s|$|[.,!?])/i.test(
      lower,
    ) &&
    /margen|stock|precio|estrategia|regla|categor/i.test(lower)
  ) {
    const ruleType = extractRuleTypeFromMessage(lower);
    if (ruleType) return { intent: "update", ruleType, newValue: userMessage };
  }

  return { intent: "none" };
}

function extractRuleTypeFromMessage(lower: string): RuleType | undefined {
  if (/\bmargen\b/i.test(lower)) return "margin";
  if (/\bstock\b|\bunidad\b|\binventario\b/i.test(lower)) return "stock";
  if (/\bcategor(?:[íi]a|ia)\b|\bcompetir\b|\benfoc(?:ar|ate|arse)\b|\bjuguetes\b/i.test(lower))
    return "category";
  if (/\bprecio\b/i.test(lower)) return "pricing";
  if (/\bcliente\b|\bresponder\b|\bcontestar\b/i.test(lower)) return "customer";
  if (/\bcompetencia\b|\bigualar\b/i.test(lower)) return "competitive";
  if (/\bprioridad\b|\bprioriz/i.test(lower)) return "priority";
  return undefined;
}

function handleStrategyCommand(
  intent: StrategyIntent,
  store: StrategyStore,
  state: ConversationState,
  userMessage: string,
): ConverseResult {
  if (intent.intent === "list") {
    const strategies = store.listActive();

    if (strategies.length === 0) {
      const response =
        "No tenés estrategias activas en este momento. " +
        "¿Querés que te ayude a crear una? Podés decirme algo como " +
        '"margen mínimo 50%" o "priorizar +10 stock en electrónica".';
      return {
        response,
        updatedState: appendMessages(state, userMessage, response),
      };
    }

    const lines = strategies.map((s) => `- [${s.ruleType}] ${s.ruleText}`);
    const response =
      `Acá están tus estrategias activas:\n\n${lines.join("\n")}\n\n` +
      "¿Querés modificar o eliminar alguna?";
    return {
      response,
      updatedState: appendMessages(state, userMessage, response),
    };
  }

  if (intent.intent === "update") {
    const parsed = parseStrategy(intent.newValue);

    if (parsed.rules.length === 0) {
      const response =
        "No pude interpretar la nueva estrategia. ¿Podrías ser más " +
        'específico? Por ejemplo: "cambiá margen mínimo a 45%".';
      return {
        response,
        updatedState: appendMessages(state, userMessage, response),
      };
    }

    const rule = { ...parsed.rules[0]!, ruleType: intent.ruleType };
    const active = store.listActive();
    const existing = active.find((s) => s.ruleType === intent.ruleType);

    if (!existing) {
      const created = store.insertStrategy(intent.newValue, rule, parsed.confidence);
      const response = `✅ Creé la nueva estrategia [${created.ruleType}] "${created.ruleText}".`;
      return {
        response,
        updatedState: appendMessages(state, userMessage, response),
      };
    }

    const created = store.insertStrategy(intent.newValue, rule, parsed.confidence);
    store.supersedeStrategy(existing.id, created.id);

    const response =
      `✅ Actualicé la estrategia de ${intent.ruleType}: ` +
      `"${existing.ruleText}" → "${created.ruleText}".`;
    return {
      response,
      updatedState: appendMessages(state, userMessage, response),
    };
  }

  if (intent.intent === "archive") {
    const active = store.listActive();
    const target = active.find((s) => s.ruleType === intent.ruleType);

    if (!target) {
      const response =
        `No encontré ninguna estrategia activa de tipo "${intent.ruleType}". ` +
        "¿Querés que revise las estrategias que tenés?";
      return {
        response,
        updatedState: appendMessages(state, userMessage, response),
      };
    }

    store.archiveStrategy(target.id);
    const response =
      `✅ Archivé la estrategia [${target.ruleType}] "${target.ruleText}". ` +
      "Ya no se aplicará en las recomendaciones.";
    return {
      response,
      updatedState: appendMessages(state, userMessage, response),
    };
  }

  const fallback = "No entendí bien. ¿Querés listar, modificar o eliminar estrategias?";
  return {
    response: fallback,
    updatedState: appendMessages(state, userMessage, fallback),
  };
}

// ---------------------------------------------------------------------------
// DeepSeek client (real) via OpenAI SDK
// ---------------------------------------------------------------------------

function createRealClient(
  openai: OpenAI,
  model: string,
  toolMap: Map<string, ToolDefinition>,
  userId?: string,
  sellerId?: string,
): LlmClient {
  const openAiTools = createOpenAiToolDefinitions(toolMap.values());

  return {
    async chat(messages) {
      const request = buildDeepSeekChatCompletionRequest({
        model,
        messages,
        ...(openAiTools.length > 0 ? { tools: openAiTools, tool_choice: "auto" as const } : {}),
        stream: false,
        ...(userId ? { userId } : {}),
        ...(sellerId ? { user: sellerId } : {}),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      const completion = await openai.chat.completions.create(request as any);

      const choice = completion.choices[0];
      const toolCalls = choice?.message?.tool_calls?.map((tc) => {
        const name = "function" in tc ? tc.function.name : "";
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const args = "function" in tc ? JSON.parse(tc.function.arguments) : {};
        return { name, arguments: args as Record<string, unknown> };
      });

      const result: {
        content: string;
        toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
        usage?: LlmUsageMetadata;
      } = {
        content: choice?.message?.content ?? "",
      };
      if (toolCalls) {
        result.toolCalls = toolCalls;
      }
      if (completion.usage) {
        result.usage = {
          provider: "deepseek",
          model,
          usage: completion.usage as unknown as Record<string, unknown>,
        };
      }
      return result;
    },

    async *stream(messages) {
      const request = buildDeepSeekChatCompletionRequest({
        model,
        messages,
        ...(openAiTools.length > 0 ? { tools: openAiTools, tool_choice: "auto" as const } : {}),
        stream: true,
        ...(userId ? { userId } : {}),
        ...(sellerId ? { user: sellerId } : {}),
      });
      const stream = (await openai.chat.completions.create(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        request as any,
      )) as unknown as AsyncIterable<{ choices?: Array<{ delta?: { content?: string | null } }> }>;

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          yield { delta, done: false };
        }
      }
      yield { delta: "", done: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock LLM client
// ---------------------------------------------------------------------------

function createMockClient(toolMap?: Map<string, ToolDefinition>): LlmClient {
  const chat = (messages: Array<{ role: string; content: string }>) => mockChat(messages, toolMap);

  return {
    chat,
    async *stream(messages) {
      const response = await chat(messages);
      yield { delta: response.content, done: false };
      yield { delta: "", done: true };
    },
  };
}

function mockChat(
  messages: Array<{ role: string; content: string }>,
  toolMap?: Map<string, ToolDefinition>,
): Promise<{
  content: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}> {
  const userMsgs = messages.filter((m) => m.role === "user");
  const lastUser = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1]!.content.toLowerCase() : "";

  if (toolMap?.has("simulate_actor")) {
    const toolMsgs = messages.filter((m) => m.role === "tool");
    if (toolMsgs.length > 0) {
      const lastTool = toolMsgs[toolMsgs.length - 1]!;
      let simResult: Record<string, unknown> = {};
      try {
        simResult = JSON.parse(lastTool.content) as Record<string, unknown>;
      } catch {
        /* malformed JSON — fall through */
      }
      const actorType = typeof simResult.actorType === "string" ? simResult.actorType : "actor";
      const recommendation =
        typeof simResult.recommendation === "string"
          ? simResult.recommendation
          : "simulación completada";
      const rationale = typeof simResult.rationale === "string" ? simResult.rationale : "";
      return Promise.resolve({
        content:
          `Consulté la simulación del ${actorType} y esto fue lo que encontré:\n\n` +
          `"${recommendation}"\n\n` +
          `Basado en esto, te recomiendo evaluar esta perspectiva antes de tomar ` +
          `una decisión.${rationale ? ` El análisis sugiere: ${rationale}` : ""}`,
      });
    }

    if (
      /\b(?:competidor|comprador|proveedor|competencia|cliente\s+(?:t[ií]pico|chileno)?)\b/i.test(
        lastUser,
      )
    ) {
      const actorType = /\bcompetidor\b|\bcompetencia\b/i.test(lastUser)
        ? "competidor"
        : /\bcomprador\b|\bcliente\b/i.test(lastUser)
          ? "comprador"
          : "proveedor";
      return Promise.resolve({
        content: "",
        toolCalls: [{ name: "simulate_actor", arguments: { actorType, query: lastUser } }],
      });
    }
  }

  if (toolMap?.has("detect_probes")) {
    const toolMsgs = messages.filter((m) => m.role === "tool");
    const lastTool = toolMsgs[toolMsgs.length - 1];
    if (lastTool) {
      let result: Record<string, unknown> = {};
      try {
        result = JSON.parse(lastTool.content) as Record<string, unknown>;
      } catch {
        /* fall through */
      }

      if (
        toolMap.has("propose_honey_pot") &&
        Array.isArray(result.alerts) &&
        (result.alerts as unknown[]).length > 0
      ) {
        return Promise.resolve({
          content: "",
          toolCalls: [
            {
              name: "propose_honey_pot",
              arguments: { strategyId: -1 },
            },
          ],
        });
      }
    }

    const hasProbeResult = toolMsgs.some((m) => {
      try {
        const parsed = JSON.parse(m.content) as Record<string, unknown>;
        return (
          "alerts" in parsed || (typeof parsed.id === "string" && parsed.id.startsWith("decoy-"))
        );
      } catch {
        return false;
      }
    });

    if (!hasProbeResult) {
      if (
        /\b(?:contrainteligencia|sonde[ao]|sondeando|espiando|vigilando|probando|monitoreando)\b/i.test(
          lastUser,
        )
      ) {
        return Promise.resolve({
          content: "",
          toolCalls: [
            {
              name: "detect_probes",
              arguments: {
                questions: [
                  {
                    text: "¿Cuál es tu precio en electrónica? ¿Y tu margen?",
                    from: "TiendaX",
                    date: "2026-06-26",
                  },
                  {
                    text: "¿Hacés descuento por volumen? ¿Cuánto margen manejás?",
                    from: "TiendaX",
                    date: "2026-06-26",
                  },
                ],
              },
            },
          ],
        });
      }
    }
  }

  if (toolMap?.has("propose_honey_pot")) {
    const toolMsgs = messages.filter((m) => m.role === "tool");
    const lastTool = toolMsgs[toolMsgs.length - 1];
    if (lastTool) {
      let result: Record<string, unknown> = {};
      try {
        result = JSON.parse(lastTool.content) as Record<string, unknown>;
      } catch {
        /* fall through */
      }

      if (typeof result.id === "string" && result.id.startsWith("decoy-")) {
        const proposal = result as unknown as {
          id: string;
          type: string;
          description: string;
          riskLevel: string;
          tosWarning: string;
        };

        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
        const alreadyShown = lastAssistant?.content.includes(proposal.id);

        const isConfirmMsg =
          /^dale\b|^s[iíí]\b|^ok\b|^confirmo\b|^confirmar\b|^ejecut[áa]\b|^ejecutar\b/i.test(
            lastUser,
          );

        if (alreadyShown && isConfirmMsg) {
          return Promise.resolve({
            content:
              "¡Perfecto! La operación de contrainteligencia fue " +
              "confirmada y quedó registrada en Cortex. " +
              "Se ejecutará en los próximos minutos. ¿Necesitás algo más?",
          });
        }

        return Promise.resolve({
          content:
            `Generé una propuesta de contrainteligencia:\n\n` +
            `**ID**: ${proposal.id}\n` +
            `**Tipo**: ${proposal.type}\n` +
            `**Descripción**: ${proposal.description}\n` +
            `**Riesgo**: ${proposal.riskLevel}\n\n` +
            `${proposal.tosWarning}\n\n` +
            `¿Querés que la ejecute? Confirmá con "dale".`,
        });
      }
      if (typeof result.error === "string") {
        return Promise.resolve({
          content: `⛔ ${result.error}`,
        });
      }
    }
  }

  if (/\b(?:ceo|socio|deleg|investig|stock|campaña|catalogo|catálogo)\b/i.test(lastUser)) {
    return Promise.resolve({ content: buildCeoDelegationProposal() });
  }

  if (/precio|margen/.test(lastUser)) {
    return Promise.resolve({
      content:
        "Analicé tus márgenes actuales. El margen promedio de la tienda " +
        "es 32.4%. En la categoría Hogar y Muebles, los márgenes están entre " +
        "28% y 38%. Veo 89 listings con precio por encima del promedio de " +
        "categoría que podrían estar perdiendo visibilidad. ¿Querés que te " +
        "prepare una propuesta de ajuste de precios para esos listings?",
    });
  }

  if (/reclamo|reputación/.test(lastUser)) {
    return Promise.resolve({
      content:
        "Revisé tu situación actual de reclamos. Tenés 3 reclamos abiertos: " +
        "1 en mediación y 2 esperando tu respuesta. Tu tasa de reclamos es " +
        "0.4%, muy por debajo del promedio de categoría (1.2%), así que tu " +
        "reputación está bien protegida. Te recomiendo priorizar los 2 reclamos " +
        "en espera — si no respondés en 24h, pueden escalar a mediación. " +
        "¿Querés que te ayude a redactar las respuestas?",
    });
  }

  if (/dale|sí\b|sí,|ok\b|confirmo|confirmar|ejecutá|ejecutar/i.test(lastUser)) {
    return Promise.resolve({
      content:
        "Listo: lo tomo como aprobación para investigar o preparar dentro del alcance. " +
        "No ejecuté ninguna mutación externa ni productiva. noMutationExecuted: true",
    });
  }

  return Promise.resolve({
    content:
      "Entendido. Para poder ayudarte mejor, ¿podrías contarme un poco más? " +
      "Por ejemplo: ¿querés revisar ventas, márgenes, reputación, reclamos, " +
      "o prioridades del día? También puedo prepararte una acción concreta " +
      "si ya tenés claro qué necesitás.",
  });
}

// ---------------------------------------------------------------------------
// Noop client
// ---------------------------------------------------------------------------

function createNoopClient(): LlmClient {
  const noopMessage = "Lo siento, el servicio de IA no está disponible en este momento.";
  return {
    chat(): Promise<{ content: string }> {
      return Promise.resolve({ content: noopMessage });
    },
    async *stream() {
      await Promise.resolve();
      yield { delta: noopMessage, done: false };
      yield { delta: "", done: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recordReturnedToolIssue(
  metrics: MetricsCollector | undefined,
  toolName: string,
  result: unknown,
): void {
  if (!metrics || !isRecord(result)) return;

  if ("error" in result && result.error !== undefined && result.error !== null) {
    metrics.record("tool.call", 1, { name: toolName, status: "error" });
    return;
  }

  if (Array.isArray(result.partialErrors) && result.partialErrors.length > 0) {
    metrics.record("tool.call", 1, { name: toolName, status: "partial" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNumericCounter(
  usage: Record<string, unknown> | null | undefined,
  key: "prompt_cache_hit_tokens" | "prompt_cache_miss_tokens",
): number | null {
  const value = usage?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNonNegativeInteger(usage: Record<string, unknown>, key: string): number | undefined {
  const value = usage[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readCachedPromptTokens(usage: Record<string, unknown>): number | undefined {
  const details = usage.prompt_tokens_details;
  if (!isRecord(details)) return undefined;
  const cachedTokens = details.cached_tokens;
  return typeof cachedTokens === "number" && Number.isInteger(cachedTokens) && cachedTokens >= 0
    ? cachedTokens
    : undefined;
}

function deriveCacheStatus(input: {
  promptCacheHitTokens: number | undefined;
  promptCacheMissTokens: number | undefined;
}): "hit" | "miss" | "partial" | "unknown" {
  const hitTokens = input.promptCacheHitTokens ?? 0;
  const missTokens = input.promptCacheMissTokens ?? 0;
  const hasHit = hitTokens > 0;
  const hasMiss = missTokens > 0;

  if (hasHit && hasMiss) return "partial";
  if (hasHit) return "hit";
  if (hasMiss) return "miss";
  return "unknown";
}

function extractLedgerTokenUsage(usage: Record<string, unknown>): {
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheStatus: "hit" | "miss" | "partial" | "unknown";
} {
  const inputTokens = readNonNegativeInteger(usage, "prompt_tokens");
  const outputTokens = readNonNegativeInteger(usage, "completion_tokens");
  let promptCacheHitTokens = readNonNegativeInteger(usage, "prompt_cache_hit_tokens");
  let promptCacheMissTokens = readNonNegativeInteger(usage, "prompt_cache_miss_tokens");

  if (promptCacheHitTokens === undefined && promptCacheMissTokens === undefined) {
    const cachedTokens = readCachedPromptTokens(usage);
    if (cachedTokens !== undefined) {
      promptCacheHitTokens = cachedTokens;
      if (inputTokens !== undefined && inputTokens >= cachedTokens) {
        promptCacheMissTokens = inputTokens - cachedTokens;
      }
    }
  }

  return {
    ...(promptCacheHitTokens !== undefined ? { promptCacheHitTokens } : {}),
    ...(promptCacheMissTokens !== undefined ? { promptCacheMissTokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    cacheStatus: deriveCacheStatus({ promptCacheHitTokens, promptCacheMissTokens }),
  };
}

function buildPhaseOneNoMutationResponse(summary: string): string {
  return (
    "Listo: tomo ese 'dale' como aprobación para investigación/preparación acotada, no como ejecución.\n\n" +
    `Propuesta: ${summary}\n` +
    "Límite Phase 1: no publiqué, no modifiqué MercadoLibre, no cobré pagos, no contacté SII y no envié mensajes a clientes.\n" +
    "noMutationExecuted: true"
  );
}

function buildCeoDelegationProposal(): string {
  const outputs: LaneOutput[] = [
    {
      laneId: "cost-supplier",
      recommendation:
        "Necesito costo, proveedor y margen objetivo antes de confirmar rentabilidad.",
      missingInputs: ["costo", "proveedor", "margen objetivo"],
      risks: ["No confirmar profit sin evidencia de costo."],
      evidenceIds: ["cost:pending"],
      freshness: "unknown",
      cacheTelemetry: extractPromptCacheTelemetry({
        provider: "deepseek",
        model: "deepseek-v4-flash",
        laneId: "cost-supplier",
        usage: null,
        measuredAt: "unavailable",
      }),
      boundaryWarnings: ["Investigación solamente; sin mutaciones productivas."],
    },
    {
      laneId: "market-catalog",
      recommendation: "Priorizar stock bajo y listings con oportunidad de visibilidad.",
      missingInputs: [],
      risks: ["La evidencia local puede estar parcial o desactualizada."],
      evidenceIds: ["catalog:local-snapshot", "stock:critical-items"],
      freshness: "partial",
      boundaryWarnings: ["Usar evidencia local antes de leer remoto."],
    },
    {
      laneId: "creative-commercial",
      recommendation: "Preparar borrador comercial, sin publicar ni enviar campañas.",
      missingInputs: [],
      risks: ["Validar margen antes de prometer descuento."],
      evidenceIds: ["creative:draft-only"],
      freshness: "unknown",
      boundaryWarnings: ["Draft only; never publish in Phase 1."],
    },
  ];
  const evidenceIds = [...new Set(outputs.flatMap((output) => output.evidenceIds))];
  const risks = [...new Set(outputs.flatMap((output) => output.risks))];

  return (
    "Como CEO/Socio, preparé una propuesta combinada con las lanes especialistas.\n\n" +
    "Recomendación: avanzar con una investigación acotada de margen, stock y campaña antes de ejecutar cualquier cambio.\n" +
    "Rationale: Market/Catalog ve oportunidades, Creative puede preparar borradores, y Cost/Supplier requiere datos de costo/proveedor antes de confirmar rentabilidad.\n" +
    `Riesgos: ${risks.join("; ")}\n` +
    `Evidence IDs: ${evidenceIds.join(", ")}\n` +
    "No ejecuté mutaciones externas: no publiqué, no modifiqué MercadoLibre, no cobré pagos, no contacté SII y no envié mensajes a clientes.\n" +
    "noMutationExecuted: true"
  );
}

function isConfirmation(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return /^(dale|s[iíí]|ok|confirmo|confirmar|ejecut[áa]|ejecutar)\b/.test(trimmed);
}

function extractPendingProposal(messages: ConversationMessage[]): AgentProposal | undefined {
  const recent = messages.slice(-5);
  for (const msg of recent) {
    if (msg.role === "assistant") {
      if (msg.content.includes("propuesta de ajuste")) {
        return {
          action: {
            id: "prop-pending",
            sellerId: "seller-1",
            kind: "price-change",
            target: { type: "listing", listingId: "MLC-42" },
            exactChange: [{ field: "price", from: 15000, to: 13500 }],
            rationale: "Ajuste recomendado por análisis de margen.",
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          naturalSummary: "¿Bajo el precio del listing MLC-42 en 10%?",
          riskLevel: "medium",
        };
      }
      if (msg.content.includes("contrainteligencia") || msg.content.includes("decoy-")) {
        return {
          action: {
            id: "decoy-pending",
            sellerId: "seller-1",
            kind: "honey-pot-deploy",
            target: { type: "listing", listingId: "decoy-listing" },
            exactChange: [{ field: "status", from: "draft", to: "active" }],
            rationale: "Operación de contrainteligencia aprobada por el CEO.",
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          naturalSummary: "¿Ejecuto la operación de contrainteligencia?",
          riskLevel: "high",
        };
      }
    }
  }
  return undefined;
}

function parseProposalFromToolCall(args: Record<string, unknown>): AgentProposal {
  const kind = ((args.kind as string) ?? "price-change") as AgentProposal["action"]["kind"];
  const targetType = (args.targetType as string) ?? "listing";
  const targetId = (args.targetId as string) ?? "";

  const target: AgentProposal["action"]["target"] =
    targetType === "listing"
      ? { type: "listing", listingId: targetId }
      : targetType === "order"
        ? { type: "order", orderId: targetId }
        : targetType === "message"
          ? { type: "message", threadId: targetId }
          : { type: "creative-asset", assetId: targetId };

  return {
    action: {
      id: (args.id as string) ?? "",
      sellerId: (args.sellerId as string) ?? "",
      kind,
      target,
      exactChange: [
        {
          field: (args.field as string) ?? "",
          from: (args.fromValue as string | number | boolean | null) ?? null,
          to: (args.toValue as string | number | boolean | null) ?? null,
        },
      ],
      rationale: (args.rationale as string) ?? "",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    naturalSummary: (args.summary as string) ?? "",
    riskLevel: "medium",
  };
}

function enforceContextWindow(
  messages: ConversationMessage[],
  limit: number,
): ConversationMessage[] {
  if (messages.length <= limit) {
    return messages;
  }

  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");

  const overflow = otherMessages.length - (limit - systemMessages.length);
  if (overflow <= 0) {
    return messages;
  }

  const keptOther = otherMessages.slice(overflow);
  return [...systemMessages, ...keptOther];
}

function appendMessages(
  state: ConversationState,
  userMessage: string,
  responseText: string,
): ConversationState {
  const now = new Date();
  const newMessages: ConversationMessage[] = [
    ...state.messages,
    {
      role: "user",
      content: userMessage,
      timestamp: now,
    },
    {
      role: "assistant",
      content: responseText,
      timestamp: now,
    },
  ];

  const trimmedMessages = enforceContextWindow(newMessages, state.contextWindowLimit);

  return {
    messages: trimmedMessages,
    contextWindowLimit: state.contextWindowLimit,
    sessionMetadata: {
      ...state.sessionMetadata,
      lastActivityAt: now,
    },
  };
}

function blockAndRespond(
  state: ConversationState,
  _userMessage: string,
  reason: string | undefined,
): ConverseResult {
  const now = new Date();
  const responseText = reason ? `⛔ ${reason}` : "⛔ Mensaje bloqueado por razones de seguridad.";

  return {
    response: responseText,
    updatedState: {
      ...state,
      messages: [
        ...state.messages,
        {
          role: "user",
          content: "[mensaje bloqueado]",
          timestamp: now,
        },
        {
          role: "assistant",
          content: responseText,
          timestamp: now,
        },
      ],
      sessionMetadata: {
        ...state.sessionMetadata,
        lastActivityAt: now,
      },
    },
  };
}
