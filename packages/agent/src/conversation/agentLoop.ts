import OpenAI from "openai";
import type { GraphEngine } from "@msl/memory";
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
import { selfVerify } from "./selfVerify.js";
import { parseStrategy } from "./strategyParser.js";
import type { ToolDefinition } from "./tools.js";
import {
  createDelegateToSubagentTool,
  createDetectProbesTool,
  createCreateCompanyAgentTool,
  createGetBusinessContextTool,
  createListCompanyAgentsTool,
  createProposeHoneyPotTool,
  createRequestAgentEvidenceTool,
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
import { injectCortexContext } from "./cacheBlocks.js";
import type { CompanyAgentRegistry } from "./companyAgents.js";

// ── Token budget (bottleneck 2.4) ──────────────────────────────────────

/** Coarse token estimator: character count / 4.
 *  DeepSeek tokens average ~4 characters per token for Spanish text. */
export function estimateTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0;
  for (const msg of messages) {
    total += Math.ceil(msg.content.length / 4);
  }
  return total;
}

/** Maximum tokens before truncation kicks in (800K tokens).
 *  DeepSeek claims 1M context; we leave headroom for the response. */
const MAX_TOKEN_BUDGET = 800_000;

// ── Strategy Store Interface ─────────────────────────────────────────

/**
 * Minimal interface for the strategy persistence layer consumed by the
 * agent loop's conversation intent routing.
 *
 * Matches the subset of {@link createStrategyStore} methods needed for
 * list/update/archive operations from natural conversation.
 */
export type StrategyStore = {
  listActive(): Strategy[];
  insertStrategy(ruleText: string, parsedRule: ParsedRule, confidence: number): Strategy;
  archiveStrategy(id: number): void;
  supersedeStrategy(oldId: number, newId: number): void;
};

/**
 * The result of a single turn of the agent conversation loop.
 */
export type ConverseResult = {
  /** The assistant's Spanish text response. */
  response: string;
  /** Updated conversation state reflecting the new messages. */
  updatedState: ConversationState;
  /** An optional action proposal the seller must confirm before execution. */
  proposal?: AgentProposal;
};

/**
 * Configuration for the agent loop factory.
 */
export type AgentLoopConfig = {
  /** The base system prompt (Block A) for identity and hard rules. */
  systemPrompt: string;
  /** When true, uses an internal mock LLM client instead of a real API. */
  mockClient?: boolean;
  /** The model name to use (default: "deepseek-v4-flash"). */
  model?: string;
  /**
   * Active CEO strategies to inject into the system prompt and validate
   * against proposals. Pass empty array or omit for no strategies.
   */
  strategies?: Strategy[];
  /**
   * Optional strategy persistence store. When provided, the agent loop
   * will detect and handle natural-language strategy management intents
   * (list, update, archive) directly without sending them to the LLM.
   */
  store?: StrategyStore;
  /**
   * Available tool definitions for function calling. When provided, the
   * mock client becomes tool-aware and the agent loop executes tool calls
   * (e.g. `simulate_actor`) before synthesizing the final response.
   */
  tools?: ToolDefinition[];
  /**
   * Optional Cortex graph engine. When provided, confirmed honey-pot
   * proposals are persisted via {@link GraphEngine.storeProbeResult},
   * and sync outcomes are tracked via sync-outcome nodes + Hebbian learning.
   */
  engine?: GraphEngine;
  /**
   * Optional autonomy engine. When provided, the agent loop evaluates
   * degradation before each turn, gates action auto-approvals against
   * the current autonomy level, and records KPIs after execution.
   */
  autonomyEngine?: AutonomyEngine;
  /**
   * Optional Product Sync Engine. When provided alongside {@link engine},
   * registers `sync_product` and `sync_all` tools so the agent can
   * synchronise listings from Plasticov to Maustian with CEO strategies.
   */
  syncEngine?: ProductSyncEngine;
  /**
   * Optional MercadoLibre API client. When provided, registers the
   * `check_account` tool so the agent can query account status and
   * reputation levels for connected sellers.
   */
  mlClient?: MlClient;
  /**
   * Optional MercadoLibre API client for listing fees. When provided,
   * registers the `calculate_listing_fees` tool so the agent can query
   * MercadoLibre's sale fee calculation for a given product.
   */
  mlcClient?: MlcApiClient;
  /**
   * Optional Escribano memory scribe observer. When provided, the agent
   * loop calls `observeTurn()` after each `converse()` return to apply
   * Hebbian learning to the Cortex graph based on conversation outcomes.
   */
  escribano?: import("./escribano.js").EscribanoObserver;
  /**
   * Optional metrics collector. When provided, the agent loop records
   * turn count, duration, tool calls, and guardrail blocks for
   * observability (OpenTelemetry-ready).
   */
  metrics?: MetricsCollector;
  /**
   * Optional operational read-model reader. When provided alongside an
   * {@link OperationalDailyDataSource}, Block B daily aggregates can be
   * populated from the operational DB instead of hardcoded placeholders.
   */
  operationalReader?: OperationalReadModelReader;
  /**
   * Optional operational evidence provider. When provided alongside
   * {@link laneId}, per-lane operational evidence is injected into
   * Block C alongside Cortex context on every turn.
   */
  evidenceProvider?: OperationalEvidenceProvider;
  /**
   * Optional durable company-agent registry. When provided,
   * `request_agent_evidence` can resolve CEO-created agents alongside
   * static lane-backed agents. Creation remains disabled unless
   * `companyAgentAdminAuthorized` is explicitly true.
   */
  companyAgentRegistry?: CompanyAgentRegistry;
  /**
   * Explicit backend authorization evidence for CEO/admin-only durable
   * company-agent creation. Read/list tools do not require this flag.
   */
  companyAgentAdminAuthorized?: boolean;
  /**
   * Active lane ID for per-lane evidence injection into Block C.
   * Required when {@link evidenceProvider} is configured.
   */
  laneId?: LaneId;
};

