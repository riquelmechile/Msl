import type { MlcApiClient, MlcSellerPromotionsSnapshot, MlcPromotionDetailSnapshot, MlcPromotionItemsSnapshot, MlcItemPromotionsSnapshot } from "@msl/mercadolibre";
import {
  MLC_PROMOTIONS_ITEMS_DEFAULT_LIMIT,
  MLC_PROMOTIONS_ITEMS_MAX_LIMIT,
} from "@msl/mercadolibre";

import type { ToolDefinition } from "../tools.js";
import { sanitizeToolErrorText } from "../toolErrorSanitizer.js";
import {
  coerceSellerId,
  coerceItemId,
  coercePromotionId,
  coercePromotionType,
} from "./_shared.js";

// ---------------------------------------------------------------------------
// read_seller_promotions tool
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

// ---------------------------------------------------------------------------
// read_item_promotions tool
// ---------------------------------------------------------------------------

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
