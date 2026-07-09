export type BusinessSignalKind =
  | "order"
  | "claim"
  | "cancellation"
  | "stock"
  | "reputation"
  | "message"
  | "listing"
  | "listing-prices"
  | "product-ads-insights"
  | "category-attributes"
  | "category-technical-specs"
  | "pricing"
  | "creative-snapshot"
  | "historical-summary"
  | "business-signal"
  | "question";

export type BusinessRisk = "low" | "medium" | "critical";

export type FreshnessStatus = "fresh" | "stale";

export type OperationalEvidenceCompleteness = "complete" | "partial" | "missing";

export type OperationalEvidenceSource =
  "operational-read-model" | "cortex" | CacheFreshness["source"];

export type CacheFreshness = {
  source: "local-cache" | "mercadolibre-api" | "seller-input";
  signalKind: BusinessSignalKind;
  risk: BusinessRisk;
  capturedAt: Date;
  maxAgeMs: number;
  status: FreshnessStatus;
};

export type OperationalEvidence = {
  evidenceId: string;
  snapshotKind: BusinessSignalKind;
  sellerId: string;
  entityId?: string;
  capturedAt: Date;
  freshnessStatus: FreshnessStatus;
  completeness: OperationalEvidenceCompleteness;
  source: OperationalEvidenceSource;
};

export type OperationalEvidenceClaimConfidence = "low" | "medium" | "high";

const fiveMinutes = 5 * 60 * 1000;
const oneHour = 60 * 60 * 1000;
const oneDay = 24 * oneHour;

const criticalSignals = new Set<BusinessSignalKind>([
  "order",
  "claim",
  "cancellation",
  "stock",
  "reputation",
  "message",
]);

export function businessRiskForSignal(kind: BusinessSignalKind): BusinessRisk {
  if (criticalSignals.has(kind)) {
    return "critical";
  }

  if (kind === "historical-summary") {
    return "low";
  }

  return "medium";
}

export function maxAgeForBusinessRisk(risk: BusinessRisk): number {
  if (risk === "critical") {
    return fiveMinutes;
  }

  if (risk === "medium") {
    return oneHour;
  }

  return oneDay;
}

export function evaluateFreshness(input: {
  source: CacheFreshness["source"];
  signalKind: BusinessSignalKind;
  capturedAt: Date;
  now: Date;
}): CacheFreshness {
  const risk = businessRiskForSignal(input.signalKind);
  const maxAgeMs = maxAgeForBusinessRisk(risk);
  const ageMs = input.now.getTime() - input.capturedAt.getTime();

  return {
    source: input.source,
    signalKind: input.signalKind,
    risk,
    capturedAt: input.capturedAt,
    maxAgeMs,
    status: ageMs <= maxAgeMs ? "fresh" : "stale",
  };
}

export function canMakeHighConfidenceClaimFromEvidence(evidence: OperationalEvidence): boolean {
  return evidence.freshnessStatus === "fresh" && evidence.completeness === "complete";
}

export function confidenceForOperationalEvidence(
  evidence: OperationalEvidence,
): OperationalEvidenceClaimConfidence {
  if (canMakeHighConfidenceClaimFromEvidence(evidence)) {
    return "high";
  }

  if (evidence.freshnessStatus === "fresh" && evidence.completeness === "partial") {
    return "medium";
  }

  return "low";
}
