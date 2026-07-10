import type { DeepSeekTransport } from "../conversation/transports/deepseekTransport.js";
import type { Logger } from "../conversation/observability.js";
import { DeepSeekReasoningGateway } from "../reasoning/DeepSeekReasoningGateway.js";
import { ReasoningLevel } from "../reasoning/reasoningTypes.js";
import type { StorefrontCandidate } from "@msl/domain";
import type { StorefrontCandidateScore } from "@msl/domain";
import {
  buildStableSystemPrompt,
  buildEvidenceBlock,
  buildOutputSchema,
  type AdvisorPromptConfig,
} from "./ownedEcommerceAdvisorPrompt.js";

// ── Public types ─────────────────────────────────────────────────────

/** Ranked candidate with evidence-linked reasoning. */
export type RankingReasoning = {
  rank: number;
  candidateId: string;
  rationale: string;
  evidenceIds: string[];
  /** true when the advisor is in deterministic fallback mode. */
  fallback?: boolean;
};

/** Structured channel comparison for a candidate. */
export type ChannelTradeoffExplanation = {
  channel: "Plasticov" | "Maustian" | "owned-ecommerce" | "unknown";
  upsides: string[];
  risks: string[];
  overallAssessment: string;
};

/** A proposed storefront experiment with hypothesis and stopping rule. */
export type ExperimentProposal = {
  hypothesis: string;
  metric: string;
  stopRule: string;
  expectedLearning: string;
};

/** Evidence gap descriptor with target agent routing information. */
export type MissingEvidenceReport = {
  category: "cost" | "images" | "competition" | "account" | "cortex";
  severity: "low" | "medium" | "high";
  description: string;
  candidateId: string;
  /** Target agent for the inter-agent message bus. */
  targetAgentId:
    "cost-supplier" | "market-catalog" | "creative-assets" | "account-brain" | "supplier-manager";
  /** The question to ask the target agent. */
  question: string;
};

/**
 * Unified result envelope returned by every `OwnedEcommerceMerchandisingAdvisor`
 * method.  Each method populates different fields; all carry
 * `noMutationExecuted: true`.
 */
export type MerchandisingAdvisorResult = {
  recommendation?: unknown;
  reasoning: RankingReasoning[];
  positioningAngles: string[];
  seoSuggestions: {
    seoTitle?: string;
    seoDescription?: string;
    keywords?: string[];
  };
  geoSuggestions: {
    geoSummary?: string;
    faq?: Array<{ question: string; answer: string; evidenceIds: string[] }>;
  };
  channelTradeoffs: ChannelTradeoffExplanation[];
  missingEvidenceRequests: MissingEvidenceReport[];
  experimentProposal: ExperimentProposal | null;
  confidence: number;
  noMutationExecuted: true;
};

/**
 * Context passed alongside ranking and draft requests.
 * Carries pre-computed scores and optional channel comparison.
 */
export type AdvisorCallContext = {
  scores?: Record<string, StorefrontCandidateScore>;
  channelComparison?: {
    recommendedSellerId: string | null;
    confidence: "high" | "medium" | "low";
  };
};

// ── Internal: parsed DeepSeek response shape ────────────────────────

type DeepSeekAdvisorResponse = {
  reasoning?: Array<{
    rank: number;
    candidateId: string;
    rationale: string;
    evidenceIds?: string[];
    fallback?: boolean;
  }>;
  positioningAngles?: string[];
  seoSuggestions?: {
    seoTitle?: string;
    seoDescription?: string;
    keywords?: string[];
  };
  geoSuggestions?: {
    geoSummary?: string;
    faq?: Array<{ question: string; answer: string; evidenceIds: string[] }>;
  };
  channelTradeoffs?: Array<{
    channel: string;
    upsides: string[];
    risks: string[];
    overallAssessment: string;
  }>;
  missingEvidenceRequests?: Array<{
    category: string;
    severity: string;
    description: string;
    candidateId: string;
    targetAgentId: string;
    question: string;
  }>;
  experimentProposal?: {
    hypothesis: string;
    metric: string;
    stopRule: string;
    expectedLearning: string;
  } | null;
  confidence?: number;
};

// ── Constants ────────────────────────────────────────────────────────

const VALID_CHANNELS = new Set(["Plasticov", "Maustian", "owned-ecommerce", "unknown"]);

const VALID_TARGET_AGENTS = new Set([
  "cost-supplier",
  "market-catalog",
  "creative-assets",
  "account-brain",
  "supplier-manager",
]);

