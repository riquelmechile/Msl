import crypto from "node:crypto";
import type { StorefrontCandidate } from "@msl/domain";

// ── Public types ─────────────────────────────────────────────────────

export type AdvisorPromptConfig = {
  /** Seller ID for channel context — varies per seller, stable for same seller. */
  sellerId?: string;
};

export type FullPromptResult = {
  stableHash: string;
  evidenceHash: string;
  fullPrompt: string;
};

// ── (A) Stable identity/safety ──────────────────────────────────────

function buildIdentityAndSafety(): string {
  return [
    "Sos el Website Manager del CEO de MSL, responsable de la tienda propia (owned ecommerce).",
    "Tu función es asesorar sobre merchandising, SEO/GEO, posicionamiento de productos, experimentación y evidencia faltante.",
    "",
    "Reglas de seguridad innegociables:",
    "- NUNCA sugerir acciones que ejecuten mutaciones sin aprobación explícita del CEO. Todo resultado lleva `noMutationExecuted: true`.",
    "- NUNCA recomendar publicar, activar checkout, o ejecutar cambios en MercadoLibre sin autorización.",
    "- NUNCA afirmar superioridad de un producto sin `evidenceIds` que lo respalden.",
    "- NUNCA hacer claims médicos, técnicos o curativos sin `evidenceIds` verificables.",
    "- NUNCA mezclar evidencia entre cuentas (Plasticov, Maustian) sin marcar `comparison: true` explícitamente.",
    "- Responder en español comercial, profesional, directo. Sin markdown excesivo.",
    "- Todo hallazgo debe citar `evidenceIds` cuando existan.",
    "- Criterio de utilidad: si no hay datos suficientes para una recomendación, indicarlo explícitamente en lugar de inventar.",
  ].join("\n");
}

// ── (B) Account/channel context ─────────────────────────────────────

function buildChannelContext(config: AdvisorPromptConfig = {}): string {
  const sellerId = config.sellerId ?? "unknown";

  return [
    `### Contexto de canales`,
    `Seller ID actual: ${sellerId}`,
    "",
    "Canales disponibles:",
    "- **Plasticov**: cuenta MercadoLibre principal. Catálogo amplio, reputación alta, tráfico consolidado.",
    "- **Maustian**: cuenta MercadoLibre secundaria. Catálogo selecto, nicho de fidelización.",
    "- **Owned Ecommerce (tienda propia)**: canal independiente. Control total de pricing, SEO, experiencia de compra. Sin comisiones de marketplace.",
    "",
    "Consideraciones estratégicas:",
    "- Plasticov compite por visibilidad en un marketplace; Maustian apunta a compradores recurrentes; la tienda propia compite en Google Shopping y búsqueda orgánica.",
    "- Productos con margen alto pueden priorizar tienda propia (sin comisión ML). Productos con alto volumen pueden beneficiarse del tráfico de Plasticov.",
    "- La evidencia entre cuentas DEBE mantenerse separada. Si comparás canales, marcá `comparison: true`.",
  ].join("\n");
}

// ── (C) Variable evidence ───────────────────────────────────────────

function buildEvidence(candidates: StorefrontCandidate[]): string {
  if (candidates.length === 0) {
    return "### Evidencia de candidatos\n(sin candidatos disponibles)";
  }

  const lines: string[] = ["### Evidencia de candidatos"];

  for (const c of candidates) {
    const parts: string[] = [
      `- **${c.id}**: "${c.title}"`,
      `  itemRef: ${c.itemRef}`,
      `  stock: ${c.stock.status}${c.stock.quantity !== undefined ? ` (qty: ${c.stock.quantity})` : ""}`,
    ];
    if (c.margin) {
      parts.push(`  margin: ${c.margin.value}%`);
    } else {
      parts.push(`  margin: sin datos`);
    }
    parts.push(`  evidence: ${c.evidenceState.completeness} (freshness: stock=${c.evidenceState.stockFreshness}, margin=${c.evidenceState.marginFreshness}, supplier=${c.evidenceState.supplierFreshness})`);
    if (c.blockedReasons.length > 0) {
      parts.push(`  ⛔ bloqueado: ${c.blockedReasons.join(", ")}`);
    }
    if (c.redactedReasons.length > 0) {
      parts.push(`  ⚠️ redactado: ${c.redactedReasons.join(", ")}`);
    }
    lines.push(parts.join("\n"));
  }

  return lines.join("\n");
}

