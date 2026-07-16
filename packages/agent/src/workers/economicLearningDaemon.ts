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

    // A claimed seller must agree with the explicit outcome reference.
    if (
      !sellerIds.includes(payload.sellerId) ||
      (claim.sellerId && claim.sellerId !== payload.sellerId)
    ) {
      return { findings: [], proposalEnqueued: false, messageIds: [] };
    }

    try {
      const outcome = economicStore.getOutcome(payload.outcomeId, payload.sellerId);
      if (!outcome || outcome.status !== "verified") {
        return {
          findings: [
            {
              kind: "info",
              severity: "info",
              summary: `Economic learning skipped: verified outcome ${payload.outcomeId} is unavailable for ${payload.sellerId}`,
              evidenceIds: [],
            },
          ],
          proposalEnqueued: false,
          messageIds: [],
        };
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
