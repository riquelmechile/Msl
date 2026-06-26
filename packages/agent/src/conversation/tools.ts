import type { GraphEngine, TraversalResult } from "@msl/memory";
import { riskLevelForAction } from "@msl/domain";

import type { AgentProposal } from "./types.js";

/**
 * Tool definition shape compatible with OpenAI function-calling schema.
 */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
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
export function createGetBusinessContextTool(
  engine: GraphEngine,
): ToolDefinition {
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
        .prepare(
          `SELECT id, label FROM nodes WHERE ${placeholders} LIMIT 20`,
        )
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
          description:
            "Identificador de la entidad objetivo (listingId, orderId, etc.).",
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
          description:
            "Justificación de por qué esta acción es necesaria. Requerido siempre.",
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
        riskLevel: riskLevelForAction(
          kind as AgentProposal["action"]["kind"],
        ),
      };

      return proposal;
    },
  };
}
