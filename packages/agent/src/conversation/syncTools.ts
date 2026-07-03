import type { GraphEngine, OperationalReadModelReader } from "@msl/memory";
import type {
  MlClient,
  MlAccountRoleConfig,
  MlcApiClient,
  MlcImageDiagnosticInput,
  MlcListingPricesInput,
  MlcListingsSnapshot,
  MlcAutomatedPriceItemsSnapshot,
  MlcPricingAutomationHistorySnapshot,
  MlcPricingAutomationRulesSnapshot,
  MlcItemPromotionsSnapshot,
  MlcPromotionDetailSnapshot,
  MlcPromotionItemsSnapshot,
  MlcRelistInput,
  MlcSellerPromotionsSnapshot,
  MlcVisitsSnapshot,
  MlcVisitsTimeWindowSnapshot,
  NewItem,
  MlWriteSnapshot,
  ProductSyncEngine,
  SyncResult,
  SyncReport,
  MlUserSnapshot,
  MlcListingSummary,
} from "@msl/mercadolibre";
import {
  assertPlasticovToMaustianDirection,
  PRICING_AUTOMATION_HISTORY_DEFAULT_DAYS,
  PRICING_AUTOMATION_HISTORY_DEFAULT_PAGE,
  PRICING_AUTOMATION_HISTORY_DEFAULT_SIZE,
  PRICING_AUTOMATION_HISTORY_MAX_SIZE,
  PRICING_AUTOMATION_ITEMS_DEFAULT_LIMIT,
  PRICING_AUTOMATION_ITEMS_MAX_LIMIT,
  MLC_PROMOTIONS_ITEMS_DEFAULT_LIMIT,
  MLC_PROMOTIONS_ITEMS_MAX_LIMIT,
  normalizeImageOrchestration,
} from "@msl/mercadolibre";
import type { Strategy as SyncStrategy } from "@msl/mercadolibre";

import type { ToolDefinition } from "./tools.js";
import { sanitizeToolErrorText } from "./toolErrorSanitizer.js";

export type SyncToolOptions = {
  approvedExecution?: boolean;
  accountConfig?: MlAccountRoleConfig;
};

const DEFAULT_SALE_PRICE_CONTEXT = "channel_marketplace,buyer_loyalty_3";

type OptionalToolRead<T> = { data?: T; error?: { endpoint: string; message: string } };
type PriceIntelligenceEndpointKey =
  | "salePrice"
  | "prices"
  | "priceToWin"
  | "automation"
  | "itemRules"
  | "productRules"
  | "history";

type PriceIntelligenceEndpointResult = {
  salePrice: OptionalToolRead<unknown>;
  prices: OptionalToolRead<unknown>;
  priceToWin: OptionalToolRead<unknown>;
  automation: OptionalToolRead<unknown>;
  itemRules: OptionalToolRead<MlcPricingAutomationRulesSnapshot>;
  productRules: OptionalToolRead<MlcPricingAutomationRulesSnapshot>;
  history: OptionalToolRead<MlcPricingAutomationHistorySnapshot>;
};

type PriceIntelligenceEndpointSpec<K extends PriceIntelligenceEndpointKey> = {
  key: K;
  read: () => Promise<PriceIntelligenceEndpointResult[K]>;
};

function approvalRequired(
  tool: "sync_product" | "sync_all" | "create_listing",
): Record<string, unknown> {
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

function coercePromotionId(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function coercePromotionType(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function metadataString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function isMlcListingSummary(value: unknown): value is MlcListingSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
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

        const rawListings: unknown = snapshot.data;
        const listings = Array.isArray(rawListings)
          ? rawListings.filter(isMlcListingSummary)
          : isMlcListingSummary(rawListings)
            ? [rawListings]
            : [];

        // Analyse reuse potential: older listings with stock history are better.
        const analysed = listings.map((listing): MlcListingSummary & { potentialScore: number } => {
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
// price intelligence tools
// ---------------------------------------------------------------------------

/**
 * Creates the `check_price_intelligence` tool.
 *
 * Aggregates read-only pricing signals for one MercadoLibre listing: sale price,
 * price book, catalog price-to-win, pricing automation state, and optional
 * automation rules/history. It never mutates prices and explicitly surfaces
 * the 2026 automation guard.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `check_price_intelligence` tool definition compatible with OpenAI function calling.
 */
export function createCheckPriceIntelligenceTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_price_intelligence",
    description:
      "Consulta inteligencia de precios READ-ONLY para una publicación: precio real " +
      "que ve el comprador (sale_price), lista de precios, precio para ganar catálogo " +
      "(price_to_win v2), estado de automatización, reglas disponibles e historial " +
      "reciente de automatización de precios. Usá esta herramienta " +
      "cuando el vendedor pregunte qué precio necesita para ganar catálogo, qué precio " +
      "está viendo el comprador, qué regla de automatización puede usar, qué cambios hizo " +
      "la automatización, o si una publicación/producto de catálogo puede automatizarse. " +
      "No cambia precios. Desde 2026, si hay automatización activa, los cambios de " +
      "precio vía /items pueden ser rechazados o ignorados.",
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
        salePriceContext: {
          type: "string",
          description: `Contexto opcional para sale_price. Por defecto usa ${DEFAULT_SALE_PRICE_CONTEXT}.`,
        },
        includeRules: {
          type: "boolean",
          description:
            "Si true, consulta reglas disponibles para el item y opcionalmente producto de catálogo.",
        },
        catalogProductId: {
          type: "string",
          description:
            "ID del producto de catálogo MLC para consultar reglas disponibles por producto.",
        },
        includeHistory: {
          type: "boolean",
          description: "Si true, consulta historial reciente de cambios hechos por automatización.",
        },
        historyDays: {
          type: "number",
          description: `Días de historial de automatización. Default ${PRICING_AUTOMATION_HISTORY_DEFAULT_DAYS}.`,
        },
        historyPage: {
          type: "number",
          description: `Página del historial. Default ${PRICING_AUTOMATION_HISTORY_DEFAULT_PAGE}.`,
        },
        historySize: {
          type: "number",
          description: `Tamaño de página del historial. Default ${PRICING_AUTOMATION_HISTORY_DEFAULT_SIZE}, máximo ${PRICING_AUTOMATION_HISTORY_MAX_SIZE}.`,
        },
      },
      required: ["sellerId", "itemId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return { error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío." };
      }

      const itemId = coerceItemId(args.itemId);
      if (!itemId) {
        return { error: "El parámetro 'itemId' es obligatorio y debe ser un string no vacío." };
      }

      const context =
        typeof args.salePriceContext === "string" && args.salePriceContext.length > 0
          ? args.salePriceContext
          : DEFAULT_SALE_PRICE_CONTEXT;
      const includeRules = args.includeRules === true || typeof args.catalogProductId === "string";
      const includeHistory = args.includeHistory === true;
      const catalogProductId =
        typeof args.catalogProductId === "string" && args.catalogProductId.length > 0
          ? args.catalogProductId
          : undefined;
      const historyOptions: { days?: number; page?: number; size?: number } = {};
      if (typeof args.historyDays === "number") historyOptions.days = args.historyDays;
      if (typeof args.historyPage === "number") historyOptions.page = args.historyPage;
      if (typeof args.historySize === "number") historyOptions.size = args.historySize;

      const readOptional = async <T>(
        name: string,
        reader: (() => Promise<T>) | undefined,
      ): Promise<OptionalToolRead<T>> => {
        if (reader === undefined) {
          return { error: { endpoint: name, message: "Endpoint no disponible en este cliente." } };
        }
        try {
          return { data: await reader() };
        } catch (err) {
          return {
            error: { endpoint: name, message: sanitizeToolErrorText(err) },
          };
        }
      };
      const skippedOptional = <T>(): Promise<OptionalToolRead<T>> => Promise.resolve({});

      const endpointSpecs: Array<PriceIntelligenceEndpointSpec<PriceIntelligenceEndpointKey>> = [
        {
          key: "salePrice",
          read: () =>
            readOptional(
              "sale_price",
              mlcClient.getItemSalePrice?.bind(mlcClient, sellerId, itemId, { context }),
            ),
        },
        {
          key: "prices",
          read: () =>
            readOptional("prices", mlcClient.getItemPrices?.bind(mlcClient, sellerId, itemId)),
        },
        {
          key: "priceToWin",
          read: () =>
            readOptional(
              "price_to_win",
              mlcClient.getItemPriceToWin?.bind(mlcClient, sellerId, itemId),
            ),
        },
        {
          key: "automation",
          read: () =>
            readOptional(
              "pricing_automation",
              mlcClient.getPricingAutomation?.bind(mlcClient, sellerId, itemId),
            ),
        },
        {
          key: "itemRules",
          read: () =>
            includeRules
              ? readOptional<MlcPricingAutomationRulesSnapshot>(
                  "pricing_automation_item_rules",
                  mlcClient.getPricingAutomationItemRules?.bind(mlcClient, sellerId, itemId),
                )
              : skippedOptional<MlcPricingAutomationRulesSnapshot>(),
        },
        {
          key: "productRules",
          read: () =>
            includeRules && catalogProductId !== undefined
              ? readOptional<MlcPricingAutomationRulesSnapshot>(
                  "pricing_automation_product_rules",
                  mlcClient.getPricingAutomationProductRules?.bind(
                    mlcClient,
                    sellerId,
                    catalogProductId,
                  ),
                )
              : skippedOptional<MlcPricingAutomationRulesSnapshot>(),
        },
        {
          key: "history",
          read: () =>
            includeHistory
              ? readOptional<MlcPricingAutomationHistorySnapshot>(
                  "pricing_automation_price_history",
                  mlcClient.getPricingAutomationPriceHistory?.bind(
                    mlcClient,
                    sellerId,
                    itemId,
                    historyOptions,
                  ),
                )
              : skippedOptional<MlcPricingAutomationHistorySnapshot>(),
        },
      ];

      const endpointResults = await Promise.all(
        endpointSpecs.map(async (spec) => [spec.key, await spec.read()] as const),
      );
      const reads = Object.fromEntries(endpointResults) as PriceIntelligenceEndpointResult;

      const errors = [
        reads.salePrice.error,
        reads.prices.error,
        reads.priceToWin.error,
        reads.automation.error,
        reads.itemRules.error,
        reads.productRules.error,
        reads.history.error,
      ].filter((error): error is { endpoint: string; message: string } => error !== undefined);
      const automationActive =
        reads.automation.data !== undefined &&
        Boolean((reads.automation.data as { data?: { active?: boolean } }).data?.active);

      return {
        sellerId,
        itemId,
        kind: "price-intelligence",
        source: "mercadolibre-api",
        noMutationExecuted: true,
        ...(reads.salePrice.data !== undefined && { salePrice: reads.salePrice.data }),
        ...(reads.prices.data !== undefined && { prices: reads.prices.data }),
        ...(reads.priceToWin.data !== undefined && { priceToWin: reads.priceToWin.data }),
        ...(reads.automation.data !== undefined && { automation: reads.automation.data }),
        ...(reads.itemRules.data !== undefined && { itemAutomationRules: reads.itemRules.data }),
        ...(reads.productRules.data !== undefined && {
          productAutomationRules: reads.productRules.data,
        }),
        ...(reads.history.data !== undefined && { automationPriceHistory: reads.history.data }),
        automationGuard: automationActive
          ? "Automatización de precio activa: desde 2026, los cambios de precio vía /items pueden ser rechazados o ignorados. No propongas editar precio sin resolver la automatización primero."
          : "No se detectó automatización activa en la respuesta consultada; igualmente verificá antes de cualquier mutación futura.",
        ...(errors.length > 0 && { partialErrors: errors }),
        recommendation:
          reads.priceToWin.data !== undefined
            ? "Usá priceToWin para evaluar competencia de catálogo y calculá margen neto antes de recomendar un cambio."
            : "No hubo señal completa de price_to_win; respondé con los datos disponibles y aclaración de cobertura.",
      };
    },
  };
}

