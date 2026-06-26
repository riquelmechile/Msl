import type { GraphEngine } from "@msl/memory";
import type { TraversalResult } from "@msl/memory";

import type { ConversationMessage } from "./types.js";

/**
 * Builds Block B: daily business aggregates with 24-hour TTL.
 *
 * ~15K token budget — stubbed with realistic MercadoLibre placeholder data
 * until a read-snapshot API provides live aggregates.
 *
 * TTL: 24 hours. Must be refreshed daily to keep the prefix cache valid.
 * DeepSeek prefix cache anchors at token 0; keeping Block A+B identical
 * across all conversations for the same seller achieves >90% cache hit rate.
 */
export function buildDailyAggregates(): string {
  return `## Contexto diario — Plasticov / Maustian (24h, refrescado automáticamente)

### Métricas del día
- Fecha: ${todaySpanish()}
- Ventas del día: $340.500 CLP (12 órdenes)
- Ventas del mes: $9.820.000 CLP
- Margen promedio: 32.4%
- Productos vendidos hoy: 18 unidades
- Visitas a listings: 1.247
- Tasa de conversión: 2.1%

### Categorías activas
- Hogar y Muebles: 423 productos activos
- Jardín y Aire Libre: 312 productos activos
- Herramientas: 198 productos activos
- Industrias y Oficinas: 187 productos activos
- Otras: 127 productos activos

### Reputación
- Nivel de MercadoLíder: Platinum
- Calificación promedio: 4.8 / 5.0
- Reclamos abiertos: 3 (1 mediación, 2 en espera de respuesta)
- Reclamos resueltos este mes: 14
- Tasa de reclamos: 0.4% (debajo del promedio de categoría 1.2%)
- Tiempo promedio de respuesta: 4.2 horas

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
export function injectCortexContext(
  query: string,
  engine: GraphEngine,
): string {
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
      .map(
        (n) =>
          `  - ${n.label} (activación: ${n.activation.toFixed(3)})`,
      )
      .join("\n");
    parts.push(
      `### Nodos activados (${result.activatedNodes.length}):\n${nodes}`,
    );
  }

  if (result.traversedEdges.length > 0) {
    const edges = result.traversedEdges
      .map(
        (e) =>
          `  - edge_${e.source}_${e.target}: peso=${e.weight.toFixed(3)}, co-ocurrencias=${e.co_occurrence_count}`,
      )
      .join("\n");
    parts.push(
      `### Conexiones recorridas (${result.traversedEdges.length}):\n${edges}`,
    );
  }

  if (result.lessons.length > 0) {
    const lessons = result.lessons
      .map(
        (l, i) =>
          `  - Lección ${i + 1}: ${l.lesson} (${l.source_node}→${l.target_node})`,
      )
      .join("\n");
    parts.push(
      `### Lecciones aprendidas (${result.lessons.length}):\n${lessons}`,
    );
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

  // Latest user message with Block C injected.
  const userContent = blockC
    ? `${userMessage}\n\n${blockC}`
    : userMessage;
  messages.push({ role: "user", content: userContent });

  return messages;
}

/**
 * Returns today's date in Spanish format.
 */
function todaySpanish(): string {
  return new Date().toLocaleDateString("es-CL", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
