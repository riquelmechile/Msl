import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DaemonHandler, DaemonFinding, CeoHandlerContext } from "./daemonTypes.js";

// ── Constants ────────────────────────────────────────────────────────

const FORUM_TOPICS_FILE = resolve(process.cwd(), "msl-forum-topics.json");
const STALE_WINDOW_HOURS = 24;
const DEDUPE_WINDOW_DAYS = 7;
const SIGNAL_TO_ACTION: Record<string, { proposalType: string; severity: string; requiresApproval: boolean }> = {
  "margin-consuming": { proposalType: "pause-campaign", severity: "critical", requiresApproval: true },
  "scale-candidate": { proposalType: "adjust-campaign-budget", severity: "opportunity", requiresApproval: true },
  "budget-waste": { proposalType: "review-campaign-structure", severity: "warning", requiresApproval: true },
  "underinvested": { proposalType: "adjust-campaign-budget", severity: "info", requiresApproval: true },
  "unit-economics": { proposalType: "review-campaign-structure", severity: "info", requiresApproval: false },
};

// ── Forum topic persistence ──────────────────────────────────────────

type ForumTopicsStore = Record<string, number>; // sellerId → message_thread_id

function loadForumTopics(): ForumTopicsStore {
  try {
    if (existsSync(FORUM_TOPICS_FILE)) {
      return JSON.parse(readFileSync(FORUM_TOPICS_FILE, "utf-8")) as ForumTopicsStore;
    }
  } catch {
    // Corrupted file — start fresh
  }
  return {};
}

