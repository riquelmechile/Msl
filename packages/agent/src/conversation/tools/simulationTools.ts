import type { ActorType, ProbeAlert, SimulationResult } from "../types.js";

import { simulateActor as defaultSimulateActor } from "../actorSimulator.js";
import {
  analyzeQuestions as defaultAnalyzeQuestions,
  detectViewAnomalies as defaultDetectViewAnomalies,
} from "../probeDetector.js";

import type { ToolDefinition } from "./types.js";

// ── Helper types ───────────────────────────────────────────────────────

type SimulateActorFn = typeof defaultSimulateActor;

type AnalyzeQuestionsFn = typeof defaultAnalyzeQuestions;
type DetectViewAnomaliesFn = typeof defaultDetectViewAnomalies;

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

// ── Constants ──────────────────────────────────────────────────────────

const VALID_ACTOR_TYPES: readonly string[] = ["comprador", "proveedor", "competidor"];

// ── Simulate Actor Tool ────────────────────────────────────────────────

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

      if (!VALID_ACTOR_TYPES.includes(actorType)) {
        return {
          error:
            `Tipo de actor "${actorType}" no válido. ` +
            `Tipos válidos: ${VALID_ACTOR_TYPES.join(", ")}.`,
        };
      }

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

// ── Detect Probes Tool ────────────────────────────────────────────────

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
