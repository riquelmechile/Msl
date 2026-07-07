import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";

// ── Thresholds ──────────────────────────────────────────────────────

const MARGIN_WARNING_THRESHOLD = 0.30; // 30% margin
const MARGIN_CRITICAL_THRESHOLD = 0.10; // 10% margin → critical
const RESTOCK_VISIT_RISING_FACTOR = 2; // visits must be at least 2× stock to signal restock

// ── Helpers ─────────────────────────────────────────────────────────

function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

/**
 * Cost-supplier daemon handler.
 *
 * Investigates listing snapshots, pricing data, and Cortex cost/supplier
 * nodes. Detects:
 *   - Margin below warning threshold (severity: warning)
 *   - Margin below critical threshold (severity: critical)
 *   - Listings selling below cost (severity: critical)
 *   - Low-stock items with rising visits — restock signal (severity: info)
 *
 * Uses estimated commissions (~15% default) and estimated shipping (~$5000 CLP)
 * when actual values are not available from Cortex. Cost data is read from
 * Cortex `cost_snapshot` nodes when available.
 */
export const costSupplierDaemon: DaemonHandler = async ({
  reader,
  cortex,
  bus,
  sellerIds,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  const now = new Date();
  const capturedAt = now.toISOString();

  // ── Collect listing snapshots ────────────────────────────────

  type ListingEntry = {
    itemId: string;
    sellerId: string;
    title: string;
    status: string;
    price: number;
    stock: number;
  }
  const allListings: ListingEntry[] = [];

  for (const sellerId of sellerIds) {
    const listingSnaps = await reader.searchSnapshots<{
      status?: string;
      price?: number;
      title?: string;
      stock?: number;
      available_quantity?: number;
      sold_quantity?: number;
    }>({ sellerId, kind: "listing_snapshot", status: "active", limit: 1000 });

    for (const snap of listingSnaps) {
      const d = snap.data;
      allListings.push({
        itemId: snap.itemId,
        sellerId,
        title: String(d.title ?? snap.itemId),
        status: String(d.status ?? "unknown"),
        price: Number(d.price ?? 0),
        stock: Number(d.stock ?? d.available_quantity ?? 0),
      });
    }

    // Also pull from Cortex for listing snapshots not in ORM
    if (listingSnaps.length === 0) {
      const cortexListings = cortex.queryByMetadata({
        type: "listing_snapshot",
        sellerId,
        limit: 2000,
      });
      for (const node of cortexListings) {
        const m = node.metadata;
        const itemId = metadataString(m.itemId);
        if (!itemId) continue;
        allListings.push({
          itemId,
          sellerId: metadataString(m.sellerId, sellerId),
          title: metadataString(m.title, itemId),
          status: metadataString(m.status, "unknown"),
          price: Number(m.price ?? 0),
          stock: Number(m.stock ?? m.available_quantity ?? 0),
        });
      }
    }
  }

  // ── Retrieve cost data from Cortex ───────────────────────────

  const costMap = new Map<string, number>();
  for (const sellerId of sellerIds) {
    const costNodes = cortex.queryByMetadata({
      type: "cost_snapshot",
      sellerId,
      limit: 2000,
    });
    for (const cn of costNodes) {
      const cm = cn.metadata;
      const itemId = metadataString(cm.itemId);
      if (!itemId) continue;
      const cost = Number(cm.cost ?? cm.unit_cost ?? cm.supplier_cost ?? 0);
      if (cost > 0) {
        costMap.set(itemId, cost);
      }
    }
  }

  // ── Retrieve pricing snapshot data from Cortex ───────────────

  const pricingMap = new Map<
    string,
    { commissionRate: number; shippingCost: number }
  >();
  for (const sellerId of sellerIds) {
    const pricingNodes = cortex.queryByMetadata({
      type: "pricing_snapshot",
      sellerId,
      limit: 2000,
    });
    for (const pn of pricingNodes) {
      const pm = pn.metadata;
      const itemId = metadataString(pm.itemId);
      if (!itemId) continue;
      pricingMap.set(itemId, {
        commissionRate: Number(pm.commission_rate ?? pm.commission ?? 0.15),
        shippingCost: Number(pm.shipping_cost ?? pm.shipping ?? 5000),
      });
    }
  }

  // ── Retrieve visit data for restock detection ────────────────

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

  // ── Active listings analysis (pre-filtered by searchSnapshots) ──

  for (const listing of allListings) {
    if (listing.price <= 0) continue;

    // Get pricing defaults + Cortex overrides
    const pricingInfo = pricingMap.get(listing.itemId);
    const commissionRate = pricingInfo?.commissionRate ?? 0.15;
    const shippingCost = pricingInfo?.shippingCost ?? 5000;

    // Calculate margin
    const commission = listing.price * commissionRate;
    const knownCost = costMap.get(listing.itemId) ?? 0;
    const totalCosts = commission + shippingCost + knownCost;
    const margin = (listing.price - totalCosts) / listing.price;

    // Check margin thresholds
    if (margin < MARGIN_CRITICAL_THRESHOLD) {
      findings.push({
        kind: "alert",
        severity: "critical",
        summary: `Critically low margin (${(margin * 100).toFixed(1)}%): ${listing.title} (${listing.itemId}) — price $${listing.price}, costs ~$${totalCosts.toFixed(0)}`,
        evidenceIds: [
          `listing_snapshot:${listing.itemId}`,
          `pricing_snapshot:${listing.itemId}`,
        ],
      });
    } else if (margin < MARGIN_WARNING_THRESHOLD) {
      findings.push({
        kind: "alert",
        severity: "warning",
        summary: `Low margin (${(margin * 100).toFixed(1)}%): ${listing.title} (${listing.itemId}) — price $${listing.price}, costs ~$${totalCosts.toFixed(0)}`,
        evidenceIds: [
          `listing_snapshot:${listing.itemId}`,
          `pricing_snapshot:${listing.itemId}`,
        ],
      });
    }

    // Check: selling below cost (when cost data available)
    if (knownCost > 0 && listing.price < knownCost) {
      findings.push({
        kind: "alert",
        severity: "critical",
        summary: `Selling below cost: ${listing.title} (${listing.itemId}) — price $${listing.price} vs cost $${knownCost}`,
        evidenceIds: [
          `listing_snapshot:${listing.itemId}`,
          `cost_snapshot:${listing.itemId}`,
        ],
      });
    }

    // Restock signal: low stock + rising visits
    if (listing.stock <= 0) {
      const visits = visitsPerItem.get(listing.itemId) ?? 0;
      if (visits > RESTOCK_VISIT_RISING_FACTOR) {
        findings.push({
          kind: "opportunity",
          severity: "info",
          summary: `Restock opportunity: ${listing.title} (${listing.itemId}) — out of stock, ${visits} visits`,
          evidenceIds: [
            `listing_snapshot:${listing.itemId}`,
            `visit_snapshot:${listing.itemId}`,
          ],
        });
      }
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
      const summary = `Cost/Supplier ${kind}s: ${group.length} finding(s)`;
      const recommendedAction =
        kind === "critical"
          ? "Review urgently — margin below critical threshold or selling below cost"
          : kind === "warning"
            ? "Review pricing and costs to improve margin viability"
            : "Review restock opportunities to capture demand";

      const message = bus.enqueue({
        senderAgentId: "cost-supplier",
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
        }),
        dedupeKey: `cost-supplier-${kind}-${capturedAt.slice(0, 10)}`,
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
