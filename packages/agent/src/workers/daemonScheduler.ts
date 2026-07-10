import type { AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";
import type { AgentConsensusStore } from "../conversation/agentConsensusStore.js";
import type {
  OperationalReadModelReader,
  GraphEngine,
  SupplierMirrorStore,
  SearchSnapshotsFilter,
  SnapshotSearchResult,
} from "@msl/memory";
import type { LaneId } from "../conversation/lanes.js";
import type { CeoInboxStore } from "../conversation/ceoInboxStore.js";
import { listCompanyAgents } from "../conversation/companyAgents.js";
import type { CeoHandlerContext, DaemonHandler } from "./daemonTypes.js";
import type { AgentAccountContext } from "../conversation/types.js";
import type { SupplierMirrorDeepSeekAdvisor } from "../conversation/supplierMirrorDeepSeekAdvisor.js";
import type { OperationsDeepSeekAdvisor } from "../conversation/operationsDeepSeekAdvisor.js";
import type { CatalogDeepSeekAdvisor } from "../conversation/catalogDeepSeekAdvisor.js";
import type { CostSupplierDeepSeekAdvisor } from "../conversation/costSupplierDeepSeekAdvisor.js";
import type { CreativeDeepSeekAdvisor } from "../conversation/creativeDeepSeekAdvisor.js";
import { marketCatalogDaemon } from "./marketCatalogDaemon.js";
import { operationsManagerDaemon } from "./operationsManagerDaemon.js";
import { costSupplierDaemon } from "./costSupplierDaemon.js";
import { creativeCommercialDaemon } from "./creativeCommercialDaemon.js";
import { productAdsMonitorDaemon } from "./productAdsMonitorDaemon.js";
import { productAdsProfitabilityDaemon } from "./productAdsProfitabilityDaemon.js";
import { creativeAssetsDaemon } from "./creativeAssetsDaemon.js";
import { creativeStudioDaemon } from "./creativeStudioDaemon.js";
import { ceoProfitabilityHandler } from "./ceoProfitabilityHandler.js";
import { supplierManagerDaemon } from "./supplierManagerDaemon.js";
import { morningReportDaemon } from "./morningReportDaemon.js";
import { eodSummaryDaemon } from "./eodSummaryDaemon.js";
import { ownedEcommerceDaemon } from "./ownedEcommerceDaemon.js";
import { unansweredQuestionsDaemon } from "./unansweredQuestionsDaemon.js";
import type { AgentWorkSessionStore } from "../sessions/AgentWorkSessionStore.js";
import type { AgentWorkSessionRunner } from "../sessions/AgentWorkSessionRunner.js";
import type { AccountBrainService } from "../conversation/accountBrainService.js";
import type { CreativeJobQueueStore } from "../conversation/creativeJobQueueStore.js";
import type { OwnedEcommerceStore } from "@msl/memory";
import { OwnedEcommerceIntelligenceService } from "../ecommerce/ownedEcommerceIntelligenceService.js";

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
  /** Optional SupplierMirrorStore for the supplier-manager daemon. */
  supplierMirrorStore?: SupplierMirrorStore;
  /** Optional CEO handler context for Telegram notifications and action preparation. */
  ceoContext?: CeoHandlerContext;
  /** Optional SupplierMirrorDeepSeekAdvisor for AI enrichment of stock-gap
   *  signals in the supplier-manager daemon. */
  advisor?: SupplierMirrorDeepSeekAdvisor;
  /** Optional OperationsDeepSeekAdvisor for AI enrichment of claim and reputation
   *  signals in the operations-manager daemon. */
  operationsAdvisor?: OperationsDeepSeekAdvisor;
  /** Optional CatalogDeepSeekAdvisor for AI enrichment of market catalog signals
   *  in the market-catalog daemon. */
  catalogAdvisor?: CatalogDeepSeekAdvisor;
  /** Optional CostSupplierDeepSeekAdvisor for AI enrichment of cost, margin, and
   *  restock signals in the cost-supplier daemon. */
  costSupplierAdvisor?: CostSupplierDeepSeekAdvisor;
  /** Optional CreativeDeepSeekAdvisor for AI enrichment of creative asset and
   *  commercial signals in the creative-assets and creative-commercial daemons. */
  creativeAdvisor?: CreativeDeepSeekAdvisor;
  /** Optional CeoInboxStore for persisting CEO proposals before bus resolution. */
  ceoInboxStore?: CeoInboxStore;
  /** When true, the 6 sessionized lanes route through WorkSessionRunner instead of direct handler dispatch. */
  enableWorkSessions?: boolean;
  /** Optional AgentWorkSessionStore for session persistence (required when enableWorkSessions is true). */
  sessionStore?: AgentWorkSessionStore;
  /** Optional session runner for work-session lifecycle. */
  workSessionRunner?: AgentWorkSessionRunner;
  /** Optional AccountBrainService for channel-recommendation scoring
   *  in the owned-ecommerce intelligence pipeline. */
  accountBrainService?: AccountBrainService;
  /** Optional CreativeJobQueueStore for creative-asset delegation
   *  when storefront candidates are missing images. */
  creativeJobQueueStore?: CreativeJobQueueStore;
  /** Optional OwnedEcommerceStore for persisting projection snapshots
   *  and candidate state. */
  ownedEcommerceStore?: OwnedEcommerceStore;
};

