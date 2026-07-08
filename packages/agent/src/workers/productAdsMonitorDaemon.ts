import type { DaemonHandler } from "./daemonTypes.js";

/**
 * Product Ads Monitor daemon handler.
 *
 * Phase 1 skeleton — returns empty findings. Full signal detection
 * (profitability, visit decline, monopoly, ROAS, opportunity gap)
 * will be implemented in PR 2.
 */
export const productAdsMonitorDaemon: DaemonHandler = async () => {
  return {
    findings: [],
    proposalEnqueued: false,
    messageIds: [],
  };
};
