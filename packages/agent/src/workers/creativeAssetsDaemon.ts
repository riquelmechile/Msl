import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import type { CreativeSnapshotData } from "../conversation/backgroundIngestion.js";
import type { CreativeDeepSeekAdvisor, CreativeActionableFinding, CreativeEnrichmentFinding } from "../conversation/creativeDeepSeekAdvisor.js";

// ── Helpers ─────────────────────────────────────────────────────────

function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

interface CreativeSnapshotWithSeller extends CreativeSnapshotData {
  sellerId: string;
}

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Creative Assets Monitor daemon handler.
 *
 * Reads creative_snapshot ORM data, Cortex visit_snapshot nodes, and
 * product-ads-insights snapshots. Applies five isolated signal checks
 * and enqueues grouped CEO proposals with hourly dedupe keys.
 * No ML write APIs are called — every payload carries
 * `noMutationExecuted: true`.
 *
 * # Signals
 *
 * | Rule                | Severity  | Condition                                      |
 * |---------------------|-----------|------------------------------------------------|
 * | Low image count     | warning   | pictureCount < 2                               |
 * | Moderation blocked  | warning   | blocked + active listing                       |
 * | Poor PICTURES       | warning   | PICTURES status PENDING                        |
 * | High-traffic poor   | warning   | visits > seller avg AND (PENDING/count<2/blocked) |
 * | Moderated-in-campaign | critical | blocked AND in active Product Ads campaign     |
 */
