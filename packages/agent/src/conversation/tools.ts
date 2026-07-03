import type { GraphEngine } from "@msl/memory";
import { riskLevelForAction } from "@msl/domain";

import type {
  ActorType,
  AgentProposal,
  DecoyProposal,
  ProbeAlert,
  SimulationResult,
  Strategy,
} from "./types.js";
import type { GuardResult } from "./guardrails.js";
import { simulateActor as defaultSimulateActor } from "./actorSimulator.js";
import {
  analyzeQuestions as defaultAnalyzeQuestions,
  detectViewAnomalies as defaultDetectViewAnomalies,
} from "./probeDetector.js";
import { proposeDecoy as defaultProposeDecoy } from "./honeyPotProposer.js";
import { getLaneContract, type LaneId } from "./lanes.js";
import {
  getCompanyAgent,
  listCompanyAgents,
  type AgentEvidenceResponse,
} from "./companyAgents.js";

/** Function signature for the actor simulator (injected for testability). */
type SimulateActorFn = typeof defaultSimulateActor;

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
 * Metadata nodes returned by {@link GraphEngine.queryByMetadata}.
 */
type MetadataNode = {
  id: number;
  label: string;
  metadata: Record<string, unknown>;
};

function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

/** Valid types for the `dataType` parameter. */
const BUSINESS_DATA_TYPES = [
  "listings",
  "visits",
  "orders",
  "seasonal",
  "cross_account",
  "all",
] as const;

// ── Cortex query helpers ───────────────────────────────────────────────

function buildQueryFilters(args: Record<string, unknown>): {
  status?: string;
  categoryId?: string;
  sellerId?: string;
  itemId?: string;
} {
  const filters: {
    status?: string;
    categoryId?: string;
    sellerId?: string;
    itemId?: string;
  } = {};

  const rawStatus = args.status;
  if (typeof rawStatus === "string" && rawStatus.length > 0) {
    filters.status = rawStatus;
  }
  const rawCategoryId = args.categoryId;
  if (typeof rawCategoryId === "string" && rawCategoryId.length > 0) {
    filters.categoryId = rawCategoryId;
  }
  const rawSellerId = args.sellerId;
  if (typeof rawSellerId === "string" && rawSellerId.length > 0) {
    filters.sellerId = rawSellerId;
  }
  const rawItemId = args.itemId;
  if (typeof rawItemId === "string" && rawItemId.length > 0) {
    filters.itemId = rawItemId;
  }

  return filters;
}

function aggregateVisitTrends(nodes: MetadataNode[]): Record<string, unknown> {
  const byItem = new Map<string, Array<{ date: string; totalVisits: number }>>();
  for (const node of nodes) {
    const itemId = metadataString(node.metadata.itemId, "unknown");
    const capturedAt = metadataString(node.metadata.capturedAt);
    const totalVisits = Number(node.metadata.totalVisits ?? 0);
    let entries = byItem.get(itemId);
    if (!entries) {
      entries = [];
      byItem.set(itemId, entries);
    }
    entries.push({ date: capturedAt, totalVisits });
  }

  const items: Array<Record<string, unknown>> = [];
  for (const [itemId, entries] of byItem) {
    entries.sort((a, b) => a.date.localeCompare(b.date));
    const latest = entries[entries.length - 1];
    const oldest = entries[0];
    const trend =
      entries.length >= 2 && oldest && latest && oldest.totalVisits > 0
        ? (latest.totalVisits - oldest.totalVisits) / oldest.totalVisits
        : 0;
    items.push({
      itemId,
      latestVisits: latest?.totalVisits ?? 0,
      trend: trend > 0.1 ? "up" : trend < -0.1 ? "down" : "stable",
      changePct: Math.round(trend * 100),
      snapshots: entries.length,
    });
  }

  return { items, total: items.length };
}

function aggregateListingStats(nodes: MetadataNode[]): Record<string, unknown> {
  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalPrice = 0;
  let priceCount = 0;

  for (const node of nodes) {
    const status = metadataString(node.metadata.status, "unknown");
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    const catId = metadataString(node.metadata.categoryId);
    if (catId && catId !== "" && catId !== "unknown") {
      byCategory[catId] = (byCategory[catId] ?? 0) + 1;
    }

    const price = Number(node.metadata.price ?? 0);
    if (price > 0) {
      totalPrice += price;
      priceCount++;
    }
  }

  return {
    total: nodes.length,
    byStatus,
    byCategory,
    avgPrice: priceCount > 0 ? Math.round(totalPrice / priceCount) : 0,
  };
}

