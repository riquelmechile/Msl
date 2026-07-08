import type { AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";
import type { AgentConsensusStore } from "../conversation/agentConsensusStore.js";
import type { OperationalReadModelReader, GraphEngine } from "@msl/memory";
import type { LaneId } from "../conversation/lanes.js";
import { listCompanyAgents } from "../conversation/companyAgents.js";
import type { DaemonHandler } from "./daemonTypes.js";
import { marketCatalogDaemon } from "./marketCatalogDaemon.js";
import { operationsManagerDaemon } from "./operationsManagerDaemon.js";
import { costSupplierDaemon } from "./costSupplierDaemon.js";
import { creativeCommercialDaemon } from "./creativeCommercialDaemon.js";
import { productAdsMonitorDaemon } from "./productAdsMonitorDaemon.js";
import { creativeAssetsDaemon } from "./creativeAssetsDaemon.js";

// ── Config ──────────────────────────────────────────────────────────

export type DaemonSchedulerConfig = {
  bus: AgentMessageBusStore;
  reader: OperationalReadModelReader;
  cortex: GraphEngine;
  sellerIds: string[];
  /** Interval in milliseconds between polling cycles. Default: 15 minutes. */
  intervalMs?: number;
  /**
   * Optional consensus store for auto-review on high-risk CEO proposals.
   * When provided, CEO messages with a high-risk `action.kind` in their
   * payload will automatically receive a `needs_more_evidence` review.
   */
  consensusStore?: AgentConsensusStore;
};

// ── Handler Map ─────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/** Static mapping from LaneId → daemon handler. Unknown lanes are skipped silently. */
const daemonHandlerMap: Partial<Record<LaneId, DaemonHandler>> = {
  "market-catalog": marketCatalogDaemon,
  "operations-manager": operationsManagerDaemon,
  "cost-supplier": costSupplierDaemon,
  "creative-assets": creativeAssetsDaemon,
  "creative-commercial": creativeCommercialDaemon,
  "product-ads-monitor": productAdsMonitorDaemon,
};

// ── Scheduler ───────────────────────────────────────────────────────

/**
 * Start a daemon scheduler that periodically wakes company agents by polling
 * the agent message bus and dispatching to matching daemon handlers.
 *
 * Follows the `startBackgroundIngestion()` pattern: runs one cycle immediately
 * on start, then on the configured interval. Returns a `{ stop }` handle.
 */
export function startDaemonScheduler(config: DaemonSchedulerConfig): {
  stop: () => void;
} {
  const intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;

  const run = async () => {
    const agents = listCompanyAgents();

    for (const agent of agents) {
      // Skip agents without a matching daemon handler
      const laneId = agent.profile.laneId;
      if (!laneId) continue;

      const handler = daemonHandlerMap[laneId];
      if (!handler) continue;

      // Skip suspended agents — they stay dormant
      if (agent.status !== "active") continue;

      // ── Claim pending messages for this agent ────────────────
      const claimed = config.bus.claimNext(laneId);
      if (claimed.length === 0) continue;

      // ── Dispatch each claimed message to the daemon ──────────
      for (const claim of claimed) {
        try {
          const result = await handler({
            claim,
            reader: config.reader,
            cortex: config.cortex,
            bus: config.bus,
            sellerIds: config.sellerIds,
          });

          config.bus.resolve(claim.messageId, result);
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : String(err);
          console.error(
            `[daemon-scheduler] Daemon ${laneId} failed for message ${claim.messageId}: ${errorMessage}`,
          );
          config.bus.fail(claim.messageId, errorMessage);
          // Continue to next message — error isolation per daemon spec
        }
      }
    }

    // ── CEO message consumption ────────────────────────────────────
    // Daemons enqueue proposals addressed to "ceo" — consume them so
    // the bus doesn't accumulate pending messages forever.
    const ceoMessages = config.bus.claimNext("ceo", { limit: 10 });
    for (const claim of ceoMessages) {
      try {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(claim.payloadJson);
        } catch {
          // non-JSON payloads are still consumed but skipped for review
        }

        const summary =
          typeof payload.summary === "string"
            ? payload.summary
            : "(no summary)";
        console.log(
          `[daemon-scheduler] CEO proposal from ${claim.senderAgentId}: ${summary}`,
        );

        // Auto-submit consensus review for high-risk proposals
        const consensusStore = config.consensusStore;
        if (consensusStore) {
          const action = payload.action as
            | Record<string, unknown>
            | undefined;
          const actionKind =
            typeof action?.kind === "string" ? action.kind : undefined;
          if (actionKind && consensusStore.requiresConsensus(actionKind)) {
            const proposalId =
              (typeof action?.id === "string" ? action.id : undefined) ??
              claim.messageId;
            consensusStore.submitReview({
              proposalId,
              reviewerAgentId: "ceo-scheduler",
              verdict: "needs_more_evidence",
              rationale: summary,
              confidence: 0.5,
            });
          }
        }

        config.bus.resolve(claim.messageId, { consumed: true });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        console.error(
          `[daemon-scheduler] CEO consumption failed for message ${claim.messageId}: ${errorMessage}`,
        );
        config.bus.fail(claim.messageId, errorMessage);
      }
    }
  };

  // Run immediately on start, then on interval
  void run();

  const interval = setInterval(() => {
    void run();
  }, intervalMs);

  return {
    stop: () => {
      clearInterval(interval);
      console.log("[daemon-scheduler] Stopped");
    },
  };
}
