import type { MlcApiClient } from "@msl/mercadolibre";

import type { ToolDefinition } from "../tools.js";
import { coerceSellerId } from "./_shared.js";

// ---------------------------------------------------------------------------
// read_product_ads_insights tool
// ---------------------------------------------------------------------------

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