const VALID_CATEGORIES = new Set(["cost", "images", "competition", "account", "cortex"]);

const VALID_SEVERITIES = new Set(["low", "medium", "high"]);

const EMPTY_RESULT: MerchandisingAdvisorResult = {
  reasoning: [],
  positioningAngles: [],
  seoSuggestions: {},
  geoSuggestions: {},
  channelTradeoffs: [],
  missingEvidenceRequests: [],
  experimentProposal: null,
  confidence: 0,
  noMutationExecuted: true,
};

// ── Advisor ──────────────────────────────────────────────────────────

/**
 * DeepSeek-powered merchandising advisor for owned-ecommerce operations.
 *
 * Provides reasoning-backed ranking, SEO/GEO drafting, channel tradeoff
 * analysis, experiment proposals, and evidence gap detection.
 *
 * When `deepSeekTransport` is absent, every method returns a deterministic
 * fallback — the pipeline never fails on missing AI capability.
 * All results carry `noMutationExecuted: true`.
 */
export class OwnedEcommerceMerchandisingAdvisor {
  private gateway: DeepSeekReasoningGateway | null = null;
  private readonly transport: DeepSeekTransport | undefined;
  private readonly clock: () => Date;
  private readonly log: Logger | undefined;
  private readonly sellerId: string | undefined;

  constructor(
    input: {
      deepSeekTransport?: DeepSeekTransport;
      clock?: { now: () => Date };
      logger?: Logger;
      sellerId?: string;
    } = {},
  ) {
    this.transport = input.deepSeekTransport;
    this.clock = input.clock?.now ?? (() => new Date());
    this.log = input.logger;
    this.sellerId = input.sellerId;

    if (this.transport) {
      this.log?.info(
        "OwnedEcommerceMerchandisingAdvisor: transport available — AI enrichment enabled",
        {
          sellerId: this.sellerId ?? "unknown",
        },
      );
    } else {
      this.log?.info(
        "OwnedEcommerceMerchandisingAdvisor: no transport — deterministic fallback only",
        {
          sellerId: this.sellerId ?? "unknown",
        },
      );
    }
  }

  // ── Lazy gateway ─────────────────────────────────────────────────

  private getGateway(): DeepSeekReasoningGateway {
    if (!this.gateway) {
      if (!this.transport) {
        throw new Error("getGateway called but transport is absent — should not happen");
      }
      this.gateway = new DeepSeekReasoningGateway(this.transport);
    }
    return this.gateway;
  }

  // ── Prompt config ─────────────────────────────────────────────────

  private get promptConfig(): AdvisorPromptConfig {
    if (this.sellerId !== undefined) {
      return { sellerId: this.sellerId };
    }
    return {};
  }

  // ── 1. rankCandidatesWithReasoning ────────────────────────────────

  /**
   * Rank candidates with evidence-linked reasoning.
   *
   * **Transport path**: calls DeepSeek with candidate data, scores, and
   * channel context for ranked rationale.
   * **Fallback**: returns candidates sorted by score descending (or
   * insertion order when no scores available), each with `fallback: true`.
   */
  async rankCandidatesWithReasoning(
    candidates: StorefrontCandidate[],
    context?: AdvisorCallContext,
  ): Promise<MerchandisingAdvisorResult> {
    if (candidates.length === 0) {
      return { ...EMPTY_RESULT, confidence: 1 };
    }

    if (!this.transport) {
      return this.rankFallback(candidates, context);
    }

    try {
      const instruction = [
        "### Tarea: Ranking de Candidatos",
        "Analizá los siguientes candidatos para la tienda propia (owned ecommerce).",
        "Rankeá por prioridad comercial: margen, stock, evidencia, ajuste de canal.",
        "Cada posición debe incluir rationale con evidenceIds cuando existan.",
      ].join("\n");

      const stablePrefix = buildStableSystemPrompt(this.promptConfig);
      const evidence = buildEvidenceBlock(candidates);
      const schema = buildOutputSchema();

      const volatileInput = `${instruction}\n\n${evidence}\n\n${schema}`;

      const gateway = this.getGateway();
      const result = await gateway.reason({
        laneId: "owned-ecommerce-ranking",
        level: ReasoningLevel.Prioritization,
        stablePrefix,
        volatileInput,
        departmentId: "owned-ecommerce",
        agentId: "merchandising-advisor",
        ...(this.sellerId !== undefined ? { sellerId: this.sellerId } : {}),
      });

      if (result.status === "fallback") {
        this.log?.warn("rankCandidatesWithReasoning: gateway fallback", { reason: result.summary });
        return this.rankFallback(candidates, context);
      }

      const parsed = this.parseResponse(result.rawResponse);
      return this.buildResult(parsed);
    } catch (err) {
      this.log?.error(
        "rankCandidatesWithReasoning failed — falling back to deterministic ranking",
        err instanceof Error ? err : undefined,
      );
      return this.rankFallback(candidates, context);
    }
  }

