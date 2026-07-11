import type { DaemonHandler } from "./daemonTypes.js";
import type { EconomicOutcomeStore } from "@msl/memory";
import type { DataFetcher } from "../economics/EconomicIngestionPipeline.js";
import { runEconomicIngestion } from "../economics/EconomicIngestionPipeline.js";

/**
 * Create an economic ingestion daemon that periodically runs the economic
 * ingestion pipeline for the configured seller(s).
 *
 * Feature-gated by `MSL_ECONOMIC_INGESTION_ENABLED` environment variable.
 * When disabled, returns an empty result immediately (no-op).
 */
export function createEconomicIngestionDaemon(opts: {
  enabled: boolean;
  store?: EconomicOutcomeStore;
  dataFetcher?: DataFetcher;
  defaultSellerId?: string;
}): DaemonHandler {
  const isEnabled = opts.enabled && process.env.MSL_ECONOMIC_INGESTION_ENABLED === "true";

  return async ({ sellerIds }) => {
    if (!isEnabled) {
      return { findings: [], proposalEnqueued: false, messageIds: [] };
    }

    const store = opts.store;
    const dataFetcher = opts.dataFetcher;

    if (!store || !dataFetcher) {
      return {
        findings: [
          {
            kind: "alert",
            severity: "warning",
            summary: "Economic ingestion daemon: missing store or dataFetcher dependency.",
            evidenceIds: [],
          },
        ],
        proposalEnqueued: false,
        messageIds: [],
      };
    }

    // Use the default seller from opts, or fall back to the first available seller
    const sellerId = opts.defaultSellerId ?? sellerIds[0];
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

    try {
      const result = await runEconomicIngestion(
        {
          sellerId,
          mode: "incremental",
          maxPages: 2, // small page limit for daemon tick
          noPersist: false,
        },
        store,
        dataFetcher,
      );

      if (result.run.status === "failed") {
        return {
          findings: [
            {
              kind: "alert",
              severity: "warning",
              summary: `Economic ingestion failed for ${sellerId}: ${result.reconciliation.details}`,
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
            summary: `Economic ingestion completed for ${sellerId}: ${result.snapshots.length} snapshots, reconciliation ${result.reconciliation.status}`,
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
            summary: `Economic ingestion daemon error for ${sellerId}: ${err instanceof Error ? err.message : String(err)}`,
            evidenceIds: [],
          },
        ],
        proposalEnqueued: false,
        messageIds: [],
      };
    }
  };
}
