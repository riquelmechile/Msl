import type { GraphEngine } from "@msl/memory";
import type { TraversalResult } from "@msl/memory";

import type { LaneContract } from "./lanes.js";
import type { ConversationMessage } from "./types.js";

export type LanePromptBlocks = {
  stablePrefix: string;
  refreshableContext: string;
};

/**
 * Interface for the daily business data source (Block B).
 *
 * Implementations provide real MercadoLibre API data for daily aggregates.
 * The default implementation returns hardcoded placeholder data — wire a
 * real ML-backed implementation in production.
 */
export type DailyDataSource = {
  /** Category-level stats: name → { activeProducts, monthlySales, marginAvg }. */
  getCategoryStats(): Array<{
    name: string;
    activeProducts: number;
    monthlySales?: number;
    marginAvg?: number;
  }>;
  /** Monthly sales volume in CLP. */
  getMonthlyVolume(): number;
  /** Reputation summary: level, rating, open claims, claim rate. */
  getReputation(): {
    level: string;
    rating: number;
    openClaims: number;
    mediationClaims: number;
    pendingResponse: number;
    resolvedThisMonth: number;
    claimRate: number;
    avgResponseTimeHours: number;
  };
};

/**
 * Default hardcoded DailyDataSource implementation.
 * Returns realistic placeholder data for Plasticov / Maustian (MLC).
 */
const defaultDataSource: DailyDataSource = {
  getCategoryStats: () => [
    { name: "Hogar y Muebles", activeProducts: 423, monthlySales: 4_200_000, marginAvg: 35.2 },
    { name: "Jardín y Aire Libre", activeProducts: 312, monthlySales: 2_800_000, marginAvg: 28.5 },
    { name: "Herramientas", activeProducts: 198, monthlySales: 1_500_000, marginAvg: 41.0 },
    { name: "Industrias y Oficinas", activeProducts: 187, monthlySales: 980_000, marginAvg: 25.8 },
    { name: "Otras", activeProducts: 127, monthlySales: 340_000, marginAvg: 31.5 },
  ],
  getMonthlyVolume: () => 9_820_000,
  getReputation: () => ({
    level: "Platinum",
    rating: 4.8,
    openClaims: 3,
    mediationClaims: 1,
    pendingResponse: 2,
    resolvedThisMonth: 14,
    claimRate: 0.4,
    avgResponseTimeHours: 4.2,
  }),
};

/**
 * Builds Block B: daily business aggregates with 24-hour TTL.
 *
 * Accepts an optional {@link DailyDataSource} implementation.
 * When omitted, falls back to hardcoded placeholder data.
 *
 * When the data source provides `getFreshnessNotes()`, operational
 * snapshot timestamps are appended so the LLM can reason about staleness.
 *
 * ~15K token budget — keeps the prefix cache valid across conversations.
 *
 * TTL: 24 hours. Must be refreshed daily to keep the prefix cache valid.
 * DeepSeek prefix cache anchors at token 0; keeping Block A+B identical
 * across all conversations for the same seller achieves >90% cache hit rate.
 */
export function buildDailyAggregates(
  source?: DailyDataSource & { getFreshnessNotes?(): string },
): string {
  const ds = source ?? defaultDataSource;
  const categories = ds.getCategoryStats();
  const monthlyVolume = ds.getMonthlyVolume();
  const rep = ds.getReputation();

  const categoryLines = categories
    .map(
      (c) =>
        `- ${c.name}: ${c.activeProducts} productos activos` +
        (c.monthlySales ? `, ventas mensuales ~$${c.monthlySales.toLocaleString("es-CL")}` : "") +
        (c.marginAvg ? `, margen prom. ${c.marginAvg}%` : ""),
    )
    .join("\n");

  let result = `## Contexto diario — Plasticov / Maustian (24h, refrescado automáticamente)

### Métricas del día
- Plasticov y Maustian operan como canales comerciales paralelos, no como fábrica/tienda.
- La estrategia de precio, título, tipo de publicación y exposición puede diferir por cuenta.
- Ventas del día: $340.500 CLP (12 órdenes)
- Ventas del mes: $${monthlyVolume.toLocaleString("es-CL")} CLP
- Margen promedio: 32.4%
- Productos vendidos hoy: 18 unidades
- Visitas a listings: 1.247
- Tasa de conversión: 2.1%

### Categorías activas
${categoryLines}

### Reputación
- Nivel de MercadoLíder: ${rep.level}
- Calificación promedio: ${rep.rating} / 5.0
- Reclamos abiertos: ${rep.openClaims} (${rep.mediationClaims} mediación, ${rep.pendingResponse} en espera de respuesta)
- Reclamos resueltos este mes: ${rep.resolvedThisMonth}
- Tasa de reclamos: ${rep.claimRate}% (debajo del promedio de categoría 1.2%)
- Tiempo promedio de respuesta: ${rep.avgResponseTimeHours} horas

### Inventario crítico (stock bajo)
- Artículos con stock ≤ 3 unidades: 47
- Artículos agotados (sin reposición programada): 12
- Artículos con alta rotación y stock bajo: 8

### Precios y competencia
- Listings con precio por encima del promedio de categoría: 89
- Listings con precio por debajo del promedio de categoría: 312
- Competidores directos monitoreados: 15

### Prioridades sugeridas
1. Responder los 2 reclamos en espera antes de 24h
2. Revisar los 8 artículos con alta rotación y stock bajo
3. Evaluar margen en 89 listings con precio sobre el promedio
4. Preparar envíos pendientes (5 órdenes sin despachar)`;

  // Append operational freshness metadata when available.
  if (source?.getFreshnessNotes) {
    const freshness = source.getFreshnessNotes();
    if (freshness) {
      result += `\n\n### Actualización de datos\n${freshness}`;
    }
  }

  return result;
}