  // ── 2. draftSeoGeoCopy ────────────────────────────────────────────

  /**
   * Draft SEO/GEO copy for a single candidate.
   *
   * **Transport path**: calls DeepSeek for SEO title, description, keywords,
   * and GEO FAQ ideas.
   * **Fallback**: product-name SEO title, empty meta/keywords/faq.
   */
  async draftSeoGeoCopy(candidate: StorefrontCandidate): Promise<MerchandisingAdvisorResult> {
    if (!this.transport) {
      return this.seoGeoFallback(candidate);
    }

    try {
      const instruction = [
        "### Tarea: Redacción SEO/GEO",
        "Redactá copy SEO y GEO para el siguiente producto de la tienda propia.",
        "SEO: título optimizado para Google Shopping (máx 70 chars), meta description (máx 160 chars), keywords.",
        "GEO: resumen de intención de compra y 2-4 FAQ con respuestas breves.",
        "Todo contenido debe estar en español, tono comercial profesional.",
      ].join("\n");

      const stablePrefix = buildStableSystemPrompt(this.promptConfig);
      const evidence = buildEvidenceBlock([candidate]);
      const schema = buildOutputSchema();

      const volatileInput = `${instruction}\n\n${evidence}\n\n${schema}`;

      const gateway = this.getGateway();
      const result = await gateway.reason({
        laneId: "owned-ecommerce-seo-geo",
        level: ReasoningLevel.Classification,
        stablePrefix,
        volatileInput,
        departmentId: "owned-ecommerce",
        agentId: "merchandising-advisor",
        ...(this.sellerId !== undefined ? { sellerId: this.sellerId } : {}),
      });

      if (result.status === "fallback") {
        this.log?.warn("draftSeoGeoCopy: gateway fallback", { reason: result.summary });
        return this.seoGeoFallback(candidate);
      }

      const parsed = this.parseResponse(result.rawResponse);
      return this.buildResult(parsed);
    } catch (err) {
      this.log?.error(
        "draftSeoGeoCopy failed — falling back to deterministic SEO/GEO",
        err instanceof Error ? err : undefined,
      );
      return this.seoGeoFallback(candidate);
    }
  }

  // ── 3. explainChannelTradeoffs ────────────────────────────────────

  /**
   * Compare a candidate across Plasticov, Maustian, and owned-ecommerce channels.
   *
   * **Transport path**: calls DeepSeek for structured upside/risk per channel.
   * **Fallback**: neutral listing of channels with empty assessments.
   */
  async explainChannelTradeoffs(
    candidate: StorefrontCandidate,
  ): Promise<MerchandisingAdvisorResult> {
    if (!this.transport) {
      return this.channelTradeoffsFallback();
    }

    try {
      const instruction = [
        "### Tarea: Comparación de Canales",
        "Analizá el siguiente producto y compará su idoneidad para cada canal:",
        "- Plasticov: cuenta MercadoLibre principal (alto tráfico, comisiones ML).",
        "- Maustian: cuenta MercadoLibre secundaria (nicho, fidelización).",
        "- Owned Ecommerce: tienda propia (sin comisiones, SEO/Google Shopping).",
        "- unknown: cuando no hay datos suficientes para un canal.",
        "Para cada canal, listá upsides y risks concretos. Incluí overallAssessment.",
      ].join("\n");

      const stablePrefix = buildStableSystemPrompt(this.promptConfig);
      const evidence = buildEvidenceBlock([candidate]);
      const schema = buildOutputSchema();

      const volatileInput = `${instruction}\n\n${evidence}\n\n${schema}`;

      const gateway = this.getGateway();
      const result = await gateway.reason({
        laneId: "owned-ecommerce-channels",
        level: ReasoningLevel.Classification,
        stablePrefix,
        volatileInput,
        departmentId: "owned-ecommerce",
        agentId: "merchandising-advisor",
        ...(this.sellerId !== undefined ? { sellerId: this.sellerId } : {}),
      });

      if (result.status === "fallback") {
        this.log?.warn("explainChannelTradeoffs: gateway fallback", { reason: result.summary });
        return this.channelTradeoffsFallback();
      }

      const parsed = this.parseResponse(result.rawResponse);
      return this.buildResult(parsed);
    } catch (err) {
      this.log?.error(
        "explainChannelTradeoffs failed — falling back to deterministic tradeoffs",
        err instanceof Error ? err : undefined,
      );
      return this.channelTradeoffsFallback();
    }
  }