/**
 * A minimal LLM client interface consumed by the agent loop.
 *
 * In production this wraps the OpenAI/DeepSeek chat completions API.
 * For testing, `mockClient: true` activates an internal mock.
 */
export type LlmClient = {
  chat(messages: Array<{ role: string; content: string }>): Promise<{
    content: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  }>;
  /** Stream a response token-by-token. The final chunk has `done: true`. */
  stream(messages: Array<{ role: string; content: string }>): AsyncIterable<StreamingChunk>;
};

export type OpenAiFunctionToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export function createOpenAiToolDefinitions(
  tools: Iterable<ToolDefinition>,
): OpenAiFunctionToolDefinition[] {
  return Array.from(tools, (tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function extractPromptCacheTelemetry(input: {
  provider: string;
  model: string;
  laneId: LaneId;
  usage?: Record<string, unknown> | null;
  credentialRef?: string;
  measuredAt?: string;
}): CacheTelemetry {
  return {
    provider: input.provider,
    model: input.model,
    laneId: input.laneId,
    promptCacheHitTokens: readNumericCounter(input.usage, "prompt_cache_hit_tokens"),
    promptCacheMissTokens: readNumericCounter(input.usage, "prompt_cache_miss_tokens"),
    ...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
    measuredAt: input.measuredAt ?? new Date().toISOString(),
  };
}

/**
 * Creates an agent loop instance.
 *
 * The agent loop orchestrates a single conversational turn:
 *   1. Validate input (Spanish-only, no harmful content)
 *   2. Build the messages array (cache strategy)
 *   3. Send to LLM (mock or real DeepSeek)
 *   4. Parse response for action proposals
 *   5. Update conversation state
 *
 * If `mockClient` is true, the loop always stays local even when
 * `DEEPSEEK_API_KEY` is set. Otherwise, a real DeepSeek client is created via
 * the OpenAI SDK when the environment variable is present; without it, the loop
 * falls back to the noop client.
 */
export function createAgentLoop(config: AgentLoopConfig) {
  const model = config.model ?? "deepseek-v4-flash";
  const openai = config.mockClient ? null : createDeepSeekClient();
  const tools = config.tools ?? [];
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  // ── Honey-pot tools ───────────────────────────────────────────────
  // Mutable reference tracked by the propose_honey_pot tool's onProposed
  // callback, consumed by the converse method for guardrail validation
  // and Cortex persistence after "dale" confirmation.
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
    config.companyAgentRegistry &&
    config.companyAgentAdminAuthorized === true &&
    !toolMap.has("create_company_agent")
  ) {
    toolMap.set(
      "create_company_agent",
      createCreateCompanyAgentTool(config.companyAgentRegistry, { authorized: true }),
    );
  }

  // ── Create listing tool (new from scratch) ─────────────────────
  if (config.mlClient && !toolMap.has("create_listing")) {
    toolMap.set("create_listing", createCreateListingTool(config.mlClient, config.engine));
  }

  // ── Update listing tool (edit existing) ──────────────────────
  if (config.mlClient && !toolMap.has("update_listing")) {
    toolMap.set("update_listing", createUpdateListingTool(config.mlClient, config.engine));
  }

  // ── Change item status tool (pause/close/activate) ───────────
  if (config.mlClient && !toolMap.has("change_item_status")) {
    toolMap.set("change_item_status", createChangeItemStatusTool(config.mlClient, config.engine));
  }

  // ── Manage variations tool (add/update/remove) ───────────────
  if (config.mlClient && !toolMap.has("manage_variations")) {
    toolMap.set("manage_variations", createManageVariationsTool(config.mlClient, config.engine));
  }

  // ── Read my catalog tool (local operational read model) ──
  if (config.operationalReader && !toolMap.has("read_my_catalog")) {
    toolMap.set("read_my_catalog", createReadMyCatalogTool(config.operationalReader));
  }

  // ── Sync tools ────────────────────────────────────────────────────
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

  // Real client is used only when the caller has not explicitly requested the mock.
  const client: LlmClient =
    openai && !config.mockClient
      ? createRealClient(openai, model, toolMap)
      : config.mockClient
        ? createMockClient(toolMap)
        : createNoopClient();

  // ── Strategy state (mutable closure) ──────────────────────────────
  let activeStrategies = config.strategies ?? [];

  /**
   * Build the effective system prompt by injecting active strategies
   * and current autonomy level when present.
   *
   * The base `config.systemPrompt` is used as-is when no strategies
   * or autonomy engine are active. When strategies exist, a
   * `## Estrategias del CEO` section is appended. When the autonomy
   * engine is configured, a `## Nivel de Autonomía Actual` section
   * is prepended so the LLM sees its current level on every turn.
   */
  function getActiveStrategies(): Strategy[] {
    // Always refresh from the persistent store when available so that
    // strategy CRUD operations during a conversation are immediately
    // reflected in the system prompt and sync safety gates.
    if (config.store) {
      return config.store.listActive();
    }
    return activeStrategies;
  }

  function getSystemPrompt(): string {
    let prompt = config.systemPrompt;

    // Append autonomy level info when engine is configured.
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

  return {
    /**
     * Process a single user message through the agent conversation loop
     * and return the complete response, optional proposal, and updated state.
     *
     * @param userMessage — The seller's latest message in Spanish.
     * @param state — The current conversation state (may be empty on first turn).
     * @returns The agent's response, optional proposal, and updated state.
     */
    async converse(userMessage: string, state: ConversationState): Promise<ConverseResult> {
      // --- Turn timing ---
      const turnStart = Date.now();
      const metrics = config.metrics;

      // --- Input guardrails ---
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

      // --- Degradation evaluation (before LLM turn) ---
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

      // --- Strategy CRUD intent routing (before LLM) ---
      if (config.store) {
        const strategyIntent = detectStrategyIntent(userMessage);
        if (strategyIntent.intent !== "none") {
          return handleStrategyCommand(strategyIntent, config.store, state, userMessage);
        }
      }

      // --- Build messages array with autonomy + strategy-aware system prompt ---
      const systemPrompt = degradationMsg
        ? `${getSystemPrompt()}\n\n${degradationMsg}`
        : getSystemPrompt();

      // --- Build Block C: Cortex context + per-lane operational evidence ---
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
          blockC = blockC
            ? `${blockC}\n\n## Evidencia operacional\n\n${operationalEvidence}`
            : `## Evidencia operacional\n\n${operationalEvidence}`;
        }
      }

      const llmMessages = buildMessages(systemPrompt, state, userMessage, blockC);

      // --- Send to LLM ---
      let llmResponse = await client.chat(llmMessages);

      // --- Tool call loop: execute non-prepare_action tools ---
      while (
        llmResponse.toolCalls &&
        llmResponse.toolCalls.some((tc) => tc.name !== "prepare_action")
      ) {
        for (const tc of llmResponse.toolCalls) {
          if (tc.name === "prepare_action") continue;
          const tool = toolMap.get(tc.name);
          if (tool) {
            try {
              // ── Sync safety gate: require active CEO strategies ──
              if (
                (tc.name === "sync_product" || tc.name === "sync_all") &&
                getActiveStrategies().length === 0
              ) {
                llmMessages.push({
                  role: "tool",
                  content: JSON.stringify({
                    error:
                      "No hay estrategias de CEO activas. " +
                      "Definí al menos una estrategia (margen, filtro de categoría, stock o regla de precio) " +
                      "antes de sincronizar productos. Ej: 'cambiá margen mínimo a 50%'.",
                  }),
                });
                continue;
              }

              if (tc.name === "sync_product" || tc.name === "sync_all") {
                metrics?.record("sync.product", 1, { tool: tc.name });
              }
              metrics?.record("tool.call", 1, { name: tc.name });

              const result = await tool.execute(tc.arguments);
              recordReturnedToolIssue(metrics, tc.name, result);
              llmMessages.push({
                role: "tool",
                content: JSON.stringify(result),
              });
              // Escribano: persist ML business data into Cortex graph memory
              if (config.escribano) {
                void config.escribano.observeToolResult(tc.name, result);
              }
            } catch {
              metrics?.record("tool.call", 1, { name: tc.name, status: "error" });
              llmMessages.push({
                role: "tool",
                content: JSON.stringify({
                  error: `Tool execution failed for ${tc.name}`,
                }),
              });
            }
          }
        }
        llmResponse = await client.chat(llmMessages);
      }

      // --- Parse response ---
      let responseText = llmResponse.content;
      let proposal: AgentProposal | undefined;

      // Check if the LLM requested tool calls (prepare_action).
      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        const toolCall = llmResponse.toolCalls[0]!;
        if (toolCall.name === "prepare_action") {
          proposal = parseProposalFromToolCall(toolCall.arguments);
        }
      }

      // --- Autonomy gate (before dale confirmation) ---
      // If the agent generated a fresh proposal this turn and the autonomy
      // level allows auto-approval, execute immediately without "dale".
      if (proposal && !isConfirmation(userMessage) && config.autonomyEngine) {
        const gateResult = autonomyGate({ riskLevel: proposal.riskLevel }, config.autonomyEngine);

        if (!gateResult.reason) {
          // Auto-approved — record KPI and return without dale.
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

      // If the user said "dale" / "sí" / "ok" and there's a pending proposal
      // in the state, Phase 1 advances preparation only. It never executes
      // productive external effects.
      if (isConfirmation(userMessage)) {
        const pendingProposal = extractPendingProposal(state.messages);
        if (pendingProposal) {
          proposal = pendingProposal;
          responseText = buildPhaseOneNoMutationResponse(pendingProposal.naturalSummary);
        }
      }

      // --- Strategy guardrail ---
      if (proposal) {
        const strategyCheck = strategyValidator(proposal, getActiveStrategies());
        if (!strategyCheck.passed) {
          return blockAndRespond(state, userMessage, strategyCheck.reason);
        }

        // --- Honey-pot guardrail (after strategy, before execution) ---
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
            // Phase 1 confirmation is preparation-only; do not persist an executed
            // honey-pot result or imply external deployment.
            pendingDecoyProposal = null;
          }
        }

        // --- Calibrated-distrust self-verification (after guardrails) ---
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

        // --- KPI recording after confirmed dale ---
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

      // --- Update state ---
      const updatedState = appendMessages(state, userMessage, responseText);

      // --- Escribano memory scribe: observe turn outcome ---
      if (config.escribano && config.engine) {
        const outcome = resolveTurnOutcome(userMessage, proposal, responseText, state);
        config.escribano.observeTurn(state, updatedState, responseText, proposal, outcome);
        metrics?.record("escribano.observation", 1, { outcome });
      }

      // --- Record turn metrics ---
      const durationMs = Date.now() - turnStart;
      metrics?.record("conversation.turn", 1);
      metrics?.record("conversation.duration_ms", durationMs);

      return {
        response: responseText,
        updatedState,
        ...(proposal !== undefined ? { proposal } : {}),
      };
    },

    /**
     * Process a single user message and stream the response token-by-token.
     *
     * Input guardrails are applied before streaming starts. If the input
     * is blocked, yields a single chunk with the blocked reason and `done: true`.
     *
     * @param userMessage — The seller's latest message in Spanish.
     * @param state — The current conversation state (may be empty on first turn).
     * @returns An async iterable of text deltas and a final completion chunk.
     */
    async *converseStream(
      userMessage: string,
      state: ConversationState,
    ): AsyncIterable<StreamingChunk> {
      // --- Input guardrails ---
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

      // --- Degradation evaluation (before LLM turn) ---
      let degradationMsg: string | null = null;
      if (config.autonomyEngine) {
        const deg = config.autonomyEngine.evaluateDegradation();
        if (deg) {
          degradationMsg =
            `⚠️ Tu nivel de autonomía bajó de ${AutonomyLevel[deg.from]} (${deg.from}) ` +
            `a ${AutonomyLevel[deg.to]} (${deg.to}). Motivo: ${deg.reason}`;
        }
      }

      // --- Build messages array with autonomy + strategy-aware system prompt ---
      const systemPrompt = degradationMsg
        ? `${getSystemPrompt()}\n\n${degradationMsg}`
        : getSystemPrompt();

      // --- Build Block C: Cortex context + per-lane operational evidence ---
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
          blockC = blockC
            ? `${blockC}\n\n## Evidencia operacional\n\n${operationalEvidence}`
            : `## Evidencia operacional\n\n${operationalEvidence}`;
        }
      }

      const llmMessages = buildMessages(systemPrompt, state, userMessage, blockC);

      // --- Stream from LLM ---
      for await (const chunk of client.stream(llmMessages)) {
        yield chunk;
      }
    },

    /**
     * Parse raw CEO text and add the resulting strategies to the active list.
     *
     * Uses the hybrid parser (regex fast-path) to extract structured rules
     * from natural Spanish, then appends them to the mutable strategy list
     * so they are available on the next turn.
     *
     * @param text — Raw CEO directive text in Spanish.
     * @returns The parsed result showing extracted rules and unparsed fragments.
     */
    updateStrategy(text: string) {
      const parsed = parseStrategy(text);
      // Convert ParsedRules to Strategy objects with synthetic ids.
      const newStrategies: Strategy[] = parsed.rules.map((rule, i) => ({
        id: -(i + 1), // negative ids to distinguish from persisted strategies
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

/**
 * Outcome of detecting a strategy-management intent in a user message.
 */
type StrategyIntent =
  | { intent: "list" }
  | { intent: "update"; ruleType: RuleType; newValue: string }
  | { intent: "archive"; ruleType: RuleType }
  | { intent: "none" };

/**
 * Match Spanish natural-language phrases to strategy management intents.
 *
 * Uses regex patterns to detect CEO commands for listing, updating,
 * and archiving strategies. Designed to catch voseo, tuteo, and
 * infinitive forms common in Argentine and neutral Spanish.
 *
 * Only hijacks messages that contain clear strategy-management keywords
 * (estrategia, regla, margen, stock, etc.) with imperative or intent verbs.
 * Normal business questions (e.g. "¿cómo está mi margen?") pass through.
 */
function detectStrategyIntent(userMessage: string): StrategyIntent {
  const lower = userMessage.toLowerCase().trim();

  // ── List intents ───────────────────────────────────────────────
  // "listá mis estrategias", "mostrame las reglas", "ver estrategias",
  // "qué estrategias tengo", "qué estrategias hay activas"
  if (
    /(?:list[aá]|mostr[aá]|ver)\s+(?:mis\s+)?(?:estrategias?|reglas?)/i.test(lower) ||
    /(?:estrategias?|reglas?)\s+(?:activas|qu[ée]\s+(?:tengo|hay))/i.test(lower) ||
    /qu[ée]\s+(?:estrategias?|reglas?)\s+(?:tengo|hay|est[aá]n\s+activas)/i.test(lower)
  ) {
    return { intent: "list" };
  }

  // ── Archive intents ────────────────────────────────────────────
  // "dejá de priorizar stock", "eliminá la estrategia de stock",
  // "sacá la regla de margen", "no quiero más esa estrategia"
  if (
    /(?:dej[aá]|elimin[aá]|sac[aá]|quit[aá]|borr[aá]|archiv[aá]|no\s+(?:quiero|necesito|uso)\s+m[aá]s)(?:\s|$|[.,!?])/i.test(
      lower,
    ) &&
    /estrategia|regla|prioriz|stock|margen|precio|categor/i.test(lower)
  ) {
    const ruleType = extractRuleTypeFromMessage(lower);
    if (ruleType) return { intent: "archive", ruleType };
  }

  // ── Update intents ─────────────────────────────────────────────
  // "cambiá margen a 45%", "actualizá la estrategia de margen",
  // "modificá margen mínimo a 45%", "subí margen"
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

/**
 * Extract the business domain (RuleType) from a Spanish message.
 *
 * Scans for keywords associated with each rule category:
 * margin ("margen"), stock ("stock"/"unidad"/"inventario"),
 * category ("categoría"/"competir"/"enfocar"/"juguetes"),
 * pricing ("precio"), customer ("cliente"/"responder"/"contestar"),
 * competitive ("competencia"/"igualar"), priority ("prioridad"/"priorizar").
 *
 * @returns The inferred RuleType or `undefined` when no keyword matches.
 */
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

/**
 * Execute a detected strategy-management command directly, bypassing the LLM.
 *
 * - **list**: Queries active strategies from the store and formats them.
 * - **update**: Parses the new strategy text, inserts it, and supersedes
 *   any existing strategy of the same {@link RuleType}.
 * - **archive**: Finds the first active strategy matching the rule type
 *   and marks it as archived.
 */
function handleStrategyCommand(
  intent: StrategyIntent,
  store: StrategyStore,
  state: ConversationState,
  userMessage: string,
): ConverseResult {
  // ── LIST ────────────────────────────────────────────────────────
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

  // ── UPDATE ──────────────────────────────────────────────────────
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
      // No existing strategy of this type — create new one.
      const created = store.insertStrategy(intent.newValue, rule, parsed.confidence);
      const response = `✅ Creé la nueva estrategia [${created.ruleType}] "${created.ruleText}".`;
      return {
        response,
        updatedState: appendMessages(state, userMessage, response),
      };
    }

    // Supersede: insert new, mark old as superseded.
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

  // ── ARCHIVE ─────────────────────────────────────────────────────
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

  // ── Fallback (should never reach here) ──────────────────────────
  const fallback = "No entendí bien. ¿Querés listar, modificar o eliminar estrategias?";
  return {
    response: fallback,
    updatedState: appendMessages(state, userMessage, fallback),
  };
}

// ---------------------------------------------------------------------------
// DeepSeek client (real) via OpenAI SDK
// ---------------------------------------------------------------------------

/**
 * Creates an OpenAI client configured for the DeepSeek API.
 *
 * Returns `null` when `DEEPSEEK_API_KEY` is not set, allowing callers
 * to fall back to mock or noop clients (useful for CI and local testing).
 */
export function createDeepSeekClient(): OpenAI | null {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });
}

/**
 * Wraps a real OpenAI client to satisfy the `LlmClient` interface.
 *
 * Uses the DeepSeek API via `baseURL: "https://api.deepseek.com"`,
 * which is compatible with the OpenAI chat completions protocol.
 */
function createRealClient(
  openai: OpenAI,
  model: string,
  toolMap: Map<string, ToolDefinition>,
): LlmClient {
  const openAiTools = createOpenAiToolDefinitions(toolMap.values());

  return {
    async chat(messages) {
      const completion = await openai.chat.completions.create({
        model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        messages: messages as any,
        ...(openAiTools.length > 0 ? { tools: openAiTools, tool_choice: "auto" as const } : {}),
        stream: false,
      });

      const choice = completion.choices[0];
      const toolCalls = choice?.message?.tool_calls?.map((tc) => {
        // ChatCompletionMessageToolCall is a union: discriminate on "function" property.
        const name = "function" in tc ? tc.function.name : "";
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const args = "function" in tc ? JSON.parse(tc.function.arguments) : {};
        return { name, arguments: args as Record<string, unknown> };
      });

      const result: {
        content: string;
        toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
      } = {
        content: choice?.message?.content ?? "",
      };
      if (toolCalls) {
        result.toolCalls = toolCalls;
      }
      return result;
    },

    async *stream(messages) {
      const stream = await openai.chat.completions.create({
        model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        messages: messages as any,
        ...(openAiTools.length > 0 ? { tools: openAiTools, tool_choice: "auto" as const } : {}),
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          yield { delta, done: false };
        }
      }
      yield { delta: "", done: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock LLM client (deterministic, no API key needed)
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
  // Extract the last user message.
  const userMsgs = messages.filter((m) => m.role === "user");
  const lastUser = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1]!.content.toLowerCase() : "";

  // ── Tool-aware: handle simulate_actor tool results ──────────
  if (toolMap?.has("simulate_actor")) {
    // If there are tool messages from a previous simulate_actor call,
    // return an actor-informed final response.
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

    // Detect actor-related user intent → return simulate_actor tool call.
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

  // ── Tool-aware: handle detect_probes tool ──────────────────────
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

      // After detect_probes → if alerts found, propose a honey-pot.
      if (
        toolMap.has("propose_honey_pot") &&
        Array.isArray(result.alerts) &&
        (result.alerts as unknown[]).length > 0
      ) {
        // Use a synthetic negative strategy ID for the mock.
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

    // Only trigger detect_probes if no prior probe results exist
    // in the conversation (prevent infinite re-detection).
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
      // User asks about competitor probing → trigger detect_probes.
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

  // ── Tool-aware: handle propose_honey_pot results ───────────────
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

      // After propose_honey_pot → present the proposal or error.
      if (typeof result.id === "string" && result.id.startsWith("decoy-")) {
        const proposal = result as unknown as {
          id: string;
          type: string;
          description: string;
          riskLevel: string;
          tosWarning: string;
        };

        // Check if this proposal was already presented to the user.
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
        const alreadyShown = lastAssistant?.content.includes(proposal.id);

        // If user is confirming (dale) after the proposal was shown,
        // return a confirmation response.
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

        // First time — present the proposal.
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

  // Intent-based routing (mock behavior, no real LLM call).
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

  // Default: ask a clarifying question in Spanish.
  return Promise.resolve({
    content:
      "Entendido. Para poder ayudarte mejor, ¿podrías contarme un poco más? " +
      "Por ejemplo: ¿querés revisar ventas, márgenes, reputación, reclamos, " +
      "o prioridades del día? También puedo prepararte una acción concreta " +
      "si ya tenés claro qué necesitás.",
  });
}

// ---------------------------------------------------------------------------
// Noop client (fallback when no API key and mockClient not requested)
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

/**
 * Detects standalone Spanish rejection patterns in a user message.
 *
 * Word-boundary-anchored regex matching: `no`, `cancelá`, `cancela`,
 * `cancelar`, `rechazo`, `no quiero`. Avoids false positives from
 * partial matches (e.g. "tecnología", "novedad").
 *
 * Uses explicit whitespace/string boundaries instead of `\b` because
 * JavaScript `\b` does not recognise accented characters (á, é, í, ó, ú, ñ)
 * as word characters.
 */
export function hasRejectionPattern(message: string): boolean {
  const lower = message.toLowerCase().trim();
  return (
    /(?:^|\s)no quiero(?:\s|$)/i.test(lower) ||
    /(?:^|\s)cancel[aá](?:\s|$)/i.test(lower) ||
    /(?:^|\s)cancelar(?:\s|$)/i.test(lower) ||
    /(?:^|\s)rechazo(?:\s|$)/i.test(lower) ||
    /(?:^|\s)no(?:\s|$)/i.test(lower)
  );
}

/**
 * Resolve the conversation turn outcome for the Escribano observer.
 *
 * Determines whether the turn involved a confirmed proposal, a seller
 * rejection (Darwinian feedback), a guardrail rejection (blocked response),
 * or neither.
 *
 * @param state — Optional conversation state used to detect pending proposals
 *   for rejection detection when the direct `proposal` parameter is undefined.
 */
export function resolveTurnOutcome(
  userMessage: string,
  proposal: AgentProposal | undefined,
  responseText: string,
  state?: ConversationState,
): TurnOutcome {
  if (responseText.startsWith("⛔")) return "blocked";

  // Darwinian rejection: standalone Spanish negation after a pending proposal.
  // Check both the direct proposal (fresh LLM output) and the conversation
  // history for a pending proposal from a previous turn.
  const effectiveProposal =
    proposal ?? (state ? extractPendingProposal(state.messages) : undefined);
  if (hasRejectionPattern(userMessage) && effectiveProposal) return "rejected";

  if (isConfirmation(userMessage) && proposal) return "confirmed";
  return "none";
}

/**
 * Builds the LLM messages array from the system prompt, conversation history,
 * and current user message.  Enforces a token budget to prevent exceeding
 * the context window.
 */
export function buildMessages(
  systemPrompt: string,
  state: ConversationState,
  userMessage: string,
  blockC?: string,
): Array<{ role: string; content: string }> {
  const systemMsg: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  // Append conversation history (only user/assistant roles).
  const historyMsgs: Array<{ role: string; content: string }> = [];
  for (const msg of state.messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      historyMsgs.push({ role: msg.role, content: msg.content });
    }
  }

  // Current user message with optional Block C injected.
  const userContent = blockC ? `${userMessage}\n\n${blockC}` : userMessage;
  const userMsg = { role: "user" as const, content: userContent };

  const allMessages = [...systemMsg, ...historyMsgs, userMsg];

  // ── Token-budget enforcement ──────────────────────────────────────
  const tokenCount = estimateTokens(allMessages);
  if (tokenCount > MAX_TOKEN_BUDGET) {
    console.warn(
      `⚠️  Token budget exceeded: ${tokenCount} > ${MAX_TOKEN_BUDGET}. ` +
        `Truncating oldest messages.`,
    );
    // Keep system + user, evict oldest history messages first.
    const systemTokens = estimateTokens(systemMsg);
    const userTokenCount = estimateTokens([userMsg]);
    const headerBudget = systemTokens + userTokenCount;
    const remainingBudget = MAX_TOKEN_BUDGET - headerBudget;

    if (remainingBudget <= 0) {
      // System prompt + user message alone exceed budget — still send them
      // because we can't drop the current request.
      console.warn(
        `⚠️  Cannot fit system+user within token budget (${headerBudget} > ${MAX_TOKEN_BUDGET}). ` +
          `Sending anyway — response may be truncated.`,
      );
      return [...systemMsg, userMsg];
    }

    // Keep newest history messages that fit within remaining budget.
    const keptHistory: Array<{ role: string; content: string }> = [];
    let usedBudget = 0;
    for (let i = historyMsgs.length - 1; i >= 0; i--) {
      const msg = historyMsgs[i]!;
      const tokens = estimateTokens([msg]);
      if (usedBudget + tokens > remainingBudget) break;
      keptHistory.unshift(msg);
      usedBudget += tokens;
    }

    return [...systemMsg, ...keptHistory, userMsg];
  }

  return allMessages;
}

/**
 * Appends a user message and assistant response to the conversation state,
 * enforcing the context window limit.
 */
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

  // Enforce context window limit: evict oldest messages first.
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

function isConfirmation(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return /^(dale|s[iíí]|ok|confirmo|confirmar|ejecut[áa]|ejecutar)\b/.test(trimmed);
}

/**
 * Extracts a pending AgentProposal from the conversation history.
 *
 * Searches recent assistant messages for a serialized proposal pattern.
 * This is a simple heuristic for the mock implementation; in production
 * the state would carry pending proposals explicitly.
 */
function extractPendingProposal(messages: ConversationMessage[]): AgentProposal | undefined {
  // Search recent messages (last 5) for proposal patterns.
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

/**
 * Parses an AgentProposal from tool call arguments.
 */
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

/**
 * Enforces the context window limit by evicting the oldest messages.
 *
 * Always preserves the system message (role === "system") and keeps
 * at most `limit` total messages. Evicts oldest user/assistant messages
 * first when the limit is exceeded.
 */
function enforceContextWindow(
  messages: ConversationMessage[],
  limit: number,
): ConversationMessage[] {
  if (messages.length <= limit) {
    return messages;
  }

  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");

  // Evict from the front (oldest) of non-system messages.
  const overflow = otherMessages.length - (limit - systemMessages.length);
  if (overflow <= 0) {
    return messages;
  }

  const keptOther = otherMessages.slice(overflow);
  return [...systemMessages, ...keptOther];
}