export const creativeAssetsDaemon: DaemonHandler = async ({
  reader,
  cortex,
  bus,
  sellerIds,
  creativeAdvisor,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];
  const now = new Date();
  const capturedAt = now.toISOString();

  // ── 2.1a – Fetch creative snapshots from ORM ────────────────

  const allSnapshots: CreativeSnapshotWithSeller[] = [];

  for (const sid of sellerIds) {
    const snaps = await reader.searchSnapshots<CreativeSnapshotData>({
      sellerId: sid,
      kind: "creative-snapshot",
      limit: 50,
    });

    for (const snap of snaps) {
      allSnapshots.push({
        ...snap.data,
        sellerId: sid,
      });
    }
  }

  if (allSnapshots.length === 0) {
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 2.1b – Build seller-average visits from Cortex ─────────

  const sellerAvgVisits = new Map<string, number>();

  for (const sid of sellerIds) {
    const visitNodes = cortex.queryByMetadata({
      type: "visit_snapshot",
      sellerId: sid,
      limit: 5000,
    });

    if (visitNodes.length === 0) {
      sellerAvgVisits.set(sid, 0);
      continue;
    }

    const byItem = new Map<string, number[]>();
    for (const node of visitNodes) {
      const m = node.metadata;
      const itemId = metadataString(m.itemId);
      if (!itemId) continue;
      const totalVisits = Number(m.totalVisits ?? 0);
      let acc = byItem.get(itemId);
      if (!acc) {
        acc = [];
        byItem.set(itemId, acc);
      }
      acc.push(totalVisits);
    }

    let totalVisits = 0;
    let count = 0;
    for (const [, values] of byItem) {
      const latest = values.reduce((a, b) => Math.max(a, b), 0);
      totalVisits += latest;
      count++;
    }

    sellerAvgVisits.set(sid, count > 0 ? totalVisits / count : 0);
  }

  // ── 2.1c – Fetch per-item visit snapshots from Cortex ──────

  const itemLatestVisits = new Map<string, number>();

  for (const snap of allSnapshots) {
    const itemNodes = cortex.queryByMetadata({
      type: "visit_snapshot",
      itemId: snap.itemId,
      limit: 1,
    });
    if (itemNodes.length > 0) {
      itemLatestVisits.set(
        snap.itemId,
        Number(itemNodes[0]!.metadata.totalVisits ?? 0),
      );
    }
  }

  // ── 2.1d – Fetch product-ads-insights for active ads ──────

  const activeAdItemIds = new Set<string>();

  for (const sid of sellerIds) {
    try {
      const adSnaps = await reader.searchSnapshots<{
        campaigns?: Array<{ id: string; name?: string; metrics?: Record<string, number> }>;
        ads?: Array<{
          id: string;
          name?: string;
          itemId?: string;
          campaignId?: string;
          status?: string;
          metrics?: Record<string, number>;
        }>;
      }>({
        sellerId: sid,
        kind: "product-ads-insights",
        limit: 10,
      });

      for (const snap of adSnaps) {
        const d = snap.data;
        if (!d.ads) continue;
        for (const ad of d.ads) {
          if (ad.status !== "paused" && ad.itemId) {
            activeAdItemIds.add(ad.itemId);
          }
        }
      }
    } catch {
      /* isolated — missing ads data skips signal 5 */
    }
  }

  // ── 2.2 Signal 1: Low image count ────────────────────────────

  try {
    for (const snap of allSnapshots) {
      if (snap.pictureCount < 2) {
        findings.push({
          kind: "alert",
          severity: "warning",
          summary: `Low image count: ${snap.itemId} has ${snap.pictureCount} picture(s) — minimum 2 recommended`,
          evidenceIds: [`creative-snapshot:${snap.itemId}`],
        });
      }
    }
  } catch {
    /* isolated */
  }

  // ── 2.3 Signal 2: Moderation blocked ─────────────────────────

  try {
    for (const snap of allSnapshots) {
      if (snap.moderationStatus === "blocked") {
        findings.push({
          kind: "alert",
          severity: "warning",
          summary: `Moderation blocked: ${snap.itemId} is blocked by moderation — review wordings`,
          evidenceIds: [`creative-snapshot:${snap.itemId}`],
        });
      }
    }
  } catch {
    /* isolated */
  }

  // ── 2.4 Signal 3: Poor PICTURES score ───────────────────────

  try {
    for (const snap of allSnapshots) {
      if (snap.performancePicturesStatus === "PENDING") {
        findings.push({
          kind: "alert",
          severity: "warning",
          summary: `Poor PICTURES score: ${snap.itemId} has PENDING PICTURES status — improve images`,
          evidenceIds: [`creative-snapshot:${snap.itemId}`],
        });
      }
    }
  } catch {
    /* isolated */
  }

  // ── 2.5 Signal 4: High-traffic + poor creative ──────────────

  try {
    for (const snap of allSnapshots) {
      const avg = sellerAvgVisits.get(snap.sellerId) ?? 0;
      if (avg <= 0) continue; // no baseline → skip

      const itemVisits = itemLatestVisits.get(snap.itemId) ?? 0;
      if (itemVisits <= avg) continue; // not high-traffic

      // Check if POOR creative (any of the three conditions)
      const hasPoorCreative =
        snap.performancePicturesStatus === "PENDING" ||
        snap.pictureCount < 2 ||
        snap.moderationStatus === "blocked";

      if (hasPoorCreative) {
        findings.push({
          kind: "alert",
          severity: "warning",
          summary: `High-traffic poor creative: ${snap.itemId} has ${itemVisits} visits (avg ${Math.round(avg)}) with poor creative quality`,
          evidenceIds: [
            `creative-snapshot:${snap.itemId}`,
            `visit_snapshot:${snap.itemId}`,
          ],
        });
      }
    }
  } catch {
    /* isolated */
  }

  // ── 2.6 Signal 5: Moderated-in-campaign (critical) ──────────

  try {
    for (const snap of allSnapshots) {
      if (snap.moderationStatus !== "blocked") continue;

      if (activeAdItemIds.has(snap.itemId)) {
        findings.push({
          kind: "alert",
          severity: "critical",
          summary: `Moderated-in-campaign: ${snap.itemId} is blocked AND in active Product Ads campaign — immediate review needed`,
          evidenceIds: [
            `creative-snapshot:${snap.itemId}`,
            `product-ads-insights:${snap.itemId}`,
          ],
        });
      }
    }
  } catch {
    /* isolated */
  }

  // ── 2.7 AI Enrichment (critical + warning only) ──────────────

  let aiEnrichment: {
    findings: CreativeEnrichmentFinding[];
    summary: string;
    modelUsed: string;
    enrichedAt: string;
  } | undefined;

  const actionableFindings: CreativeActionableFinding[] = [];
  for (const f of findings) {
    if (f.severity === "info") continue;
    const itemId = f.evidenceIds.find((id) => id.startsWith("creative-snapshot:"))?.replace("creative-snapshot:", "") ?? "";
    actionableFindings.push({
      itemId,
      signalKind: f.summary.includes("Low image count") ? "low-image-count"
        : f.summary.includes("Moderation blocked") ? "moderation-blocked"
        : f.summary.includes("Poor PICTURES") ? "poor-pictures-score"
        : f.summary.includes("High-traffic poor") ? "high-traffic-poor-creative"
        : f.summary.includes("Moderated-in-campaign") ? "moderated-in-campaign"
        : "low-image-count",
      severity: f.severity === "critical" ? "critical" : "warning",
    });
  }

  if (creativeAdvisor && actionableFindings.length > 0) {
    try {
      const analysis = await creativeAdvisor.analyze({
        daemonKind: "creative-assets",
        actionableFindings,
      });

      aiEnrichment = {
        findings: analysis.findings,
        summary: analysis.summary,
        modelUsed: analysis.modelUsed,
        enrichedAt: capturedAt,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[creative-assets] Advisor enrichment failed, using rule-only: ${errorMessage}`,
      );
    }
  }

  // ── 2.8 CEO proposal enqueue (per severity tier) ────────────

  let proposalEnqueued = false;

  if (findings.length > 0) {
    const criticals = findings.filter((f) => f.severity === "critical");
    const warnings = findings.filter((f) => f.severity === "warning");

    const enqueueGroup = (group: DaemonFinding[], kind: string) => {
      if (group.length === 0) return;

      const summary = `Creative Assets ${kind}s: ${group.length} finding(s)`;
      const recommendedAction =
        kind === "critical"
          ? "Review moderated-in-campaign listings immediately — pause or delist"
          : "Review creative quality issues — add images, fix moderation, improve PICTURES score";

      const payload: Record<string, unknown> = {
        type: "proposal",
        summary,
        findings: group.map((f) => ({
          kind: f.kind,
          severity: f.severity,
          summary: f.summary,
          evidenceIds: f.evidenceIds,
        })),
        recommendedAction,
        capturedAt,
        noMutationExecuted: true,
      };

      if (aiEnrichment) {
        payload.aiEnrichment = aiEnrichment;
      }

      const msg = bus.enqueue({
        senderAgentId: "creative-assets",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: JSON.stringify(payload),
        dedupeKey: `creative-assets-${kind}-${capturedAt.slice(0, 13)}`,
      });
      messageIds.push(msg.messageId);
    };

    enqueueGroup(criticals, "critical");
    enqueueGroup(warnings, "warning");
    proposalEnqueued = true;
  }

  return {
    findings,
    proposalEnqueued,
    messageIds,
  };
};