  // ── 4. proposeStorefrontExperiment ────────────────────────────────

  /**
   * Propose an A/B experiment for a storefront candidate.
   *
   * **Transport path**: calls DeepSeek for hypothesis, metric, stop rule,
   * and expected learning.
   * **Fallback**: returns `experimentProposal: null`.
   */
  async proposeStorefrontExperiment(
    candidate: StorefrontCandidate,
  ): Promise<MerchandisingAdvisorResult> {
    if (!this.transport) {
      return this.experimentFallback();
    }

    try {
      const instruction = [
        "### Tarea: Propuesta de Experimento",
        "Diseñá un experimento A/B para este producto en la tienda propia.",
        "Incluí: hypothesis clara, métrica principal, stop rule (cuándo parar), y expected learning.",
        "Si el producto ya está en una categoría conocida y no hay incertidumbre relevante,",
        "devolvé experimentProposal: null con una razón en positioningAngles.",
      ].join("\n");

      const stablePrefix = buildStableSystemPrompt(this.promptConfig);
      const evidence = buildEvidenceBlock([candidate]);
      const schema = buildOutputSchema();

      const volatileInput = `${instruction}\n\n${evidence}\n\n${schema}`;

      const gateway = this.getGateway();
      const result = await gateway.reason({
        laneId: "owned-ecommerce-experiment",
        level: ReasoningLevel.Recommendation,
        stablePrefix,
        volatileInput,
        departmentId: "owned-ecommerce",
        agentId: "merchandising-advisor",
        ...(this.sellerId !== undefined ? { sellerId: this.sellerId } : {}),
      });

      if (result.status === "fallback") {
        this.log?.warn("proposeStorefrontExperiment: gateway fallback", { reason: result.summary });
        return this.experimentFallback();
      }

      const parsed = this.parseResponse(result.rawResponse);
      return this.buildResult(parsed);
    } catch (err) {
      this.log?.error(
        "proposeStorefrontExperiment failed — falling back to null experiment",
        err instanceof Error ? err : undefined,
      );
      return this.experimentFallback();
    }
  }

  // ── 5. identifyMissingEvidence ────────────────────────────────────

  /**
   * Detect evidence gaps for a candidate and identify which agent should
   * provide the missing data.
   *
   * **Transport path**: calls DeepSeek for gap analysis with target agent routing.
   * **Fallback**: returns empty `missingEvidenceRequests`.
   */
  async identifyMissingEvidence(
    candidate: StorefrontCandidate,
  ): Promise<MerchandisingAdvisorResult> {
    if (!this.transport) {
      return this.evidenceGapFallback();
    }

    try {
      const instruction = [
        "### Tarea: Detección de Evidencia Faltante",
        "Analizá el siguiente candidato e identificá qué evidencia falta para tomar una decisión informada.",
        "Categorías: cost (margen/costo), images (creative assets), competition (datos de mercado),",
        "account (comparación entre cuentas), cortex (datos de memoria neuronal).",
        "Para cada gap, indicá severity, description, y qué agente debería proveer la evidencia:",
        "cost-supplier, market-catalog, creative-assets, account-brain, o supplier-manager.",
        "Si no hay gaps evidentes, devolvé un array vacío.",
      ].join("\n");

      const stablePrefix = buildStableSystemPrompt(this.promptConfig);
      const evidence = buildEvidenceBlock([candidate]);
      const schema = buildOutputSchema();

      const volatileInput = `${instruction}\n\n${evidence}\n\n${schema}`;

      const gateway = this.getGateway();
      const result = await gateway.reason({
        laneId: "owned-ecommerce-evidence-gap",
        level: ReasoningLevel.Classification,
        stablePrefix,
        volatileInput,
        departmentId: "owned-ecommerce",
        agentId: "merchandising-advisor",
        ...(this.sellerId !== undefined ? { sellerId: this.sellerId } : {}),
      });

      if (result.status === "fallback") {
        this.log?.warn("identifyMissingEvidence: gateway fallback", { reason: result.summary });
        return this.evidenceGapFallback();
      }

      const parsed = this.parseResponse(result.rawResponse);
      return this.buildResult(parsed);
    } catch (err) {
      this.log?.error(
        "identifyMissingEvidence failed — falling back to empty gap report",
        err instanceof Error ? err : undefined,
      );
      return this.evidenceGapFallback();
    }
  }

