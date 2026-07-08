import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import type { MlcProductAdsInsights } from "@msl/mercadolibre";

// ── Helpers ─────────────────────────────────────────────────────────

function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

/**
 * Compute an ISO-8601 week key (e.g. "2026-W27") from an ISO date string.
 */
function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  // Thursday-aligned ISO week
  const dayNum = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - dayNum);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// ── Flattened ad / campaign helpers ────────────────────────────────

type AdFlat = {
  id: string;
  name: string;
  itemId: string;
  campaignId: string;
  status: string;
  metrics: Record<string, number>;
};

type CampaignFlat = {
  id: string;
  name: string;
  metrics: Record<string, number>;
  advertisedItemIds: Set<string>;
};

// ── Signal check thresholds ────────────────────────────────────────

const VISIT_DECLINE_WOW_THRESHOLD = -0.3; // 30%+ decline
const CAMPAIGN_ROAS_OPPORTUNITY_THRESHOLD = 3.0;
const PER_PRODUCT_ROAS_WARNING_THRESHOLD = 1.0;

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Product Ads Monitor daemon handler.
 *
 * Reads product-ads-insights snapshots via the operational read model,
 * cross-references Cortex data (cost, visit, listing snapshots), applies
 * five signal-detection rules, and enqueues grouped CEO proposals with
 * hourly dedupe keys. No ML write APIs are called — every payload carries
 * `noMutationExecuted: true`.
 *
 * # Signals
 *
 * | Rule                | Severity  | Condition                                      |
 * |---------------------|-----------|------------------------------------------------|
 * | Profitability       | critical  | price – cost < 0 (cost known)                  |
 * | Visit decline       | warning   | WoW ↓ ≥30 % for 2+ consecutive weeks           |
 * | Monopoly            | info      | itemId listed only on owned sellerIds           |
 * | Per-product ROAS    | warning   | revenue / investment < 1.0 (investment > 0)    |
 * | Opportunity gap     | info      | campaign ROAS > 3.0 + profitable item not in ad |
 */
