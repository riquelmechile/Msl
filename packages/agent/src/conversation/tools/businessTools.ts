import type { GraphEngine } from "@msl/memory";
import { riskLevelForAction } from "@msl/domain";
import type { AgentProposal } from "../types.js";
import { getLaneContract, type LaneId } from "../lanes.js";
import type { ToolDefinition, MetadataNode } from "./types.js";
import { metadataString } from "./_shared.js";

// ── Internal helpers ───────────────────────────────────────────────────

const BUSINESS_DATA_TYPES = [
  "listings",
  "visits",
  "orders",
  "seasonal",
  "cross_account",
  "all",
] as const;

function buildQueryFilters(args: Record<string, unknown>): {
  status?: string;
  categoryId?: string;
  sellerId?: string;
  itemId?: string;
} {
  const filters: {
    status?: string;
    categoryId?: string;
    sellerId?: string;
    itemId?: string;
  } = {};

  const rawStatus = args.status;
  if (typeof rawStatus === "string" && rawStatus.length > 0) {
    filters.status = rawStatus;
  }
  const rawCategoryId = args.categoryId;
  if (typeof rawCategoryId === "string" && rawCategoryId.length > 0) {
    filters.categoryId = rawCategoryId;
  }
  const rawSellerId = args.sellerId;
  if (typeof rawSellerId === "string" && rawSellerId.length > 0) {
    filters.sellerId = rawSellerId;
  }
  const rawItemId = args.itemId;
  if (typeof rawItemId === "string" && rawItemId.length > 0) {
    filters.itemId = rawItemId;
  }

  return filters;
}

function aggregateVisitTrends(nodes: MetadataNode[]): Record<string, unknown> {
  const byItem = new Map<string, Array<{ date: string; totalVisits: number }>>();
  for (const node of nodes) {
    const itemId = metadataString(node.metadata.itemId, "unknown");
    const capturedAt = metadataString(node.metadata.capturedAt);
    const totalVisits = Number(node.metadata.totalVisits ?? 0);
    let entries = byItem.get(itemId);
    if (!entries) {
      entries = [];
      byItem.set(itemId, entries);
    }
    entries.push({ date: capturedAt, totalVisits });
  }

  const items: Array<Record<string, unknown>> = [];
  for (const [itemId, entries] of byItem) {
    entries.sort((a, b) => a.date.localeCompare(b.date));
    const latest = entries[entries.length - 1];
    const oldest = entries[0];
    const trend =
      entries.length >= 2 && oldest && latest && oldest.totalVisits > 0
        ? (latest.totalVisits - oldest.totalVisits) / oldest.totalVisits
        : 0;
    items.push({
      itemId,
      latestVisits: latest?.totalVisits ?? 0,
      trend: trend > 0.1 ? "up" : trend < -0.1 ? "down" : "stable",
      changePct: Math.round(trend * 100),
      snapshots: entries.length,
    });
  }

  return { items, total: items.length };
}

function aggregateListingStats(nodes: MetadataNode[]): Record<string, unknown> {
  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalPrice = 0;
  let priceCount = 0;

  for (const node of nodes) {
    const status = metadataString(node.metadata.status, "unknown");
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    const catId = metadataString(node.metadata.categoryId);
    if (catId && catId !== "" && catId !== "unknown") {
      byCategory[catId] = (byCategory[catId] ?? 0) + 1;
    }

    const price = Number(node.metadata.price ?? 0);
    if (price > 0) {
      totalPrice += price;
      priceCount++;
    }
  }

  return {
    total: nodes.length,
    byStatus,
    byCategory,
    avgPrice: priceCount > 0 ? Math.round(totalPrice / priceCount) : 0,
  };
}

function summarizeOrderHistory(nodes: MetadataNode[]): Record<string, unknown> {
  let totalOrders = 0;
  let totalAmount = 0;
  const byCategory: Record<string, { orderCount: number; totalAmount: number }> = {};

  for (const node of nodes) {
    totalOrders += Number(node.metadata.totalOrders ?? 0);
    totalAmount += Number(node.metadata.totalAmount ?? 0);

    const catBreakdown = node.metadata.categoryBreakdown as
      | Array<{ categoryId: string; orderCount: number; totalAmount: number }>
      | undefined;
    if (catBreakdown) {
      for (const cat of catBreakdown) {
        const existing = byCategory[cat.categoryId];
        if (existing) {
          existing.orderCount += cat.orderCount;
          existing.totalAmount += cat.totalAmount;
        } else {
          byCategory[cat.categoryId] = {
            orderCount: cat.orderCount,
            totalAmount: cat.totalAmount,
          };
        }
      }
    }
  }

  return { totalOrders, totalAmount, byCategory };
}

