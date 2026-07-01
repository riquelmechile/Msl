import { evaluateFreshness, type BusinessSignalKind, type CacheFreshness } from "@msl/domain";

export type InsightCandidate = {
  id: string;
  title: string;
  businessReason: string;
  expectedTradeoff: string;
  profitImpact: number;
  urgency: number;
  reputationRisk: number;
  confidence: "low" | "medium" | "high";
  signalKind: BusinessSignalKind;
  capturedAt: Date;
};

export type RankedInsight = InsightCandidate & {
  rank: number;
  score: number;
  freshness: CacheFreshness;
  staleDataDisclosure: string | null;
};

export type DailySummary = {
  generatedAt: Date;
  priorities: ReadonlyArray<RankedInsight>;
  staleDataDisclosures: ReadonlyArray<string>;
};

const confidenceWeight: Record<InsightCandidate["confidence"], number> = {
  low: 0.7,
  medium: 1,
  high: 1.2,
};
const signalLabels: Record<BusinessSignalKind, string> = {
  cancellation: "cancelaciones",
  "category-attributes": "category attributes",
  "category-technical-specs": "category technical specs",
  claim: "reclamos",
  "historical-summary": "resumen histórico",
  listing: "publicaciones",
  "listing-prices": "listing prices",
  message: "mensajes",
  order: "órdenes",
  pricing: "precios",
  "product-ads-insights": "Product Ads insights",
  reputation: "reputación",
  stock: "stock",
};

export function generateDailySummary(input: {
  now: Date;
  candidates: ReadonlyArray<InsightCandidate>;
}): DailySummary {
  const ranked = input.candidates
    .map((candidate) => rankInsight(candidate, input.now))
    .sort((left, right) => right.score - left.score)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  return {
    generatedAt: input.now,
    priorities: ranked,
    staleDataDisclosures: ranked
      .map((insight) => insight.staleDataDisclosure)
      .filter((disclosure): disclosure is string => disclosure !== null),
  };
}

function rankInsight(candidate: InsightCandidate, now: Date): RankedInsight {
  const freshness = evaluateFreshness({
    source: "local-cache",
    signalKind: candidate.signalKind,
    capturedAt: candidate.capturedAt,
    now,
  });
  const stalePenalty = freshness.status === "stale" ? 0.75 : 1;
  const score =
    (candidate.profitImpact * 0.45 + candidate.urgency * 0.3 + candidate.reputationRisk * 0.25) *
    confidenceWeight[candidate.confidence] *
    stalePenalty;

  return {
    ...candidate,
    rank: 0,
    score: Number(score.toFixed(3)),
    freshness,
    staleDataDisclosure:
      freshness.status === "stale"
        ? `Datos desactualizados en ${signalLabels[candidate.signalKind]}; refrescar antes de la guía final si afecta una prioridad crítica.`
        : null,
  };
}
