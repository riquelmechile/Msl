import type { DaemonHandler } from "./daemonTypes.js";
import {
  createEconomicIngestionRuntime,
  type EconomicIngestionRuntime,
  type SellerSlug,
} from "../economics/factory.js";
import { safeEconomicErrorMessage } from "../economics/economicSanitizer.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";

function runtimeSeller(sellerId: string): SellerSlug | null {
  if (sellerId === "plasticov") return "source";
  if (sellerId === "maustian") return "target";
  return null;
}

function claimedSellerId(claim: AgentMessage): string | null {
  let payloadSellerId: string | undefined;
  try {
    const payload = JSON.parse(claim.payloadJson) as { sellerId?: unknown };
    if (typeof payload.sellerId === "string") payloadSellerId = payload.sellerId;
  } catch {
    return null;
  }
  if (claim.sellerId && payloadSellerId && claim.sellerId !== payloadSellerId) return null;
  return claim.sellerId ?? payloadSellerId ?? null;
}

/**
 * Create an economic ingestion daemon that periodically runs the economic
 * ingestion pipeline for the configured seller(s).
 *
 * Feature-gated by `MSL_ECONOMIC_INGESTION_ENABLED` environment variable.
 * When disabled, returns an empty result immediately (no-op).
 */
export function createEconomicIngestionDaemon(opts: {
  enabled: boolean;
  sellerRoutes?: ReadonlyMap<string, SellerSlug>;
  runtimeFactory?: (seller: SellerSlug) => EconomicIngestionRuntime;
}): DaemonHandler {
  const isEnabled = opts.enabled && process.env.MSL_ECONOMIC_INGESTION_ENABLED === "true";

  return async ({ claim }) => {
    if (!isEnabled) {
      return { findings: [], proposalEnqueued: false, messageIds: [] };
    }

    const sellerId = claimedSellerId(claim);
    if (!sellerId) {
      return {
        findings: [
          {
            kind: "info",
            severity: "info",
            summary: "Economic ingestion daemon: no seller configured.",
            evidenceIds: [],
          },
        ],
        proposalEnqueued: false,
        messageIds: [],
      };
    }
    const sellerSlug = opts.sellerRoutes?.get(sellerId) ?? runtimeSeller(sellerId);
    if (!sellerSlug) {
      return {
        findings: [
          {
            kind: "alert",
            severity: "warning",
            summary: "Economic ingestion daemon: seller is not configured for the durable runtime.",
            evidenceIds: [],
          },
        ],
        proposalEnqueued: false,
        messageIds: [],
      };
    }

    let runtime: EconomicIngestionRuntime | undefined;
    try {
      runtime = (opts.runtimeFactory ?? createEconomicIngestionRuntime)(sellerSlug);
      if (
        opts.sellerRoutes &&
        (runtime.health.numericSellerId !== sellerId || runtime.health.sellerSlug !== sellerSlug)
      ) {
        throw new Error("Economic ingestion runtime seller mismatch");
      }
      const result = await runtime.pipeline({
        sellerId: runtime.health.sellerId,
        mode: "incremental",
        maxPages: 2, // small page limit for daemon tick
        noPersist: false,
      });

      if (result.run.status === "failed") {
        return {
          findings: [
            {
              kind: "alert",
              severity: "warning",
              summary: `Economic ingestion failed for ${sellerId}: ${safeEconomicErrorMessage(result.reconciliation.details)}`,
              evidenceIds: [`run:${result.run.runId}`],
            },
          ],
          proposalEnqueued: false,
          messageIds: [],
        };
      }

      return {
        findings: [
          {
            kind: "info",
            severity: "info",
            summary: `Economic ingestion completed for ${sellerId}: ${result.snapshots.length} snapshots, reconciliation ${result.reconciliation.status}, checkpoint ${result.run.checkpointAfter ?? "unchanged"}, noExternalMutationExecuted=true`,
            evidenceIds: [`run:${result.run.runId}`],
          },
        ],
        proposalEnqueued: false,
        messageIds: [],
      };
    } catch (err) {
      return {
        findings: [
          {
            kind: "alert",
            severity: "warning",
            summary: `Economic ingestion daemon error for ${sellerId}: ${safeEconomicErrorMessage(err)}`,
            evidenceIds: [],
          },
        ],
        proposalEnqueued: false,
        messageIds: [],
      };
    } finally {
      runtime?.close();
    }
  };
}