// ── Tool factories ─────────────────────────────────────────────────────

export function createGetBusinessContextTool(engine: GraphEngine): ToolDefinition {
  return {
    name: "get_business_context",
    description:
      "Consulta la memoria Cortex del negocio para obtener datos reales sobre " +
      "publicaciones, visitas, ventas, patrones estacionales y rendimiento entre cuentas. " +
      "Usá esta herramienta para entender el estado actual e histórico del negocio " +
      "antes de hacer recomendaciones. Podés consultar por tipo de dato, período, " +
      "categoría, o cuenta específica.",
    parameters: {
      type: "object",
      properties: {
        dataType: {
          type: "string",
          enum: [...BUSINESS_DATA_TYPES],
          description:
            "Tipo de datos a consultar: listings (catálogo), visits (tráfico), " +
            "orders (ventas), seasonal (estacionalidad), cross_account (comparación " +
            "entre cuentas), all (todo)",
        },
        status: {
          type: "string",
          enum: ["active", "paused", "closed"],
          description: "Filtrar listings por estado (active, paused, closed)",
        },
        categoryId: {
          type: "string",
          description: "Filtrar por categoría de MercadoLibre (ej: MLC1743)",
        },
        sellerId: {
          type: "string",
          description: "Filtrar por vendedor (plasticov o maustian)",
        },
        itemId: {
          type: "string",
          description: "Consultar una publicación específica por su ID de MercadoLibre",
        },
        months: {
          type: "number",
          description: "Período de análisis en meses (default: 3)",
        },
      },
      required: [],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      try {
        const dataType =
          typeof args.dataType === "string" &&
          (BUSINESS_DATA_TYPES as readonly string[]).includes(args.dataType)
            ? args.dataType
            : "all";
        const months = typeof args.months === "number" && args.months > 0 ? args.months : 3;
        const after = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString();

        const context: Record<string, unknown> = {};
        const userFilters = buildQueryFilters(args);

        if (dataType === "listings" || dataType === "all") {
          const filters: Record<string, unknown> = {
            type: "listing_snapshot",
            limit: 50,
          };
          if (userFilters.status) filters.status = userFilters.status;
          if (userFilters.categoryId) filters.categoryId = userFilters.categoryId;
          if (userFilters.sellerId) filters.sellerId = userFilters.sellerId;
          if (userFilters.itemId) filters.itemId = userFilters.itemId;

          const nodes = engine.queryByMetadata(filters);
          context.listings = aggregateListingStats(nodes);
          if (context.listings && (context.listings as Record<string, unknown>).total === 0) {
            context.listings = { ...(context.listings as Record<string, unknown>), items: [] };
          }
        }

        if (dataType === "visits" || dataType === "all") {
          const filters: Record<string, unknown> = {
            type: "visit_snapshot",
            after,
            limit: 100,
          };
          if (userFilters.sellerId) filters.sellerId = userFilters.sellerId;
          if (userFilters.itemId) filters.itemId = userFilters.itemId;

          const nodes = engine.queryByMetadata(filters);
          context.visits = aggregateVisitTrends(nodes);
        }

        if (dataType === "orders" || dataType === "all") {
          const filters: Record<string, unknown> = {
            type: "order_snapshot",
            after,
            limit: 30,
          };
          if (userFilters.sellerId) filters.sellerId = userFilters.sellerId;

          const nodes = engine.queryByMetadata(filters);
          context.orders = summarizeOrderHistory(nodes);
        }

        if (dataType === "seasonal" || dataType === "all") {
          const filters: Record<string, unknown> = {
            type: "seasonal_pattern",
            limit: 50,
          };
          if (userFilters.categoryId) filters.categoryId = userFilters.categoryId;

          const nodes = engine.queryByMetadata(filters);
          context.seasonal = nodes.map((n) => n.metadata);
        }

        if (dataType === "cross_account" || dataType === "all") {
          const plasticovNodes = engine.queryByMetadata({
            type: "listing_snapshot",
            sellerId: "plasticov",
            limit: 100,
          });
          const maustianNodes = engine.queryByMetadata({
            type: "listing_snapshot",
            sellerId: "maustian",
            limit: 100,
          });

          context.cross_account = {
            plasticov: aggregateListingStats(plasticovNodes),
            maustian: aggregateListingStats(maustianNodes),
          };
        }

        return {
          context,
          metadata: {
            dataType,
            months,
            queriedAt: new Date().toISOString(),
          },
        };
      } catch {
        return { error: "Cortex no está disponible en este momento." };
      }
    },
  };
}

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
          description: "ID de la cuenta vendedora configurada para esta acción.",
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
            "product-ads-action",
            "honey-pot-deploy",
            "probe-analysis",
          ],
          description:
            "Tipo de acción a ejecutar: cambio de precio, cambio de stock, " +
            "mensaje a cliente, cancelación, reembolso, edición de listing, " +
            "publicación creativa, o ajuste de Product Ads.",
        },
        targetType: {
          type: "string",
          enum: [
            "listing",
            "order",
            "message",
            "creative-asset",
            "product-ads-campaign",
            "product-ads-ad",
          ],
          description:
            "Tipo de entidad sobre la que se ejecuta la acción. " +
            "Usá 'product-ads-campaign' para ajustar campañas y " +
            "'product-ads-ad' para anuncios individuales.",
        },
        targetId: {
          type: "string",
          description: "Identificador de la entidad objetivo (listingId, orderId, etc.).",
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
          description: "Justificación de por qué esta acción es necesaria. Requerido siempre.",
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

      const target: AgentProposal["action"]["target"] = (() => {
        switch (targetType) {
          case "listing":
            return { type: "listing", listingId: targetId };
          case "order":
            return { type: "order", orderId: targetId };
          case "message":
            return { type: "message", threadId: targetId };
          case "product-ads-campaign":
            return { type: "product-ads-campaign", campaignId: targetId };
          case "product-ads-ad":
            return { type: "product-ads-ad", adId: targetId };
          default:
            return { type: "creative-asset", assetId: targetId };
        }
      })();

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
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        naturalSummary: (args.summary as string) ?? "",
        riskLevel: riskLevelForAction(kind as AgentProposal["action"]["kind"]),
      };

      return proposal;
    },
  };
}