// ── Handler Map ─────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/** Lanes that support work-session routing when enableWorkSessions is true. */
const SESSION_LANE_IDS = new Set<LaneId>([
  "unanswered-questions",
  "product-ads-profitability",
  "creative-assets",
  "operations-manager",
  "morning-report",
  "eod-summary",
]);

/** Minimum cooldown between sessions for the same lane+seller (1 hour). */
const SESSION_COOLDOWN_MS = 60 * 60 * 1000;

/** Static mapping from LaneId → daemon handler. Unknown lanes are skipped silently. */
const daemonHandlerMap: Partial<Record<LaneId, DaemonHandler>> = {
  "market-catalog": marketCatalogDaemon,
  "operations-manager": operationsManagerDaemon,
  "cost-supplier": costSupplierDaemon,
  "creative-assets": creativeAssetsDaemon,
  "creative-commercial": creativeCommercialDaemon,
  "creative-studio": creativeStudioDaemon,
  "product-ads-monitor": productAdsMonitorDaemon,
  "product-ads-ceo-profitability": ceoProfitabilityHandler,
  "product-ads-profitability": productAdsProfitabilityDaemon,
  "supplier-manager": supplierManagerDaemon,
  "morning-report": morningReportDaemon,
  "eod-summary": eodSummaryDaemon,
  "owned-ecommerce": ownedEcommerceDaemon,
  "unanswered-questions": unansweredQuestionsDaemon,
};

// ── Cycle-level cache ───────────────────────────────────────────────

/**
 * Creates a reader wrapper that caches searchSnapshots results for the
 * duration of one daemon cycle. Each call with the same filter key returns
 * the cached result, avoiding redundant data reads across daemon handlers.
 */
function createCachingReader(reader: OperationalReadModelReader): OperationalReadModelReader {
  const cache = new Map<string, unknown>();

  return {
    ...reader,
    searchSnapshots: async <TData>(
      filter: SearchSnapshotsFilter,
    ): Promise<SnapshotSearchResult<TData>[]> => {
      const key = JSON.stringify(filter);
      if (cache.has(key)) return cache.get(key) as SnapshotSearchResult<TData>[];
      const result = await reader.searchSnapshots<TData>(filter);
      cache.set(key, result);
      return result;
    },
  };
}

// ── Tick Generation ─────────────────────────────────────────────────

/**
 * Enqueue a self-triggering daemon tick for each registered lane × seller.
 * Dedupe keys include `sellerId` to prevent cross-account dedupe collisions.
 * Each tick carries an ISO-8601 `cycleTimestamp` so daemons can check
 * hour gates.
 */