function summarizeOrderHistory(nodes: MetadataNode[]): Record<string, unknown> {
  let totalOrders = 0;
  let totalAmount = 0;
  const byCategory: Record<string, { orderCount: number; totalAmount: number }> = {};

  for (const node of nodes) {
    totalOrders += Number(node.metadata.totalOrders ?? 0);
    totalAmount += Number(node.metadata.totalAmount ?? 0);

    const catBreakdown = node.metadata.categoryBreakdown as
      | Array<{ categoryId: string; orderCount: number; totalAmount: number }>
      | undefined;
    if (catBreakdown) {
      for (const cat of catBreakdown) {
        const existing = byCategory[cat.categoryId];
        if (existing) {
          existing.orderCount += cat.orderCount;
          existing.totalAmount += cat.totalAmount;
        } else {
          byCategory[cat.categoryId] = {
            orderCount: cat.orderCount,
            totalAmount: cat.totalAmount,
          };
        }
      }
    }
  }

  return { totalOrders, totalAmount, byCategory };
}

// ── Tool factory ────────────────────────────────────────────────────────

/**
 * Creates the `get_business_context` tool.
 *
 * Queries the Cortex graph engine for structured business data using
 * {@link GraphEngine.queryByMetadata}. The LLM picks a `dataType` and
 * optional filters (status, category, seller, item) to retrieve real
 * operational data instead of label-based substring matching.
 *
 * @param engine — an initialized Cortex GraphEngine instance.
 * @returns a tool definition compatible with OpenAI function calling.
 */
export function createGetBusinessContextTool(engine: GraphEngine): ToolDefinition {
  return {
    name: "get_business_context",
    description:
      "Consulta la memoria Cortex del negocio para obtener datos reales sobre " +
      "publicaciones, visitas, ventas, patrones estacionales y rendimiento entre cuentas. " +
      "Usá esta herramienta para entender el estado actual e histórico del negocio " +
      "antes de hacer recomendaciones. Podés consultar por tipo de dato, período, " +
      "categoría, o cuenta específica.",
    parameters: {
      type: "object",
      properties: {
        dataType: {
          type: "string",
          enum: [...BUSINESS_DATA_TYPES],
          description:
            "Tipo de datos a consultar: listings (catálogo), visits (tráfico), " +
            "orders (ventas), seasonal (estacionalidad), cross_account (comparación " +
            "entre cuentas), all (todo)",
        },
        status: {
          type: "string",
          enum: ["active", "paused", "closed"],
          description: "Filtrar listings por estado (active, paused, closed)",
        },
        categoryId: {
          type: "string",
          description: "Filtrar por categoría de MercadoLibre (ej: MLC1743)",
        },
        sellerId: {
          type: "string",
          description: "Filtrar por vendedor (plasticov o maustian)",
        },
        itemId: {
          type: "string",
          description: "Consultar una publicación específica por su ID de MercadoLibre",
        },
        months: {
          type: "number",
          description: "Período de análisis en meses (default: 3)",
        },
      },
      required: [],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      try {
        const dataType =
          typeof args.dataType === "string" &&
          (BUSINESS_DATA_TYPES as readonly string[]).includes(args.dataType)
            ? args.dataType
            : "all";
        const months = typeof args.months === "number" && args.months > 0 ? args.months : 3;
        const after = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString();

        const context: Record<string, unknown> = {};
        const userFilters = buildQueryFilters(args);

        // ── Listings ──────────────────────────────────────────
        if (dataType === "listings" || dataType === "all") {
          const filters: Record<string, unknown> = {
            type: "listing_snapshot",
            limit: 50,
          };
          if (userFilters.status) filters.status = userFilters.status;
          if (userFilters.categoryId) filters.categoryId = userFilters.categoryId;
          if (userFilters.sellerId) filters.sellerId = userFilters.sellerId;
          if (userFilters.itemId) filters.itemId = userFilters.itemId;

          const nodes = engine.queryByMetadata(filters);
          context.listings = aggregateListingStats(nodes);
          if (context.listings && (context.listings as Record<string, unknown>).total === 0) {
            context.listings = { ...(context.listings as Record<string, unknown>), items: [] };
          }
        }

        // ── Visits ────────────────────────────────────────────
        if (dataType === "visits" || dataType === "all") {
          const filters: Record<string, unknown> = {
            type: "visit_snapshot",
            after,
            limit: 100,
          };
          if (userFilters.sellerId) filters.sellerId = userFilters.sellerId;
          if (userFilters.itemId) filters.itemId = userFilters.itemId;

          const nodes = engine.queryByMetadata(filters);
          context.visits = aggregateVisitTrends(nodes);
        }

        // ── Orders ────────────────────────────────────────────
        if (dataType === "orders" || dataType === "all") {
          const filters: Record<string, unknown> = {
            type: "order_snapshot",
            after,
            limit: 30,
          };
          if (userFilters.sellerId) filters.sellerId = userFilters.sellerId;

          const nodes = engine.queryByMetadata(filters);
          context.orders = summarizeOrderHistory(nodes);
        }

        // ── Seasonal patterns ─────────────────────────────────
        if (dataType === "seasonal" || dataType === "all") {
          const filters: Record<string, unknown> = {
            type: "seasonal_pattern",
            limit: 50,
          };
          if (userFilters.categoryId) filters.categoryId = userFilters.categoryId;

          const nodes = engine.queryByMetadata(filters);
          context.seasonal = nodes.map((n) => n.metadata);
        }

        // ── Cross-account comparison ──────────────────────────
        if (dataType === "cross_account" || dataType === "all") {
          const plasticovNodes = engine.queryByMetadata({
            type: "listing_snapshot",
            sellerId: "plasticov",
            limit: 100,
          });
          const maustianNodes = engine.queryByMetadata({
            type: "listing_snapshot",
            sellerId: "maustian",
            limit: 100,
          });

          context.cross_account = {
            plasticov: aggregateListingStats(plasticovNodes),
            maustian: aggregateListingStats(maustianNodes),
          };
        }

        return {
          context,
          metadata: {
            dataType,
            months,
            queriedAt: new Date().toISOString(),
          },
        };
      } catch {
        return { error: "Cortex no está disponible en este momento." };
      }
    },
  };
}