/**
 * Creates the `find_automated_price_items` tool.
 *
 * Lists seller items with MercadoLibre price automation enabled. Read-only.
 */
export function createFindAutomatedPriceItemsTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "find_automated_price_items",
    description:
      "Lista publicaciones con automatización de precios activa para un vendedor. " +
      "Es READ-ONLY y sirve para responder qué publicaciones tienen precio automatizado " +
      `antes de considerar cualquier recomendación de cambio. Máximo ${PRICING_AUTOMATION_ITEMS_MAX_LIMIT} por página.`,
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        offset: { type: "number", description: "Offset de paginación. Default 0." },
        limit: {
          type: "number",
          description: `Cantidad por página. Default ${PRICING_AUTOMATION_ITEMS_DEFAULT_LIMIT}, máximo ${PRICING_AUTOMATION_ITEMS_MAX_LIMIT}.`,
        },
      },
      required: ["sellerId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (!mlcClient.getPricingAutomationItems) {
        return { error: "La lectura de automatizaciones de precio no está disponible." };
      }

      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return { error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío." };
      }

      const options: { offset?: number; limit?: number } = {};
      if (typeof args.offset === "number") options.offset = args.offset;
      if (typeof args.limit === "number") options.limit = args.limit;

      try {
        const snapshot: MlcAutomatedPriceItemsSnapshot = await mlcClient.getPricingAutomationItems(
          sellerId,
          options,
        );
        const data = snapshot.data;
        const itemCount = data.items.length;
        return {
          ...snapshot,
          noMutationExecuted: true,
          automationGuard:
            "Antes de editar un precio, verificá automatización activa. Desde 2026, MercadoLibre puede rechazar o ignorar cambios vía /items si la publicación está automatizada.",
          summary: `${itemCount} publicaciones con precio automatizado encontradas en esta página.`,
        };
      } catch (err) {
        return {
          error:
            `No se pudo listar publicaciones con automatización de precio para "${sellerId}": ` +
            `${sanitizeToolErrorText(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// promotion intelligence tools
// ---------------------------------------------------------------------------

export function createReadSellerPromotionsTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "read_seller_promotions",
    description:
      "Lee promociones/campañas disponibles del vendedor en MercadoLibre de forma READ-ONLY. " +
      "Puede listar campañas, leer el detalle de una promoción y, si se indica, listar items " +
      "de esa promoción con filtros documentados. Usala cuando el vendedor pregunte qué " +
      "promociones tiene, qué items participan en una promo, o qué descuentos/beneficios trae.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        promotionId: {
          type: "string",
          description: "ID de promoción/campaña. Ej: 'P-MLC1806015' o 'C-MLC302'.",
        },
        promotionType: {
          type: "string",
          description:
            "Tipo documentado de promoción. Ej: MARKETPLACE_CAMPAIGN, SELLER_CAMPAIGN, LIGHTNING.",
        },
        includeDetail: {
          type: "boolean",
          description: "Si true, consulta el detalle de la promoción indicada.",
        },
        includeItems: {
          type: "boolean",
          description: "Si true, lista items de la promoción indicada.",
        },
        itemId: { type: "string", description: "Filtro opcional por item participante." },
        status: {
          type: "string",
          enum: ["started", "pending", "candidate"],
          description: "Filtro documentado por estado de participación.",
        },
        statusItem: {
          type: "string",
          enum: ["active", "paused"],
          description:
            "Filtro documentado por estado del item. Otros valores generan 400 upstream.",
        },
        limit: {
          type: "number",
          description: `Cantidad por página para items de promoción. Default ${MLC_PROMOTIONS_ITEMS_DEFAULT_LIMIT}, máximo ${MLC_PROMOTIONS_ITEMS_MAX_LIMIT}.`,
        },
        searchAfter: {
          type: "string",
          description: "Cursor search_after para avanzar páginas de items de promoción.",
        },
      },
      required: ["sellerId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return { error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío." };
      }
      if (!mlcClient.getSellerPromotions) {
        return { error: "La lectura de promociones del vendedor no está disponible." };
      }

      const promotionId = coercePromotionId(args.promotionId);
      const promotionType = coercePromotionType(args.promotionType);
      const includeDetail = args.includeDetail === true;
      const includeItems = args.includeItems === true;
      if (
        (includeDetail || includeItems) &&
        (promotionId === undefined || promotionType === undefined)
      ) {
        return {
          error:
            "Para consultar detalle o items de una promoción, 'promotionId' y 'promotionType' son obligatorios.",
        };
      }

      const itemOptions: {
        itemId?: string;
        status?: "started" | "pending" | "candidate";
        statusItem?: "active" | "paused";
        limit?: number;
        searchAfter?: string;
      } = {};
      if (typeof args.itemId === "string" && args.itemId.length > 0)
        itemOptions.itemId = args.itemId;
      if (typeof args.status === "string") {
        if (args.status !== "started" && args.status !== "pending" && args.status !== "candidate") {
          return {
            error: "El parámetro 'status' debe ser uno de: started, pending, candidate.",
          };
        }
        itemOptions.status = args.status;
      }
      if (typeof args.statusItem === "string") {
        if (args.statusItem !== "active" && args.statusItem !== "paused") {
          return { error: "El parámetro 'statusItem' debe ser uno de: active, paused." };
        }
        itemOptions.statusItem = args.statusItem;
      }
      if (typeof args.limit === "number") itemOptions.limit = args.limit;
      if (typeof args.searchAfter === "string" && args.searchAfter.length > 0) {
        itemOptions.searchAfter = args.searchAfter;
      }

      try {
        const promotions: MlcSellerPromotionsSnapshot =
          await mlcClient.getSellerPromotions(sellerId);
        const partialErrors: Array<{ endpoint: string; message: string }> = [];
        let detail: MlcPromotionDetailSnapshot | undefined;
        let items: MlcPromotionItemsSnapshot | undefined;
        if (includeDetail && mlcClient.getPromotionDetail && promotionId && promotionType) {
          try {
            detail = await mlcClient.getPromotionDetail(sellerId, promotionId, promotionType);
          } catch (err) {
            partialErrors.push({
              endpoint: "promotion_detail",
              message: sanitizeToolErrorText(err),
            });
          }
        } else if (includeDetail && promotionId && promotionType && !mlcClient.getPromotionDetail) {
          partialErrors.push({
            endpoint: "promotion_detail",
            message:
              "MlcApiClient does not support promotion detail reads for this token/client version.",
          });
        }
        if (includeItems && mlcClient.getPromotionItems && promotionId && promotionType) {
          try {
            items = await mlcClient.getPromotionItems(
              sellerId,
              promotionId,
              promotionType,
              itemOptions,
            );
          } catch (err) {
            partialErrors.push({
              endpoint: "promotion_items",
              message: sanitizeToolErrorText(err),
            });
          }
        } else if (includeItems && promotionId && promotionType && !mlcClient.getPromotionItems) {
          partialErrors.push({
            endpoint: "promotion_items",
            message:
              "MlcApiClient does not support promotion item reads for this token/client version.",
          });
        }

        return {
          sellerId,
          kind: "promotion-intelligence",
          source: "mercadolibre-api",
          noMutationExecuted: true,
          promotions,
          ...(detail !== undefined && { detail }),
          ...(items !== undefined && { items }),
          ...(partialErrors.length > 0 && { partialErrors }),
          recommendation:
            "Usá beneficios, precio original/precio promo y descuentos sugeridos para calcular margen neto antes de recomendar participación.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo leer promociones para "${sellerId}": ` + `${sanitizeToolErrorText(err)}`,
        };
      }
    },
  };
}

