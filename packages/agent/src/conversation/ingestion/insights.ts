import OpenAI from "openai";
import {
  buildDeepSeekChatCompletionRequest,
  resolveDeepSeekRuntimeConfig,
  resolveDeepSeekUserId,
} from "../deepseekRuntime.js";
import type { GraphEngine } from "@msl/memory";

import {
  isRecord,
  metadataString,
  categoryBreakdownFromMetadata,
} from "./utils.js";

// ── Types ──────────────────────────────────────────────────────────────

/**
 * Structured business context assembled after an ingestion cycle,
 * used as input for the DeepSeek inference pass.
 */
export type DailyBusinessContext = {
  capturedAt: string;
  listings: {
    total: number;
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
    avgPrice: number;
  };
  visits: {
    trendingUp: string[];
    trendingDown: string[];
    totalSnapshots: number;
  };
  orders: {
    totalOrders: number;
    totalAmount: number;
    byCategory: Record<string, { orderCount: number; totalAmount: number }>;
  };
  seasonal: Array<Record<string, unknown>>;
  crossAccount: {
    plasticov: { total: number; byStatus: Record<string, number> };
    maustian: { total: number; byStatus: Record<string, number> };
  };
  alerts: string[];
};

// ── Build Daily Context ────────────────────────────────────────────────

export function buildDailyContext(
  engine: GraphEngine,
  sellerNames: Record<string, string>,
  alerts: string[],
): DailyBusinessContext {
  const capturedAt = new Date().toISOString();

  const listingNodes = engine.queryByMetadata({
    type: "listing_snapshot",
    limit: 200,
  });

  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalPrice = 0;
  let priceCount = 0;

  for (const n of listingNodes) {
    const m = n.metadata;
    const status = metadataString(m.status, "unknown");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const cat = metadataString(m.categoryId);
    if (cat && cat !== "unknown") {
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }
    const price = Number(m.price ?? 0);
    if (price > 0) {
      totalPrice += price;
      priceCount++;
    }
  }

  const visitNodes = engine.queryByMetadata({
    type: "visit_snapshot",
    limit: 100,
  });

  const byVisitItem = new Map<string, number[]>();
  for (const n of visitNodes) {
    const m = n.metadata;
    const itemId = metadataString(m.itemId, "unknown");
    const visits = Number(m.totalVisits ?? 0);
    let values = byVisitItem.get(itemId);
    if (!values) {
      values = [];
      byVisitItem.set(itemId, values);
    }
    values.push(visits);
  }

  const trendingUp: string[] = [];
  const trendingDown: string[] = [];
  for (const [itemId, values] of byVisitItem) {
    if (values.length < 2) continue;
    const first = values[0];
    const last = values[values.length - 1];
    if (first === undefined || last === undefined || first === 0) continue;
    const change = (last - first) / first;
    if (change > 0.1) trendingUp.push(itemId);
    else if (change < -0.1) trendingDown.push(itemId);
  }

  const orderNodes = engine.queryByMetadata({
    type: "order_snapshot",
    limit: 30,
  });

  let totalOrders = 0;
  let totalAmount = 0;
  const byOrderCategory: Record<string, { orderCount: number; totalAmount: number }> = {};

  for (const n of orderNodes) {
    const m = n.metadata;
    totalOrders += Number(m.totalOrders ?? 0);
    totalAmount += Number(m.totalAmount ?? 0);

    const breakdown = categoryBreakdownFromMetadata(m.categoryBreakdown);
    for (const cat of breakdown) {
      const existing = byOrderCategory[cat.categoryId];
      if (existing) {
        existing.orderCount += cat.orderCount;
        existing.totalAmount += cat.totalAmount;
      } else {
        byOrderCategory[cat.categoryId] = {
          orderCount: cat.orderCount,
          totalAmount: cat.totalAmount,
        };
      }
    }
  }

  const seasonalNodes = engine.queryByMetadata({
    type: "seasonal_pattern",
    limit: 50,
  });
  const seasonal = seasonalNodes.map((n) => n.metadata);

  const plasticovListings = engine.queryByMetadata({
    type: "listing_snapshot",
    sellerId: "plasticov",
    limit: 200,
  });
  const maustianListings = engine.queryByMetadata({
    type: "listing_snapshot",
    sellerId: "maustian",
    limit: 200,
  });

  const pByStatus: Record<string, number> = {};
  for (const n of plasticovListings) {
    const s = metadataString(n.metadata.status, "unknown");
    pByStatus[s] = (pByStatus[s] ?? 0) + 1;
  }
  const mByStatus: Record<string, number> = {};
  for (const n of maustianListings) {
    const s = metadataString(n.metadata.status, "unknown");
    mByStatus[s] = (mByStatus[s] ?? 0) + 1;
  }

  return {
    capturedAt,
    listings: {
      total: listingNodes.length,
      byStatus,
      byCategory,
      avgPrice: priceCount > 0 ? Math.round(totalPrice / priceCount) : 0,
    },
    visits: {
      trendingUp,
      trendingDown,
      totalSnapshots: visitNodes.length,
    },
    orders: {
      totalOrders,
      totalAmount,
      byCategory: byOrderCategory,
    },
    seasonal,
    crossAccount: {
      plasticov: { total: plasticovListings.length, byStatus: pByStatus },
      maustian: { total: maustianListings.length, byStatus: mByStatus },
    },
    alerts,
  };
}