/**
 * Creates the `prepare_action` tool.
 *
 * Maps an LLM-generated action description into a domain-level
 * `AgentProposal` that enters the PreparedAction pipeline:
 *   AgentProposal → guardrail validation → PreparedAction → ApprovalRecord → AuditRecord
 *
 * The LLM must provide the WriteActionKind, target, exact changes, and rationale.
 * This tool assigns the domain-derived risk level and constructs the summary.
 *
 * @returns a tool definition compatible with OpenAI function calling.
 */
export function createPrepareActionTool(): ToolDefinition {
  return {
    name: "prepare_action",
    description:
      "Prepara una acción concreta para que el vendedor la revise y confirme. " +
      "NUNCA ejecutes acciones sin confirmación. Esta herramienta solo crea " +
      "una propuesta que queda en estado pendiente hasta que el vendedor diga 'dale'.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Identificador único de la propuesta (ej: 'prop-001').",
        },
        sellerId: {
          type: "string",
          description: "ID de la cuenta vendedora configurada para esta acción.",
        },
        kind: {
          type: "string",
          enum: [
            "price-change",
            "stock-change",
            "customer-message",
            "cancellation",
            "refund",
            "listing-edit",
            "creative-publication",
            "product-ads-action",
            "honey-pot-deploy",
            "probe-analysis",
          ],
          description:
            "Tipo de acción a ejecutar: cambio de precio, cambio de stock, " +
            "mensaje a cliente, cancelación, reembolso, edición de listing, " +
            "publicación creativa, o ajuste de Product Ads.",
        },
        targetType: {
          type: "string",
          enum: [
            "listing",
            "order",
            "message",
            "creative-asset",
            "product-ads-campaign",
            "product-ads-ad",
          ],
          description:
            "Tipo de entidad sobre la que se ejecuta la acción. " +
            "Usá 'product-ads-campaign' para ajustar campañas y " +
            "'product-ads-ad' para anuncios individuales.",
        },
        targetId: {
          type: "string",
          description: "Identificador de la entidad objetivo (listingId, orderId, etc.).",
        },
        field: {
          type: "string",
          description: "Campo a modificar (ej: 'price', 'stock', 'status').",
        },
        fromValue: {
          description: "Valor actual del campo (número, texto o booleano).",
        },
        toValue: {
          description: "Nuevo valor del campo (número, texto o booleano).",
        },
        rationale: {
          type: "string",
          description: "Justificación de por qué esta acción es necesaria. Requerido siempre.",
        },
        summary: {
          type: "string",
          description:
            "Resumen en español natural de la acción propuesta, " +
            "ej: '¿Bajo el precio del listing #42 en 10%?'.",
        },
      },
      required: [
        "id",
        "sellerId",
        "kind",
        "targetType",
        "targetId",
        "field",
        "fromValue",
        "toValue",
        "rationale",
        "summary",
      ],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const kind = (args.kind as string) ?? "";
      const targetType = (args.targetType as string) ?? "";
      const targetId = (args.targetId as string) ?? "";

      // Build the action target from the flat args.
      const target: AgentProposal["action"]["target"] = (() => {
        switch (targetType) {
          case "listing":
            return { type: "listing", listingId: targetId };
          case "order":
            return { type: "order", orderId: targetId };
          case "message":
            return { type: "message", threadId: targetId };
          case "product-ads-campaign":
            return { type: "product-ads-campaign", campaignId: targetId };
          case "product-ads-ad":
            return { type: "product-ads-ad", adId: targetId };
          default:
            return { type: "creative-asset", assetId: targetId };
        }
      })();

      const proposal: AgentProposal = {
        action: {
          id: (args.id as string) ?? "",
          sellerId: (args.sellerId as string) ?? "",
          kind: kind as AgentProposal["action"]["kind"],
          target,
          exactChange: [
            {
              field: (args.field as string) ?? "",
              from: args.fromValue as string | number | boolean | null,
              to: args.toValue as string | number | boolean | null,
            },
          ],
          rationale: (args.rationale as string) ?? "",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
        },
        naturalSummary: (args.summary as string) ?? "",
        riskLevel: riskLevelForAction(kind as AgentProposal["action"]["kind"]),
      };

      return proposal;
    },
  };
}

