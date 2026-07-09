import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import type {
  CatalogActionableFinding,
  CatalogDeepSeekAdvisor, // eslint-disable-line @typescript-eslint/no-unused-vars
} from "../conversation/catalogDeepSeekAdvisor.js";

// ── Thresholds ──────────────────────────────────────────────────────

const LOW_VISIT_THRESHOLD = 10; // active listings with fewer visits trigger a warning
const PRICE_ABOVE_MEDIAN_BUFFER = 0.2; // +20% above median
const RELIST_WINDOW_DAYS = 55; // 60-day limit minus 5-day buffer
const RELIST_EXPIRING_DAYS = 7; // warn when relist window closes within 7 days

// ── Helpers ─────────────────────────────────────────────────────────

function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

/**
 * Market-catalog daemon handler.
 *
 * Investigates listing snapshots, pricing data, and visit history from
 * Cortex + OperationalReadModel. Detects:
 *   - Low-visit active listings
 *   - Above-market pricing (price > median + buffer)
 *   - Paused listings with sales history (relist candidates)
 *   - Closed listings within the 60-day relist window (relist candidates)
 *
 * Absorbs the detection logic from `runQualityChecks()` and
 * `runRelistChecks()` in background ingestion.
 */
export const marketCatalogDaemon: DaemonHandler = async ({
  reader,
  cortex,
  bus,
  sellerIds,
  catalogAdvisor,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  const now = new Date();
  const capturedAt = now.toISOString();
  const hardDeadline = new Date(now);
  hardDeadline.setDate(hardDeadline.getDate() - 60);

  // ── Collect listing snapshots across all sellers ────────────
  type ListingEntry = {
    itemId: string;
    sellerId: string;
    title: string;
    status: string;
    price: number;
    categoryId: string;
    capturedAt: string;
  };
  const allListings: ListingEntry[] = [];

  for (const sellerId of sellerIds) {
    // Read from operational read model when available, fallback to Cortex
    const ormSnapshots = await reader.searchSnapshots<{
      status?: string;
      price?: number;
      title?: string;
      category_id?: string;
    }>({ sellerId, kind: "listing_snapshot", limit: 1000 });

    if (ormSnapshots.length > 0) {
      for (const snap of ormSnapshots) {
        allListings.push({
          itemId: snap.itemId,
          sellerId,
          title: String(snap.data?.title ?? snap.itemId),
          status: String(snap.data?.status ?? "unknown"),
          price: Number(snap.data?.price ?? 0),
          categoryId: String(snap.data?.category_id ?? ""),
          capturedAt: snap.capturedAt,
        });
      }
    } else {
      // Fallback: query Cortex nodes directly
      const cortexNodes = cortex.queryByMetadata({
        type: "listing_snapshot",
        sellerId,
        limit: 2000,
      });

      for (const node of cortexNodes) {
        const m = node.metadata;
        const itemId = metadataString(m.itemId);
        if (!itemId) continue;

        allListings.push({
          itemId,
          sellerId: metadataString(m.sellerId, sellerId),
          title: metadataString(m.title, itemId),
          status: metadataString(m.status, "unknown"),
          price: Number(m.price ?? 0),
          categoryId: metadataString(m.categoryId),
          capturedAt: metadataString(m.capturedAt, capturedAt),
        });
      }
    }
  }

  // Group newest snapshot per itemId
  const newestPerItem = new Map<
    string,
    {
      itemId: string;
      sellerId: string;
      title: string;
      status: string;
      price: number;
      categoryId: string;
      capturedAt: string;
    }
  >();
  for (const listing of allListings) {
    const existing = newestPerItem.get(listing.itemId);
    if (!existing || listing.capturedAt > existing.capturedAt) {
      newestPerItem.set(listing.itemId, listing);
    }
  }

  // ── 1. Low-visit active listings ────────────────────────────
  const activeListings = [...newestPerItem.values()].filter((l) => l.status === "active");

  // Get visit data from Cortex
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

  for (const listing of activeListings) {
    const visits = visitsPerItem.get(listing.itemId) ?? 0;
    if (visits < LOW_VISIT_THRESHOLD) {
      findings.push({
        kind: "alert",
        severity: "warning",
        summary: `Low-visit listing: ${listing.title} (${listing.itemId}) has only ${visits} visits`,
        evidenceIds: [`listing_snapshot:${listing.itemId}`, `visit_snapshot:${listing.itemId}`],
      });
    }
  }

  // ── 2. Above-market pricing ─────────────────────────────────
  // Group active listings by category, compute median, flag outliers
  const categoryPrices = new Map<string, number[]>();
  for (const listing of activeListings) {
    if (listing.price <= 0) continue;
    const cat = listing.categoryId || "__unknown__";
    let prices = categoryPrices.get(cat);
    if (!prices) {
      prices = [];
      categoryPrices.set(cat, prices);
    }
    prices.push(listing.price);
  }

  const categoryMedians = new Map<string, number>();
  for (const [cat, prices] of categoryPrices) {
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
    categoryMedians.set(cat, median);
  }

  for (const listing of activeListings) {
    if (listing.price <= 0) continue;
    const cat = listing.categoryId || "__unknown__";
    const median = categoryMedians.get(cat);
    if (median && median > 0 && listing.price > median * (1 + PRICE_ABOVE_MEDIAN_BUFFER)) {
      findings.push({
        kind: "opportunity",
        severity: "warning",
        summary: `Above-market price: ${listing.title} (${listing.itemId}) at $${listing.price} vs median $${median.toFixed(0)}`,
        evidenceIds: [`listing_snapshot:${listing.itemId}`, `category:${cat}`],
      });
    }
  }

  // ── 3. Relist candidates (paused with sales history) ────────
  const pausedListings = [...newestPerItem.values()].filter((l) => l.status === "paused");

  for (const listing of pausedListings) {
    const visits = visitsPerItem.get(listing.itemId) ?? 0;
    if (visits > 0) {
      findings.push({
        kind: "opportunity",
        severity: "info",
        summary: `Paused listing with sales history: ${listing.title} (${listing.itemId}), ${visits} visits — relist candidate`,
        evidenceIds: [`listing_snapshot:${listing.itemId}`, `visit_snapshot:${listing.itemId}`],
      });
    }
  }

  // ── 4. Relist candidates (closed within window) ─────────────
  // Group all listing snapshots by itemId to detect status transitions
  const byItem = new Map<string, ListingEntry[]>();
  for (const listing of allListings) {
    let entries = byItem.get(listing.itemId);
    if (!entries) {
      entries = [];
      byItem.set(listing.itemId, entries);
    }
    entries.push(listing);
  }

  const relistDeadline = new Date(now);
  relistDeadline.setDate(relistDeadline.getDate() - RELIST_WINDOW_DAYS);

  const expiringAfter = new Date(now);
  expiringAfter.setDate(expiringAfter.getDate() + RELIST_EXPIRING_DAYS);

  for (const [itemId, entries] of byItem) {
    // Sort newest first
    entries.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const latest = entries[0]!;
    if (latest.status !== "closed") continue;

    // Find the first snapshot where status became "closed"
    let closeDateStr = latest.capturedAt;
    for (let i = entries.length - 1; i >= 0; i--) {
      let allClosedSince = true;
      for (let j = i; j < entries.length; j++) {
        if (entries[j]!.status !== "closed") {
          allClosedSince = false;
          break;
        }
      }
      if (allClosedSince && i > 0 && entries[i - 1]!.status !== "closed") {
        closeDateStr = entries[i]!.capturedAt;
        break;
      }
    }

    const closeDate = new Date(closeDateStr);
    if (isNaN(closeDate.getTime())) continue;

    // Check if within the 60-day window
    if (closeDate < hardDeadline) continue;

    const daysSinceClose = Math.round(
      (now.getTime() - closeDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    // If closed within the 55-day window
    const isWithinWindow = closeDate >= relistDeadline;
    if (!isWithinWindow) continue;

    // Check sales history via visits
    const visits = visitsPerItem.get(itemId) ?? 0;
    const hadSalesHistory = visits > 0;

    if (hadSalesHistory) {
      const expiryDate = new Date(closeDate);
      expiryDate.setDate(expiryDate.getDate() + 60);
      const daysUntilExpiry = Math.round(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysUntilExpiry <= RELIST_EXPIRING_DAYS) {
        findings.push({
          kind: "alert",
          severity: "critical",
          summary: `Relist expiring: ${itemId} closes for relist in ${daysUntilExpiry} days — loses history after expiry`,
          evidenceIds: [`listing_snapshot:${itemId}`],
        });
      } else {
        findings.push({
          kind: "opportunity",
          severity: "info",
          summary: `Relist candidate: ${itemId} closed ${daysSinceClose} days ago, ${visits} visits — eligible for relist`,
          evidenceIds: [`listing_snapshot:${itemId}`],
        });
      }
    }
  }

  // ── Enqueue CEO proposals ────────────────────────────────────
  let proposalEnqueued = false;

  if (findings.length > 0) {
    // Group findings for a single CEO proposal per severity tier
    const criticals = findings.filter((f) => f.severity === "critical");
    const warnings = findings.filter((f) => f.severity === "warning");
    const infos = findings.filter((f) => f.severity === "info");

    // ── Helper: extract itemId from evidenceIds ─────────────────
    function extractItemId(evidenceIds: string[]): string | undefined {
      for (const eid of evidenceIds) {
        const parts = eid.split(":");
        if (parts.length >= 2 && parts[0] === "listing_snapshot") {
          return parts[1];
        }
      }
      return undefined;
    }

    // ── Helper: build CatalogActionableFinding from DaemonFinding ──
    function buildActionableFinding(
      f: DaemonFinding,
      signalKind: "low-visit" | "above-market" | "relist-expiring",
      severity: "warning" | "critical",
    ): CatalogActionableFinding {
      const itemId = extractItemId(f.evidenceIds) ?? "";
      const listing = newestPerItem.get(itemId);
      const visits = visitsPerItem.get(itemId) ?? 0;
      const median = listing ? categoryMedians.get(listing.categoryId) : undefined;
      return {
        itemId,
        sellerId: listing?.sellerId ?? "",
        title: listing?.title ?? itemId,
        price: listing?.price ?? 0,
        status: listing?.status ?? "",
        visits,
        categoryId: listing?.categoryId ?? "",
        ...(median !== undefined ? { categoryMedian: median } : {}),
        signalKind,
        severity,
      };
    }

    // ── AI enrichment: critical signals (relist-expiring) ──────
    type AiEnrichmentPayload = {
      findings: Array<{
        kind: string;
        severity: string;
        summary: string;
        detail: string;
        evidenceIds: string[];
      }>;
      summary: string;
      modelUsed: string;
      enrichedAt: string;
    };

    let criticalEnrichment: AiEnrichmentPayload | undefined;
    if (catalogAdvisor && criticals.length > 0) {
      const actionableFindings: CatalogActionableFinding[] = criticals.map((f) =>
        buildActionableFinding(f, "relist-expiring", "critical"),
      );
      try {
        const analysis = await catalogAdvisor.analyze({ actionableFindings });
        criticalEnrichment = {
          findings: analysis.findings,
          summary: analysis.summary,
          modelUsed: analysis.modelUsed,
          enrichedAt: capturedAt,
        };
      } catch (err) {
        console.error(
          "[market-catalog-daemon] Advisor enrichment failed for critical signals:",
          err,
        );
      }
    }

    // ── AI enrichment: warning signals (low-visit, above-market) ──
    let warningEnrichment: AiEnrichmentPayload | undefined;
    if (catalogAdvisor && warnings.length > 0) {
      const actionableFindings: CatalogActionableFinding[] = warnings.map((f) => {
        const isLowVisit = f.summary.startsWith("Low-visit");
        return buildActionableFinding(f, isLowVisit ? "low-visit" : "above-market", "warning");
      });
      try {
        const analysis = await catalogAdvisor.analyze({ actionableFindings });
        warningEnrichment = {
          findings: analysis.findings,
          summary: analysis.summary,
          modelUsed: analysis.modelUsed,
          enrichedAt: capturedAt,
        };
      } catch (err) {
        console.error(
          "[market-catalog-daemon] Advisor enrichment failed for warning signals:",
          err,
        );
      }
    }

    const enqueueGroup = (
      group: DaemonFinding[],
      kind: string,
      enrichment?: AiEnrichmentPayload,
    ) => {
      if (group.length === 0) return;
      const summary = `Market catalog ${kind}s: ${group.length} finding(s)`;
      const recommendedAction =
        kind === "critical"
          ? "Review and act immediately — relist window closing or score critical"
          : kind === "warning"
            ? "Review pricing and visibility — adjust to improve catalog health"
            : "Review opportunities — relist candidates and catalog improvements available";

      const message = bus.enqueue({
        senderAgentId: "market-catalog",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: JSON.stringify({
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
          ...(enrichment ? { aiEnrichment: enrichment } : {}),
        }),
        dedupeKey: `market-catalog-${kind}-${capturedAt.slice(0, 13)}`,
      });
      messageIds.push(message.messageId);
    };

    enqueueGroup(criticals, "critical", criticalEnrichment);
    enqueueGroup(warnings, "warning", warningEnrichment);
    enqueueGroup(infos, "opportunity"); // No AI enrichment for info-only proposals
    proposalEnqueued = true;
  }

  return {
    findings,
    proposalEnqueued,
    messageIds,
  };
};