export const productAdsMonitorDaemon: DaemonHandler = async ({
  reader,
  cortex,
  bus,
  sellerIds,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];
  const now = new Date();
  const capturedAt = now.toISOString();

  // ── 2.1a – Fetch product-ads-insights from ORM ──────────────

  const allAds: AdFlat[] = [];
  const campaignsMap = new Map<string, CampaignFlat>();

  for (const sid of sellerIds) {
    const snaps = await reader.searchSnapshots<MlcProductAdsInsights>({
      sellerId: sid,
      kind: "product-ads-insights",
      limit: 10,
    });

    for (const snap of snaps) {
      const d = snap.data;

      for (const c of d.campaigns) {
        if (!c.id) continue;
        if (!campaignsMap.has(c.id)) {
          campaignsMap.set(c.id, {
            id: c.id,
            name: c.name ?? c.id,
            metrics: { ...(c.metrics ?? {}) },
            advertisedItemIds: new Set(),
          });
        }
      }

      for (const a of d.ads) {
        allAds.push({
          id: a.id,
          name: a.name ?? a.id,
          itemId: a.itemId ?? "",
          campaignId: a.campaignId ?? "",
          status: a.status ?? "",
          metrics: { ...(a.metrics ?? {}) },
        });
        if (a.campaignId && a.itemId) {
          const camp = campaignsMap.get(a.campaignId);
          if (camp) camp.advertisedItemIds.add(a.itemId);
        }
      }
    }
  }

  if (allAds.length === 0) {
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 2.1b – Fetch listing snapshots (prices) ────────────────

  const listingPrice = new Map<string, number>();
  for (const sid of sellerIds) {
    const lst = await reader.searchSnapshots<{ price?: number }>({
      sellerId: sid,
      kind: "listing_snapshot",
      limit: 1000,
    });
    for (const s of lst) {
      const p = Number(s.data.price ?? 0);
      if (p > 0) listingPrice.set(s.itemId, p);
    }
  }

  // ── 2.1c – Fetch cost snapshots from Cortex ────────────────

  const costMap = new Map<string, number>();
  for (const sid of sellerIds) {
    const nodes = cortex.queryByMetadata({
      type: "cost_snapshot",
      sellerId: sid,
      limit: 2000,
    });
    for (const n of nodes) {
      const m = n.metadata;
      const itemId = metadataString(m.itemId);
      if (!itemId) continue;
      const c = Number(m.cost ?? m.unit_cost ?? m.supplier_cost ?? 0);
      if (c > 0) costMap.set(itemId, c);
    }
  }

  // ── 2.1d – Fetch visit snapshots from Cortex (last 3 wk) ───

  const threeWeeksAgo = new Date(now);
  threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
  const visits: { itemId: string; visits: number; capturedAt: string }[] =
    [];

  for (const sid of sellerIds) {
    const nodes = cortex.queryByMetadata({
      type: "visit_snapshot",
      sellerId: sid,
      after: threeWeeksAgo.toISOString(),
      limit: 5000,
    });
    for (const n of nodes) {
      const m = n.metadata;
      const itemId = metadataString(m.itemId);
      if (!itemId) continue;
      visits.push({
        itemId,
        visits: Number(m.totalVisits ?? m.total_visits ?? 0),
        capturedAt: metadataString(m.capturedAt, capturedAt),
      });
    }
  }

  // Group by itemId + ISO week
  const visitWeekMap = new Map<string, Map<string, number>>();
  for (const v of visits) {
    const wk = isoWeekKey(v.capturedAt);
    if (!wk) continue;
    let wm = visitWeekMap.get(v.itemId);
    if (!wm) {
      wm = new Map();
      visitWeekMap.set(v.itemId, wm);
    }
    wm.set(wk, (wm.get(wk) ?? 0) + v.visits);
  }

  // ── 2.1e – Fetch listing data from Cortex (cross-seller) ────

  const listingSellers = new Map<string, Set<string>>();
  {
    const nodes = cortex.queryByMetadata({
      type: "listing_snapshot",
      limit: 5000,
    });
    for (const n of nodes) {
      const m = n.metadata;
      const itemId = metadataString(m.itemId);
      const sid = metadataString(m.sellerId);
      if (!itemId || !sid) continue;
      let s = listingSellers.get(itemId);
      if (!s) {
        s = new Set();
        listingSellers.set(itemId, s);
      }
      s.add(sid);
    }
  }

  // ── 2.2 Profitability check (critical) ──────────────────────

  try {
    for (const ad of allAds) {
      if (!ad.itemId) continue;
      const price = listingPrice.get(ad.itemId) ?? 0;
      const cost = costMap.get(ad.itemId);
      if (cost === undefined) continue; // cost unknown → skip
      if (price > 0 && price - cost < 0) {
        findings.push({
          kind: "alert",
          severity: "critical",
          summary: `Unprofitable ad: ${ad.name} (${ad.itemId}) — price $${price} vs cost $${cost}`,
          evidenceIds: [
            `cost_snapshot:${ad.itemId}`,
            `listing_snapshot:${ad.itemId}`,
          ],
        });
      }
    }
  } catch {
    /* isolated — single signal failure never blocks others */
  }

  // ── 2.3 Visit decline check (warning) ───────────────────────

  try {
    for (const ad of allAds) {
      if (!ad.itemId) continue;
      const wm = visitWeekMap.get(ad.itemId);
      if (!wm || wm.size < 3) continue; // need 3+ weeks

      const sorted = [...wm.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => v);
      const w1 = sorted.at(-3)!;
      const w2 = sorted.at(-2)!;
      const w3 = sorted.at(-1)!;

      const d1 = (w2 - w1) / w1; // WoW (oldest → middle)
      const d2 = (w3 - w2) / w2; // WoW (middle → newest)

      if (d1 <= VISIT_DECLINE_WOW_THRESHOLD && d2 <= VISIT_DECLINE_WOW_THRESHOLD) {
        findings.push({
          kind: "alert",
          severity: "warning",
          summary: `Declining visits: ${ad.name} (${ad.itemId}) — WoW ${(d1 * 100).toFixed(0)}%, ${(d2 * 100).toFixed(0)}% for 2 consecutive weeks`,
          evidenceIds: [`visit_snapshot:${ad.itemId}`],
        });
      }
    }
  } catch {
    /* isolated */
  }

  // ── 2.4 Monopoly check (info) ───────────────────────────────

  try {
    for (const ad of allAds) {
      if (!ad.itemId) continue;
      const sellers = listingSellers.get(ad.itemId);
      if (!sellers || sellers.size === 0) continue;

      const hasExternal = [...sellers].some((s) => !sellerIds.includes(s));
      if (!hasExternal) {
        findings.push({
          kind: "info",
          severity: "info",
          summary: `Cross-account monopoly: ${ad.name} (${ad.itemId}) listed only on owned accounts`,
          evidenceIds: [`listing_snapshot:${ad.itemId}`],
        });
      }
    }
  } catch {
    /* isolated */
  }

  // ── 2.5 Per-product ROAS check (warning) ────────────────────

  try {
    for (const ad of allAds) {
      const m = ad.metrics;
      if (!m || Object.keys(m).length === 0) continue;
      const investment = m["investment"] ?? 0;
      if (investment === 0) continue; // zero inv → skip ROAS
      const revenue = m["revenue"] ?? 0;
      const roas = revenue / investment;
      if (roas < PER_PRODUCT_ROAS_WARNING_THRESHOLD) {
        findings.push({
          kind: "alert",
          severity: "warning",
          summary: `Low ROAS: ${ad.name} (${ad.id}) — ROAS ${roas.toFixed(2)} (revenue $${revenue}, investment $${investment})`,
          evidenceIds: [`product-ads-insights:ad:${ad.id}`],
        });
      }
    }
  } catch {
    /* isolated */
  }

  // ── 2.6 Opportunity gap check (info) ─────────────────────────

  try {
    // Build set of profitable items (price > cost)
    const profitableItems = new Set<string>();
    for (const [itemId, price] of listingPrice) {
      const cost = costMap.get(itemId);
      if (cost !== undefined && price > cost) {
        profitableItems.add(itemId);
      }
    }

    for (const [, camp] of campaignsMap) {
      const cm = camp.metrics;
      if (!cm || Object.keys(cm).length === 0) continue;
      const campInv = cm["investment"] ?? 0;
      if (campInv === 0) continue;
      const campRev = cm["revenue"] ?? 0;
      const campRoas = campRev / campInv;
      if (campRoas <= CAMPAIGN_ROAS_OPPORTUNITY_THRESHOLD) continue;

      for (const itemId of profitableItems) {
        if (!camp.advertisedItemIds.has(itemId)) {
          // Find the ad name for this item (if any ad references it)
          const adName =
            allAds.find((a) => a.itemId === itemId)?.name ?? itemId;
          findings.push({
            kind: "opportunity",
            severity: "info",
            summary: `Opportunity: ${adName} (${itemId}) — profitable, not advertised in campaign ${camp.name}`,
            evidenceIds: [
              `listing_snapshot:${itemId}`,
              `cost_snapshot:${itemId}`,
            ],
          });
        }
      }
    }
  } catch {
    /* isolated */
  }

  // ── 2.7 CEO proposal enqueue (per severity tier) ────────────

  let proposalEnqueued = false;

  if (findings.length > 0) {
    const criticals = findings.filter((f) => f.severity === "critical");
    const warnings = findings.filter((f) => f.severity === "warning");
    const opportunities = findings.filter(
      (f) => f.kind === "opportunity",
    );
    const infos = findings.filter(
      (f) => f.kind === "info" && f.severity === "info",
    );

    const enqueueGroup = (group: DaemonFinding[], kind: string) => {
      if (group.length === 0) return;

      const summary = `Product Ads ${kind}s: ${group.length} finding(s)`;
      const recommendedAction =
        kind === "critical"
          ? "Review unprofitable ads immediately — adjust bids or pause campaigns"
          : kind === "warning"
            ? "Review ads with declining visits or low ROAS — optimize campaigns"
            : kind === "opportunity"
              ? "Review profitable products not yet advertised — expand campaign coverage"
              : "Review cross-account monopoly risks";

      const msg = bus.enqueue({
        senderAgentId: "product-ads-monitor",
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
        dedupeKey: `product-ads-${kind}-${capturedAt.slice(0, 13)}`,
      });
      messageIds.push(msg.messageId);
    };

    enqueueGroup(criticals, "critical");
    enqueueGroup(warnings, "warning");
    enqueueGroup(opportunities, "opportunity");
    enqueueGroup(infos, "info");
    proposalEnqueued = true;
  }

  return {
    findings,
    proposalEnqueued,
    messageIds,
  };
};