export function createDelegateToSubagentTool(): ToolDefinition {
  return {
    name: "delegate_to_subagent",
    description:
      "Prepara una delegación proposal-only a una lane especialista. No ejecuta acciones, " +
      "no muta MercadoLibre y devuelve advertencias de límite con evidence IDs.",
    parameters: {
      type: "object",
      properties: {
        laneId: {
          type: "string",
          enum: ["cost-supplier", "market-catalog", "creative-commercial"],
        },
        scope: { type: "string" },
        requestedAction: { type: "string" },
        evidenceIds: { type: "array", items: { type: "string" } },
      },
      required: ["laneId", "scope"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const laneId = typeof args.laneId === "string" ? (args.laneId as LaneId) : "cost-supplier";
      const lane = getLaneContract(laneId);
      const evidenceIds = Array.isArray(args.evidenceIds)
        ? args.evidenceIds.filter((id): id is string => typeof id === "string")
        : [];
      const requestedAction = typeof args.requestedAction === "string" ? args.requestedAction : "";
      const boundaryWarnings = [...lane.boundaries];

      if (
        /publish|publicar|mutar|mutation|precio|price|mensaje|payment|pago|sii/i.test(
          requestedAction,
        )
      ) {
        boundaryWarnings.push(
          "Requested productive effect was blocked: Phase 1 delegation may investigate or prepare only.",
        );
      }

      return {
        laneId: lane.laneId,
        status: "proposal-only",
        scope: typeof args.scope === "string" ? args.scope : "bounded investigation",
        evidenceIds,
        boundaryWarnings,
        noMutationExecuted: true,
      };
    },
  };
}

const productiveRequestPattern =
  /publish|publicar|mutar|mutation|ejecutar|execute|cambiar|change|modificar|update|crear|create|mensaje|message|payment|pago|sii|enviar|send/i;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function createRequestAgentEvidenceTool(): ToolDefinition {
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
          enum: listCompanyAgents().map((agent) => agent.id),
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

      const agent = getCompanyAgent(targetAgent);
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

      const missingInputs: string[] = [];
      if (!scope) missingInputs.push("scope");
      if (requestedEvidenceKinds.length === 0) missingInputs.push("requestedEvidenceKinds");

      const missingEvidenceKinds = agent.profile.requiredEvidenceKinds.filter(
        (kind) => !requestedEvidenceKinds.includes(kind),
      );
      for (const kind of missingEvidenceKinds) {
        missingInputs.push(`requested evidence kind: ${kind}`);
      }

      return {
        status: missingInputs.length > 0 ? "missing-inputs" : "evidence-ready",
        targetAgent: agent.id,
        laneId: agent.profile.laneId,
        scope,
        requestedEvidenceKinds,
        existingEvidenceIds,
        requiredEvidenceKinds: agent.profile.requiredEvidenceKinds,
        evidenceIds: existingEvidenceIds,
        missingInputs,
        boundaryWarnings: [...agent.profile.boundaries, ...warnings],
        noMutationExecuted: true,
      };
    },
  };
}