function saveForumTopics(store: ForumTopicsStore): void {
  writeFileSync(FORUM_TOPICS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

async function ensureTopic(
  sellerId: string,
  sellerName: string,
  adminChatId: number,
  ceoCtx: CeoHandlerContext,
): Promise<number | undefined> {
  if (!ceoCtx.createForumTopic) return undefined;

  const store = loadForumTopics();
  const existingId = store[sellerId];
  if (existingId) return existingId;

  try {
    const result = await ceoCtx.createForumTopic(adminChatId, sellerName);
    store[sellerId] = result.message_thread_id;
    saveForumTopics(store);
    return result.message_thread_id;
  } catch {
    // Topic might already exist — try to recover by returning undefined
    // (notification will be sent without thread ID)
    return undefined;
  }
}

// ── Signal mapping ────────────────────────────────────────────────────

type CeoFinding = {
  sellerId: string;
  campaignId: string;
  itemId: string;
  adId?: string;
  signal: string;
  severity: string;
  summary: string;
  evidenceIds: string[];
  capturedAt: string;
  recommendationIdentity: string;
};

function parseFindings(payloadJson: string): {
  findings: CeoFinding[];
  capturedAt: string;
} | null {
  try {
    const payload = JSON.parse(payloadJson);
    if (payload.type !== "proposal") return null;

    const reportedFindings = payload.findings ?? [];
    if (reportedFindings.length === 0) return null;

    const capturedAt: string = payload.capturedAt ?? new Date().toISOString();

    // Parse recommendation identity to extract sellerId, campaignId, itemId, signal
    const findings: CeoFinding[] = reportedFindings.map((f: Record<string, unknown>) => {
      const identity: string = (f.recommendationIdentity as string) ?? "";
      const parts = identity.split(":");
      // prefix:sellerId:campaignId:itemId:signal
      const sellerId = parts[1] ?? "";
      const campaignId = parts[2] ?? "";
      const itemId = parts[3] ?? "";
      const signal = parts[4] ?? "unit-economics";

      return {
        sellerId,
        campaignId,
        itemId,
        adId: (f.adId as string) ?? undefined,
        signal,
        severity: (f.severity as string) ?? "info",
        summary: (f.summary as string) ?? "(no summary)",
        evidenceIds: (f.evidenceIds as string[]) ?? [],
        capturedAt,
        recommendationIdentity: identity,
      };
    });

    return { findings, capturedAt };
  } catch {
    return null;
  }
}

function isStale(capturedAt: string): boolean {
  const captured = new Date(capturedAt).getTime();
  if (isNaN(captured)) return false;
  const ageHours = (Date.now() - captured) / (1000 * 60 * 60);
  return ageHours > STALE_WINDOW_HOURS;
}

function getSellerName(sellerId: string, sellerNames?: Record<string, string>): string {
  return sellerNames?.[sellerId] ?? sellerId;
}

// ── Action message construction ──────────────────────────────────────

function buildActionPayload(
  finding: CeoFinding,
  action: { proposalType: string },
): {
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
} {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 2); // 48h expiry

  return {
    sellerId: finding.sellerId,
    proposalType: action.proposalType,
    campaignId: finding.campaignId,
    itemId: finding.itemId,
    adId: finding.adId,
    currentStatus: "active",
    metricsSnapshotSummary: finding.summary,
    rationale: `CFO signal: ${finding.signal} — ${finding.summary}`,
    sourceTool: "product-ads-profitability-daemon",
    observedAt: finding.capturedAt,
    expiresAt: expiresAt.toISOString(),
  };
}

// ── Daemon handler ───────────────────────────────────────────────────

/**
 * CEO Profitability Handler.
 *
 * Claims profitability proposals from the agent message bus, maps
 * CFO-grade signals to Product Ads actions, manages per-seller Telegram
 * forum topics, and sends proactive deduplicated notifications.
 *
 * On errors, the handler fails safely by returning an empty result so the
 * scheduler can fail the message on the bus (error isolation per daemon spec).
 */
export const ceoProfitabilityHandler: DaemonHandler = async ({
  claim,
  bus,
  sellerIds,
  ceoContext,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  // ── Unpack payload ──────────────────────────────────────────────
  const parsed = parseFindings(claim.payloadJson);
  if (!parsed) {
    // Invalid payload — return empty so scheduler fails the message
    return { findings, proposalEnqueued: false, messageIds };
  }

  const { findings: parsedFindings, capturedAt } = parsed;

  // ── Skip stale findings (>24h) ──────────────────────────────────
  if (isStale(capturedAt)) {
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── Resolve admin chat ──────────────────────────────────────────
  const ceoCtx = ceoContext ?? {};
  const adminChatIds = ceoCtx.adminChatIds ?? [];
  const sellerNames = ceoCtx.sellerNames ?? {};
  const primaryAdminChatId = adminChatIds.length > 0 ? Number(adminChatIds[0]) : undefined;

  // ── Resolve seller name mapping ─────────────────────────────────
  const sellerNameMap: Record<string, string> = {};
  for (const sid of sellerIds) {
    sellerNameMap[sid] = getSellerName(sid, sellerNames);
  }

  // ── Process each finding ────────────────────────────────────────
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - DEDUPE_WINDOW_DAYS);
  const windowStart = sevenDaysAgo.toISOString();

  for (const finding of parsedFindings) {
    try {
      // ── Dedupe check ──────────────────────────────────────────────
      const dedupeIdentity = `product-ads-cfo:${finding.sellerId}:${finding.campaignId}:${finding.itemId}:${finding.signal}`;
      const recent = bus.lookupRecentByDedupePrefix(dedupeIdentity, windowStart);
      if (recent.length > 0) continue; // Suppress within 7-day window

      // ── Map signal to action ─────────────────────────────────────
      const action = SIGNAL_TO_ACTION[finding.signal] ?? SIGNAL_TO_ACTION["unit-economics"];

      // ── Add finding to results ────────────────────────────────────
      findings.push({
        kind: action.severity === "critical" ? "alert" : action.severity === "warning" ? "alert" : "info",
        severity: action.severity as "info" | "warning" | "critical",
        summary: `[${finding.signal}] ${finding.summary}`,
        evidenceIds: finding.evidenceIds,
      });

      // ── Prepare action for actionable signals ─────────────────────
      if (action.requiresApproval && ceoCtx.prepareProductAdsAction) {
        const actionPayload = buildActionPayload(finding, action);
        await ceoCtx.prepareProductAdsAction(actionPayload);
      }

      // ── Send Telegram notification ────────────────────────────────
      if (ceoCtx.sendProactiveMessage && primaryAdminChatId) {
        const sellerName = sellerNameMap[finding.sellerId] ?? finding.sellerId;

        // Ensure forum topic exists
        const threadId = await ensureTopic(finding.sellerId, sellerName, primaryAdminChatId, ceoCtx);

        // Build notification text
        const actionLabel = action.requiresApproval
          ? `🔧 Action: ${action.proposalType} (requires approval)`
          : `ℹ️ Info: ${action.proposalType}`;
        const notificationText = [
          `<b>📊 Profitability Report — ${sellerName}</b>`,
          ``,
          `<b>Signal:</b> ${finding.signal}`,
          `<b>Severity:</b> ${action.severity}`,
          ``,
          finding.summary,
          ``,
          actionLabel,
        ].join("\n");

        await ceoCtx.sendProactiveMessage(primaryAdminChatId, notificationText, threadId);
      }
    } catch (err) {
      // Isolated error handling per finding — log and continue
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[ceo-profitability-handler] Error processing finding for ${finding.sellerId}:${finding.campaignId}:${finding.itemId}: ${errorMessage}`,
      );
      // Continue to next finding — error isolation per daemon spec
    }
  }

  let proposalEnqueued = findings.length > 0;

  return {
    findings,
    proposalEnqueued,
    messageIds,
  };
};
