import type { DaemonHandler } from "./daemonTypes.js";
import type {
  EconomicLearningStore,
  EconomicOutcomeReader as EconomicOutcomeStore,
  GraphEngine,
} from "@msl/memory";
import { EconomicLearningTrigger } from "../finance/EconomicLearningTrigger.js";

type OutcomePayload = { outcomeId: string; status: string; sellerId: string };

function parsePayload(payloadJson: string): OutcomePayload | null {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.outcomeId !== "string" || typeof p.sellerId !== "string") return null;
    return {
      outcomeId: p.outcomeId,
      sellerId: p.sellerId,
      status: typeof p.status === "string" ? p.status : "unknown",
    };
  } catch {
    return null;
  }
}

export function createEconomicLearningDaemon(
  economicStore: EconomicOutcomeStore,
  learningStore: EconomicLearningStore,
  engine?: GraphEngine,
): DaemonHandler {
  const trigger = new EconomicLearningTrigger();

  // eslint-disable-next-line @typescript-eslint/require-await
  return async ({ claim, sellerIds, reader }) => {
    // Parse outcome reference from message payloadJson
    const payload = parsePayload(claim.payloadJson);
    if (!payload) {
      return { findings: [], proposalEnqueued: false, messageIds: [] };
    }

    // Only process for sellers we manage
    if (!sellerIds.includes(payload.sellerId)) {
      return { findings: [], proposalEnqueued: false, messageIds: [] };
    }

    try {
      const outcomes = economicStore.listOutcomesBySeller(payload.sellerId, { limit: 1 });
      const outcome = outcomes.find((o) => o.outcomeId === payload.outcomeId);
      if (!outcome) {
        return { findings: [], proposalEnqueued: false, messageIds: [] };
      }

      const input: Record<string, unknown> = {
        outcome,
        economicStore,
        learningStore,
      };
      if (engine !== undefined) input.engine = engine;

      const result = trigger.onOutcomeTransition(
        input as Parameters<typeof trigger.onOutcomeTransition>[0],
      );

      void reader;

      return {
        findings: [
          {
            kind: "info" as const,
            severity: "info" as const,
            summary: `Economic learning ${result.status} for outcome ${result.outcomeId}`,
            evidenceIds: [`outcome:${result.outcomeId}`, `seller:${result.sellerId}`],
          },
        ],
        proposalEnqueued: false,
        messageIds: [],
      };
    } catch {
      return { findings: [], proposalEnqueued: false, messageIds: [] };
    }
  };
}
