import type { GraphEngine, TraversalResult } from "@msl/memory";
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
 * Creates the `get_business_context` tool.
 *
 * This tool calls the Cortex graph engine on demand: the LLM decides
 * when to query context, keeping Cortex calls fresh (traversal snapshot
 * per-tool-invocation) and independently testable.
 *
 * @param engine — an initialized Cortex GraphEngine instance.
 * @returns a tool definition compatible with OpenAI function calling.
 */
export function createGetBusinessContextTool(engine: GraphEngine): ToolDefinition {
  return {
    name: "get_business_context",
    description:
      "Obtiene contexto del negocio desde la memoria Cortex. " +
      "Usa esta herramienta cuando necesites datos sobre ventas, " +
      "márgenes, inventario, reputación, reclamos o cualquier " +
      "información operativa del negocio Plasticov/Maustian.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "La consulta en lenguaje natural sobre lo que necesitás saber del negocio. " +
            "Ej: 'ventas de hoy', 'reclamos abiertos', 'margen de la categoría Hogar'.",
        },
      },
      required: ["query"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const query = typeof args.query === "string" ? args.query : "";

      if (!query) {
        return { error: "El parámetro 'query' es obligatorio." };
      }

      // Seed nodes by matching query terms against node labels.
      const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 3);

      if (terms.length === 0) {
        return { context: {}, node_count: 0 };
      }

      // Build parameterized query matching any term in node labels.
      const placeholders = terms.map(() => "label LIKE ?").join(" OR ");
      const matchers = terms.map((t) => `%${t}%`);

      const seedRows = engine.db
        .prepare(`SELECT id, label FROM nodes WHERE ${placeholders} LIMIT 20`)
        .all(...matchers) as Array<{ id: number; label: string }>;

      if (seedRows.length === 0) {
        return { context: {}, node_count: 0 };
      }

      const seedIds = seedRows.map((r) => r.id);
      engine.spreadActivation(seedIds);

      const result: TraversalResult = engine.traverse();
      return result.context;
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
          description: "ID del vendedor (siempre 'seller-1' para Plasticov).",
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
            "honey-pot-deploy",
            "probe-analysis",
          ],
          description:
            "Tipo de acción a ejecutar: cambio de precio, cambio de stock, " +
            "mensaje a cliente, cancelación, reembolso, edición de listing, " +
            "o publicación creativa.",
        },
        targetType: {
          type: "string",
          enum: ["listing", "order", "message", "creative-asset"],
          description: "Tipo de entidad sobre la que se ejecuta la acción.",
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
      const target: AgentProposal["action"]["target"] =
        targetType === "listing"
          ? { type: "listing", listingId: targetId }
          : targetType === "order"
            ? { type: "order", orderId: targetId }
            : targetType === "message"
              ? { type: "message", threadId: targetId }
              : { type: "creative-asset", assetId: targetId };

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