// ── simulate_actor Tool ─────────────────────────────────────────────

/** Valid actor type values for validation at the tool boundary. */
const VALID_ACTOR_TYPES: readonly string[] = ["comprador", "proveedor", "competidor"];

/**
 * Creates the `simulate_actor` tool.
 *
 * Wraps the actor simulator so the LLM can consult counter-party
 * perspectives on demand. The tool executes a mock simulation that
 * returns realistic Spanish responses keyed to the actor persona
 * and query keywords.
 *
 * @param simulator — the actor simulation function (injected for testability).
 *   Defaults to the mock implementation from `actorSimulator.ts`.
 * @returns a tool definition compatible with OpenAI function calling.
 */
export function createSimulateActorTool(
  simulator: SimulateActorFn = defaultSimulateActor,
): ToolDefinition {
  return {
    name: "simulate_actor",
    description:
      "Simula el comportamiento de un actor del mercado (comprador, " +
      "proveedor o competidor) para evaluar una decisión",
    parameters: {
      type: "object",
      properties: {
        actorType: {
          type: "string",
          enum: [...VALID_ACTOR_TYPES],
          description: "Tipo de actor a simular: comprador, proveedor o competidor.",
        },
        query: {
          type: "string",
          description:
            "La pregunta o situación a evaluar desde la perspectiva del actor. " +
            "Ej: '¿Comprarías este producto a $15.000?' o " +
            "'¿Cómo reaccionarías si bajo el precio un 10%?'.",
        },
      },
      required: ["actorType", "query"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const actorType = args.actorType as string;
      const query = (args.query as string) ?? "";

      // Validate actorType at the tool boundary.
      if (!VALID_ACTOR_TYPES.includes(actorType)) {
        return {
          error:
            `Tipo de actor "${actorType}" no válido. ` +
            `Tipos válidos: ${VALID_ACTOR_TYPES.join(", ")}.`,
        };
      }

      // Validate query is non-empty after trimming.
      if (!query.trim()) {
        return {
          error: "El parámetro 'query' es obligatorio y no puede estar vacío.",
        };
      }

      const result: SimulationResult = await simulator(actorType as ActorType, query);

      return result;
    },
  };
}

// ── detect_probes Tool ──────────────────────────────────────────────

/** Function signatures for the probe detector (injected for testability). */
type AnalyzeQuestionsFn = typeof defaultAnalyzeQuestions;
type DetectViewAnomaliesFn = typeof defaultDetectViewAnomalies;

/**
 * Composed detector that runs both question analysis and view anomaly
 * detection, merging results into a single ProbeAlert array.
 */
type DetectProbesFn = (
  questions?: Array<{ text: string; from: string; date: string }>,
  views?: Array<{ count: number; date: string }>,
) => ProbeAlert[];

function makeDetectProbes(
  analyzeQ: AnalyzeQuestionsFn,
  detectV: DetectViewAnomaliesFn,
): DetectProbesFn {
  return (questions, views) => {
    const alerts: ProbeAlert[] = [];
    if (questions && questions.length > 0) {
      alerts.push(...analyzeQ(questions));
    }
    if (views && views.length > 0) {
      alerts.push(...detectV(views));
    }
    return alerts;
  };
}

/**
 * Creates the `detect_probes` tool.
 *
 * Wraps the probe detector so the LLM can scan question and view data
 * for suspicious competitor counterintelligence patterns on demand.
 *
 * @param detector — optional composed detector function (injected for testability).
 *   Defaults to the real `analyzeQuestions` + `detectViewAnomalies` composition.
 * @returns a tool definition compatible with OpenAI function calling.
 */
export function createDetectProbesTool(
  detector: DetectProbesFn = makeDetectProbes(defaultAnalyzeQuestions, defaultDetectViewAnomalies),
): ToolDefinition {
  return {
    name: "detect_probes",
    description:
      "Detecta patrones sospechosos de contrainteligencia en preguntas " +
      "y vistas de tus publicaciones. Usa esta herramienta cuando " +
      "quieras saber si un competidor está sondeando tu negocio.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description:
            "Lista de preguntas recibidas con su texto, origen y fecha. " +
            'Ej: [{ "text": "¿Cuál es tu precio?", "from": "TiendaX", "date": "2026-06-26" }].',
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              from: { type: "string" },
              date: { type: "string" },
            },
          },
        },
        views: {
          type: "array",
          description:
            "Conteo diario de vistas a tus publicaciones, cronológicamente. " +
            'Ej: [{ "count": 150, "date": "2026-06-26" }].',
          items: {
            type: "object",
            properties: {
              count: { type: "number" },
              date: { type: "string" },
            },
          },
        },
      },
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const questions = Array.isArray(args.questions)
        ? (args.questions as Array<{ text: string; from: string; date: string }>)
        : undefined;
      const views = Array.isArray(args.views)
        ? (args.views as Array<{ count: number; date: string }>)
        : undefined;

      if (!questions && !views) {
        return {
          error: "Se requiere al menos 'questions' o 'views' para detectar patrones.",
        };
      }

      const alerts = detector(questions, views);
      return { alerts, count: alerts.length };
    },
  };
}