  // ── Private: fallback implementations ─────────────────────────────

  private rankFallback(
    candidates: StorefrontCandidate[],
    context?: AdvisorCallContext,
  ): MerchandisingAdvisorResult {
    const sorted = [...candidates];

    // Sort by score when available, otherwise preserve insertion order
    if (context?.scores) {
      sorted.sort((a, b) => {
        const scoreA = context.scores?.[a.id]?.score ?? 0;
        const scoreB = context.scores?.[b.id]?.score ?? 0;
        return scoreB - scoreA;
      });
    }

    const reasoning: RankingReasoning[] = sorted.map((c, index) => ({
      rank: index + 1,
      candidateId: c.id,
      rationale: `Deterministic ranking. Score: ${context?.scores?.[c.id]?.score ?? "N/A"}. Stock: ${c.stock.status}. Margin: ${c.margin ? `${c.margin.value}%` : "unknown"}.`,
      evidenceIds: [...c.evidenceIds],
      fallback: true,
    }));

    return {
      reasoning,
      positioningAngles: [],
      seoSuggestions: {},
      geoSuggestions: {},
      channelTradeoffs: [],
      missingEvidenceRequests: [],
      experimentProposal: null,
      confidence: 1,
      noMutationExecuted: true,
    };
  }

  private seoGeoFallback(candidate: StorefrontCandidate): MerchandisingAdvisorResult {
    return {
      reasoning: [],
      positioningAngles: [],
      seoSuggestions: {
        seoTitle: `${candidate.title} — Owned Ecommerce Storefront`,
        seoDescription: `Storefront listing for ${candidate.title}. Evidence-backed pricing and availability.`,
        keywords: [],
      },
      geoSuggestions: {
        geoSummary: `Purchase-intent listing for ${candidate.title}.`,
        faq: [],
      },
      channelTradeoffs: [],
      missingEvidenceRequests: [],
      experimentProposal: null,
      confidence: 1,
      noMutationExecuted: true,
    };
  }

  private channelTradeoffsFallback(): MerchandisingAdvisorResult {
    const channels: ChannelTradeoffExplanation[] = [
      {
        channel: "Plasticov",
        upsides: [],
        risks: [],
        overallAssessment: "No AI analysis available — review manually.",
      },
      {
        channel: "Maustian",
        upsides: [],
        risks: [],
        overallAssessment: "No AI analysis available — review manually.",
      },
      {
        channel: "owned-ecommerce",
        upsides: [],
        risks: [],
        overallAssessment: "No AI analysis available — review manually.",
      },
      {
        channel: "unknown",
        upsides: [],
        risks: [],
        overallAssessment: "No AI analysis available — review manually.",
      },
    ];

    return {
      reasoning: [],
      positioningAngles: [],
      seoSuggestions: {},
      geoSuggestions: {},
      channelTradeoffs: channels,
      missingEvidenceRequests: [],
      experimentProposal: null,
      confidence: 1,
      noMutationExecuted: true,
    };
  }

  private experimentFallback(): MerchandisingAdvisorResult {
    return {
      reasoning: [],
      positioningAngles: ["No AI available — experiment design requires manual review."],
      seoSuggestions: {},
      geoSuggestions: {},
      channelTradeoffs: [],
      missingEvidenceRequests: [],
      experimentProposal: null,
      confidence: 1,
      noMutationExecuted: true,
    };
  }

  private evidenceGapFallback(): MerchandisingAdvisorResult {
    return {
      reasoning: [],
      positioningAngles: [],
      seoSuggestions: {},
      geoSuggestions: {},
      channelTradeoffs: [],
      missingEvidenceRequests: [],
      experimentProposal: null,
      confidence: 1,
      noMutationExecuted: true,
    };
  }

  // ── Private: parsing helpers ──────────────────────────────────────

