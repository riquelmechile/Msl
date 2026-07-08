import type { AgentMessage, AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";
import type { GraphEngine, SupplierMirrorStore } from "@msl/memory";
import type { OperationalReadModelReader } from "@msl/memory";
import type { WorkforceCostCacheLedgerStore } from "../conversation/workforceCostCacheLedgerStore.js";
import type { SupplierMirrorDeepSeekAdvisor } from "../conversation/supplierMirrorDeepSeekAdvisor.js";
import type { OperationsDeepSeekAdvisor } from "../conversation/operationsDeepSeekAdvisor.js";
import type { CatalogDeepSeekAdvisor } from "../conversation/catalogDeepSeekAdvisor.js";

// ── Daemon Finding ──────────────────────────────────────────────────

export type DaemonFinding = {
  kind: "opportunity" | "alert" | "info";
  summary: string;
  /** Evidence identifiers (snapshot evidence IDs, Cortex node labels, etc.). */
  evidenceIds: string[];
  severity: "info" | "warning" | "critical";
}

// ── Daemon Result ───────────────────────────────────────────────────

export type DaemonResult = {
  findings: DaemonFinding[];
  /** Whether at least one CEO proposal was enqueued via the message bus. */
  proposalEnqueued: boolean;
  /** Message IDs of enqueued proposals on the bus. */
  messageIds: string[];
}

// ── Daemon Handler ──────────────────────────────────────────────────

export type CeoHandlerContext = {
  /** Send a proactive Telegram message to a chat, optionally in a forum thread. */
  sendProactiveMessage?: (chatId: number, text: string, threadId?: number) => Promise<void>;
  /** Create a forum topic in a Telegram chat via grammY API. */
  createForumTopic?: (chatId: number, name: string) => Promise<{ message_thread_id: number }>;
  /** Admin chat IDs for Telegram notifications (comma-separated string values). */
  adminChatIds?: string[];
  /** Mapping from sellerId to human-readable seller name. */
  sellerNames?: Record<string, string>;
  /**
   * Prepare a Product Ads action for seller approval.
   * When absent, actionable findings will only send Telegram notifications
   * without creating formal action proposals.
   */
  prepareProductAdsAction?: (input: {
    sellerId: string;
    proposalType: string;
    campaignId: string;
    itemId: string;
    adId?: string;
    currentStatus: string;
    metricsSnapshotSummary: string;
    rationale: string;
    sourceTool: string;
    observedAt: string;
    expiresAt: string;
  }) => Promise<void>;
  /**
   * Optional workforce cost ledger for recording DeepSeek API call costs.
   * When absent, LLM reasoning costs are not recorded but the handler still
   * processes findings via the fallback or LLM path.
   */
  workforceCostCacheLedgerStore?: WorkforceCostCacheLedgerStore;
};

export type DaemonHandler = (input: {
  claim: AgentMessage;
  reader: OperationalReadModelReader;
  cortex: GraphEngine;
  bus: AgentMessageBusStore;
  sellerIds: string[];
  /** Optional SupplierMirrorStore for supplier-manager daemon. When absent
   *  the supplier-manager daemon returns empty findings without error. */
  supplierMirrorStore?: SupplierMirrorStore;
  /** Optional CEO handler context for Telegram notifications and action preparation. */
  ceoContext?: CeoHandlerContext;
  /** Optional SupplierMirrorDeepSeekAdvisor for AI enrichment of stock-gap
   *  signals. When present, the supplier-manager daemon calls advisor.analyze()
   *  for stock-gap detections and appends aiEnrichment to the proposal payload.
   *  When absent, all proposals are rule-only. */
  advisor?: SupplierMirrorDeepSeekAdvisor;
  /** Optional OperationsDeepSeekAdvisor for AI enrichment of claim and reputation
   *  signals. When present, the operations-manager daemon calls operationsAdvisor.analyze()
   *  for claims and reputation detections and appends aiEnrichment to the proposal payload.
   *  When absent, all proposals are rule-only. */
  operationsAdvisor?: OperationsDeepSeekAdvisor;
  /** Optional CatalogDeepSeekAdvisor for AI enrichment of market catalog signals.
   *  When present, the market-catalog daemon calls catalogAdvisor.analyze() for critical
   *  (relist-expiring) and warning (low-visit, above-market) signals and appends
   *  aiEnrichment to the proposal payload. When absent, all proposals are rule-only. */
  catalogAdvisor?: CatalogDeepSeekAdvisor;
}) => Promise<DaemonResult>;