export function createReadItemPromotionsTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "read_item_promotions",
    description:
      "Lee promociones asociadas a una publicación específica de MercadoLibre de forma READ-ONLY. " +
      "Devuelve campos documentados como descuento sugerido, porcentajes Meli/vendedor, boost, " +
      "precio top deal y stock de LIGHTNING cuando existan.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        itemId: { type: "string", description: "ID de la publicación. Ej: 'MLC1001'." },
      },
      required: ["sellerId", "itemId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (!mlcClient.getItemPromotions) {
        return { error: "La lectura de promociones por item no está disponible." };
      }
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return { error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío." };
      }
      const itemId = coerceItemId(args.itemId);
      if (!itemId) {
        return { error: "El parámetro 'itemId' es obligatorio y debe ser un string no vacío." };
      }

      try {
        const snapshot: MlcItemPromotionsSnapshot = await mlcClient.getItemPromotions(
          sellerId,
          itemId,
        );
        return {
          ...snapshot,
          noMutationExecuted: true,
          recommendation:
            "Compará descuento sugerido, aporte de MercadoLibre, boost y margen neto antes de recomendar una acción.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo leer promociones del item "${itemId}" para "${sellerId}": ` +
            `${sanitizeToolErrorText(err)}`,
        };
      }
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
// audit_all_quality tool
// ---------------------------------------------------------------------------

/**
 * Creates the `audit_all_quality` tool.
 *
 * Queries Cortex for quality snapshots captured by the background worker and
 * returns the latest snapshot per item, ranked from lowest to highest score.
 *
 * @param engine — an initialized Cortex GraphEngine instance.
 * @returns an `audit_all_quality` tool definition compatible with OpenAI function calling.
 */