  private parseResponse(raw: string | undefined): DeepSeekAdvisorResponse {
    if (!raw) return {};
    try {
      return JSON.parse(raw) as DeepSeekAdvisorResponse;
    } catch {
      return {};
    }
  }

  private buildResult(parsed: DeepSeekAdvisorResponse): MerchandisingAdvisorResult {
    const channelTradeoffs = (parsed.channelTradeoffs ?? [])
      .filter((ct): ct is ChannelTradeoffExplanation => {
        if (!VALID_CHANNELS.has(ct.channel)) return false;
        if (!Array.isArray(ct.upsides)) return false;
        if (!Array.isArray(ct.risks)) return false;
        if (typeof ct.overallAssessment !== "string") return false;
        return true;
      })
      .map((ct) => ({
        channel: ct.channel as ChannelTradeoffExplanation["channel"],
        upsides: ct.upsides,
        risks: ct.risks,
        overallAssessment: ct.overallAssessment,
      }));

    const missingEvidenceRequests = (parsed.missingEvidenceRequests ?? [])
      .filter((mr): mr is MissingEvidenceReport => {
        if (!VALID_CATEGORIES.has(mr.category)) return false;
        if (!VALID_SEVERITIES.has(mr.severity)) return false;
        if (typeof mr.description !== "string") return false;
        if (typeof mr.candidateId !== "string") return false;
        if (!VALID_TARGET_AGENTS.has(mr.targetAgentId)) return false;
        if (typeof mr.question !== "string") return false;
        return true;
      })
      .map((mr) => ({
        category: mr.category as MissingEvidenceReport["category"],
        severity: mr.severity as MissingEvidenceReport["severity"],
        description: mr.description,
        candidateId: mr.candidateId,
        targetAgentId: mr.targetAgentId as MissingEvidenceReport["targetAgentId"],
        question: mr.question,
      }));

    let experimentProposal: ExperimentProposal | null = null;
    if (parsed.experimentProposal && typeof parsed.experimentProposal === "object") {
      const ep = parsed.experimentProposal;
      if (
        typeof ep.hypothesis === "string" &&
        typeof ep.metric === "string" &&
        typeof ep.stopRule === "string" &&
        typeof ep.expectedLearning === "string"
      ) {
        experimentProposal = {
          hypothesis: ep.hypothesis,
          metric: ep.metric,
          stopRule: ep.stopRule,
          expectedLearning: ep.expectedLearning,
        };
      }
    } else if (parsed.experimentProposal === null) {
      experimentProposal = null;
    }

    const seoTitle =
      typeof parsed.seoSuggestions?.seoTitle === "string"
        ? parsed.seoSuggestions.seoTitle
        : undefined;
    const seoDescription =
      typeof parsed.seoSuggestions?.seoDescription === "string"
        ? parsed.seoSuggestions.seoDescription
        : undefined;
    const seoKeywords = Array.isArray(parsed.seoSuggestions?.keywords)
      ? parsed.seoSuggestions.keywords
      : undefined;
    const geoSummary =
      typeof parsed.geoSuggestions?.geoSummary === "string"
        ? parsed.geoSuggestions.geoSummary
        : undefined;
    const geoFaq = Array.isArray(parsed.geoSuggestions?.faq)
      ? parsed.geoSuggestions.faq
      : undefined;

    return {
      reasoning: (parsed.reasoning ?? []).map((r) => ({
        rank: typeof r.rank === "number" ? r.rank : 0,
        candidateId: typeof r.candidateId === "string" ? r.candidateId : "",
        rationale: typeof r.rationale === "string" ? r.rationale : "",
        evidenceIds: Array.isArray(r.evidenceIds) ? r.evidenceIds : [],
        ...(r.fallback === true ? { fallback: true as const } : {}),
      })),
      positioningAngles: Array.isArray(parsed.positioningAngles) ? parsed.positioningAngles : [],
      seoSuggestions: {
        ...(seoTitle !== undefined ? { seoTitle } : {}),
        ...(seoDescription !== undefined ? { seoDescription } : {}),
        ...(seoKeywords !== undefined ? { keywords: seoKeywords } : {}),
      },
      geoSuggestions: {
        ...(geoSummary !== undefined ? { geoSummary } : {}),
        ...(geoFaq !== undefined ? { faq: geoFaq } : {}),
      },
      channelTradeoffs,
      missingEvidenceRequests,
      experimentProposal,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      noMutationExecuted: true,
    };
  }
}
