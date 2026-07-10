import type { AgentMessage, AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";
import type { GraphEngine, SupplierMirrorStore } from "@msl/memory";
import type { OperationalReadModelReader, OwnedEcommerceStore } from "@msl/memory";
import type { WorkforceCostCacheLedgerStore } from "../conversation/workforceCostCacheLedgerStore.js";
import type { SupplierMirrorDeepSeekAdvisor } from "../conversation/supplierMirrorDeepSeekAdvisor.js";
import type { OperationsDeepSeekAdvisor } from "../conversation/operationsDeepSeekAdvisor.js";
import type { CatalogDeepSeekAdvisor } from "../conversation/catalogDeepSeekAdvisor.js";
import type { CostSupplierDeepSeekAdvisor } from "../conversation/costSupplierDeepSeekAdvisor.js";
import type { CreativeDeepSeekAdvisor } from "../conversation/creativeDeepSeekAdvisor.js";
import type { AgentAccountContext } from "../conversation/types.js";
import type { AgentWorkSessionStore } from "../sessions/AgentWorkSessionStore.js";
import type { AgentWorkSessionRunner } from "../sessions/AgentWorkSessionRunner.js";
import type { AccountBrainService } from "../conversation/accountBrainService.js";
import type { CreativeJobQueueStore } from "../conversation/creativeJobQueueStore.js";
import type { OwnedEcommerceIntelligenceService } from "../ecommerce/ownedEcommerceIntelligenceService.js";

// ── Daemon Finding ──────────────────────────────────────────────────

export type DaemonFinding = {
  kind: "opportunity" | "alert" | "info";
  summary: string;
  /** Evidence identifiers (snapshot evidence IDs, Cortex node labels, etc.). */
  evidenceIds: string[];
  severity: "info" | "warning" | "critical";
};

// ── Daemon Result ───────────────────────────────────────────────────

export type DaemonResult = {
  findings: DaemonFinding[];
  /** Whether at least one CEO proposal was enqueued via the message bus. */
  proposalEnqueued: boolean;
  /** Message IDs of enqueued proposals on the bus. */
  messageIds: string[];
};

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
  /** Optional per-account context map keyed by sellerId. When provided, handlers
   *  can use it to scope proposals and evidence per seller. When absent, handlers
   *  fall back to sellerId-only scoping. */
  accountContexts?: Map<string, AgentAccountContext>;
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
  /** Optional CostSupplierDeepSeekAdvisor for AI enrichment of cost, margin, and
   *  restock signals. When present, the cost-supplier daemon calls costSupplierAdvisor.analyze()
   *  for critical (critical-margin, below-cost) and warning (low-margin) signals and
   *  appends aiEnrichment to the proposal payload. When absent, all proposals are rule-only. */
  costSupplierAdvisor?: CostSupplierDeepSeekAdvisor;
  /** Optional CreativeDeepSeekAdvisor for AI enrichment of creative asset and commercial
   *  signals. When present, the creative-assets daemon calls creativeAdvisor.analyze()
   *  for critical (moderated-in-campaign) and warning signals, and the creative-commercial
   *  daemon calls it for warning (high-visit-low-conversion) signals. Enrichment is
   *  appended as aiEnrichment to the proposal payload. When absent, all proposals are
   *  rule-only. */
  creativeAdvisor?: CreativeDeepSeekAdvisor;
  /** Optional AgentWorkSessionStore for session persistence. When provided,
   *  session-aware lanes may query session state before dispatch. */
  sessionStore?: AgentWorkSessionStore;
  /** Optional session runner for work-session lifecycle. When provided alongside
   *  enableWorkSessions in the scheduler, daemon ticks route through the
   *  session runner instead of direct handler invocation. */
  sessionRunner?: AgentWorkSessionRunner;
  /** Optional OwnedEcommerceIntelligenceService for supplier-web-signal
   *  processing in the owned-ecommerce daemon. When absent, the daemon
   *  runs monitor-only mode (tick-based listing checks). */
  intelligenceService?: OwnedEcommerceIntelligenceService;
  /** Optional AccountBrainService for channel-recommendation scoring.
   *  When absent, scored candidates skip channel fit analysis. */
  accountBrainService?: AccountBrainService;
  /** Optional CreativeJobQueueStore for creative-asset delegation.
   *  When absent and images are missing, missingMedia is recorded
   *  without a creative request. */
  creativeJobQueueStore?: CreativeJobQueueStore;
  /** Optional OwnedEcommerceStore for persisting projection snapshots
   *  and candidate state. When absent, persistence is skipped. */
  ownedEcommerceStore?: OwnedEcommerceStore;
}) => Promise<DaemonResult>;
