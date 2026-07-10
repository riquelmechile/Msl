import type { AccountBrainService } from "../accountBrainService.js";
import type { ToolDefinition } from "./types.js";
import { safeString } from "./types.js";

/**
 * CEO tool: get_account_brain_status
 *
 * Reads AccountBrainStatus per seller from the AccountBrainService.
 * Read-only — no mutations, no DeepSeek calls.
 */
export function createGetAccountBrainStatusTool(service?: AccountBrainService): ToolDefinition {
  return {
    name: "get_account_brain_status",
    description:
      "Visualizador estratégico de cuenta. Retorna estado de salud, capacidades, riesgos, " +
      "oportunidades, actividad de agentes, aprobaciones pendientes, costos y presencia en " +
      "Cortex. Solo lectura — nunca ejecuta mutaciones en MercadoLibre.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description:
            "ID del vendedor (plasticov, maustian). Opcional — si se omite, retorna todas las cuentas activas.",
        },
        accountName: {
          type: "string",
          description: "Nombre de cuenta alternativo para búsqueda. Opcional.",
        },
        includeLessons: {
          type: "boolean",
          description: "Incluir lecciones aprendidas transferibles. Default: true.",
        },
        includeCosts: {
          type: "boolean",
          description: "Incluir desglose de costos por agente. Default: true.",
        },
        includePendingApprovals: {
          type: "boolean",
          description: "Incluir aprobaciones pendientes del CEO Inbox. Default: true.",
        },
      },
      required: [],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      if (!service) {
        return {
          status: "unavailable",
          message:
            "AccountBrainService not configured. Enable account asset tracking to use this tool.",
          noMutationExecuted: true,
        };
      }

      const sellerId = safeString(args.sellerId) || undefined;
      const includeLessons = args.includeLessons !== false;
      const includeCosts = args.includeCosts !== false;
      const includePendingApprovals = args.includePendingApprovals !== false;

      // When no sellerId provided, query all known active sellers
      const sellers = sellerId ? [sellerId] : ["plasticov", "maustian"];

      const results: Record<string, unknown>[] = [];
      for (const seller of sellers) {
        try {
          const status = service.getAccountBrainStatus(seller, {
            sellerId: seller,
            includeLessons,
            includeCosts,
            includePendingApprovals,
          });

          // Only include results for accounts that actually exist
          if (status.status !== "missing_account_asset" || sellerId) {
            results.push(status);
          }
        } catch {
          results.push({
            sellerId: seller,
            status: "unavailable",
            message: `Failed to retrieve status for ${seller}.`,
            noMutationExecuted: true,
          });
        }
      }

      if (results.length === 0) {
        return {
          status: "no_accounts_found",
          message: "No active accounts found. Register accounts in AccountAssetStore first.",
          noMutationExecuted: true,
        };
      }

      // Single seller → return the object directly; multiple → return array
      return sellerId
        ? { ...results[0], noMutationExecuted: true }
        : { accounts: results, noMutationExecuted: true };
    },
  };
}

/**
 * CEO tool: compare_account_assets
 *
 * Compares two or more seller accounts side-by-side with a recommendation
 * (not execution). Read-only — always requires CEO approval before any action.
 */
export function createCompareAccountAssetsTool(service?: AccountBrainService): ToolDefinition {
  return {
    name: "compare_account_assets",
    description:
      "Compara cuentas de vendedor lado a lado (ej. Plasticov vs Maustian) para decidir " +
      "cuál usar para un producto u oportunidad. Puntúa por capacidades, salud, riesgo, " +
      "profit, y costos. Retorna ranking con recomendación. Solo lectura — requiere " +
      "aprobación del CEO antes de cualquier acción.",
    parameters: {
      type: "object",
      properties: {
        productName: {
          type: "string",
          description: "Nombre o descripción del producto/oportunidad a evaluar.",
        },
        category: {
          type: "string",
          description: "Categoría del producto para filtrado de capacidades.",
        },
        requiredCapabilities: {
          type: "array",
          items: { type: "string" },
          description: "Capacidades requeridas para este producto (ej. Fulfillment, Advertising).",
        },
        goal: {
          type: "string",
          enum: ["maximize_profit", "reduce_risk", "grow_reputation", "clear_stock", "test_market"],
          description:
            "Objetivo del CEO que ajusta los pesos del ranking. " +
            "maximize_profit pondera margen y oportunidad. " +
            "reduce_risk pondera nivel de riesgo. " +
            "grow_reputation pondera reputación y salud de capacidades. " +
            "clear_stock pondera velocidad de venta. " +
            "test_market pondera capacidades disponibles.",
        },
        candidateSellerIds: {
          type: "array",
          items: { type: "string" },
          description:
            "IDs de vendedores a comparar. Opcional — si se omite, compara todas las cuentas activas.",
        },
      },
      required: [],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      if (!service) {
        return {
          recommendedSellerId: null,
          confidence: "low",
          ranking: [],
          decisionLogic: "AccountBrainService not configured.",
          evidence: [],
          suggestedNextAction: {
            kind: "collect_more_evidence",
            description:
              "AccountBrainService not configured. Enable account asset tracking to use this tool.",
            requiresApproval: true,
          },
          noMutationExecuted: true,
        };
      }

      const productName = safeString(args.productName) || undefined;
      const goal = safeString(args.goal) || undefined;
      const candidateSellerIds = Array.isArray(args.candidateSellerIds)
        ? args.candidateSellerIds.filter((id): id is string => typeof id === "string")
        : undefined;

      try {
        // Build input with only provided fields to satisfy exactOptionalPropertyTypes
        const input: Record<string, unknown> = { includeEvidence: true };
        if (productName) input.opportunity = productName;
        if (candidateSellerIds) input.candidateSellerIds = candidateSellerIds;
        if (goal) input.goal = goal;

        const result = service.compareAccountAssets(input);

        return { ...result, noMutationExecuted: true };
      } catch {
        return {
          recommendedSellerId: null,
          confidence: "low",
          ranking: [],
          decisionLogic: "Comparison failed — internal error.",
          evidence: [
            {
              source: "AccountBrainService",
              observation: "Exception during comparison.",
            },
          ],
          suggestedNextAction: {
            kind: "collect_more_evidence",
            description: "Comparison failed. Check account data and retry.",
            requiresApproval: true,
          },
          noMutationExecuted: true,
        };
      }
    },
  };
}
