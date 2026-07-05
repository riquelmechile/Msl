import {
  evaluateFreshness,
  type BusinessSignalKind,
  type CacheFreshness,
  type SellerId,
} from "@msl/domain";

export * from "./creative/index.js";
export * from "./insights/index.js";
export * from "./ownedEcommerce/index.js";
export * from "./supplierMirror/index.js";

export type CriticalSyncSignal = Extract<
  BusinessSignalKind,
  "order" | "claim" | "cancellation" | "stock" | "reputation" | "message"
>;

export type SyncJobStub = {
  id: string;
  signalKind: CriticalSyncSignal;
  sellerId: SellerId;
  source: "mercadolibre-api";
  run(): Promise<{ status: "stubbed"; signalKind: CriticalSyncSignal }>;
};

export type StaleSignalDecision = {
  signalKind: CriticalSyncSignal;
  freshness: CacheFreshness;
  shouldEnqueueRefresh: boolean;
  refreshMode: "webhook-or-risk-scheduled" | "none";
  disclosure: "critical-signal-stale" | "not-needed";
};

export const criticalSyncSignals: ReadonlyArray<CriticalSyncSignal> = [
  "order",
  "claim",
  "cancellation",
  "stock",
  "reputation",
  "message",
];

export function createSyncJobStubs(sellerId: SellerId): ReadonlyArray<SyncJobStub> {
  return criticalSyncSignals.map((signalKind) => ({
    id: `${sellerId}:${signalKind}:sync`,
    signalKind,
    sellerId,
    source: "mercadolibre-api",
    run: () => Promise.resolve({ status: "stubbed", signalKind }),
  }));
}

export function evaluateStaleCriticalSignal(input: {
  signalKind: CriticalSyncSignal;
  capturedAt: Date;
  now: Date;
}): StaleSignalDecision {
  const freshness = evaluateFreshness({
    source: "local-cache",
    signalKind: input.signalKind,
    capturedAt: input.capturedAt,
    now: input.now,
  });

  if (freshness.status === "stale") {
    return {
      signalKind: input.signalKind,
      freshness,
      shouldEnqueueRefresh: true,
      refreshMode: "webhook-or-risk-scheduled",
      disclosure: "critical-signal-stale",
    };
  }

  return {
    signalKind: input.signalKind,
    freshness,
    shouldEnqueueRefresh: false,
    refreshMode: "none",
    disclosure: "not-needed",
  };
}