// ── Resolve DeepSeek User ID ───────────────────────────────────────────

export function resolveDailyInsightsDeepSeekUserId(sellerIds: ReadonlyArray<string>): string {
  return resolveDeepSeekUserId({
    laneId: "market-catalog",
    sellerId: sellerIds.join("-"),
    agentId: "background-ingestion",
  });
}

// ── Generate Daily Insights ────────────────────────────────────────────

export async function generateDailyInsights(
  context: DailyBusinessContext,
  openai: OpenAI,
  userId = resolveDeepSeekUserId({ laneId: "ceo", agentId: "background-ingestion" }),
): Promise<string> {
  const prompt = `Sos un analista de negocio experto en MercadoLibre. Analizá estos datos del negocio
Plasticov/Maustian y generá 3-5 insights accionables en español. Cada insight debe:
- Identificar un patrón o anomalía concreta
- Explicar por qué importa para la utilidad neta
- Recomendar una acción específica (qué listing, qué cambiar, de qué valor a qué valor)
- Incluir los datos que respaldan la recomendación

Cuando corresponda, sugerí acciones concretas que el vendedor puede confirmar con "dale":
- Cambios de precio: "MLC99281 bajar de $15.000 a $12.500 (margen 34%, +23% ventas esperadas)"
- Ajustes de stock: "MLC77412 reponer 20 unidades (67% más visitas, stock crítico)"
- Presupuesto de ads: "Campaña X subir daily_budget de $12.000 a $25.000 (ROAS 4.2)"
- Reutilizar paused: "MLC84512 pausada (47 ventas) → reutilizar para nuevo producto"

DATOS DEL NEGOCIO:
${JSON.stringify(context, null, 2)}

Respondé en este formato exacto, máximo 5 insights:
🔍 [Insight 1 - patrón detectado]
💰 [Insight 2 - margen/utilidad con acción concreta]
📈 [Insight 3 - tendencia con acción concreta]
⚠️ [Insight 4 - riesgo con acción correctiva]
🎯 [Insight 5 - oportunidad con acción concreta]`;

  try {
    const request = buildDeepSeekChatCompletionRequest({
      model: resolveDeepSeekRuntimeConfig().model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      ...(userId ? { userId, user: userId } : {}),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const completion = await openai.chat.completions.create(request as any);

    return completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    console.error(
      "[background-ingestion] DeepSeek insight generation failed:",
      err instanceof Error ? err.message : String(err),
    );
    return "";
  }
}
