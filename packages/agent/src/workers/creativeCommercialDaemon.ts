import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import type { CreativeDeepSeekAdvisor, CreativeActionableFinding, CreativeEnrichmentFinding } from "../conversation/creativeDeepSeekAdvisor.js";

// ── Thresholds ──────────────────────────────────────────────────────

const HIGH_VISIT_THRESHOLD = 50; // visits above this count as "high"
const LOW_CONVERSION_RATE = 0.02; // orders/visits < 2%
const STAGNANT_DAYS = 30; // active > 30 days, no orders → stagnant

// ── Helpers ─────────────────────────────────────────────────────────

function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

/**
 * Creative-commercial daemon handler.
 *
 * Investigates visit snapshots, order data, and listing snapshots to
 * detect commercial opportunities and conversion problems. Detects:
 *   - High-visit, low-conversion listings (severity: warning)
 *   - Stagnant stock — active > 30 days with no orders (severity: info)
 *   - Creative candidates — high-visit listings (good for social content)
 *
 * All findings are enqueued as CEO proposals with `noMutationExecuted: true`.
 */
export const creativeCommercialDaemon: DaemonHandler = async ({
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

  // ── Collect listing snapshots for active listings ────────────

  type ListingEntry = {
    itemId: string;
    sellerId: string;
    title: string;
    status: string;
    price: number;
    capturedAt: string;
    listingCreatedAt: string;
  }
  const activeListings: ListingEntry[] = [];

  for (const sellerId of sellerIds) {
    // Try ORM first
    const listingSnaps = await reader.searchSnapshots<{
      status?: string;
      price?: number;
      title?: string;
      created_at?: string;
      start_time?: string;
      date_created?: string;
    }>({ sellerId, kind: "listing_snapshot", status: "active", limit: 1000 });

    for (const snap of listingSnaps) {
      const d = snap.data;
      activeListings.push({
        itemId: snap.itemId,
        sellerId,
        title: String(d.title ?? snap.itemId),
        status: String(d.status ?? "unknown"),
        price: Number(d.price ?? 0),
        capturedAt: snap.capturedAt,
        listingCreatedAt: String(d.created_at ?? d.start_time ?? d.date_created ?? snap.capturedAt),
      });
    }

    // Also pull from Cortex when ORM has no active listings
    if (listingSnaps.length === 0) {
      const cortexListings = cortex.queryByMetadata({
        type: "listing_snapshot",
        status: "active",
        sellerId,
        limit: 2000,
      });
      for (const node of cortexListings) {
        const m = node.metadata;
        const itemId = metadataString(m.itemId);
        if (!itemId) continue;
        activeListings.push({
          itemId,
          sellerId: metadataString(m.sellerId, sellerId),
          title: metadataString(m.title, itemId),
          status: "active",
          price: Number(m.price ?? 0),
          capturedAt: metadataString(m.capturedAt, capturedAt),
          listingCreatedAt: metadataString(m.created_at ?? m.start_time ?? m.date_created ?? m.capturedAt, capturedAt),
        });
      }
    }
  }

  // ── Retrieve visit data ──────────────────────────────────────

  const visitsPerItem = new Map<string, number>();
  for (const sellerId of sellerIds) {
    const visitNodes = cortex.queryByMetadata({
      type: "visit_snapshot",
      sellerId,
      limit: 5000,
    });
    for (const vn of visitNodes) {
      const vm = vn.metadata;
      const itemId = metadataString(vm.itemId);
      if (!itemId) continue;
      const totalVisits = Number(vm.totalVisits ?? vm.total_visits ?? 0);
      visitsPerItem.set(itemId, (visitsPerItem.get(itemId) ?? 0) + totalVisits);
    }
  }

  // ── Retrieve order data from Cortex ──────────────────────────

  const ordersPerItem = new Map<string, number>();
  for (const sellerId of sellerIds) {
    const orderNodes = cortex.queryByMetadata({
      type: "order_snapshot",
      sellerId,
      limit: 5000,
    });
    for (const on_ of orderNodes) {
      const om = on_.metadata;
      const itemId = metadataString(om.itemId);
      if (!itemId) continue;
      ordersPerItem.set(itemId, (ordersPerItem.get(itemId) ?? 0) + 1);
    }
  }

  // ── Detection ────────────────────────────────────────────────

  const staleThreshold = new Date(now);
  staleThreshold.setDate(staleThreshold.getDate() - STAGNANT_DAYS);

  for (const listing of activeListings) {
    const visits = visitsPerItem.get(listing.itemId) ?? 0;
    const orders = ordersPerItem.get(listing.itemId) ?? 0;

    // A. High-visit, low-conversion → warning
    if (visits >= HIGH_VISIT_THRESHOLD) {
      const conversionRate = visits > 0 ? orders / visits : 0;
      if (conversionRate < LOW_CONVERSION_RATE) {
        findings.push({
          kind: "alert",
          severity: "warning",
          summary: `High-traffic, low-conversion: ${listing.title} (${listing.itemId}) — ${visits} visits, ${orders} orders (${(conversionRate * 100).toFixed(1)}% conversion)`,
          evidenceIds: [
            `listing_snapshot:${listing.itemId}`,
            `visit_snapshot:${listing.itemId}`,
            `order_snapshot:${listing.itemId}`,
          ],
        });
      } else {
        // High-visit, good conversion → creative candidate for social content
        findings.push({
          kind: "opportunity",
          severity: "info",
          summary: `Creative candidate: ${listing.title} (${listing.itemId}) — ${visits} visits, ${orders} orders (${(conversionRate * 100).toFixed(1)}% conversion)`,
          evidenceIds: [
            `listing_snapshot:${listing.itemId}`,
            `visit_snapshot:${listing.itemId}`,
          ],
        });
      }
    }

    // B. Stagnant stock — active > 30 days, zero orders
    const listingDate = new Date(listing.listingCreatedAt);
    if (!isNaN(listingDate.getTime()) && listingDate < staleThreshold) {
      if (orders === 0) {
        const daysActive = Math.round(
          (now.getTime() - listingDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        findings.push({
          kind: "opportunity",
          severity: "info",
          summary: `Stagnant stock: ${listing.title} (${listing.itemId}) — active ${daysActive} days, ${visits} visits, zero orders`,
          evidenceIds: [
            `listing_snapshot:${listing.itemId}`,
            `visit_snapshot:${listing.itemId}`,
          ],
        });
      }
    }
  }

  // ── AI Enrichment (warning only — info stays rule-based) ──

  let aiEnrichment: {
    findings: CreativeEnrichmentFinding[];
    summary: string;
    modelUsed: string;
    enrichedAt: string;
  } | undefined;

  const warningFindings = findings.filter((f) => f.severity === "warning");
  const actionableFindings: CreativeActionableFinding[] = [];

  for (const f of warningFindings) {
    const itemId = f.evidenceIds.find((id) => id.startsWith("listing_snapshot:"))?.replace("listing_snapshot:", "") ?? "";
    actionableFindings.push({
      itemId,
      title: f.summary,
      signalKind: "high-visit-low-conversion",
      severity: "warning",
    });
  }

  if (creativeAdvisor && actionableFindings.length > 0) {
    try {
      const analysis = await creativeAdvisor.analyze({
        daemonKind: "creative-commercial",
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
        `[creative-commercial] Advisor enrichment failed, using rule-only: ${errorMessage}`,
      );
    }
  }

  // ── Enqueue CEO proposals ──────────────────────────────────
  let proposalEnqueued = false;

  if (findings.length > 0) {
    const criticals = findings.filter((f) => f.severity === "critical");
    const warnings = findings.filter((f) => f.severity === "warning");
    const infos = findings.filter((f) => f.severity === "info");

    const enqueueGroup = (
      group: DaemonFinding[],
      kind: string,
    ) => {
      if (group.length === 0) return;
      const summary = `Creative/Commercial ${kind}s: ${group.length} finding(s)`;
      const recommendedAction =
        kind === "critical"
          ? "Review urgently — urgent commercial issues detected"
          : kind === "warning"
            ? "Review title, images, or price to improve conversion"
            : "Review candidates for social content, ads, or refresh";

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

      // Only attach enrichment to warning proposals (info stays rule-based)
      if (kind === "warning" && aiEnrichment) {
        payload.aiEnrichment = aiEnrichment;
      }

      const message = bus.enqueue({
        senderAgentId: "creative-commercial",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: JSON.stringify(payload),
        dedupeKey: `creative-commercial-${kind}-${capturedAt.slice(0, 13)}`,
      });
      messageIds.push(message.messageId);
    };

    enqueueGroup(criticals, "critical");
    enqueueGroup(warnings, "warning");
    enqueueGroup(infos, "opportunity");
    proposalEnqueued = true;
  }

  return {
    findings,
    proposalEnqueued,
    messageIds,
  };
};