// ── (D) Output JSON schema ──────────────────────────────────────────

function buildSchema(): string {
  return [
    "Respondé ÚNICAMENTE con un objeto JSON válido con esta estructura:",
    "",
    "```json",
    "{",
    '  "reasoning": [',
    '    { "rank": 1, "candidateId": "...", "rationale": "...", "evidenceIds": ["..."], "fallback": false }',
    "  ],",
    '  "positioningAngles": ["ángulo 1", "ángulo 2"],',
    '  "seoSuggestions": {',
    '    "seoTitle": "...",',
    '    "seoDescription": "...",',
    '    "keywords": ["..."]',
    "  },",
    '  "geoSuggestions": {',
    '    "geoSummary": "...",',
    '    "faq": [{ "question": "...", "answer": "...", "evidenceIds": ["..."] }]',
    "  },",
    '  "channelTradeoffs": [',
    '    { "channel": "Plasticov|Maustian|owned-ecommerce|unknown", "upsides": ["..."], "risks": ["..."], "overallAssessment": "..." }',
    "  ],",
    '  "missingEvidenceRequests": [',
    '    { "category": "cost|images|competition|account|cortex", "severity": "low|medium|high", "description": "...", "candidateId": "...", "targetAgentId": "cost-supplier|market-catalog|creative-assets|account-brain|supplier-manager", "question": "..." }',
    "  ],",
    '  "experimentProposal": { "hypothesis": "...", "metric": "...", "stopRule": "...", "expectedLearning": "..." } | null,',
    '  "confidence": 0.8',
    "}",
    "```",
    "",
    "Campos obligatorios: reasoning (array no vacío), confidence (0-1).",
    "Campos opcionales: experimentProposal puede ser null si no hay experimento viable.",
  ].join("\n");
}

// ── Hash utilities ──────────────────────────────────────────────────

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Builds the cache-friendly stable system prompt (blocks A + B).
 * This prompt is identical for the same seller and does not change
 * with candidate data — ideal for DeepSeek prefix-cache at token 0.
 */
export function buildStableSystemPrompt(config: AdvisorPromptConfig = {}): string {
  return [buildIdentityAndSafety(), "", buildChannelContext(config)].join("\n");
}

/**
 * Builds the variable evidence block (block D — output schema is appended).
 * This changes per invocation and is NOT cached.
 */
export function buildEvidenceBlock(candidates: StorefrontCandidate[]): string {
  return buildEvidence(candidates);
}

/**
 * Returns the output JSON schema block (block D).
 * Stable — same for every invocation.
 */
export function buildOutputSchema(): string {
  return buildSchema();
}

/**
 * SHA-256 hash of a stable prompt (blocks A + B + D).
 * Used as a cache key: identical hash = identical cached prefix.
 */
export function hashStablePrompt(prompt: string): string {
  return sha256(prompt);
}

/**
 * SHA-256 hash of an evidence block.
 * Changes when candidate data changes.
 */
export function hashEvidenceBlock(block: string): string {
  return sha256(block);
}

/**
 * Builds the full prompt by combining all four blocks.
 *
 * Returns the stable hash (A+B+D), evidence hash (C), and the
 * concatenated full prompt string.
 */
export function buildFullPrompt(
  candidates: StorefrontCandidate[],
  config: AdvisorPromptConfig = {},
): FullPromptResult {
  const stable = buildStableSystemPrompt(config);
  const schema = buildOutputSchema();
  const stableWithSchema = `${stable}\n\n${schema}`;
  const stableHash = hashStablePrompt(stableWithSchema);

  const evidence = buildEvidenceBlock(candidates);
  const evidenceHash = hashEvidenceBlock(evidence);

  const fullPrompt = `${stable}\n\n${evidence}\n\n${schema}`;

  return { stableHash, evidenceHash, fullPrompt };
}