export function enqueueDaemonTick(bus: AgentMessageBusStore, sellerIds: string[]): void {
  const now = new Date();
  const hourKey = now.toISOString().slice(0, 13); // "2026-07-09T14"
  for (const laneId of Object.keys(daemonHandlerMap)) {
    for (const sellerId of sellerIds) {
      bus.enqueue({
        senderAgentId: "system",
        receiverAgentId: laneId,
        messageType: "daemon-tick",
        payloadJson: JSON.stringify({ cycleTimestamp: now.toISOString(), sellerId }),
        dedupeKey: `${laneId}:${sellerId}:tick:${hourKey}`,
      });
    }
  }
}

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
    // ── Build per-seller account contexts ──
    const accountContexts = new Map<string, AgentAccountContext>();
    for (const sellerId of config.sellerIds) {
      accountContexts.set(sellerId, { sellerId });
    }

    // ── Enqueue autonomous ticks before claim loop ──
    enqueueDaemonTick(config.bus, config.sellerIds);

    const agents = listCompanyAgents();
    const activeAgents = agents.filter(
      (agent) =>
        agent.profile.laneId && daemonHandlerMap[agent.profile.laneId] && agent.status === "active",
    );

    // ── Wrap reader with per-cycle cache to avoid redundant data reads ──
    const cachedReader = createCachingReader(config.reader);

    // ── Run all active daemons in parallel with error isolation ──
    // Pre-construct the owned-ecommerce intelligence service once per cycle
    // so all daemon handler invocations share the same instance.
    const intelligenceService = new OwnedEcommerceIntelligenceService({
      cortex: config.cortex,
      ...(config.accountBrainService ? { accountBrainService: config.accountBrainService } : {}),
      ...(config.creativeJobQueueStore
        ? { creativeJobQueueStore: config.creativeJobQueueStore }
        : {}),
      ...(config.ownedEcommerceStore ? { ownedEcommerceStore: config.ownedEcommerceStore } : {}),
    });

    await Promise.all(
      activeAgents.map(async (agent) => {
        const laneId = agent.profile.laneId!;
        const handler = daemonHandlerMap[laneId]!;

        const claimed = config.bus.claimNext(laneId);
        if (claimed.length === 0) return;

        for (const claim of claimed) {
          try {
            // ── Session-aware dispatch for sessionized lanes ──
            if (config.enableWorkSessions && config.sessionStore && SESSION_LANE_IDS.has(laneId)) {
              const sessionSellerId =
                (claim.sellerId ?? claim.payloadJson)
                  ? (() => {
                      try {
                        const parsed = JSON.parse(claim.payloadJson) as {
                          sellerId?: string;
                        };
                        return parsed.sellerId;
                      } catch {
                        return undefined;
                      }
                    })()
                  : undefined;

              if (sessionSellerId) {
                // Check for recent session to skip duplicate dispatches
                const recentSessions = config.sessionStore.listRecentSessionsByAgent(
                  sessionSellerId,
                  laneId,
                  1,
                );
                if (recentSessions.length > 0) {
                  const lastSession = recentSessions[0];
                  if (
                    lastSession &&
                    (lastSession.status === "completed" || lastSession.status === "skipped")
                  ) {
                    const endedAt = lastSession.endedAt;
                    if (endedAt) {
                      const elapsed = Date.now() - new Date(endedAt).getTime();
                      if (elapsed < SESSION_COOLDOWN_MS) {
                        // Skip — recent session already processed this lane+seller
                        config.bus.resolve(claim.messageId, {
                          findings: [],
                          proposalEnqueued: false,
                          messageIds: [],
                          sessionSkipped: true,
                          reason: "cooldown",
                        });
                        continue;
                      }
                    }
                  }
                }
              }
            }

            const result = await handler({
              claim,
              reader: cachedReader,
              cortex: config.cortex,
              bus: config.bus,
              sellerIds: config.sellerIds,
              accountContexts,
              supplierMirrorStore: config.supplierMirrorStore,
              ceoContext: config.ceoContext,
              advisor: config.advisor,
              operationsAdvisor: config.operationsAdvisor,
              catalogAdvisor: config.catalogAdvisor,
              costSupplierAdvisor: config.costSupplierAdvisor,
              creativeAdvisor: config.creativeAdvisor,
              sessionStore: config.sessionStore,
              sessionRunner: config.workSessionRunner,
              intelligenceService,
              accountBrainService: config.accountBrainService,
              creativeJobQueueStore: config.creativeJobQueueStore,
              ownedEcommerceStore: config.ownedEcommerceStore,
            } as Parameters<DaemonHandler>[0]);
            config.bus.resolve(claim.messageId, result);
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(
              `[daemon-scheduler] Daemon ${laneId} failed for message ${claim.messageId}: ${errorMessage}`,
            );
            config.bus.fail(claim.messageId, errorMessage);
          }
        }
      }),
    );

    // ── CEO message consumption ────────────────────────────────────
    // Daemons enqueue proposals addressed to "ceo" — consume them so
    // the bus doesn't accumulate pending messages forever. For each
    // valid proposal, persist to CeoInboxStore before resolving.
    const ceoMessages = config.bus.claimNext("ceo", { limit: 10 });
    for (const claim of ceoMessages) {
      try {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(claim.payloadJson); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        } catch {
          // non-JSON payloads are still consumed but skipped for review
        }

        const summary = typeof payload.summary === "string" ? payload.summary : "(no summary)";
        console.log(`[daemon-scheduler] CEO proposal from ${claim.senderAgentId}: ${summary}`);

        // Persist to CeoInboxStore if available (PR4: Proposal Router & Durability)
        const inbox = config.ceoInboxStore;
        if (inbox) {
          const severity = payload.severity;
          const riskLevel: "low" | "medium" | "high" | "critical" =
            severity === "critical"
              ? "critical"
              : severity === "high"
                ? "high"
                : severity === "medium"
                  ? "medium"
                  : "low";

          inbox.insert({
            sender_agent_id: claim.senderAgentId,
            proposal_type: typeof payload.type === "string" ? payload.type : "proposal",
            payload_json: claim.payloadJson,
            normalized_summary: summary,
            risk_level: riskLevel,
            seller_id: claim.sellerId ?? "unknown",
          });
        }

        // Auto-submit consensus review for high-risk proposals
        const consensusStore = config.consensusStore;
        if (consensusStore) {
          const action = payload.action as Record<string, unknown> | undefined;
          const actionKind = typeof action?.kind === "string" ? action.kind : undefined;
          if (actionKind && consensusStore.requiresConsensus(actionKind)) {
            const proposalId =
              (typeof action?.id === "string" ? action.id : undefined) ?? claim.messageId;
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
        const errorMessage = err instanceof Error ? err.message : String(err);
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