export function createDelegateToSubagentTool(): ToolDefinition {
  return {
    name: "delegate_to_subagent",
    description:
      "Prepara una delegación proposal-only a una lane especialista. No ejecuta acciones, " +
      "no muta MercadoLibre y devuelve advertencias de límite con evidence IDs.",
    parameters: {
      type: "object",
      properties: {
        laneId: {
          type: "string",
          enum: [
            "cost-supplier",
            "market-catalog",
            "creative-commercial",
            "operations-manager",
            "owned-ecommerce",
          ],
        },
        scope: { type: "string" },
        requestedAction: { type: "string" },
        evidenceIds: { type: "array", items: { type: "string" } },
      },
      required: ["laneId", "scope"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const laneId = typeof args.laneId === "string" ? (args.laneId as LaneId) : "cost-supplier";
      const lane = getLaneContract(laneId);
      const evidenceIds = Array.isArray(args.evidenceIds)
        ? args.evidenceIds.filter((id): id is string => typeof id === "string")
        : [];
      const requestedAction = typeof args.requestedAction === "string" ? args.requestedAction : "";
      const boundaryWarnings = [...lane.boundaries];

      if (
        /publish|publicar|mutar|mutation|precio|price|mensaje|payment|pago|sii/i.test(
          requestedAction,
        )
      ) {
        boundaryWarnings.push(
          "Requested productive effect was blocked: Phase 1 delegation may investigate or prepare only.",
        );
      }

      return {
        laneId: lane.laneId,
        status: "proposal-only",
        scope: typeof args.scope === "string" ? args.scope : "bounded investigation",
        evidenceIds,
        boundaryWarnings,
        noMutationExecuted: true,
      };
    },
  };
}
