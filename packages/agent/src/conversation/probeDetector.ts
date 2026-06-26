import type { ProbeAlert } from "./types.js";

// ── Internal Helpers ─────────────────────────────────────────────────

/** Pricing-related keywords that indicate a competitor is probing prices. */
const PRICING_KEYWORDS = [
  "precio",
  "margen",
  "costo",
  "descuento",
  "promo",
  "promoción",
  "ganancia",
  "rentabilidad",
  "profit",
  "barato",
  "caro",
  "oferta",
  "liquidación",
  "precio de lista",
  "precio mayorista",
  "precio minorista",
] as const;

/**
 * Compute a simple Jaccard-like similarity score based on word overlap.
 *
 * Returns 0.0–1.0 where 1.0 means the two strings share the same set of
 * significant words (after lowercasing and filtering short stop words).
 */
function textSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const setA = words(a);
  const setB = words(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter((w) => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Count how many pricing-related keywords appear in a question text.
 */
function countPricingKeywords(text: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const kw of PRICING_KEYWORDS) {
    if (lower.includes(kw)) count++;
  }
  return count;
}

/**
 * Estimate the complexity of a question by character length
 * and count of business-relevant words.
 */
function questionComplexity(text: string): number {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  // Longer questions with more business vocabulary are more complex.
  return Math.min(1.0, words.length / 15 + text.length / 300);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Analyse a set of incoming questions for competitor probing patterns.
 *
 * Pure function — no external dependencies or side effects.
 *
 * @param questions — Array of questions with text, origin, and date.
 * @returns Array of {@link ProbeAlert} objects, one per detected pattern.
 */
export function analyzeQuestions(
  questions: Array<{ text: string; from: string; date: string }>,
): ProbeAlert[] {
  if (!questions || questions.length === 0) return [];

  const alerts: ProbeAlert[] = [];

  // ── Group questions by origin (from) ──────────────────────────────
  const byUser = new Map<string, typeof questions>();
  for (const q of questions) {
    const key = q.from;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key)!.push(q);
  }

  for (const [userId, userQuestions] of byUser) {
    // ── 1. Question spike detection ─────────────────────────────────
    // Trigger when a single user sends >3 questions
    if (userQuestions.length > 3) {
      // Compute pairwise similarity to confirm repeated themes
      let totalSim = 0;
      let pairs = 0;
      for (let i = 0; i < userQuestions.length; i++) {
        for (let j = i + 1; j < userQuestions.length; j++) {
          totalSim += textSimilarity(userQuestions[i]!.text, userQuestions[j]!.text);
          pairs++;
        }
      }
      const avgSim = pairs > 0 ? totalSim / pairs : 0;
      // Spike confidence scales with count and similarity
      const spikeConf = Math.min(0.9, 0.55 + userQuestions.length * 0.05 + avgSim * 0.2);

      if (spikeConf >= 0.6) {
        alerts.push({
          pattern: "question_spike",
          confidence: Number(spikeConf.toFixed(2)),
          competitorId: userId,
          description: `El usuario "${userId}" realizó ${userQuestions.length} preguntas en un período corto con una similitud promedio del ${(avgSim * 100).toFixed(0)}%. Posible sondeo de inteligencia competitiva.`,
          recommendedAction: "monitor",
        });
      }
    }

    // ── 2. Price reaction detection ─────────────────────────────────
    const pricingQs = userQuestions.filter((q) => countPricingKeywords(q.text) >= 2);
    if (pricingQs.length >= 2) {
      const priceConf = Math.min(0.85, 0.6 + pricingQs.length * 0.08);
      alerts.push({
        pattern: "price_reaction",
        confidence: Number(priceConf.toFixed(2)),
        competitorId: userId,
        description: `El usuario "${userId}" hizo ${pricingQs.length} preguntas con foco en precios. Probable reacción a cambios de precio en la categoría.`,
        recommendedAction: "deploy_decoy",
      });
    }

    // ── 3. New competitor detection ─────────────────────────────────
    // Complex business questions from an origin that only appears once
    // (no prior interaction history) suggests a new competitor probing.
    if (userQuestions.length <= 2) {
      const complexQs = userQuestions.filter((q) => questionComplexity(q.text) >= 0.4);
      if (complexQs.length >= 1) {
        const newCompConf = Math.min(
          0.8,
          0.55 + complexQs.length * 0.1 + questionComplexity(complexQs[0]!.text) * 0.2,
        );
        if (newCompConf >= 0.6) {
          alerts.push({
            pattern: "new_competitor",
            confidence: Number(newCompConf.toFixed(2)),
            competitorId: userId,
            description: `El usuario "${userId}" parece ser una cuenta nueva o con poca actividad haciendo preguntas detalladas de negocio. Posible competidor investigando la categoría.`,
            recommendedAction: "deploy_decoy",
          });
        }
      }
    }
  }

  return alerts;
}

/**
 * Detect view-count anomalies that indicate competitor reconnaissance.
 *
 * Compares the most recent day's view count against the average of the
 * previous 7 days (or however many are available).  When the latest day
 * exceeds 2× the trailing average, a `view_anomaly` alert is raised.
 *
 * Pure function — no external dependencies.
 *
 * @param views — Daily view counts ordered chronologically (oldest first).
 * @returns Array of {@link ProbeAlert} objects.
 */
export function detectViewAnomalies(views: Array<{ count: number; date: string }>): ProbeAlert[] {
  if (!views || views.length < 2) return [];

  const alerts: ProbeAlert[] = [];

  // The last entry is "today"
  const today = views[views.length - 1]!;
  const previous = views.slice(0, -1);

  if (previous.length === 0) return [];

  const avg = previous.reduce((sum, v) => sum + v.count, 0) / previous.length;

  if (avg === 0) return []; // Avoid division by zero

  if (today.count > avg * 2) {
    const ratio = today.count / avg;
    const confidence = Math.min(0.9, 0.65 + (ratio - 2) * 0.1);

    alerts.push({
      pattern: "view_anomaly",
      confidence: Number(confidence.toFixed(2)),
      description: `Pico anómalo de vistas detectado: ${today.count} vistas (${ratio.toFixed(1)}× el promedio de ${avg.toFixed(0)}). Posible reconocimiento de competidores.`,
      recommendedAction: "monitor",
    });
  }

  return alerts;
}
