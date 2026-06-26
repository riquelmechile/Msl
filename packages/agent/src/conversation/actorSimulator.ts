import type { ActorType, SimulationResult } from "./types.js";

// ── Actor Persona Prompts (Spanish) ────────────────────────────────

/** System prompt for comprador (buyer) simulation persona. */
export const COMPRADOR_PROMPT =
  "Sos un comprador típico de MercadoLibre Chile. " +
  "Buscás buena relación precio-calidad, te importa la reputación " +
  "del vendedor (estrellas verdes), leés las opiniones, comparás " +
  "con otras publicaciones similares, y tomás decisiones de compra " +
  "basado en precio + confianza + fotos reales.";

/** System prompt for proveedor (supplier) simulation persona. */
export const PROVEEDOR_PROMPT =
  "Sos un proveedor mayorista en Chile. " +
  "Vendés por volumen, negociás márgenes, ofrecés descuentos por " +
  "cantidad, tenés tiempos de entrega variables, y priorizás " +
  "clientes frecuentes con buenos historiales de pago.";

/** System prompt for competidor (competitor) simulation persona. */
export const COMPETIDOR_PROMPT =
  "Sos un vendedor competidor en MercadoLibre Chile. " +
  "Monitoreás precios de la competencia, ajustás tus publicaciones " +
  "para ganar visibilidad, reaccionás a cambios de precio en tu " +
  "categoría, y protegés tu participación de mercado.";

// ── Internal Lookup ─────────────────────────────────────────────────

const ACTOR_PROMPTS: Record<ActorType, string> = {
  comprador: COMPRADOR_PROMPT,
  proveedor: PROVEEDOR_PROMPT,
  competidor: COMPETIDOR_PROMPT,
};

const VALID_ACTORS: readonly ActorType[] = [
  "comprador",
  "proveedor",
  "competidor",
] as const;

const VALID_ACTORS_MSG = VALID_ACTORS.join(", ");

// ── Mock Response Builder ───────────────────────────────────────────

interface MockResponse {
  recommendation: string;
  rationale: string;
}

/**
 * Builds a keyword-matched mock response for a given actor type and query.
 *
 * In production this would be replaced by an LLM call using the persona prompt.
 * The mock provides realistic-sounding Spanish responses that vary by query
 * keywords so tests can verify different-queries-produce-different-responses.
 */
function buildMockResponse(
  actorType: ActorType,
  query: string,
): MockResponse {
  const lower = query.toLowerCase();

  switch (actorType) {
    // ── Comprador ─────────────────────────────────────────────
    case "comprador":
      if (/\bprecio\b|\$\d/.test(lower)) {
        return {
          recommendation:
            "Como comprador, si el precio es competitivo y tiene " +
            "buena reputación, compraría. Pero antes revisaría las " +
            "opiniones de otros compradores y compararía con " +
            "publicaciones similares para asegurarme de que es una " +
            "buena decisión.",
          rationale:
            `Evaluación basada en la consulta: "${query}". ` +
            "El comprador prioriza relación precio-calidad, " +
            "reputación del vendedor y fotos reales.",
        };
      }
      if (/\breputación\b|\bopiniones?\b|\bestrellas?\b/.test(lower)) {
        return {
          recommendation:
            "Como comprador, la reputación del vendedor es clave. " +
            "Si tiene buenas estrellas verdes y opiniones positivas " +
            "recientes, confiaría. Si no, buscaría otro vendedor " +
            "aunque sea un poco más caro.",
          rationale:
            `Evaluación basada en la consulta: "${query}". ` +
            "El comprador prioriza confianza y reputación sobre " +
            "precio absoluto.",
        };
      }
      return {
        recommendation:
          "Como comprador, evaluaría cuidadosamente la publicación. " +
          "Me fijo en el precio, la reputación del vendedor, las " +
          "fotos reales del producto, y las opiniones de otros " +
          "compradores antes de decidir.",
        rationale:
          `Evaluación basada en la consulta: "${query}". ` +
          "Análisis general del comprador.",
      };

    // ── Proveedor ─────────────────────────────────────────────
    case "proveedor":
      if (/\bstock\b|\bvolumen\b|\bcantidad\b|\bunidades?\b/.test(lower)) {
        return {
          recommendation:
            "Como proveedor, con ese volumen puedo ofrecerte un " +
            "10-15% de descuento. Para pedidos grandes manejo " +
            "entrega en 5-7 días hábiles. Si sos cliente frecuente " +
            "con buen historial de pago, puedo mejorar el margen.",
          rationale:
            `Evaluación basada en la consulta: "${query}". ` +
            "El proveedor prioriza volumen y frecuencia de compra.",
        };
      }
      if (/\bentrega\b|\btiempo\b|\bplazo\b/.test(lower)) {
        return {
          recommendation:
            "Como proveedor, los tiempos de entrega dependen del " +
            "volumen. Para pedidos estándar, entrego en 3-5 días " +
            "hábiles. Para grandes volúmenes, podemos coordinar " +
            "entregas parciales. Clientes frecuentes tienen prioridad.",
          rationale:
            `Evaluación basada en la consulta: "${query}". ` +
            "El proveedor ajusta tiempos según volumen y relación " +
            "comercial.",
        };
      }
      return {
        recommendation:
          "Como proveedor, evalúo cada solicitud según el volumen, " +
          "la frecuencia de compra y el historial de pago. Puedo " +
          "ajustar márgenes y condiciones para clientes que compran " +
          "regularmente.",
        rationale:
          `Evaluación basada en la consulta: "${query}". ` +
          "Análisis general del proveedor.",
      };

    // ── Competidor ────────────────────────────────────────────
    case "competidor":
      if (/\bprecio\b|\$\d/.test(lower)) {
        return {
          recommendation:
            "Como competidor, si bajás el precio yo también bajo " +
            "para mantener mi posición en la categoría. Monitoreo " +
            "los precios diariamente y ajusto mis publicaciones " +
            "para no perder visibilidad. Si tu margen es muy bajo, " +
            "espero a que subas y ahí aprovecho.",
          rationale:
            `Evaluación basada en la consulta: "${query}". ` +
            "El competidor reacciona a cambios de precio para " +
            "proteger su participación de mercado.",
        };
      }
      if (/\bcompetencia\b|\bmercado\b|\bcategoría\b/.test(lower)) {
        return {
          recommendation:
            "Como competidor, estoy atento a los movimientos en la " +
            "categoría. Si veo que alguien gana visibilidad con una " +
            "estrategia de precio o publicación, analizo si debo " +
            "ajustar la mía. Mi objetivo es mantener mi cuota de " +
            "mercado.",
          rationale:
            `Evaluación basada en la consulta: "${query}". ` +
            "El competidor monitorea movimientos del mercado y " +
            "ajusta su estrategia.",
        };
      }
      return {
        recommendation:
          "Como competidor, monitoreo constantemente los precios y " +
          "publicaciones en mi categoría. Ajusto mi estrategia " +
          "según lo que hace la competencia para proteger mi " +
          "participación de mercado y mi visibilidad en los " +
          "resultados de búsqueda.",
        rationale:
          `Evaluación basada en la consulta: "${query}". ` +
          "Análisis general del competidor.",
      };

    // Should never reach here — caller validates actorType.
    default:
      return { recommendation: "", rationale: "" };
  }
}

