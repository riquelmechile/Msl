export type BusinessSignalKind =
  | "order"
  | "claim"
  | "cancellation"
  | "stock"
  | "reputation"
  | "message"
  | "listing"
  | "category-attributes"
  | "category-technical-specs"
  | "pricing"
  | "historical-summary";

export type BusinessRisk = "low" | "medium" | "critical";

export type FreshnessStatus = "fresh" | "stale";

export type CacheFreshness = {
  source: "local-cache" | "mercadolibre-api" | "seller-input";
  signalKind: BusinessSignalKind;
  risk: BusinessRisk;
  capturedAt: Date;
  maxAgeMs: number;
  status: FreshnessStatus;
};

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