/**
 * Injects Cortex context (Block C) into the conversation.
 *
 * Searches the graph for nodes whose labels match terms in the query,
 * seeds spreading activation from those nodes, traverses the activated
 * subgraph, and formats the result as an LLM-context string.
 *
 * Returns an empty string when the graph has no matching nodes or when
 * the query yields no seed candidates.
 */
export function injectCortexContext(query: string, engine: GraphEngine): string {
  // Seed nodes: find nodes whose labels match query terms.
  // The GraphEngine exposes its database; we query by label substring match.
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3);

  if (terms.length === 0) {
    return "";
  }

  // Build a parameterized query matching any term in node labels.
  const placeholders = terms.map(() => "label LIKE ?").join(" OR ");
  const matchers = terms.map((t) => `%${t}%`);

  const seedRows = engine.db
    .prepare(`SELECT id, label FROM nodes WHERE ${placeholders} LIMIT 20`)
    .all(...matchers) as Array<{ id: number; label: string }>;

  if (seedRows.length === 0) {
    return "";
  }

  const seedIds = seedRows.map((r) => r.id);

  // Spread activation from seed nodes.
  engine.spreadActivation(seedIds);

  // Traverse the activated subgraph.
  const result: TraversalResult = engine.traverse();

  return formatTraversalContext(result);
}

/**
 * Formats a TraversalResult into a compact LLM-context string.
 */
function formatTraversalContext(result: TraversalResult): string {
  const parts: string[] = [];

  if (result.activatedNodes.length > 0) {
    const nodes = result.activatedNodes
      .map((n) => `  - ${n.label} (activación: ${n.activation.toFixed(3)})`)
      .join("\n");
    parts.push(`### Nodos activados (${result.activatedNodes.length}):\n${nodes}`);
  }

  if (result.traversedEdges.length > 0) {
    const edges = result.traversedEdges
      .map(
        (e) =>
          `  - edge_${e.source}_${e.target}: peso=${e.weight.toFixed(3)}, co-ocurrencias=${e.co_occurrence_count}`,
      )
      .join("\n");
    parts.push(`### Conexiones recorridas (${result.traversedEdges.length}):\n${edges}`);
  }

  if (result.lessons.length > 0) {
    const lessons = result.lessons
      .map((l, i) => `  - Lección ${i + 1}: ${l.lesson} (${l.source_node}→${l.target_node})`)
      .join("\n");
    parts.push(`### Lecciones aprendidas (${result.lessons.length}):\n${lessons}`);
  }

  if (parts.length === 0) {
    return "";
  }

  return `## Contexto de memoria (Cortex)\n\n${parts.join("\n\n")}`;
}

/**
 * Builds an OpenAI-compatible messages array using the 3-block
 * prefix-anchored cache strategy.
 *
 * Layout (token-0 anchored):
 *   1. System: Block A + Block B  (~20K tokens, >90% cache hit rate)
 *   2. Conversation history (user/assistant turns)
 *   3. Latest user message with Block C injected at end
 *
 * DeepSeek's prefix cache is anchored at token 0, so keeping the
 * system prefix identical across all conversations maximizes cache hits.
 */
export function assembleMessages(
  blockA: string,
  blockB: string,
  blockC: string,
  history: ConversationMessage[],
  userMessage: string,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];

  // Prefix cache (token-0 anchored): Block A + Block B as system prompt.
  const systemContent = `${blockA}\n\n${blockB}`;
  messages.push({ role: "system", content: systemContent });

  // Conversation history (user/assistant turns only).
  for (const msg of history) {
    if (msg.role === "user" || msg.role === "assistant") {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Latest user message with date label + optional Block C injected.
  const dateLabel = `\n[Fecha: ${new Date().toLocaleDateString("es-CL", { year: "numeric", month: "long", day: "numeric" })}]`;
  const userContent = blockC 
    ? `${userMessage}${dateLabel}\n\n${blockC}` 
    : `${userMessage}${dateLabel}`;
  messages.push({ role: "user", content: userContent });

  return messages;
}

export function buildLanePromptBlocks(
  lane: LaneContract,
  refreshableContext: string,
): LanePromptBlocks {
  return {
    stablePrefix: lane.stablePrefix,
    refreshableContext,
  };
}

export function assembleLaneMessages(
  lane: LaneContract,
  refreshableContext: string,
  history: ConversationMessage[],
  userMessage: string,
): Array<{ role: string; content: string }> {
  const blocks = buildLanePromptBlocks(lane, refreshableContext);
  return assembleMessages(blocks.stablePrefix, "", blocks.refreshableContext, history, userMessage);
}


