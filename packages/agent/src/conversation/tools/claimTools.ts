import type { MlcApiClient } from "@msl/mercadolibre";

import type { ToolDefinition } from "../tools.js";
import { coerceSellerId } from "./_shared.js";

// ---------------------------------------------------------------------------
// check_claims tool
// ---------------------------------------------------------------------------

export function createCheckClaimsTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_claims",
    description:
      "Busca reclamos y mediaciones de posventa de un vendedor en MercadoLibre. " +
      "Devuelve lista de reclamos con estado, tipo, fechas y partes involucradas. " +
      "Permite filtrar por estado y paginar resultados. Usá esta herramienta " +
      "cuando el vendedor pregunte por reclamos, quiera hacer un seguimiento, " +
      "o necesite identificar reclamos abiertos que requieren atención.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        status: {
          type: "string",
          description:
            "Filtrar por estado de reclamo: open, closed, under_review, etc. (opcional).",
        },
        limit: {
          type: "number",
          description: "Cantidad máxima de reclamos a retornar (opcional).",
        },
        offset: {
          type: "number",
          description: "Offset para paginación (opcional).",
        },
      },
      required: ["sellerId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }
      if (!mlcClient.searchClaims) {
        return {
          error: "La búsqueda de reclamos no está disponible en este momento.",
        };
      }

      const opts: { limit?: number; offset?: number; status?: string } = {};
      if (typeof args.limit === "number") opts.limit = args.limit;
      if (typeof args.offset === "number") opts.offset = args.offset;
      if (typeof args.status === "string" && args.status.length > 0) opts.status = args.status;

      try {
        const snapshot = await mlcClient.searchClaims(sellerId, opts);
        const data = snapshot.data;
        const openCount = data.results.filter(
          (c) => c.status === "open" || c.status === "under_review",
        ).length;
        return {
          ...snapshot,
          totalClaims: data.paging.total,
          openClaims: openCount,
          summary:
            data.results.length > 0
              ? `${data.paging.total} reclamos encontrados, ${openCount} abiertos/en revisión.`
              : "No se encontraron reclamos.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo buscar reclamos: ` + `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// check_claim_detail tool
// ---------------------------------------------------------------------------

export function createCheckClaimDetailTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_claim_detail",
    description:
      "Obtiene el detalle completo de un reclamo de MercadoLibre, incluyendo " +
      "mensajes, partes involucradas y acciones disponibles. Usá esta herramienta " +
      "después de check_claims cuando el vendedor quiera ver un reclamo específico " +
      "en profundidad para decidir cómo resolverlo.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        claimId: {
          type: "string",
          description: "ID del reclamo en MercadoLibre. Ej: C-123456789.",
        },
      },
      required: ["sellerId", "claimId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const claimId =
        typeof args.claimId === "string" && args.claimId.length > 0 ? args.claimId : null;
      if (!claimId) {
        return {
          error: "El parámetro 'claimId' es obligatorio y debe ser un string no vacío.",
        };
      }
      if (!mlcClient.getClaimDetail) {
        return {
          error: "La consulta de detalle de reclamo no está disponible en este momento.",
        };
      }

      try {
        const snapshot = await mlcClient.getClaimDetail(sellerId, claimId);
        const data = snapshot.data;
        return {
          ...snapshot,
          messageCount: data.messages?.length ?? 0,
          availableActionCount: data.availableActions?.length ?? 0,
          summary:
            `Reclamo ${data.claim.id}: estado "${data.claim.status ?? "desconocido"}", ` +
            `tipo "${data.claim.type ?? "desconocido"}", ` +
            `${data.messages?.length ?? 0} mensajes, ` +
            `${data.availableActions?.length ?? 0} acciones disponibles.`,
        };
      } catch (err) {
        return {
          error:
            `No se pudo obtener el detalle del reclamo: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// check_claim_messages tool
// ---------------------------------------------------------------------------

export function createCheckClaimMessagesTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_claim_messages",
    description:
      "Lee el historial de mensajes de un reclamo de MercadoLibre. " +
      "Devuelve los mensajes entre el vendedor, comprador y Mediador de ML " +
      "con fechas y adjuntos. Usá esta herramienta para revisar la conversación " +
      "completa de un reclamo antes de decidir cómo responder.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        claimId: {
          type: "string",
          description: "ID del reclamo en MercadoLibre. Ej: C-123456789.",
        },
      },
      required: ["sellerId", "claimId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const claimId =
        typeof args.claimId === "string" && args.claimId.length > 0 ? args.claimId : null;
      if (!claimId) {
        return {
          error: "El parámetro 'claimId' es obligatorio y debe ser un string no vacío.",
        };
      }
      if (!mlcClient.getClaimMessages) {
        return {
          error: "La consulta de mensajes del reclamo no está disponible en este momento.",
        };
      }

      try {
        const snapshot = await mlcClient.getClaimMessages(sellerId, claimId);
        const data = snapshot.data;
        return {
          ...snapshot,
          messageCount: data.messages.length,
          summary:
            data.messages.length > 0
              ? `${data.messages.length} mensajes en el historial del reclamo.`
              : "No hay mensajes en este reclamo.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo leer los mensajes del reclamo: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// check_claim_resolutions tool
// ---------------------------------------------------------------------------

export function createCheckClaimResolutionsTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_claim_resolutions",
    description:
      "Lee las opciones de resolución disponibles para un reclamo de MercadoLibre. " +
      "Devuelve las resoluciones esperadas con su estado y descripción. Usá esta " +
      "herramienta ANTES de decidir cómo resolver un reclamo, para conocer las " +
      "opciones que MercadoLibre ofrece y elegir la más conveniente para el vendedor.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        claimId: {
          type: "string",
          description: "ID del reclamo en MercadoLibre. Ej: C-123456789.",
        },
      },
      required: ["sellerId", "claimId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const claimId =
        typeof args.claimId === "string" && args.claimId.length > 0 ? args.claimId : null;
      if (!claimId) {
        return {
          error: "El parámetro 'claimId' es obligatorio y debe ser un string no vacío.",
        };
      }
      if (!mlcClient.getClaimExpectedResolutions) {
        return {
          error: "La consulta de resoluciones esperadas no está disponible en este momento.",
        };
      }

      try {
        const snapshot = await mlcClient.getClaimExpectedResolutions(sellerId, claimId);
        const data = snapshot.data;
        const resolutionDescs = data.expected_resolutions
          .map((r) => `${r.status ?? "?"}: ${r.description ?? "sin descripción"}`)
          .join(" | ");
        return {
          ...snapshot,
          resolutionCount: data.expected_resolutions.length,
          summary:
            data.expected_resolutions.length > 0
              ? `${data.expected_resolutions.length} resoluciones disponibles: ${resolutionDescs}`
              : "No hay resoluciones esperadas para este reclamo.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo leer las resoluciones del reclamo: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// check_claim_reputation tool
// ---------------------------------------------------------------------------

export function createCheckClaimReputationTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_claim_reputation",
    description:
      "Verifica si un reclamo de MercadoLibre afecta la reputación del vendedor. " +
      "Devuelve si el reclamo impacta en el score de reputación y el motivo. " +
      "Usá esta herramienta ANTES de decidir cómo resolver un reclamo, para evaluar " +
      "el impacto reputacional de cada opción y priorizar los reclamos que más afectan.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        claimId: {
          type: "string",
          description: "ID del reclamo en MercadoLibre. Ej: C-123456789.",
        },
      },
      required: ["sellerId", "claimId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const claimId =
        typeof args.claimId === "string" && args.claimId.length > 0 ? args.claimId : null;
      if (!claimId) {
        return {
          error: "El parámetro 'claimId' es obligatorio y debe ser un string no vacío.",
        };
      }
      if (!mlcClient.getClaimAffectsReputation) {
        return {
          error: "La consulta de impacto reputacional no está disponible en este momento.",
        };
      }

      try {
        const snapshot = await mlcClient.getClaimAffectsReputation(sellerId, claimId);
        const data = snapshot.data;
        return {
          ...snapshot,
          recommendation: data.affects_reputation
            ? `⚠️ Este reclamo AFECTA la reputación del vendedor. Motivo: ${data.reason ?? "no especificado"}. Resolverlo rápido minimiza el impacto.`
            : "✅ Este reclamo NO afecta la reputación del vendedor.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo verificar el impacto reputacional: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// check_claim_history tool
// ---------------------------------------------------------------------------

export function createCheckClaimHistoryTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_claim_history",
    description:
      "Lee el historial cronológico de cambios de estado de un reclamo de MercadoLibre. " +
      "Devuelve cada cambio de estado con su fecha. Usá esta herramienta para " +
      "entender la evolución de un reclamo, detectar demoras, y tomar decisiones " +
      "informadas sobre los próximos pasos.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        claimId: {
          type: "string",
          description: "ID del reclamo en MercadoLibre. Ej: C-123456789.",
        },
      },
      required: ["sellerId", "claimId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const claimId =
        typeof args.claimId === "string" && args.claimId.length > 0 ? args.claimId : null;
      if (!claimId) {
        return {
          error: "El parámetro 'claimId' es obligatorio y debe ser un string no vacío.",
        };
      }
      if (!mlcClient.getClaimStatusHistory) {
        return {
          error: "La consulta del historial de estados no está disponible en este momento.",
        };
      }

      try {
        const snapshot = await mlcClient.getClaimStatusHistory(sellerId, claimId);
        const data = snapshot.data;
        const timeline = data.history
          .map((h) => `${h.status ?? "?"} (${h.date ?? "sin fecha"})`)
          .join(" → ");
        return {
          ...snapshot,
          eventCount: data.history.length,
          timeline,
          summary:
            data.history.length > 0
              ? `${data.history.length} cambios de estado: ${timeline}`
              : "No hay historial de cambios de estado para este reclamo.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo leer el historial del reclamo: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// prepare_answer tool
// ---------------------------------------------------------------------------

export function createPrepareAnswerTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "prepare_answer",
    description:
      "Prepara una respuesta a una pregunta de comprador en MercadoLibre. " +
      "Esta herramienta NO publica la respuesta — solo la prepara para que el " +
      "vendedor la revise y apruebe. requiresApproval: true. noMutationExecuted: true. " +
      "Usá esta herramienta cuando el vendedor te pida responder una pregunta " +
      "de un comprador, pero NUNCA publiques sin confirmación explícita.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        questionId: {
          type: "string",
          description: "ID de la pregunta en MercadoLibre. Ej: 123456789.",
        },
        text: {
          type: "string",
          description: "Texto de la respuesta a publicar. Debe ser profesional y útil.",
        },
      },
      required: ["sellerId", "questionId", "text"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const questionId =
        typeof args.questionId === "string" && args.questionId.length > 0 ? args.questionId : null;
      if (!questionId) {
        return {
          error: "El parámetro 'questionId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const text = typeof args.text === "string" && args.text.length > 0 ? args.text : null;
      if (!text) {
        return {
          error: "El parámetro 'text' es obligatorio y debe ser un string no vacío.",
        };
      }
      if (!mlcClient.prepareAnswer) {
        return {
          error: "La preparación de respuestas no está disponible en este momento.",
        };
      }

      try {
        const snapshot = await mlcClient.prepareAnswer(sellerId, { questionId, text });
        return {
          ...snapshot,
          warning: "⚠️ Esta respuesta NO fue publicada. El vendedor debe aprobarla explícitamente.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo preparar la respuesta: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
