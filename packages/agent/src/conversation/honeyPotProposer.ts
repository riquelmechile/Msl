import type { DecoyProposal, SimulationResult, Strategy } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────

/** Mandatory TOS warning, always included in every DecoyProposal. */
const TOS_WARNING =
  "⚠️ Esta operación simula actividad en MercadoLibre. " +
  "Asegurate de cumplir con los Términos de Servicio. " +
  "No se permite la creación de listings falsos o engañosos.";

// ── Decoy Type Resolution ────────────────────────────────────────────

/**
 * Map a probe strategy's parsed-rule target + operator to a decoy type.
 *
 * - category probe → `price_probe` (default) or `category_entry`
 * - competitor probe → `stock_signal`
 */
function resolveDecoyType(strategy: Strategy): DecoyProposal["type"] {
  const op = strategy.parsedRule.operator.toLowerCase();

  if (strategy.parsedRule.target === "competidor") {
    return "stock_signal";
  }

  // Verbs that suggest deploying a decoy listing
  if (
    op === "probá" ||
    op === "sondeá" ||
    op === "investigá"
  ) {
    return "category_entry";
  }

  if (op === "monitoreá" || op === "vigilá" || op === "seguí" || op === "trackeá") {
    return "price_probe";
  }

  return "price_probe";
}

/**
 * Determine risk level from the strategy scope.
 *
 * - Broad category (no further qualifier) → `"medium"`
 * - Specific product or narrow scope → `"low"`
 * - Competitor monitoring → `"medium"`
 */
function resolveRiskLevel(strategy: Strategy): DecoyProposal["riskLevel"] {
  if (strategy.parsedRule.target === "competidor") {
    return "medium";
  }

  const value = strategy.parsedRule.value.toLowerCase();

  // Very specific product names → low risk
  const broadCategories = new Set([
    "electrónica",
    "electrónica",
    "ropa",
    "hogar",
    "juguetes",
    "deportes",
    "alimentos",
    "bebés",
    "salud",
    "belleza",
    "herramientas",
    "automóviles",
    "inmuebles",
    "servicios",
    "música",
    "libros",
    "películas",
    "videojuegos",
    "software",
    "hardware",
  ]);

  if (broadCategories.has(value)) {
    return "medium";
  }

  // Heuristic: specific product names tend to be longer or compound words
  if (value.includes(" ") || value.length > 10) {
    return "low";
  }

  return "medium";
}

/**
 * Build a Spanish description for the decoy proposal.
 */
function buildDescription(
  strategy: Strategy,
  decoyType: DecoyProposal["type"],
  competitorActor?: SimulationResult,
): string {
  const category = strategy.parsedRule.value;
  const base = (() => {
    switch (decoyType) {
      case "price_probe":
        return `Listing señuelo en "${category}" con precio ajustado para observar reacciones de la competencia.`;
      case "category_entry":
        return `Simulación de entrada a la categoría "${category}" para medir la respuesta de competidores activos.`;
      case "stock_signal":
        return `Señal de stock bajo en "${category}" para evaluar si los competidores ajustan sus precios o publicaciones.`;
    }
  })();

  if (competitorActor) {
    return (
      `${base} Basado en el análisis del actor competidor: ` +
      `"${competitorActor.recommendation}"`
    );
  }

  return base;
}

// ── Id Generation ────────────────────────────────────────────────────

function generateProposalId(): string {
  return `decoy-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Generate a decoy proposal based on an active probe strategy.
 *
 * Every proposal includes a mandatory MercadoLibre TOS warning in Spanish.
 * The risk level is derived from the strategy scope: broad categories
 * receive `"medium"` risk, specific products receive `"low"`.
 *
 * @param strategy — An active CEO strategy with `ruleType: "probe"`.
 * @param competitorActor — Optional `SimulationResult` from a competidor
 *   simulation; when provided, its recommendation enriches the description.
 * @returns A {@link DecoyProposal} ready for guardrail validation.
 */
export function proposeDecoy(
  strategy: Strategy,
  competitorActor?: SimulationResult,
): DecoyProposal {
  const decoyType = resolveDecoyType(strategy);
  const riskLevel = resolveRiskLevel(strategy);
  const description = buildDescription(strategy, decoyType, competitorActor);

  return {
    id: generateProposalId(),
    type: decoyType,
    description,
    riskLevel,
    tosCompliant: true,
    tosWarning: TOS_WARNING,
  };
}