// ── propose_honey_pot Tool ──────────────────────────────────────────

/** Function signatures for the honey-pot proposer and validator (injected). */
type ProposeDecoyFn = typeof defaultProposeDecoy;
type HoneyPotValidatorFn = (proposal: DecoyProposal, strategies: Strategy[]) => GuardResult;

/**
 * Creates the `propose_honey_pot` tool.
 *
 * Generates a decoy proposal from an active probe strategy, validates
 * it through the honey-pot guardrail (default-deny), and either returns
 * the {@link DecoyProposal} or a blocked error with a Spanish explanation.
 *
 * @param proposer — the decoy proposal generator (injected for testability).
 * @param guardrail — the honey-pot validator function.
 * @param getStrategies — closure that returns the current active strategies.
 * @param onProposed — optional callback invoked when a proposal passes validation,
 *   allowing the caller to track it for later confirmation (Cortex storage).
 * @returns a tool definition compatible with OpenAI function calling.
 */
export function createProposeHoneyPotTool(
  proposer: ProposeDecoyFn,
  guardrail: HoneyPotValidatorFn,
  getStrategies: () => Strategy[],
  onProposed?: (proposal: DecoyProposal) => void,
): ToolDefinition {
  return {
    name: "propose_honey_pot",
    description:
      "Propone una operación de contrainteligencia basada en estrategias " +
      "activas del CEO. La propuesta incluye un listing señuelo para " +
      "detectar y analizar el comportamiento de competidores.",
    parameters: {
      type: "object",
      properties: {
        strategyId: {
          type: "number",
          description:
            "ID de la estrategia activa de tipo 'probe' a utilizar. " +
            "Obtenelo de la lista de estrategias activas.",
        },
      },
      required: ["strategyId"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const strategyId = typeof args.strategyId === "number" ? args.strategyId : NaN;
      if (isNaN(strategyId)) {
        return { error: "El parámetro 'strategyId' debe ser un número." };
      }

      const strategies = getStrategies();
      const strategy = strategies.find((s) => s.id === strategyId && s.status === "active");

      if (!strategy) {
        return {
          error:
            `No se encontró una estrategia activa con ID ${strategyId}. ` +
            "Revisá las estrategias activas con 'listá mis estrategias'.",
        };
      }

      if (strategy.ruleType !== "probe") {
        return {
          error:
            `La estrategia #${strategyId} es de tipo "${strategy.ruleType}", ` +
            "no de tipo 'probe'. Seleccioná una estrategia de contrainteligencia.",
        };
      }

      const proposal = proposer(strategy);
      const guard = guardrail(proposal, strategies);

      if (!guard.passed) {
        return { error: guard.reason };
      }

      // Notify the caller (agent loop) that a validated proposal was generated.
      onProposed?.(proposal);

      return proposal;
    },
  };
}
