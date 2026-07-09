import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";

// ── Thresholds ──────────────────────────────────────────────────────

const LOW_STOCK_THRESHOLD = 5;
const PRICE_DEVIATION_THRESHOLD = 0.2; // 20% above/below average

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract optional env config with fallback.
 */
function envVal(key: string, fallback: number): number {
  const raw = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Owned Ecommerce daemon handler.
 *
 * Investigates owned-ecommerce candidate listings via `OperationalReadModelReader`.
 * Detects:
 *   - Items with missing or insufficient images (severity: warning)
 *   - Items with very low stock (severity: warning)
 *   - Items with price deviations relative to catalog average (severity: info)
 *
 * All findings are enqueued as CEO proposals with `noMutationExecuted: true`.
 * This daemon is proposal-only and never executes mutations directly.
 */
export const ownedEcommerceDaemon: DaemonHandler = async ({ reader, bus, sellerIds }) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  const capturedAt = new Date().toISOString();
  const lowStockThreshold = envVal("MSL_OWNED_ECOMMERCE_LOW_STOCK_THRESHOLD", LOW_STOCK_THRESHOLD);
  const priceDevThreshold = envVal(
    "MSL_OWNED_ECOMMERCE_PRICE_DEVIATION_THRESHOLD",
    PRICE_DEVIATION_THRESHOLD,
  );

  // ── Collect listing data across all sellers ───────────────────

  type ListingEntry = {
    itemId: string;
    sellerId: string;
    title: string;
    price: number;
    availableQuantity: number;
    thumbnail: string;
    categoryId: string;
  };

  const allListings: ListingEntry[] = [];

  for (const sellerId of sellerIds) {
    try {
      const listingSnaps = await reader.searchSnapshots<{
        title?: string;
        price?: number;
        available_quantity?: number;
        availableQuantity?: number;
        thumbnail?: string;
        category_id?: string;
        categoryId?: string;
        status?: string;
      }>({ sellerId, kind: "listing_snapshot", status: "active", limit: 1000 });

      for (const snap of listingSnaps) {
        const d = snap.data;
        allListings.push({
          itemId: snap.itemId,
          sellerId,
          title: String(d.title ?? snap.itemId),
          price: Number(d.price ?? 0),
          availableQuantity: Number(d.available_quantity ?? d.availableQuantity ?? 0),
          thumbnail: String(d.thumbnail ?? ""),
          categoryId: String(d.category_id ?? d.categoryId ?? "unknown"),
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[owned-ecommerce] Failed to read listings for seller ${sellerId}: ${errorMessage}`,
      );
    }
  }

  // ── Detection ─────────────────────────────────────────────────

  // A. Missing / insufficient images → warning
  for (const listing of allListings) {
    if (!listing.thumbnail || listing.thumbnail === "") {
      findings.push({
        kind: "alert",
        severity: "warning",
        summary: `Listing "${listing.title}" (${listing.itemId}) has no thumbnail image — storefront readiness issue`,
        evidenceIds: [`listing_snapshot:${listing.itemId}`, `seller:${listing.sellerId}`],
      });
    }
  }

  // B. Low stock → warning
  for (const listing of allListings) {
    if (listing.availableQuantity > 0 && listing.availableQuantity < lowStockThreshold) {
      findings.push({
        kind: "alert",
        severity: "warning",
        summary: `Listing "${listing.title}" (${listing.itemId}) has low stock: ${listing.availableQuantity} units (threshold: ${lowStockThreshold})`,
        evidenceIds: [`listing_snapshot:${listing.itemId}`, `seller:${listing.sellerId}`],
      });
    }
  }

  // C. Price deviation relative to category average → info
  const categoryPrices = new Map<string, number[]>();
  for (const listing of allListings) {
    const prices = categoryPrices.get(listing.categoryId) ?? [];
    prices.push(listing.price);
    categoryPrices.set(listing.categoryId, prices);
  }
  const categoryAvg = new Map<string, number>();
  for (const [cat, prices] of categoryPrices) {
    const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    categoryAvg.set(cat, avg);
  }

  for (const listing of allListings) {
    const avg = categoryAvg.get(listing.categoryId);
    if (avg && avg > 0 && listing.price > 0) {
      const deviation = Math.abs(listing.price - avg) / avg;
      if (deviation > priceDevThreshold) {
        const direction = listing.price > avg ? "above" : "below";
        findings.push({
          kind: "opportunity",
          severity: "info",
          summary: `Listing "${listing.title}" (${listing.itemId}) priced ${direction} category average by ${(deviation * 100).toFixed(0)}% — review for storefront readiness`,
          evidenceIds: [`listing_snapshot:${listing.itemId}`, `seller:${listing.sellerId}`],
        });
      }
    }
  }

  // ── Enqueue CEO proposals ─────────────────────────────────────
  let proposalEnqueued = false;

  if (findings.length > 0) {
    const warnings = findings.filter((f) => f.severity === "warning");
    const infos = findings.filter((f) => f.severity === "info");

    const enqueueGroup = (group: DaemonFinding[], kind: string) => {
      if (group.length === 0) return;

      const summary = `Owned Ecommerce ${kind}s: ${group.length} finding(s)`;
      const recommendedAction =
        kind === "warning"
          ? "Review and address listing issues — missing images and low stock affect storefront readiness"
          : "Review pricing deviations for storefront pricing strategy";

      const payloadJson: Record<string, unknown> = {
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

      const message = bus.enqueue({
        senderAgentId: "owned-ecommerce",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: JSON.stringify(payloadJson),
        dedupeKey: `owned-ecommerce-${kind}-${capturedAt.slice(0, 13)}`,
      });
      messageIds.push(message.messageId);
    };

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
