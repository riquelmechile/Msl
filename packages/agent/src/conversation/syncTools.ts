import type { GraphEngine } from "@msl/memory";
import type {
  MlClient,
  MlAccountRoleConfig,
  ProductSyncEngine,
  SyncResult,
  SyncReport,
  MlUserSnapshot,
} from "@msl/mercadolibre";
import { assertPlasticovToMaustianDirection } from "@msl/mercadolibre";
import type { Strategy as SyncStrategy } from "@msl/mercadolibre";

import type { ToolDefinition } from "./tools.js";

export type SyncToolOptions = {
  approvedExecution?: boolean;
  accountConfig?: MlAccountRoleConfig;
};

function approvalRequired(tool: "sync_product" | "sync_all"): Record<string, unknown> {
  return {
    status: "approval_required",
    tool,
    error:
      "Direct LLM sync execution is blocked. Prepare an approval-required proposal and execute only through the explicit approved sync path.",
  };
}

function validateSyncDirection(
  sourceSellerId: string,
  targetSellerId: string,
  options?: SyncToolOptions,
): Record<string, unknown> | undefined {
  try {
    if (options?.accountConfig) {
      assertPlasticovToMaustianDirection(sourceSellerId, targetSellerId, {
        MERCADOLIBRE_SOURCE_SELLER_ID: options.accountConfig.sourceSellerId,
        MERCADOLIBRE_TARGET_SELLER_ID: options.accountConfig.targetSellerId,
      });
    } else {
      assertPlasticovToMaustianDirection(sourceSellerId, targetSellerId);
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Converts tool-call arguments (plain objects) into sync-engine Strategy objects.
 *
 * The tool receives strategies from the agent loop as serialised plain objects.
 * This function coerces them into the discriminated union the engine expects.
 */
function coerceStrategies(raw: unknown): SyncStrategy[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is SyncStrategy =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as Record<string, unknown>).type === "string",
  );
}

/**
 * Coerces a seller-id argument into a non-empty string.
 * Returns `undefined` when the value is missing or invalid.
 */
function coerceSellerId(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/** Coerces an item-id argument the same way. */
function coerceItemId(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

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

// ---------------------------------------------------------------------------
// Cortex integration helpers
// ---------------------------------------------------------------------------

/**
 * Persists a sync-outcome node in the Cortex graph and applies Hebbian
 * reinforcement on successful syncs.
 *
 * - Creates (or reuses) seller-account nodes for source and target.
 * - Creates a `sync_outcome` node tagged with the item ID, status, and pricing data.
 * - On success (`"published"`): Hebbian reinforces edges between the sync
 *   node and the target-seller node (+0.1).
 * - On failure: penalises edges (−0.15).
 *
 * This allows future queries (e.g. "¿cómo fue la última sincronización?")
 * to activate the relevant subgraph.
 */
function storeSyncOutcome(
  cortex: GraphEngine,
  result: SyncResult,
  sourceSellerId: string,
  targetSellerId: string,
): void {
  // 1. Ensure seller-account nodes exist (idempotent via label matching).
  const sourceNode = ensureSellerNode(cortex, sourceSellerId);
  const targetNode = ensureSellerNode(cortex, targetSellerId);

  // 2. Create a sync-outcome node.
  const outcomeNode = cortex.createNode(
    `sync_${result.itemId}_${new Date().toISOString().slice(0, 10)}`,
    {
      type: "sync_outcome",
      itemId: result.itemId,
      status: result.status,
      sourcePrice: result.sourcePrice,
      targetPrice: result.targetPrice,
      margin: result.margin,
      error: result.error ?? null,
      sourceSeller: sourceSellerId,
      targetSeller: targetSellerId,
    },
  );

  // 3. Edge: outcome → target seller node. Hebbian update on success/failure.
  ensureEdge(cortex, outcomeNode.id, targetNode.id);
  ensureEdge(cortex, outcomeNode.id, sourceNode.id);

  if (result.status === "published") {
    try {
      cortex.reinforceEdge(outcomeNode.id, targetNode.id);
      cortex.reinforceEdge(outcomeNode.id, sourceNode.id);
    } catch {
      // Edge might not exist yet — it is created above so this is defensive.
    }
  } else if (result.status === "failed") {
    try {
      cortex.penalizeEdge(outcomeNode.id, targetNode.id);
    } catch {
      // Defensive — edge creation above should prevent this.
    }
  }
}

/**
 * Finds or creates a Cortex node labelled with the seller ID.
 *
 * Uses metadata LIKE matching for idempotency: re-running the same
 * sync batch on the same seller reuses the existing node.
 */
function ensureSellerNode(cortex: GraphEngine, sellerId: string): { id: number; label: string } {
  const existing = cortex.db
    .prepare("SELECT id, label FROM nodes WHERE metadata LIKE ?")
    .get(`%"sellerId":"${sellerId}"%`) as { id: number; label: string } | undefined;

  if (existing) return existing;

  const node = cortex.createNode(`seller_${sellerId}`, {
    type: "seller_account",
    sellerId,
  });
  return { id: node.id, label: node.label };
}

/**
 * Creates a bidirectional edge if one doesn't already exist between two nodes.
 * Safe to call multiple times — duplicate edges are caught and ignored.
 */
function ensureEdge(cortex: GraphEngine, source: number, target: number): void {
  try {
    cortex.createEdge(source, target);
  } catch {
    // Edge already exists — idempotent, nothing to do.
  }
}