export function createAuditAllQualityTool(engine: GraphEngine): ToolDefinition {
  return {
    name: "audit_all_quality",
    description:
      "Audita la calidad de TODAS las publicaciones usando los datos " +
      "almacenados en Cortex. Devuelve las publicaciones ordenadas de " +
      "peor a mejor calidad, con su score, nivel, y las oportunidades " +
      "de mejora pendientes. No llama a la API de MercadoLibre — usa " +
      "los snapshots de calidad que el worker actualiza cada 6 horas. " +
      "Usá esta herramienta cuando el vendedor pregunte '¿cómo está la " +
      "calidad de mis publicaciones?' o quiera priorizar mejoras.",
    parameters: {
      type: "object",
      properties: {
        sellerId: { type: "string", description: "ID del vendedor (plasticov o maustian)" },
        limit: { type: "number", description: "Cantidad máxima de resultados (default: 10)" },
      },
      required: [],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const sellerId = args.sellerId as string | undefined;
      const limit = (args.limit as number) || 10;

      const filters: Record<string, unknown> = { type: "quality_snapshot" };
      if (sellerId) filters.sellerId = sellerId;

      const nodes = engine.queryByMetadata({ ...filters, limit: 100 });
      if (!nodes.length) {
        return {
          items: [],
          summary: "No hay datos de calidad disponibles. El worker actualiza cada 6 horas.",
        };
      }

      // Group by itemId, keep latest snapshot per item.
      const latestPerItem = new Map<string, Record<string, unknown>>();
      for (const node of nodes) {
        const m = node.metadata;
        const iid = metadataString(m.itemId);
        const previous = latestPerItem.get(iid);
        if (!previous || metadataString(m.capturedAt) > metadataString(previous.capturedAt)) {
          latestPerItem.set(iid, m);
        }
      }

      // Convert to array, sort by score ascending (worst first).
      const items = Array.from(latestPerItem.values())
        .sort((a, b) => (Number(a.score) || 0) - (Number(b.score) || 0))
        .slice(0, limit)
        .map((m) => ({
          itemId: m.itemId,
          score: m.score,
          level: m.levelWording,
          pendingOpportunities: m.pendingOpportunities,
          capturedAt: m.capturedAt,
        }));

      const avgScore =
        items.length > 0
          ? Math.round(items.reduce((sum, i) => sum + (Number(i.score) || 0), 0) / items.length)
          : 0;
      const lowScoreCount = items.filter((i) => Number(i.score) < 70).length;

      return {
        items,
        summary: `${items.length} publicaciones auditadas. Score promedio: ${avgScore}/100. ${lowScoreCount} con score bajo (<70).`,
        metadata: { avgScore, totalItems: items.length, lowScoreCount },
      };
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
// find_relist_opportunities tool
// ---------------------------------------------------------------------------

/**
 * Creates the `find_relist_opportunities` tool.
 *
 * Queries Cortex for relist-opportunity nodes generated by the background
 * worker, optionally filtering by seller and urgency.
 *
 * @param engine — an initialized Cortex GraphEngine instance.
 * @returns a `find_relist_opportunities` tool definition compatible with OpenAI function calling.
 */
export function createFindRelistOpportunitiesTool(engine: GraphEngine): ToolDefinition {
  return {
    name: "find_relist_opportunities",
    description:
      "Busca todas las oportunidades de republicación almacenadas en Cortex. " +
      "El worker detecta publicaciones cerradas que pueden republicarse " +
      "(menos de 60 días cerradas, con historial de ventas) y publicaciones " +
      "pausadas que conviene cerrar y republicar. La republicación transfiere " +
      "visitas, preguntas y ventas del ítem original. " +
      "Usá esta herramienta cuando el vendedor quiera saber qué publicaciones " +
      "puede republicar para aprovechar su historial.",
    parameters: {
      type: "object",
      properties: {
        sellerId: { type: "string", description: "Filtrar por vendedor (plasticov o maustian)" },
        urgent: {
          type: "boolean",
          description: "Solo mostrar las que vencen en <5 días (default: false)",
        },
      },
      required: [],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const sellerId = args.sellerId as string | undefined;
      const urgentOnly = args.urgent === true;

      const filters: Record<string, unknown> = { type: "relist_opportunity" };
      if (sellerId) filters.sellerId = sellerId;

      let nodes = engine.queryByMetadata({ ...filters, limit: 50 });

      if (urgentOnly) {
        nodes = nodes.filter((n) => {
          const m = n.metadata;
          return m.daysSinceClose !== undefined && Number(m.daysSinceClose) > 50;
        });
      }

      const items = nodes.map((n) => ({
        itemId: n.metadata.itemId,
        title: n.metadata.title,
        daysSinceClose: n.metadata.daysSinceClose,
        hadSalesHistory: n.metadata.hadSalesHistory,
        suggestedPrice: n.metadata.suggestedPrice,
        expiresAt: n.metadata.closedAt
          ? new Date(new Date(n.metadata.closedAt as string).getTime() + 60 * 24 * 60 * 60 * 1000)
              .toISOString()
              .slice(0, 10)
          : undefined,
      }));

      const urgent = items.filter(
        (i) => i.daysSinceClose !== undefined && Number(i.daysSinceClose) > 50,
      );

      return {
        items,
        summary: `${items.length} oportunidades de relist encontradas. ${urgent.length} urgentes (vence en <10 días).`,
        metadata: { total: items.length, urgent: urgent.length },
      };
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

// ---------------------------------------------------------------------------
// read_seller_notices tool
// ---------------------------------------------------------------------------

/**
 * Creates the `read_seller_notices` tool.
 *
 * Reads MercadoLibre communications, notifications, and alerts for a seller.
 * Returns notices with pagination metadata.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `read_seller_notices` tool definition compatible with OpenAI function calling.
 */
export function createReadSellerNoticesTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "read_seller_notices",
    description:
      "Lee las comunicaciones, notificaciones y alertas de MercadoLibre para un vendedor. " +
      "Devuelve avisos con fechas, acciones disponibles, categorías y paginación. " +
      "Usá esta herramienta cuando el vendedor pregunte por novedades, comunicaciones, " +
      "campañas informativas o actualizaciones de MercadoLibre.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        limit: {
          type: "number",
          description: "Cantidad máxima de avisos a retornar (opcional).",
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
      if (!mlcClient.getNotices) {
        return {
          error: "La lectura de comunicaciones no está disponible en este momento.",
        };
      }

      const opts: { limit?: number; offset?: number } = {};
      if (typeof args.limit === "number") opts.limit = args.limit;
      if (typeof args.offset === "number") opts.offset = args.offset;

      try {
        const snapshot = await mlcClient.getNotices(sellerId, opts);
        const data = snapshot.data;
        const titles = data.notices
          .slice(0, 5)
          .map((n) => n.title ?? "(sin título)")
          .join("; ");
        return {
          ...snapshot,
          noticeCount: data.notices.length,
          highlightedCount: data.notices.filter((n) => n.highlighted).length,
          summary:
            data.notices.length > 0
              ? `${data.notices.length} avisos encontrados. Destacados: ${titles || "ninguno"}`
              : "No hay avisos pendientes.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo leer los avisos del vendedor: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// check_image_moderation tool
// ---------------------------------------------------------------------------

/**
 * Creates the `check_image_moderation` tool.
 *
 * Checks moderation status for a MercadoLibre listing's images.
 * Detects watermarks, text overlays, and other moderation issues.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `check_image_moderation` tool definition compatible with OpenAI function calling.
 */
export function createCheckImageModerationTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_image_moderation",
    description:
      "Verifica el estado de moderación de imágenes de una publicación de MercadoLibre. " +
      "Detecta si las imágenes tienen marcas de agua, texto superpuesto, o problemas " +
      "que pueden causar moderación o rechazo. Usá esta herramienta cuando el vendedor " +
      "pregunte por el estado de sus imágenes, sospeche problemas de moderación, o " +
      "quiera verificar que una publicación cumple con los requisitos de ML.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        itemId: {
          type: "string",
          description: "ID de la publicación en MercadoLibre. Ej: MLC123456789.",
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
      const itemId = typeof args.itemId === "string" && args.itemId.length > 0 ? args.itemId : null;
      if (!itemId) {
        return {
          error: "El parámetro 'itemId' es obligatorio y debe ser un string no vacío.",
        };
      }
      if (!mlcClient.getModerationStatus) {
        return {
          error: "La verificación de moderación no está disponible en este momento.",
        };
      }

      try {
        const snapshot = await mlcClient.getModerationStatus(sellerId, itemId);
        const data = snapshot.data;
        return {
          ...snapshot,
          hasIssues: data.blocked || data.wordings.length > 0,
          recommendation: data.blocked
            ? `La publicación ${itemId} tiene imágenes bloqueadas por moderación. Revisar y corregir.`
            : data.wordings.length > 0
              ? `La publicación ${itemId} tiene ${data.wordings.length} advertencias de moderación. Se recomienda corregir antes de que escalen.`
              : `La publicación ${itemId} no tiene problemas de moderación detectados.`,
        };
      } catch (err) {
        return {
          error:
            `No se pudo verificar la moderación de imágenes: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// check_claims tool
// ---------------------------------------------------------------------------

/**
 * Creates the `check_claims` tool.
 *
 * Searches post-purchase claims/mediations for a MercadoLibre seller.
 * Returns claim summaries with status, type, dates, and involved parties.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `check_claims` tool definition compatible with OpenAI function calling.
 */
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

/**
 * Creates the `check_claim_detail` tool.
 *
 * Gets full detail for a specific MercadoLibre post-purchase claim,
 * including messages, players, and available actions.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `check_claim_detail` tool definition compatible with OpenAI function calling.
 */
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
// check_shipment_status tool
// ---------------------------------------------------------------------------

/**
 * Creates the `check_shipment_status` tool.
 *
 * Gets shipment tracking status for a MercadoLibre order.
 * Returns delivery status, tracking number, dates, and logistic type.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `check_shipment_status` tool definition compatible with OpenAI function calling.
 */
export function createCheckShipmentStatusTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_shipment_status",
    description:
      "Consulta el estado de envío de una orden de MercadoLibre. Devuelve " +
      "estado actual, subestado, número de seguimiento, fechas y tipo logístico. " +
      "Usá esta herramienta cuando el vendedor pregunte por el estado de un envío, " +
      "necesite verificar si llegó a destino, o quiera hacer seguimiento de una entrega.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        shipmentId: {
          type: "string",
          description: "ID del envío en MercadoLibre. Ej: 41567890123.",
        },
      },
      required: ["sellerId", "shipmentId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const shipmentId =
        typeof args.shipmentId === "string" && args.shipmentId.length > 0 ? args.shipmentId : null;
      if (!shipmentId) {
        return {
          error: "El parámetro 'shipmentId' es obligatorio y debe ser un string no vacío.",
        };
      }
      if (!mlcClient.getShipmentStatus) {
        return {
          error: "La consulta de estado de envío no está disponible en este momento.",
        };
      }

      try {
        const snapshot = await mlcClient.getShipmentStatus(sellerId, shipmentId);
        const data = snapshot.data;
        return {
          ...snapshot,
          friendlyStatus: data.status
            ? `Estado: ${data.status}${data.substatus ? ` (${data.substatus})` : ""}`
            : "Estado desconocido",
          tracking: data.trackingNumber
            ? `Seguimiento: ${data.trackingNumber} (${data.trackingMethod ?? "método desconocido"})`
            : "Sin número de seguimiento",
          summary:
            `Envío ${data.id}: ${data.status ?? "estado desconocido"}. ` +
            `${data.trackingNumber ? `Tracking: ${data.trackingNumber}. ` : ""}` +
            `Logística: ${data.logisticType ?? "no especificada"}.`,
        };
      } catch (err) {
        return {
          error:
            `No se pudo consultar el estado del envío: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// check_claim_messages tool
// ---------------------------------------------------------------------------

/**
 * Creates the `check_claim_messages` tool.
 *
 * Reads the message history for a specific MercadoLibre post-purchase claim.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `check_claim_messages` tool definition compatible with OpenAI function calling.
 */
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

/**
 * Creates the `check_claim_resolutions` tool.
 *
 * Reads the expected resolution options available for a MercadoLibre claim.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `check_claim_resolutions` tool definition compatible with OpenAI function calling.
 */
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

/**
 * Creates the `check_claim_reputation` tool.
 *
 * Checks whether a MercadoLibre claim affects the seller's reputation score.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `check_claim_reputation` tool definition compatible with OpenAI function calling.
 */
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

/**
 * Creates the `check_claim_history` tool.
 *
 * Reads the chronological status change history for a MercadoLibre claim.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `check_claim_history` tool definition compatible with OpenAI function calling.
 */
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

/**
 * Creates the `prepare_answer` tool.
 *
 * Prepares an answer to a buyer question on MercadoLibre for seller approval.
 * This tool does NOT post the answer — it only prepares it for approval.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `prepare_answer` tool definition compatible with OpenAI function calling.
 */
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

// ---------------------------------------------------------------------------
// prepare_image_flow tool
// ---------------------------------------------------------------------------

/**
 * Creates the `prepare_image_flow` tool.
 *
 * Prepares a complete 4-step image orchestration flow for a MercadoLibre listing:
 * 1. Diagnose the image for moderation issues
 * 2. Upload to MercadoLibre CDN
 * 3. Associate the image with the listing item
 * 4. Check the final association status
 *
 * This tool runs the diagnosis step immediately (if available) but does NOT
 * execute any mutations. The remaining steps are returned as pending.
 *
 * @param mlcClient — the `MlcApiClient` instance for API calls.
 * @returns a `prepare_image_flow` tool definition compatible with OpenAI function calling.
 */
export function createPrepareImageFlowTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "prepare_image_flow",
    description:
      "Prepara un flujo completo de imágenes para una publicación de MercadoLibre " +
      "en 4 pasos: diagnóstico → subida → asociación → verificación. " +
      "requiresApproval: true. noMutationExecuted: true. " +
      "Ejecuta el diagnóstico de inmediato para detectar problemas, " +
      "pero NO realiza la subida, asociación ni verificación sin aprobación. " +
      "Usá esta herramienta cuando el vendedor necesite preparar imágenes para " +
      "una publicación nueva, combinando diagnóstico, subida y asociación en un solo flujo.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        itemId: {
          type: "string",
          description: "ID de la publicación en MercadoLibre. Ej: MLC123456789.",
        },
        pictureUrl: {
          type: "string",
          description: "URL de la imagen a procesar (pública o base64).",
        },
        categoryId: {
          type: "string",
          description: "ID de la categoría de MercadoLibre. Ej: MLC1743.",
        },
        title: {
          type: "string",
          description: "Título del producto (opcional, ayuda al diagnóstico contextual).",
        },
      },
      required: ["sellerId", "itemId", "pictureUrl", "categoryId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const itemId = typeof args.itemId === "string" && args.itemId.length > 0 ? args.itemId : null;
      if (!itemId) {
        return {
          error: "El parámetro 'itemId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const pictureUrl =
        typeof args.pictureUrl === "string" && args.pictureUrl.length > 0 ? args.pictureUrl : null;
      if (!pictureUrl) {
        return {
          error: "El parámetro 'pictureUrl' es obligatorio y debe ser una URL válida.",
        };
      }
      const categoryId =
        typeof args.categoryId === "string" && args.categoryId.length > 0 ? args.categoryId : null;
      if (!categoryId) {
        return {
          error: "El parámetro 'categoryId' es obligatorio y debe ser un string no vacío.",
        };
      }

      if (!mlcClient.diagnoseImage) {
        return {
          error:
            "El flujo de imágenes no está disponible: el diagnóstico de imágenes " +
            "no está habilitado en este momento. Se requiere diagnose_image para continuar.",
        };
      }

      try {
        // Step 1: Run diagnosis immediately.
        const diagInput: MlcImageDiagnosticInput = { pictureUrl, categoryId };
        if (typeof args.title === "string" && args.title.length > 0) {
          diagInput.title = args.title;
        }
        const diagSnapshot = await mlcClient.diagnoseImage(sellerId, diagInput);

        // Step 2: Build the orchestration summary with diagnose completed.
        const orchestrationInput = {
          sellerId,
          itemId,
          pictureUrl,
          categoryId,
          now: new Date(),
        };
        if (typeof args.title === "string") {
          Object.assign(orchestrationInput, { title: args.title });
        }
        const orchestration = normalizeImageOrchestration(orchestrationInput);
        const summary = orchestration.data;

        // Mark the diagnose step as completed.
        const updatedSteps = summary.steps.map((s) =>
          s.step === "diagnose" ? { ...s, status: "completed" as const, result: diagSnapshot } : s,
        );

        return {
          ...orchestration,
          data: {
            ...summary,
            steps: updatedSteps,
          },
          diagnoseResult: diagSnapshot,
          nextStep: "upload",
          instructions:
            "Paso 1 (diagnóstico) completado. Pasos pendientes: upload, associate, check. " +
            "El vendedor debe aprobar antes de continuar con la subida de imagen.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo preparar el flujo de imágenes: ` +
            `${err instanceof Error ? err.message : String(err)}`,
          failedStep: "diagnose",
          instructions:
            "El diagnóstico falló. Verificá que la URL de la imagen y la categoría " +
            "sean correctas antes de reintentar.",
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// create_listing tool
// ---------------------------------------------------------------------------

/**
 * Creates the `create_listing` tool.
 *
 * Allows the CEO to create a brand-new MercadoLibre listing from scratch
 * via natural conversation. Supports full ML API capabilities: variations
 * with individual prices/stock/pictures, catalog listings, shipping config,
 * sale terms, and all item metadata.
 *
 * Follows the same approval pipeline as sync_product: first call returns
 * approval_required with preview, second call with approvedExecution executes
 * via mlClient.publishItem().
 *
 * @param mlClient — the `MlClient` instance for publishing.
 * @param cortex — optional Cortex GraphEngine for persisting creation-outcome nodes.
 * @returns a `create_listing` tool definition compatible with OpenAI function calling.
 */
export function createCreateListingTool(
  mlClient: MlClient,
  cortex?: GraphEngine,
  options: SyncToolOptions = {},
): ToolDefinition {
  return {
    name: "create_listing",
    description:
      "Crea una publicación NUEVA en MercadoLibre desde cero. " +
      "Usá esta herramienta cuando el vendedor quiera publicar un producto " +
      "que NO existe todavía en ninguna cuenta. Soporta variantes (color, " +
      "talle, medida) con precio, stock y fotos individuales. También soporta " +
      "publicaciones de catálogo. IMPORTANTE: solo se ejecuta si el vendedor " +
      "confirma con 'dale'. Antes de llamarla, asegurate de tener título, " +
      "categoría, precio y al menos una foto.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID de la cuenta donde publicar. Ej: 'plasticov' o 'maustian'.",
        },
        title: {
          type: "string",
          description: "Título de la publicación en español.",
        },
        category_id: {
          type: "string",
          description: "ID de categoría de MercadoLibre. Ej: 'MLC1743'.",
        },
        price: {
          type: "number",
          description: "Precio base de la publicación en CLP.",
        },
        currency_id: {
          type: "string",
          description: "Moneda. Por defecto 'CLP' para Chile.",
        },
        available_quantity: {
          type: "number",
          description: "Cantidad disponible total.",
        },
        buying_mode: {
          type: "string",
          description: "Modo de compra: 'buy_it_now' (Compra inmediata).",
        },
        listing_type_id: {
          type: "string",
          description:
            "Tipo de publicación: 'gold_pro' (Premium), 'gold_special' (Clásica), 'free' (Gratuita).",
        },
        condition: {
          type: "string",
          description: "Condición: 'new' (Nuevo), 'used' (Usado).",
        },
        pictures: {
          type: "array",
          description: "URLs de las fotos del producto. Cada elemento: { source: 'https://...' }.",
          items: {
            type: "object",
            properties: {
              source: { type: "string" },
            },
          },
        },
        variations: {
          type: "array",
          description:
            "Variantes del producto (color, talle, medida). Cada variante " +
            "tiene su propio precio, stock, fotos y atributos (SKU, EAN, GTIN). " +
            "Máximo 100 variantes por publicación (250 en Fashion/Auto Parts).",
          items: {
            type: "object",
            properties: {
              attribute_combinations: {
                type: "array",
                description:
                  "Atributos que diferencian esta variante. Ej: [{ name: 'Tamaño', value_name: '2m x 3m' }].",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    value_id: { type: "string" },
                    value_name: { type: "string" },
                  },
                },
              },
              price: {
                type: "number",
                description: "Precio de esta variante específica.",
              },
              available_quantity: {
                type: "number",
                description: "Stock de esta variante.",
              },
              picture_ids: {
                type: "array",
                items: { type: "string" },
                description: "IDs o URLs de fotos para esta variante.",
              },
              attributes: {
                type: "array",
                description: "Atributos por variante: SKU, EAN, GTIN.",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    value_name: { type: "string" },
                  },
                },
              },
            },
          },
        },
        attributes: {
          type: "array",
          description:
            "Atributos del producto: marca, modelo, GTIN, etc. Ej: [{ id: 'BRAND', value_name: 'Genérica' }].",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              value_name: { type: "string" },
            },
          },
        },
        description: {
          type: "string",
          description: "Descripción en texto plano del producto.",
        },
        shipping: {
          type: "object",
          description: "Configuración de envío.",
          properties: {
            mode: { type: "string" },
            free_shipping: { type: "boolean" },
            logistic_type: { type: "string" },
          },
        },
        sale_terms: {
          type: "array",
          description:
            "Términos de venta: garantía. Ej: [{ id: 'WARRANTY_TYPE', value_name: 'Garantía del vendedor' }].",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              value_name: { type: "string" },
            },
          },
        },
        warranty: {
          type: "string",
          description: "Texto de garantía. Ej: 'Garantía del vendedor: 6 meses'.",
        },
        catalog_product_id: {
          type: "string",
          description: "ID del producto de catálogo si es publicación de catálogo.",
        },
        catalog_listing: {
          type: "boolean",
          description: "true si es publicación de catálogo.",
        },
      },
      required: ["sellerId", "title", "category_id", "price", "pictures"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return { error: "El parámetro 'sellerId' es obligatorio." };
      }

      if (!options.approvedExecution) {
        return {
          status: "approval_required",
          tool: "create_listing",
          preview: {
            title: args.title,
            category_id: args.category_id,
            price: args.price,
            sellerId,
            variationCount: Array.isArray(args.variations) ? args.variations.length : 0,
          },
          error:
            "La creación de publicaciones requiere confirmación explícita del vendedor ('dale').",
        };
      }

      // Build NewItem from arguments
      const pictures = Array.isArray(args.pictures)
        ? args.pictures.filter(
            (p): p is { source: string } =>
              typeof p === "object" &&
              p !== null &&
              typeof (p as Record<string, unknown>).source === "string",
          )
        : [];

      if (pictures.length === 0) {
        return { error: "Se requiere al menos una foto (pictures)." };
      }

      const newItem: NewItem = {
        title: typeof args.title === "string" ? args.title : "",
        category_id: typeof args.category_id === "string" ? args.category_id : "",
        price: typeof args.price === "number" ? args.price : 0,
        currency_id: typeof args.currency_id === "string" ? args.currency_id : "CLP",
        available_quantity:
          typeof args.available_quantity === "number" ? args.available_quantity : 1,
        buying_mode: typeof args.buying_mode === "string" ? args.buying_mode : "buy_it_now",
        listing_type_id:
          typeof args.listing_type_id === "string" ? args.listing_type_id : "gold_special",
        condition: typeof args.condition === "string" ? args.condition : "new",
        pictures,
      };

      // Optional fields
      if (Array.isArray(args.variations) && args.variations.length > 0) {
        (newItem as Record<string, unknown>).variations = args.variations;
      }
      if (Array.isArray(args.attributes) && args.attributes.length > 0) {
        (newItem as Record<string, unknown>).attributes = args.attributes;
      }
      if (typeof args.description === "string" && args.description.length > 0) {
        (newItem as Record<string, unknown>).descriptions = [{ plain_text: args.description }];
      }
      if (args.shipping && typeof args.shipping === "object") {
        (newItem as Record<string, unknown>).shipping = args.shipping;
      }
      if (Array.isArray(args.sale_terms) && args.sale_terms.length > 0) {
        (newItem as Record<string, unknown>).sale_terms = args.sale_terms;
      }
      if (typeof args.warranty === "string") {
        (newItem as Record<string, unknown>).warranty = args.warranty;
      }
      if (typeof args.catalog_product_id === "string") {
        (newItem as Record<string, unknown>).catalog_product_id = args.catalog_product_id;
      }
      if (args.catalog_listing === true) {
        (newItem as Record<string, unknown>).catalog_listing = true;
      }

      try {
        const result: MlWriteSnapshot = await mlClient.publishItem(sellerId, newItem);

        // Cortex integration: store creation outcome
        if (cortex) {
          storeCreateOutcome(cortex, result, sellerId, newItem);
        }

        return {
          status: "published",
          itemId: result.id,
          permalink: result.permalink,
          title: newItem.title,
          price: newItem.price,
          variationCount: Array.isArray(args.variations) ? args.variations.length : 0,
        };
      } catch (err) {
        return {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// update_listing tool
// ---------------------------------------------------------------------------

/**
 * Creates the `update_listing` tool.
 *
 * Allows the CEO to edit an existing MercadoLibre listing via natural
 * conversation. Supports partial updates: only the fields provided are
 * sent to MercadoLibre. Fields not included remain unchanged.
 *
 * Follows the same approval pipeline as sync_product: first call returns
 * approval_required with preview, second call with approvedExecution executes
 * via mlClient.updateItem().
 *
 * @param mlClient — the `MlClient` instance for updates.
 * @param cortex — optional Cortex GraphEngine for persisting update-outcome nodes.
 * @returns an `update_listing` tool definition compatible with OpenAI function calling.
 */
export function createUpdateListingTool(
  mlClient: MlClient,
  cortex?: GraphEngine,
  options: SyncToolOptions = {},
): ToolDefinition {
  return {
    name: "update_listing",
    description:
      "Actualiza una publicación EXISTENTE en MercadoLibre. " +
      "Usá esta herramienta cuando el vendedor quiera modificar el título, " +
      "precio, stock, descripción, fotos, envío o garantía de una publicación " +
      "que ya existe. IMPORTANTE: solo se ejecuta si el vendedor confirma con 'dale'.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID de la cuenta. Ej: 'plasticov' o 'maustian'.",
        },
        itemId: {
          type: "string",
          description: "ID de la publicación en MercadoLibre. Ej: 'MLC1234'.",
        },
        title: { type: "string", description: "Nuevo título (opcional)." },
        price: { type: "number", description: "Nuevo precio en CLP (opcional)." },
        available_quantity: { type: "number", description: "Nuevo stock (opcional)." },
        description: {
          type: "string",
          description: "Nueva descripción en texto plano (opcional).",
        },
        pictures: {
          type: "array",
          items: { type: "object", properties: { source: { type: "string" } } },
          description: "Nuevas fotos (opcional).",
        },
        shipping: {
          type: "object",
          properties: { mode: { type: "string" }, free_shipping: { type: "boolean" } },
          description: "Configuración de envío (opcional).",
        },
        warranty: { type: "string", description: "Texto de garantía (opcional)." },
      },
      required: ["sellerId", "itemId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      const itemId = coerceItemId(args.itemId);
      if (!sellerId || !itemId) return { error: "sellerId e itemId son obligatorios." };

      if (!options.approvedExecution) {
        return {
          status: "approval_required",
          tool: "update_listing",
          preview: {
            sellerId,
            itemId,
            fields: Object.keys(args).filter(
              (k) => args[k] !== undefined && k !== "sellerId" && k !== "itemId",
            ),
          },
          error: "La actualización requiere confirmación ('dale').",
        };
      }

      // Build updates object — only include fields that were provided.
      const updates: Record<string, unknown> = {};
      if (typeof args.title === "string") updates.title = args.title;
      if (typeof args.price === "number") updates.price = args.price;
      if (typeof args.available_quantity === "number")
        updates.available_quantity = args.available_quantity;
      if (typeof args.description === "string")
        updates.descriptions = [{ plain_text: args.description }];
      if (Array.isArray(args.pictures) && args.pictures.length > 0)
        updates.pictures = args.pictures;
      if (args.shipping && typeof args.shipping === "object") updates.shipping = args.shipping;
      if (typeof args.warranty === "string") updates.warranty = args.warranty;

      try {
        const result = await mlClient.updateItem(sellerId, itemId, updates);
        if (cortex) {
          cortex.createNode(`update_${itemId}_${Date.now()}`, {
            type: "listing_updated",
            itemId,
            sellerId,
            fields: Object.keys(updates),
          });
        }
        return {
          status: "updated",
          itemId: result.id,
          permalink: result.permalink,
          fields: Object.keys(updates),
        };
      } catch (err) {
        return { status: "failed", error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// change_item_status tool
// ---------------------------------------------------------------------------

/**
 * Creates the `change_item_status` tool.
 *
 * Allows the CEO to pause, close (finalize), or reactivate an existing
 * MercadoLibre listing. Closings are irreversible — the tool surfaces an
 * explicit warning for 'closed' status.
 *
 * Follows the same approval pipeline as other mutation tools: first call
 * returns approval_required, second call with approvedExecution executes.
 *
 * Uses mlClient.updateItem() to PUT /items/:id with { status }. The
 * `status` field is passed via a type cast since `NewItem` does not
 * include it, but the ML API accepts it as a top-level field.
 *
 * @param mlClient — the `MlClient` instance for updates.
 * @param cortex — optional Cortex GraphEngine for persisting status-change nodes.
 * @returns a `change_item_status` tool definition compatible with OpenAI function calling.
 */
export function createChangeItemStatusTool(
  mlClient: MlClient,
  cortex?: GraphEngine,
  options: SyncToolOptions = {},
): ToolDefinition {
  return {
    name: "change_item_status",
    description:
      "Cambia el estado de una publicación: pausar, cerrar (finalizar) o reactivar. " +
      "Usá 'paused' para pausar temporalmente, 'closed' para finalizar definitivamente, " +
      "'active' para reactivar una publicación pausada. " +
      "IMPORTANTE: 'closed' es irreversible. Pedí confirmación explícita antes de cerrar.",
    parameters: {
      type: "object",
      properties: {
        sellerId: { type: "string", description: "ID de la cuenta." },
        itemId: { type: "string", description: "ID de la publicación." },
        status: {
          type: "string",
          enum: ["paused", "closed", "active"],
          description: "Nuevo estado.",
        },
      },
      required: ["sellerId", "itemId", "status"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      const itemId = coerceItemId(args.itemId);
      if (!sellerId || !itemId) return { error: "sellerId e itemId son obligatorios." };

      const newStatus = args.status as string;
      if (newStatus !== "paused" && newStatus !== "closed" && newStatus !== "active") {
        return { error: "status debe ser 'paused', 'closed' o 'active'." };
      }

      if (!options.approvedExecution) {
        return {
          status: "approval_required",
          tool: "change_item_status",
          preview: { sellerId, itemId, newStatus },
          warning:
            newStatus === "closed"
              ? "CERRAR es irreversible. La publicación no podrá reactivarse."
              : undefined,
          error: "El cambio de estado requiere confirmación ('dale').",
        };
      }

      try {
        const result = await mlClient.updateItem(sellerId, itemId, {
          status: newStatus,
        } as Partial<NewItem>);
        if (cortex) {
          cortex.createNode(`status_${itemId}_${Date.now()}`, {
            type: "listing_status_changed",
            itemId,
            sellerId,
            newStatus,
          });
        }
        return { status: "ok", itemId: result.id, newStatus };
      } catch (err) {
        return { status: "failed", error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// manage_variations tool
// ---------------------------------------------------------------------------

/**
 * Creates the `manage_variations` tool.
 *
 * Allows the CEO to add, update, or remove variations from an existing
 * MercadoLibre listing. The tool is self-contained: it first fetches the
 * current item to access its current variations, applies the requested
 * change, and PUTs the full variations array back via mlClient.updateItem().
 *
 * Follows the approval pipeline: first call returns approval_required
 * with preview, second call with approvedExecution executes the mutation.
 *
 * @param mlClient — the `MlClient` instance for GET/PUT operations.
 * @param cortex — optional Cortex GraphEngine for persisting variation-change nodes.
 * @returns a `manage_variations` tool definition compatible with OpenAI function calling.
 */
export function createManageVariationsTool(
  mlClient: MlClient,
  cortex?: GraphEngine,
  options: SyncToolOptions = {},
): ToolDefinition {
  return {
    name: "manage_variations",
    description:
      "Administra las variantes de una publicación existente: agregar, " +
      "modificar o eliminar variantes. IMPORTANTE: requiere confirmación ('dale'). " +
      "Para agregar: action='add', attributes con las combinaciones, price, quantity. " +
      "Para modificar: action='update', variationId, y campos a cambiar (price, quantity). " +
      "Para eliminar: action='remove', variationId.",
    parameters: {
      type: "object",
      properties: {
        sellerId: { type: "string", description: "ID de la cuenta." },
        itemId: { type: "string", description: "ID de la publicación." },
        action: {
          type: "string",
          enum: ["add", "update", "remove"],
          description: "Acción: agregar, modificar o eliminar una variante.",
        },
        variationId: {
          type: "number",
          description: "ID de la variante a modificar o eliminar (requerido para update/remove).",
        },
        attributes: {
          type: "array",
          description:
            "Atributos de la nueva variante. Ej: [{ name: 'Tamaño', value_name: '2m x 3m' }].",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              value_id: { type: "string" },
              value_name: { type: "string" },
            },
          },
        },
        price: { type: "number", description: "Precio de la variante." },
        available_quantity: { type: "number", description: "Stock de la variante." },
        picture_ids: {
          type: "array",
          items: { type: "string" },
          description: "IDs de fotos para la variante.",
        },
      },
      required: ["sellerId", "itemId", "action"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      const itemId = coerceItemId(args.itemId);
      if (!sellerId || !itemId) return { error: "sellerId e itemId son obligatorios." };

      const action = args.action as string;
      if (action !== "add" && action !== "update" && action !== "remove") {
        return { error: "action debe ser 'add', 'update' o 'remove'." };
      }

      if ((action === "update" || action === "remove") && typeof args.variationId !== "number") {
        return {
          error: "variationId es obligatorio para las acciones 'update' y 'remove'.",
        };
      }

      if (action === "add") {
        if (!Array.isArray(args.attributes) || args.attributes.length === 0) {
          return { error: "attributes es obligatorio para agregar una variante." };
        }
        if (typeof args.price !== "number") {
          return { error: "price es obligatorio para agregar una variante." };
        }
        if (typeof args.available_quantity !== "number") {
          return { error: "available_quantity es obligatorio para agregar una variante." };
        }
      }

      if (!options.approvedExecution) {
        return {
          status: "approval_required",
          tool: "manage_variations",
          preview: { sellerId, itemId, action, variationId: args.variationId },
          error: "La gestión de variantes requiere confirmación ('dale').",
        };
      }

      try {
        // 1. Fetch current item to get existing variations.
        const currentItem = await mlClient.getItem(sellerId, itemId);
        const currentVariations = Array.isArray((currentItem as Record<string, unknown>).variations)
          ? ((currentItem as Record<string, unknown>).variations as Array<Record<string, unknown>>)
          : [];

        let updatedVariations: Array<Record<string, unknown>> = [];

        switch (action) {
          case "add": {
            const newVariation = {
              attribute_combinations: args.attributes,
              price: args.price as number,
              available_quantity: args.available_quantity as number,
              ...(Array.isArray(args.picture_ids) && (args.picture_ids as string[]).length > 0
                ? { picture_ids: args.picture_ids }
                : {}),
            };
            updatedVariations = [...currentVariations, newVariation];
            break;
          }

          case "update": {
            const targetId = args.variationId as number;
            updatedVariations = currentVariations.map((v) => {
              if (v.id !== targetId) return v;
              const updated = { ...v };
              if (typeof args.price === "number") updated.price = args.price;
              if (typeof args.available_quantity === "number")
                updated.available_quantity = args.available_quantity;
              if (Array.isArray(args.picture_ids) && (args.picture_ids as string[]).length > 0)
                updated.picture_ids = args.picture_ids;
              return updated;
            });
            break;
          }

          case "remove": {
            const targetId = args.variationId as number;
            updatedVariations = currentVariations.filter((v) => v.id !== targetId);
            break;
          }

          default:
            return { error: `Acción desconocida: ${String(action)}` };
        }

        // 2. PUT the full variations array back.
        const result = await mlClient.updateItem(sellerId, itemId, {
          variations: updatedVariations,
        } as Partial<NewItem>);

        if (cortex) {
          cortex.createNode(`variation_${itemId}_${Date.now()}`, {
            type: "variations_managed",
            itemId,
            sellerId,
            action,
            variationCount: updatedVariations.length,
          });
        }

        return {
          status: "updated",
          itemId: result.id,
          permalink: result.permalink,
          action,
          variationCount: updatedVariations.length,
        };
      } catch (err) {
        return { status: "failed", error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// read_my_catalog tool
// ---------------------------------------------------------------------------

/**
 * Creates the `read_my_catalog` tool.
 *
 * Queries the LOCAL operational read model (SQLite snapshots) for a seller's
 * listing catalog WITHOUT hitting the MercadoLibre API. Returns structured
 * listing data from background ingestion snapshots — zero rate-limit cost.
 *
 * @param reader — the `OperationalReadModelReader` instance for local DB queries.
 * @returns a `read_my_catalog` tool definition compatible with OpenAI function calling.
 */
export function createReadMyCatalogTool(reader: OperationalReadModelReader): ToolDefinition {
  return {
    name: "read_my_catalog",
    description:
      "Consulta la base de datos LOCAL de productos. NO llama a la API de MercadoLibre — " +
      "usa los snapshots guardados por la ingesta en segundo plano. " +
      "Devuelve el catálogo con precios, stock, estado y categoría. " +
      "Usá esta herramienta para obtener una vista rápida del catálogo sin consumir rate limits. " +
      "Podés filtrar por cuenta, categoría o estado.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID de la cuenta: 'plasticov' o 'maustian'.",
        },
        categoryId: {
          type: "string",
          description: "Filtrar por ID de categoría (opcional).",
        },
        status: {
          type: "string",
          enum: ["active", "paused", "closed"],
          description: "Filtrar por estado (opcional).",
        },
      },
      required: ["sellerId"],
    },
    execute: async (args: Record<string, unknown>) => {
      const sellerId = typeof args.sellerId === "string" ? args.sellerId : undefined;
      if (!sellerId) return { error: "sellerId es obligatorio." };

      try {
        const snapshots = await reader.listSnapshots<Record<string, unknown>>(sellerId, "listing", {
          limit: 200,
          ...(typeof args.status === "string" ? { status: args.status } : {}),
          ...(typeof args.categoryId === "string" ? { categoryId: args.categoryId } : {}),
        });

        if (snapshots.length === 0) {
          return {
            sellerId,
            total: 0,
            items: [],
            message: `No hay snapshots locales para ${sellerId}. La ingesta en segundo plano puede no haber corrido aún.`,
          };
        }

        const items = snapshots.map((s) => {
          const data = s.data;
          return {
            id: s.itemId,
            title: data.title ?? "Sin título",
            price: data.price,
            available_quantity: data.available_quantity,
            category_id: data.category_id,
            status: data.status,
            listing_type_id: data.listing_type_id,
            variation_count: Array.isArray(data.variations) ? data.variations.length : 0,
            currency_id: data.currency_id ?? "CLP",
            captured_at: s.capturedAt,
            freshness: s.freshness,
          };
        });

        return {
          sellerId,
          total: items.length,
          active: items.filter((i) => i.status === "active").length,
          paused: items.filter((i) => i.status === "paused").length,
          closed: items.filter((i) => i.status === "closed").length,
          items,
        };
      } catch (err) {
        return {
          error: `No se pudo consultar el catálogo local: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

function storeCreateOutcome(
  cortex: GraphEngine,
  result: MlWriteSnapshot,
  sellerId: string,
  item: NewItem,
): void {
  const sellerNode = cortex.db
    .prepare("SELECT id, label FROM nodes WHERE metadata LIKE ?")
    .get(`%"sellerId":"${sellerId}"%`) as { id: number; label: string } | undefined;

  const sourceId =
    sellerNode?.id ??
    cortex.createNode(`seller_${sellerId}`, {
      type: "seller_account",
      sellerId,
    }).id;

  const outcomeNode = cortex.createNode(
    `create_${result.id}_${new Date().toISOString().slice(0, 10)}`,
    {
      type: "listing_created",
      itemId: result.id,
      permalink: result.permalink,
      title: item.title,
      price: item.price,
      variationCount: item.variations?.length ?? 0,
      sellerId,
    },
  );

  try {
    cortex.createEdge(outcomeNode.id, sourceId);
    cortex.reinforceEdge(outcomeNode.id, sourceId);
  } catch {
    // Edge may already exist — idempotent
  }
}
