import type { MlClient, MlUserSnapshot, ProductSyncEngine, SyncResult, SyncReport } from "@msl/mercadolibre";
import type { GraphEngine } from "@msl/memory";

import type { ToolDefinition } from "../tools.js";
import {
  approvalRequired,
  coerceStrategies,
  coerceSellerId,
  coerceItemId,
  storeSyncOutcome,
  validateSyncDirection,
  type SyncToolOptions,
} from "./_shared.js";

// ---------------------------------------------------------------------------
// sync_product tool
// ---------------------------------------------------------------------------

/**
 * Creates the `sync_product` tool.
 *
 * Synchronises a single product across the configured Plasticov → Maustian
 * boundary, applying CEO strategies for margin, pricing, category filtering,
 * and stock without treating the accounts as a business hierarchy.
 *
 * @param syncEngine — the `ProductSyncEngine` instance orchestrating extract→apply→diff→publish.
 * @param cortex — optional Cortex GraphEngine for persisting sync-outcome nodes.
 * @returns a `sync_product` tool definition compatible with OpenAI function calling.
 */
export function createSyncProductTool(
  syncEngine: ProductSyncEngine,
  cortex?: GraphEngine,
  options: SyncToolOptions = {},
): ToolDefinition {
  return {
    name: "sync_product",
    description:
      "Prepara sync Plasticov a Maustian aplicando estrategias de CEO y safety gates. " +
      "Usa esta herramienta cuando el vendedor quiera publicar un producto específico " +
      "en su cuenta Maustian con las reglas de margen, filtro de categoría, stock y " +
      "precios configuradas por el CEO. IMPORTANTE: solo se ejecuta si hay estrategias " +
      "de CEO activas y el vendedor confirma con 'dale'.",
    parameters: {
      type: "object",
      properties: {
        sourceSellerId: {
          type: "string",
          description:
            "ID del vendedor configurado como origen para este sync (Plasticov). Ej: 'plasticov'.",
        },
        targetSellerId: {
          type: "string",
          description:
            "ID del vendedor configurado como destino para este sync (Maustian). Ej: 'maustian'.",
        },
        itemId: {
          type: "string",
          description: "ID del producto en MercadoLibre a sincronizar. Ej: 'MLC1001'.",
        },
        strategies: {
          type: "array",
          description:
            "Lista de estrategias de CEO a aplicar. Cada estrategia debe tener " +
            "un campo 'type' ('margin', 'category_filter', 'stock', 'pricing_rule') " +
            "con los parámetros correspondientes.",
          items: { type: "object" },
        },
      },
      required: ["sourceSellerId", "targetSellerId", "itemId", "strategies"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sourceSellerId = coerceSellerId(args.sourceSellerId);
      const targetSellerId = coerceSellerId(args.targetSellerId);
      const itemId = coerceItemId(args.itemId);

      if (!sourceSellerId || !targetSellerId || !itemId) {
        return {
          error:
            "Los parámetros 'sourceSellerId', 'targetSellerId' e 'itemId' son obligatorios " +
            "y deben ser strings no vacíos.",
        };
      }

      const directionError = validateSyncDirection(sourceSellerId, targetSellerId, options);
      if (directionError) return directionError;

      if (!options.approvedExecution) return approvalRequired("sync_product");

      const strategies = coerceStrategies(args.strategies);
      if (strategies.length === 0) {
        return {
          error:
            "No hay estrategias de CEO activas. " +
            "Definí al menos una estrategia (margen, filtro de categoría, stock o regla de precio) " +
            "antes de sincronizar productos. Usá 'cambiá margen a 50%' o 'no competir en juguetes'.",
        };
      }

      const result: SyncResult = await syncEngine.syncProduct(
        sourceSellerId,
        targetSellerId,
        itemId,
        strategies,
      );

      // Cortex integration: store sync outcome node and reinforce on success.
      if (cortex) {
        storeSyncOutcome(cortex, result, sourceSellerId, targetSellerId);
      }

      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// sync_all tool
// ---------------------------------------------------------------------------

/**
 * Creates the `sync_all` tool.
 *
 * Runs the configured Plasticov → Maustian sync boundary for pending products,
 * applying CEO strategies. By default only processes changed/unsynced items
 * (differential mode). An optional `limit` caps the number of items processed.
 *
 * @param syncEngine — the `ProductSyncEngine` instance.
 * @param cortex — optional Cortex GraphEngine for persisting sync-outcome nodes.
 * @returns a `sync_all` tool definition compatible with OpenAI function calling.
 */
export function createSyncAllTool(
  syncEngine: ProductSyncEngine,
  cortex?: GraphEngine,
  options: SyncToolOptions = {},
): ToolDefinition {
  return {
    name: "sync_all",
    description:
      "Prepara la operación masiva del sync configurado Plasticov a Maustian. " +
      "Usa esta herramienta cuando el vendedor quiera procesar dentro de ese " +
      "límite los productos que cambiaron o no fueron sincronizados aún. " +
      "IMPORTANTE: solo se ejecuta si hay estrategias de CEO activas y el " +
      "vendedor confirma con 'dale'.",
    parameters: {
      type: "object",
      properties: {
        sourceSellerId: {
          type: "string",
          description:
            "ID del vendedor configurado como origen para esta operación de sync (Plasticov). Ej: 'plasticov'.",
        },
        targetSellerId: {
          type: "string",
          description:
            "ID del vendedor configurado como destino para esta operación de sync (Maustian). Ej: 'maustian'.",
        },
        strategies: {
          type: "array",
          description:
            "Lista de estrategias de CEO a aplicar. Cada estrategia debe tener " +
            "un campo 'type' ('margin', 'category_filter', 'stock', 'pricing_rule') " +
            "con los parámetros correspondientes.",
          items: { type: "object" },
        },
        limit: {
          type: "number",
          description: "Cantidad máxima de productos a procesar (opcional).",
        },
        differential: {
          type: "boolean",
          description:
            "Si es true (por defecto), solo procesa productos cambiados o no sincronizados. " +
            "Si es false, procesa todos los productos.",
        },
      },
      required: ["sourceSellerId", "targetSellerId", "strategies"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sourceSellerId = coerceSellerId(args.sourceSellerId);
      const targetSellerId = coerceSellerId(args.targetSellerId);

      if (!sourceSellerId || !targetSellerId) {
        return {
          error:
            "Los parámetros 'sourceSellerId' y 'targetSellerId' son obligatorios " +
            "y deben ser strings no vacíos.",
        };
      }

      const directionError = validateSyncDirection(sourceSellerId, targetSellerId, options);
      if (directionError) return directionError;

      if (!options.approvedExecution) return approvalRequired("sync_all");

      const strategies = coerceStrategies(args.strategies);
      if (strategies.length === 0) {
        return {
          error:
            "No hay estrategias de CEO activas. " +
            "Definí al menos una estrategia antes de sincronizar productos.",
        };
      }

      const syncOptions: { differential?: boolean; limit?: number } = {};
      if (typeof args.differential === "boolean") {
        syncOptions.differential = args.differential;
      }
      if (typeof args.limit === "number" && args.limit > 0) {
        syncOptions.limit = args.limit;
      }

      const report: SyncReport = await syncEngine.syncAll(
        sourceSellerId,
        targetSellerId,
        strategies,
        syncOptions,
      );

      // Cortex integration: store outcomes for each synced product.
      if (cortex) {
        for (const result of report.results) {
          storeSyncOutcome(cortex, result, sourceSellerId, targetSellerId);
        }
      }

      return report;
    },
  };
}

// ---------------------------------------------------------------------------
// check_account tool
// ---------------------------------------------------------------------------

/**
 * Creates the `check_account` tool.
 *
 * Queries MercadoLibre for the current account status and reputation level
 * of a connected seller.
 *
 * @param mlClient — the `MlClient` instance for API calls.
 * @returns a `check_account` tool definition compatible with OpenAI function calling.
 */
export function createCheckAccountTool(mlClient: MlClient): ToolDefinition {
  return {
    name: "check_account",
    description:
      "Verifica el estado y nivel de una cuenta de MercadoLibre. " +
      "Devuelve el nivel (classic/premium/platinum), reputación, puntos " +
      "y estado de la cuenta del vendedor conectado.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor a verificar. Ej: 'plasticov' o 'maustian'.",
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

      try {
        const snapshot: MlUserSnapshot = await mlClient.getUserInfo(sellerId);
        return snapshot.data;
      } catch (err) {
        return {
          error:
            `No se pudo verificar la cuenta de "${sellerId}": ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
