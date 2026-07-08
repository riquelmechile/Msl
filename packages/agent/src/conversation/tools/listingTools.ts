import type { GraphEngine, OperationalReadModelReader } from "@msl/memory";
import type {
  MlClient,
  MlcApiClient,
  MlcListingPricesInput,
  MlcListingsSnapshot,
  MlcListingSummary,
  MlcVisitsSnapshot,
  MlcVisitsTimeWindowSnapshot,
  MlcAutomatedPriceItemsSnapshot,
  MlcPricingAutomationHistorySnapshot,
  MlcPricingAutomationRulesSnapshot,
  MlcRelistInput,
  NewItem,
  MlWriteSnapshot,
} from "@msl/mercadolibre";
import {
  PRICING_AUTOMATION_HISTORY_DEFAULT_DAYS,
  PRICING_AUTOMATION_HISTORY_DEFAULT_PAGE,
  PRICING_AUTOMATION_HISTORY_DEFAULT_SIZE,
  PRICING_AUTOMATION_HISTORY_MAX_SIZE,
  PRICING_AUTOMATION_ITEMS_DEFAULT_LIMIT,
  PRICING_AUTOMATION_ITEMS_MAX_LIMIT,
} from "@msl/mercadolibre";

import type { ToolDefinition } from "../tools.js";
import { sanitizeToolErrorText } from "../toolErrorSanitizer.js";
import {
  coerceSellerId,
  coerceItemId,
  metadataString,
  isMlcListingSummary,
  DEFAULT_SALE_PRICE_CONTEXT,
  storeCreateOutcome,
  type SyncToolOptions,
} from "./_shared.js";

// ---------------------------------------------------------------------------
// calculate_listing_fees tool
// ---------------------------------------------------------------------------

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
          const potentialScore = (hasHistory ? 2 : 0) + (hasStock ? 1 : 0);
          return { ...listing, potentialScore };
        });

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
// check_price_intelligence tool
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// find_automated_price_items tool
// ---------------------------------------------------------------------------

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
// check_listing_quality tool
// ---------------------------------------------------------------------------

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

      const latestPerItem = new Map<string, Record<string, unknown>>();
      for (const node of nodes) {
        const m = node.metadata;
        const iid = metadataString(m.itemId);
        const previous = latestPerItem.get(iid);
        if (!previous || metadataString(m.capturedAt) > metadataString(previous.capturedAt)) {
          latestPerItem.set(iid, m);
        }
      }

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
// read_seller_notices tool
// ---------------------------------------------------------------------------

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
// create_listing tool
// ---------------------------------------------------------------------------

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
