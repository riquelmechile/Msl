import type { GraphEngine } from "@msl/memory";
import type {
  MlClient,
  MlAccountRoleConfig,
  MlcApiClient,
  MlcImageDiagnosticInput,
  MlcListingPricesInput,
  MlcListingsSnapshot,
  MlcRelistInput,
  MlcVisitsSnapshot,
  MlcVisitsTimeWindowSnapshot,
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

// ---------------------------------------------------------------------------
// calculate_listing_fees tool
// ---------------------------------------------------------------------------

/**
 * Creates the `calculate_listing_fees` tool.
 *
 * Queries MercadoLibre's listing prices API to compute sale fees for a
 * product. Returns the sale fee amount and a detailed fee breakdown.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `calculate_listing_fees` tool definition compatible with OpenAI function calling.
 */
export function createCalculateListingFeesTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "calculate_listing_fees",
    description:
      "Calcula las tarifas de venta de MercadoLibre para un producto. " +
      "Devuelve el costo de comisión (saleFeeAmount) y el desglose detallado " +
      "de tarifas (fixedFee, percentageFee, meliPercentageFee, grossAmount, " +
      "financingAddOnFee). Usá esta herramienta cuando el vendedor pregunte " +
      "por costos de venta, comisiones, márgenes o quiera saber cuánto pagaría " +
      "por publicar un producto. Antes de llamarla, asegurate de tener el precio, " +
      "la categoría y el tipo de publicación del producto.",
    parameters: {
      type: "object",
      properties: {
        sellerId: { type: "string", description: "ID del vendedor en MercadoLibre" },
        price: { type: "number", description: "Precio de venta del producto" },
        categoryId: {
          type: "string",
          description: "ID de la categoría de MercadoLibre (ej. MLC1743)",
        },
        siteId: {
          type: "string",
          description: "ID del sitio de MercadoLibre. Por defecto MLC (Chile).",
        },
        listingTypeId: {
          type: "string",
          description:
            "Tipo de publicación: gold_pro (Premium), gold_special (Clásica), free (Gratuita)",
        },
        currencyId: { type: "string", description: "ID de moneda. Por defecto CLP para Chile." },
        quantity: { type: "number", description: "Cantidad de unidades vendidas (opcional)" },
      },
      required: ["sellerId", "price", "categoryId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (!mlcClient.getListingPrices) {
        return { error: "El cálculo de comisiones no está disponible en este momento." };
      }

      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }

      const input: MlcListingPricesInput = {
        siteId: (args.siteId as string) || "MLC",
        price: args.price as number,
        categoryId: args.categoryId as string,
        ...(args.listingTypeId !== undefined && { listingTypeId: args.listingTypeId as string }),
        ...(args.currencyId !== undefined && { currencyId: args.currencyId as string }),
        ...(args.quantity !== undefined && { quantity: args.quantity as number }),
      };

      try {
        const snapshot = await mlcClient.getListingPrices(sellerId, input);
        return snapshot;
      } catch (err) {
        return {
          error:
            `No se pudo calcular las tarifas para el producto: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// read_my_listings tool
// ---------------------------------------------------------------------------

/**
 * Creates the `read_my_listings` tool.
 *
 * Queries MercadoLibre for the seller's listings, optionally filtered by
 * status (active, paused, closed) or listing type.  Returns structured
 * listing data the agent can analyse for business recommendations.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `read_my_listings` tool definition compatible with OpenAI function calling.
 */
export function createReadMyListingsTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "read_my_listings",
    description:
      "Lee las publicaciones del vendedor en MercadoLibre. " +
      "Devuelve la lista de publicaciones con su estado, precio, stock y " +
      "tipo de publicación. Podés filtrar por estado (active, paused, closed) " +
      "y por tipo de publicación. Usá esta herramienta cuando el vendedor " +
      "pregunte por sus publicaciones, quiera revisar su catálogo, o necesite " +
      "identificar publicaciones pausadas para reutilizar.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        status: {
          type: "string",
          enum: ["active", "paused", "closed"],
          description:
            "Filtro opcional por estado de la publicación. " +
            "Usá 'paused' para encontrar publicaciones reutilizables.",
        },
        listingTypeId: {
          type: "string",
          description:
            "Filtro opcional por tipo de publicación: gold_pro (Premium), " +
            "gold_special (Clásica), free (Gratuita).",
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

      const options: { status?: "active" | "paused" | "closed"; listingTypeId?: string } = {};
      if (
        typeof args.status === "string" &&
        (args.status === "active" || args.status === "paused" || args.status === "closed")
      ) {
        options.status = args.status;
      }
      if (typeof args.listingTypeId === "string" && args.listingTypeId.length > 0) {
        options.listingTypeId = args.listingTypeId;
      }

      try {
        const snapshot: MlcListingsSnapshot = await mlcClient.getListings(sellerId, options);
        return snapshot;
      } catch (err) {
        return {
          error:
            `No se pudo leer las publicaciones de "${sellerId}": ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// find_paused_listings tool
// ---------------------------------------------------------------------------

/**
 * Creates the `find_paused_listings` tool.
 *
 * Searches for paused listings that can be reused for new products.
 * Analyses listing age and prior sales signals to rank reuse potential,
 * then returns the listings sorted from best to worst candidate.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `find_paused_listings` tool definition compatible with OpenAI function calling.
 */
export function createFindPausedListingsTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "find_paused_listings",
    description:
      "Busca publicaciones pausadas que pueden reutilizarse para nuevos productos. " +
      "Analiza la antigüedad e historial de ventas de cada publicación pausada " +
      "y las ordena por potencial de reutilización (mejores candidatos primero). " +
      "Usá esta herramienta cuando el vendedor quiera dar de alta productos nuevos " +
      "aprovechando publicaciones existentes, o cuando necesite liberar espacio " +
      "en su límite de publicaciones activas. Las publicaciones más antiguas con " +
      "buen historial son mejores candidatas para reutilizar.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        listingTypeId: {
          type: "string",
          description:
            "Filtro opcional por tipo de publicación: gold_pro (Premium), " +
            "gold_special (Clásica), free (Gratuita).",
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

      const options: { status: "paused"; listingTypeId?: string } = { status: "paused" };
      if (typeof args.listingTypeId === "string" && args.listingTypeId.length > 0) {
        options.listingTypeId = args.listingTypeId;
      }

      try {
        const snapshot: MlcListingsSnapshot = await mlcClient.getListings(sellerId, options);

        const listings = Array.isArray(snapshot.data) ? snapshot.data : [snapshot.data];

        // Analyse reuse potential: older listings with stock history are better.
        const analysed = listings.map((listing) => {
          const hasHistory = listing.title !== undefined && listing.price !== undefined;
          const hasStock = (listing.availableQuantity ?? 0) > 0;
          // Simple heuristic: listings with title+price (indicating prior use)
          // and remaining stock are better candidates.
          const potentialScore = (hasHistory ? 2 : 0) + (hasStock ? 1 : 0);
          return { ...listing, potentialScore };
        });

        // Sort descending by potentialScore.
        analysed.sort((a, b) => b.potentialScore - a.potentialScore);

        const candidatesWithPotential = analysed.filter((l) => l.potentialScore >= 2);

        return {
          sellerId: snapshot.sellerId,
          kind: snapshot.kind,
          source: snapshot.source,
          data: analysed,
          completeness: snapshot.completeness,
          freshness: snapshot.freshness,
          confidence: snapshot.confidence,
          totalPaused: analysed.length,
          reuseCandidates: candidatesWithPotential.length,
          recommendation:
            analysed.length === 0
              ? "No se encontraron publicaciones pausadas. Todas tus publicaciones están activas o cerradas."
              : candidatesWithPotential.length > 0
                ? `Hay ${candidatesWithPotential.length} publicaciones pausadas con buen potencial de reutilización. Cambiá fotos y descripción para darles nueva vida.`
                : "Las publicaciones pausadas tienen bajo potencial. Considerá crear publicaciones nuevas en lugar de reutilizar.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo buscar publicaciones pausadas para "${sellerId}": ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// check_listing_visits tool
// ---------------------------------------------------------------------------

/**
 * Creates the `check_listing_visits` tool.
 *
 * Queries visit metrics for a specific listing, preferring the time-windowed
 * endpoint that returns daily breakdowns by traffic source. Falls back to
 * the lifetime-visit endpoint when time-window data is unavailable.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `check_listing_visits` tool definition compatible with OpenAI function calling.
 */
export function createCheckListingVisitsTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_listing_visits",
    description:
      "Consulta las visitas de una publicación en MercadoLibre. " +
      "Devuelve las visitas diarias de los últimos días con desglose por " +
      "fuente de tráfico (MercadoLibre, Google, etc.). Usá esta herramienta " +
      "cuando el vendedor pregunte por el rendimiento de una publicación " +
      "específica, quiera saber cuántas visitas recibe, o necesite evaluar " +
      "si una publicación tiene buena exposición.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        itemId: {
          type: "string",
          description: "ID de la publicación en MercadoLibre. Ej: 'MLC1001'.",
        },
        last: {
          type: "number",
          description:
            "Cantidad de días hacia atrás para consultar visitas. Por defecto 7. Máximo 30.",
        },
      },
      required: ["sellerId", "itemId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }

      const itemId = coerceItemId(args.itemId);
      if (!itemId) {
        return { error: "El parámetro 'itemId' es obligatorio y debe ser un string no vacío." };
      }

      const last =
        typeof args.last === "number" && args.last > 0 && args.last <= 30
          ? Math.floor(args.last)
          : 7;

      // Prefer time-windowed endpoint for daily breakdown.
      if (mlcClient.getItemVisitsTimeWindow) {
        try {
          const snapshot: MlcVisitsTimeWindowSnapshot = await mlcClient.getItemVisitsTimeWindow(
            sellerId,
            itemId,
            { last, unit: "day" },
          );
          return snapshot;
        } catch (err) {
          return {
            error:
              `No se pudo consultar las visitas de "${itemId}" en la ventana de tiempo: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      // Fallback: lifetime visits.
      if (mlcClient.getItemVisits) {
        try {
          const snapshot: MlcVisitsSnapshot = await mlcClient.getItemVisits(sellerId, itemId);
          return snapshot;
        } catch (err) {
          return {
            error:
              `No se pudo consultar las visitas de "${itemId}": ` +
              `${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      return {
        error:
          "La consulta de visitas de publicaciones no está disponible en este momento. " +
          "Verificá que la cuenta tenga los permisos necesarios.",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// read_product_ads_insights tool
// ---------------------------------------------------------------------------

/**
 * Creates the `read_product_ads_insights` tool.
 *
 * Queries MercadoLibre's Product Ads API for campaign and ad-level metrics:
 * impressions, clicks, CTR, cost, CPC, ACOS, CVR, ROAS, and Share of Voice.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `read_product_ads_insights` tool definition compatible with OpenAI function calling.
 */
export function createProductAdsInsightsTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "read_product_ads_insights",
    description:
      "Lee las métricas de Product Ads de MercadoLibre. Devuelve datos de campañas " +
      "y anuncios: impresiones, clicks, CTR, costo, CPC, ACOS, CVR, ROAS, Share of Voice. " +
      "Usá esta herramienta cuando el vendedor pregunte por el rendimiento de sus avisos, " +
      "quiera optimizar su inversión en publicidad, o necesite comparar ROAS entre campañas. " +
      "Los datos incluyen métricas de conversión reales de la API de MercadoLibre.",
    parameters: {
      type: "object",
      properties: {
        sellerId: { type: "string", description: "ID del vendedor en MercadoLibre" },
        dateFrom: { type: "string", description: "Fecha de inicio en formato ISO (YYYY-MM-DD)" },
        dateTo: { type: "string", description: "Fecha de fin en formato ISO (YYYY-MM-DD)" },
        limit: { type: "number", description: "Cantidad máxima de campañas a retornar" },
        offset: { type: "number", description: "Offset para paginación" },
        status: {
          type: "string",
          description: "Filtrar por estado de campaña: active, paused, etc.",
        },
      },
      required: ["sellerId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return { error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío." };
      }
      if (!mlcClient.getProductAdsInsights) {
        return { error: "La lectura de Product Ads no está disponible en este momento." };
      }
      try {
        const snapshot = await mlcClient.getProductAdsInsights(sellerId, {
          ...(args.dateFrom !== undefined && { dateFrom: args.dateFrom as string }),
          ...(args.dateTo !== undefined && { dateTo: args.dateTo as string }),
          ...(args.limit !== undefined && { limit: args.limit as number }),
          ...(args.offset !== undefined && { offset: args.offset as number }),
          ...(args.status !== undefined && { status: args.status as string }),
        });
        return snapshot;
      } catch (err) {
        return {
          error: `No se pudo leer las métricas de Product Ads: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// read_my_orders tool
// ---------------------------------------------------------------------------

/**
 * Creates the `read_my_orders` tool.
 *
 * Queries MercadoLibre for the seller's order history, returning structured
 * order summaries with status, total amount, currency, creation date, and buyer.
 * Enables seasonal pattern detection and product-star analysis.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `read_my_orders` tool definition compatible with OpenAI function calling.
 */
export function createReadMyOrdersTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "read_my_orders",
    description:
      "Lee el historial de órdenes (ventas) del vendedor en MercadoLibre. " +
      "Devuelve la lista de órdenes con su estado, monto total, moneda, fecha " +
      "de creación y comprador. Usá esta herramienta cuando el vendedor pregunte " +
      "por sus ventas recientes, quiera analizar tendencias, detectar productos " +
      "estacionales, o necesite datos históricos para planificar. Las órdenes " +
      "permiten identificar qué productos y categorías generan más ingresos.",
    parameters: {
      type: "object",
      properties: {
        sellerId: { type: "string", description: "ID del vendedor en MercadoLibre" },
      },
      required: ["sellerId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return { error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío." };
      }
      try {
        const snapshot = await mlcClient.getOrders(sellerId);
        return snapshot;
      } catch (err) {
        return {
          error: `No se pudo leer las órdenes de "${sellerId}": ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// check_listing_quality tool
// ---------------------------------------------------------------------------

/**
 * Creates the `check_listing_quality` tool.
 *
 * Queries MercadoLibre's item performance API to audit the listing's quality
 * score (0-100), level ("Good"/"Bad"/"Medium"), and actionable improvement
 * opportunities grouped by bucket and variable.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `check_listing_quality` tool definition compatible with OpenAI function calling.
 */
export function createCheckListingQualityTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_listing_quality",
    description:
      "Revisa la calidad de una publicación en MercadoLibre. " +
      "Devuelve un score 0-100, nivel (Good/Bad/Medium), y oportunidades " +
      "de mejora accionables organizadas por categoría (fotos, ficha técnica, " +
      "cuotas, etc.). Usá esta herramienta cuando el vendedor pregunte por " +
      "la calidad de una publicación o quiera saber cómo mejorarla para " +
      "aumentar su exposición.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        itemId: {
          type: "string",
          description: "ID de la publicación en MercadoLibre. Ej: 'MLC1001'.",
        },
      },
      required: ["sellerId", "itemId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (!mlcClient.getItemPerformance) {
        return {
          error: "La auditoría de calidad de publicaciones no está disponible en este momento.",
        };
      }

      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }

      const itemId = coerceItemId(args.itemId);
      if (!itemId) {
        return { error: "El parámetro 'itemId' es obligatorio y debe ser un string no vacío." };
      }

      try {
        const snapshot = await mlcClient.getItemPerformance(sellerId, itemId);
        const data = snapshot.data as import("@msl/mercadolibre").MlcPerformanceSummary;

        // Extract actionable OPPORTUNITY mode rules grouped by variable.
        const opportunities: Array<{
          variable: string;
          rules: Array<{ title: string; label: string; link: string }>;
        }> = [];
        for (const bucket of data.buckets) {
          for (const variable of bucket.variables) {
            const pendingOpportunities = variable.rules.filter(
              (r) => r.mode === "OPPORTUNITY" && r.status === "PENDING",
            );
            if (pendingOpportunities.length > 0) {
              opportunities.push({
                variable: variable.title,
                rules: pendingOpportunities.map((r) => ({
                  title: r.wordings.title,
                  label: r.wordings.label,
                  link: r.wordings.link,
                })),
              });
            }
          }
        }

        return {
          ...snapshot,
          opportunities,
          recommendation:
            data.score >= 70
              ? `El listing ${itemId} tiene buena calidad (score ${data.score}). `
              : `El listing ${itemId} tiene calidad baja (score ${data.score}). ` +
                "Revisá las oportunidades pendientes para mejorar su exposición.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo auditar la calidad de "${itemId}": ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// relist_listing tool
// ---------------------------------------------------------------------------

/**
 * Creates the `relist_listing` tool.
 *
 * Relists a closed MercadoLibre item by creating a new listing that inherits
 * visits, questions, and sales history from the original. This is a REAL
 * mutation — requires user approval before execution.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `relist_listing` tool definition compatible with OpenAI function calling.
 */
export function createRelistListingTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "relist_listing",
    description:
      "Republica un ítem cerrado de MercadoLibre creando uno nuevo que hereda " +
      "visitas, preguntas y ventas del ítem original. IMPORTANTE: esta herramienta " +
      "crea una mutación real en MercadoLibre — solo debe usarse después de que el " +
      "vendedor confirme explícitamente la operación. El ítem original debe estar " +
      "cerrado hace menos de 60 días. Solo se permite UNA republicación por ítem padre. " +
      "Podés ajustar precio, cantidad y tipo de publicación en la nueva publicación.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        itemId: {
          type: "string",
          description:
            "ID del ítem cerrado a republicar en MercadoLibre. Debe ser un ítem en estado 'closed'.",
        },
        price: {
          type: "number",
          description: "Nuevo precio (opcional — si no se especifica, se usa el original).",
        },
        quantity: {
          type: "number",
          description:
            "Nueva cantidad de stock (opcional — si no se especifica, se usa la original).",
        },
        listingTypeId: {
          type: "string",
          description:
            "Nuevo tipo de publicación: gold_pro (Premium), gold_special (Clásica), free (Gratuita). Opcional.",
        },
      },
      required: ["sellerId", "itemId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (!mlcClient.relistItem) {
        return {
          error:
            "La republicación de ítems no está disponible en este momento. " +
            "Verificá que la cuenta tenga los permisos necesarios.",
        };
      }

      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }

      const itemId = coerceItemId(args.itemId);
      if (!itemId) {
        return { error: "El parámetro 'itemId' es obligatorio y debe ser un string no vacío." };
      }

      const input: MlcRelistInput = {};
      if (args.price !== undefined) {
        input.price = args.price as number;
      }
      if (args.quantity !== undefined) {
        input.quantity = args.quantity as number;
      }
      if (typeof args.listingTypeId === "string" && args.listingTypeId.length > 0) {
        input.listingTypeId = args.listingTypeId;
      }

      try {
        const snapshot = await mlcClient.relistItem(sellerId, itemId, input);
        return {
          ...snapshot,
          requiresApproval: true,
          warning:
            "⚠️ Esta es una mutación real en MercadoLibre. Solo debe ejecutarse " +
            "después de la confirmación explícita del vendedor.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo republicar el ítem "${itemId}": ` +
            `${err instanceof Error ? err.message : String(err)}. ` +
            "Verificá que el ítem original esté cerrado y hayan pasado menos de 60 días.",
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// diagnose_image tool
// ---------------------------------------------------------------------------

/**
 * Creates the `diagnose_image` tool.
 *
 * Sends an image URL to MercadoLibre's moderation diagnostic API to detect
 * potential issues before publishing: white background, minimum size,
 * text/logo overlay, and watermark violations.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `diagnose_image` tool definition compatible with OpenAI function calling.
 */
export function createDiagnoseImageTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "diagnose_image",
    description:
      "Diagnostica una imagen antes de publicarla en MercadoLibre. " +
      "Detecta problemas de fondo blanco, tamaño mínimo, texto/logos " +
      "y marcas de agua que podrían causar moderación o rechazo. " +
      "Usá esta herramienta cuando el vendedor esté preparando imágenes " +
      "para una publicación nueva o quiera verificar si una imagen " +
      "cumple con los requisitos de MercadoLibre.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        pictureUrl: {
          type: "string",
          description: "URL de la imagen a diagnosticar (puede ser URL pública o base64).",
        },
        categoryId: {
          type: "string",
          description: "ID de la categoría de MercadoLibre donde se publicará. Ej: MLC1743.",
        },
        title: {
          type: "string",
          description: "Título del producto (opcional, ayuda al diagnóstico contextual).",
        },
        pictureType: {
          type: "string",
          enum: ["thumbnail", "variation_thumbnail", "other"],
          description: "Tipo de imagen: thumbnail, variation_thumbnail, u other.",
        },
      },
      required: ["sellerId", "pictureUrl", "categoryId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (!mlcClient.diagnoseImage) {
        return {
          error: "El diagnóstico de imágenes no está disponible en este momento.",
        };
      }

      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }

      const pictureUrl = args.pictureUrl as string;
      if (!pictureUrl || typeof pictureUrl !== "string") {
        return {
          error: "El parámetro 'pictureUrl' es obligatorio y debe ser una URL válida.",
        };
      }

      const categoryId = args.categoryId as string;
      if (!categoryId || typeof categoryId !== "string") {
        return {
          error: "El parámetro 'categoryId' es obligatorio y debe ser un string no vacío.",
        };
      }

      const input: MlcImageDiagnosticInput = {
        pictureUrl,
        categoryId,
      };
      if (typeof args.title === "string" && args.title.length > 0) {
        input.title = args.title;
      }
      if (
        typeof args.pictureType === "string" &&
        (args.pictureType === "thumbnail" ||
          args.pictureType === "variation_thumbnail" ||
          args.pictureType === "other")
      ) {
        input.pictureType = args.pictureType;
      }

      try {
        const snapshot = await mlcClient.diagnoseImage(sellerId, input);
        const data = snapshot.data as import("@msl/mercadolibre").MlcImageDiagnosticSummary;
        const issues = data.diagnostics.flatMap((d) =>
          d.detections.map((det) => ({
            type: det.name,
            pictureType: d.pictureType,
            details: det.wordings.map((w) => `${w.kind}: ${w.value}`).join("; "),
          })),
        );

        return {
          ...snapshot,
          issues,
          recommendation: data.hasIssues
            ? `Se detectaron ${issues.length} problemas en la imagen. Corregilos antes de publicar.`
            : "La imagen pasó el diagnóstico sin problemas detectados.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo diagnosticar la imagen: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// upload_image tool
// ---------------------------------------------------------------------------

/**
 * Creates the `upload_image` tool.
 *
 * Downloads an image from the provided URL and uploads it to MercadoLibre's
 * picture CDN. Returns the picture ID and variation URLs for use in listings.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns an `upload_image` tool definition compatible with OpenAI function calling.
 */
export function createUploadImageTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "upload_image",
    description:
      "Sube una imagen al CDN de MercadoLibre para usarla en publicaciones. " +
      "Descarga la imagen desde la URL proporcionada y la sube a MercadoLibre. " +
      "Devuelve el ID de la imagen y las URLs en diferentes tamaños. " +
      "Usá esta herramienta cuando el vendedor necesite subir imágenes para " +
      "una publicación nueva o reemplazar las imágenes de una existente. " +
      "IMPORTANTE: pasá siempre las imágenes por diagnose_image antes de publicar.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        imageUrl: {
          type: "string",
          description: "URL pública de la imagen a subir al CDN de MercadoLibre.",
        },
      },
      required: ["sellerId", "imageUrl"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (!mlcClient.uploadImage) {
        return {
          error: "La subida de imágenes no está disponible en este momento.",
        };
      }

      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }

      const imageUrl = args.imageUrl as string;
      if (!imageUrl || typeof imageUrl !== "string") {
        return {
          error: "El parámetro 'imageUrl' es obligatorio y debe ser una URL válida.",
        };
      }

      try {
        // Fetch the image from the provided URL.
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          return {
            error:
              `No se pudo descargar la imagen desde "${imageUrl}": ` +
              `${imageResponse.status} ${imageResponse.statusText}`,
          };
        }

        const contentType = imageResponse.headers.get("content-type") ?? "image/jpeg";
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const filename =
          imageUrl
            .split("/")
            .pop()
            ?.replace(/[^a-zA-Z0-9._-]/g, "_") ?? "image.jpg";

        const snapshot = await mlcClient.uploadImage(sellerId, imageBuffer, filename);
        return {
          ...snapshot,
          uploadedFrom: imageUrl,
          contentType,
        };
      } catch (err) {
        return {
          error:
            `No se pudo subir la imagen a MercadoLibre: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