// ── Id Generation ───────────────────────────────────────────────────

/** Generates a unique simulation identifier. */
function generateSimulationId(): string {
  return `sim-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Returns the persona system prompt for a given actor type.
 *
 * @param actorType — One of "comprador", "proveedor", "competidor".
 * @returns The Spanish persona prompt string.
 * @throws If actorType is not a valid {@link ActorType}.
 */
export function getActorPrompt(actorType: ActorType): string {
  const prompt = ACTOR_PROMPTS[actorType];
  if (!prompt) {
    throw new Error(
      `Tipo de actor "${actorType}" no válido. ` +
        `Tipos válidos: ${VALID_ACTORS_MSG}.`,
    );
  }
  return prompt;
}

/**
 * Simulates a counter-party actor's response to a business query.
 *
 * This is a **mock implementation** that returns keyword-matched Spanish
 * responses. In production, this function will call the DeepSeek LLM
 * with the actor's persona prompt via the provided `agentConfig`.
 *
 * @param actorType  — The actor to simulate (comprador, proveedor, competidor).
 * @param query      — The business question or scenario in Spanish.
 * @param agentConfig — Optional LLM client configuration. Accepted but unused
 *                      in mock mode; reserved for Phase 3 LLM integration.
 * @returns A {@link SimulationResult} with recommendation, rationale,
 *          confidence (0.85), and a unique simulationId.
 * @throws If actorType is invalid or query is empty.
 */
export async function simulateActor(
  actorType: ActorType,
  query: string,
  agentConfig?: { systemPrompt: string },
): Promise<SimulationResult> {
  // Validate actorType
  if (!(VALID_ACTORS as readonly string[]).includes(actorType)) {
    throw new Error(
      `Tipo de actor "${actorType}" no válido. ` +
        `Tipos válidos: ${VALID_ACTORS_MSG}.`,
    );
  }

  // Validate query
  if (!query || query.trim().length === 0) {
    throw new Error("El parámetro 'query' no puede estar vacío.");
  }

  const { recommendation, rationale } = buildMockResponse(
    actorType,
    query.trim(),
  );

  const result: SimulationResult = {
    actorType,
    recommendation,
    confidence: 0.85,
    rationale,
    simulationId: generateSimulationId(),
  };

  // agentConfig is accepted but unused in mock mode.
  void agentConfig;

  return result;
}
