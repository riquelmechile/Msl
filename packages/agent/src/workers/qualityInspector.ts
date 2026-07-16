import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";

// ── Input / Output types ─────────────────────────────────────────────

export type QualityInspectorInput = {
  title: string;
  images: Array<{ url: string }>;
  attributesJson: string;
  gtin?: string;
  hasFreeShipping: boolean;
};

export type QualityLevel = "Básica" | "Estándar" | "Profesional";

export type QualityInspectorOutput = {
  predictedScore: number;
  predictedLevel: QualityLevel;
  issues: string[];
  recommendations: string[];
};

// ── Scoring limits ───────────────────────────────────────────────────

const MAX_SCORE = 100;
const MIN_SCORE = 0;

// ── Rules-based scoring (mimics ML /performance dimensions) ───────────

function parseAttributesCompleteness(attributesJson: string): number {
  try {
    const parsed = JSON.parse(attributesJson) as Record<string, unknown>;
    const count = Object.keys(parsed).length;
    // Heuristic: 20 attributes is considered "fully complete" for a typical listing
    return Math.min(count / 20, 1.0) * 100;
  } catch {
    return 0;
  }
}

function countTitleWords(title: string): number {
  return title
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function determineLevel(score: number): QualityLevel {
  if (score >= 80) return "Profesional";
  if (score >= 50) return "Estándar";
  return "Básica";
}

/**
 * Rules-based quality scoring mimicking ML /performance dimensions:
 *
 * - GTIN present → +25 pts
 * - 3+ images → +20 pts (1 image → +5, 2 images → +10)
 * - Title length > 3 words → +10 pts
 * - Attributes completeness > 80% → +25 pts
 * - Attributes completeness > 50% → +10 pts
 * - Free shipping → +20 pts
 *
 * Max possible: 100 pts
 */
function scoreQuality(input: QualityInspectorInput): QualityInspectorOutput {
  let score = 0;
  const issues: string[] = [];
  const recommendations: string[] = [];

  // ── GTIN ──────────────────────────────────────────────────────
  if (input.gtin && input.gtin.trim().length > 0) {
    score += 25;
  } else {
    issues.push("Falta GTIN (código de barras)");
    recommendations.push("Agrega el GTIN/UPC/EAN del producto para mejorar la visibilidad");
  }

  // ── Images ────────────────────────────────────────────────────
  const imageCount = input.images?.length ?? 0;
  if (imageCount >= 3) {
    score += 20;
  } else if (imageCount === 2) {
    score += 10;
    issues.push(`Solo ${imageCount} imágenes (mínimo recomendado: 3)`);
    recommendations.push(
      "Agrega al menos una imagen más. Las publicaciones con 3+ imágenes tienen mejor rendimiento",
    );
  } else if (imageCount === 1) {
    score += 5;
    issues.push(`Solo ${imageCount} imagen (mínimo recomendado: 3)`);
    recommendations.push(
      "Agrega al menos 2 imágenes adicionales mostrando el producto desde diferentes ángulos",
    );
  } else {
    issues.push("Sin imágenes — la publicación no será visible");
    recommendations.push(
      "Agrega al menos 3 imágenes del producto. Sin imágenes la publicación no compite",
    );
  }

  // ── Title ─────────────────────────────────────────────────────
  const titleWords = countTitleWords(input.title);
  if (titleWords > 3) {
    score += 10;
  } else if (titleWords > 0) {
    issues.push(`Título muy corto (${titleWords} palabras). Mínimo recomendado: 4 palabras`);
    recommendations.push("Expande el título incluyendo marca, modelo y característica principal");
  } else {
    issues.push("Título vacío o sin palabras");
    recommendations.push("Agrega un título descriptivo con marca, modelo y característica clave");
  }

  // ── Attributes completeness ──────────────────────────────────
  const attrCompleteness = parseAttributesCompleteness(input.attributesJson);
  if (attrCompleteness > 80) {
    score += 25;
  } else if (attrCompleteness > 50) {
    score += 10;
    issues.push(`atributos incompletos (${Math.round(attrCompleteness)}% de completitud estimada)`);
    recommendations.push(
      "Completa los atributos requeridos por la categoría para mejorar el posicionamiento",
    );
  } else {
    issues.push(
      `atributos muy incompletos (${Math.round(attrCompleteness)}% de completitud estimada)`,
    );
    recommendations.push(
      "Completa todos los atributos obligatorios de la categoría para que la publicación sea visible en filtros",
    );
  }

  // ── Free shipping ─────────────────────────────────────────────
  if (input.hasFreeShipping) {
    score += 20;
  } else {
    recommendations.push(
      "Considera ofrecer envío gratis. Las publicaciones con Mercado Envíos Full o envío gratis tienen mejor conversión",
    );
  }

  // ── Clamp ────────────────────────────────────────────────────
  const finalScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
  const level = determineLevel(finalScore);

  // ── Level-specific recommendations ─────────────────────────────
  if (level === "Básica") {
    recommendations.unshift(
      "La calidad de la publicación es baja. Prioriza completar los atributos y agregar imágenes",
    );
  } else if (level === "Estándar") {
    recommendations.unshift(
      "La publicación tiene calidad aceptable. Mejora los atributos faltantes para alcanzar nivel Profesional",
    );
  }

  return {
    predictedScore: finalScore,
    predictedLevel: level,
    issues,
    recommendations,
  };
}

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Quality Inspector daemon handler.
 *
 * Claims messages with `receiverAgentId: "listing-composition"`.
 *
 * 1. Parse the claimed message payload as QualityInspectorInput
 * 2. Apply rules-based scoring (GTIN, images, title, attributes, free shipping)
 * 3. Predict the ML quality level: Básica, Estándar, or Profesional
 * 4. Return findings with score, level, issues, and recommendations
 *
 * This handler is always available — no external API dependency.
 */
export const qualityInspector: DaemonHandler = ({ claim, bus }) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  // ── 1. Parse input ────────────────────────────────────────────
  let input: QualityInspectorInput;
  try {
    input = JSON.parse(claim.payloadJson) as QualityInspectorInput;
  } catch {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Quality Inspector: invalid payload — could not parse QualityInspectorInput",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  if (!input.title || !input.images) {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Quality Inspector: missing title or images in payload",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 2. Score quality ──────────────────────────────────────────
  const output = scoreQuality(input);

  // ── 3. Enqueue result ─────────────────────────────────────────
  const summary = `Quality Inspector: score ${output.predictedScore}/100 (${output.predictedLevel}), ${output.issues.length} issues, ${output.recommendations.length} recommendations`;
  const severity =
    output.predictedLevel === "Básica"
      ? "critical"
      : output.predictedLevel === "Estándar"
        ? "warning"
        : "info";
  const kind =
    output.predictedLevel === "Básica"
      ? "alert"
      : output.predictedLevel === "Estándar"
        ? "alert"
        : "opportunity";

  const payload: Record<string, unknown> = {
    type: "finding",
    summary,
    qualityInspection: output,
    input: {
      title: input.title,
      imageCount: input.images.length,
      hasGtin: !!input.gtin,
      hasFreeShipping: input.hasFreeShipping,
    },
    nextAction: output.predictedLevel === "Profesional" ? "ready_to_publish" : "improve_quality",
    noMutationExecuted: true,
    capturedAt: new Date().toISOString(),
  };

  const message = bus.enqueue({
    senderAgentId: "listing-composition",
    receiverAgentId: "listing-composition",
    messageType: "quality-inspection-result",
    payloadJson: JSON.stringify(payload),
    dedupeKey: `quality-inspector-${claim.messageId}`,
  });
  messageIds.push(message.messageId);

  findings.push({
    kind,
    severity,
    summary,
    evidenceIds: [claim.messageId, message.messageId],
  });

  return { findings, proposalEnqueued: true, messageIds };
};
