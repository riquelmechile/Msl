import type { MlcProductAdsInsights } from "@msl/mercadolibre";
import type { GraphEngine, OperationalReadModelReader } from "@msl/memory";

// ── Product Ad Economics ────────────────────────────────────────────

export type ProductAdEconomics = {
  sellerId: string;
  campaignId: string;
  adId: string;
  itemId: string;
  price?: number;
  costPerUnit?: number;
  unitsFromAds?: number;
  adSpend: number;
  revenue: number;
  clicks?: number;
  cpc?: number;
  cvr?: number;
  roas?: number;
  acos?: number;
  sov?: number;
  grossContribution?: number;
  netContribution?: number;
  contributionMarginPct?: number;
  breakEvenCpc?: number;
  breakEvenCpa?: number;
  dataCompleteness: "full" | "partial" | "insufficient";
};

// ── Flat ad type ────────────────────────────────────────────────────

export type AdFlat = {
  id: string;
  name: string;
  itemId: string;
  campaignId: string;
  status: string;
  sellerId: string;
  metrics: Record<string, number>;
};

export type CampaignFlat = {
  id: string;
  name: string;
  metrics: Record<string, number>;
  advertisedItemIds: Set<string>;
  sellerId: string;
};

// ── Context result ──────────────────────────────────────────────────

export type ProductAdsContext = {
  ads: AdFlat[];
  campaigns: Map<string, CampaignFlat>;
  listingPrice: Map<string, number>;
  costMap: Map<string, number>;
};

// ── Shared helpers ──────────────────────────────────────────────────

function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

/**
 * Load Product Ads context from ORM and Cortex for the given seller IDs.
 * Reads product-ads-insights, listing snapshots, and cost snapshots.
 */
export async function loadProductAdsContext(
  reader: OperationalReadModelReader,
  cortex: GraphEngine,
  sellerIds: string[],
): Promise<ProductAdsContext> {
  const allAds: AdFlat[] = [];
  const campaignsMap = new Map<string, CampaignFlat>();

  // ── Fetch product-ads-insights from ORM ──
  for (const sid of sellerIds) {
    const snaps = await reader.searchSnapshots<MlcProductAdsInsights>({
      sellerId: sid,
      kind: "product-ads-insights",
      limit: 10,
    });

    for (const snap of snaps) {
      const d = snap.data;

      if (d.campaigns) {
        for (const c of d.campaigns) {
          if (!c.id) continue;
          if (!campaignsMap.has(c.id)) {
            campaignsMap.set(c.id, {
              id: c.id,
              name: c.name ?? c.id,
              metrics: { ...(c.metrics ?? {}) },
              advertisedItemIds: new Set(),
              sellerId: sid,
            });
          }
        }
      }

      if (d.ads) {
        for (const a of d.ads) {
          allAds.push({
            id: a.id,
            name: a.name ?? a.id,
            itemId: a.itemId ?? "",
            campaignId: a.campaignId ?? "",
            status: a.status ?? "",
            sellerId: sid,
            metrics: { ...(a.metrics ?? {}) },
          });
          if (a.campaignId && a.itemId) {
            const camp = campaignsMap.get(a.campaignId);
            if (camp) camp.advertisedItemIds.add(a.itemId);
          }
        }
      }
    }
  }

  // ── Fetch listing snapshots (prices) from ORM ──
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

  // ── Fetch cost snapshots from Cortex ──
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

  return { ads: allAds, campaigns: campaignsMap, listingPrice, costMap };
}

/**
 * Flatten product-ads-insights into AdFlat array (for direct snapshot use).
 */
export function flattenProductAds(snapshots: MlcProductAdsInsights[], sellerId: string): AdFlat[] {
  const ads: AdFlat[] = [];
  for (const snap of snapshots) {
    if (snap.ads) {
      for (const a of snap.ads) {
        ads.push({
          id: a.id,
          name: a.name ?? a.id,
          itemId: a.itemId ?? "",
          campaignId: a.campaignId ?? "",
          status: a.status ?? "",
          sellerId,
          metrics: { ...(a.metrics ?? {}) },
        });
      }
    }
  }
  return ads;
}

/**
 * Enrich ad records with economics from listing prices and costs.
 * Returns an array of ProductAdEconomics, one per ad that has an itemId.
 */
export function enrichWithEconomics(
  ads: AdFlat[],
  listingPrice: Map<string, number>,
  costMap: Map<string, number>,
): ProductAdEconomics[] {
  const enriched: ProductAdEconomics[] = [];

  for (const ad of ads) {
    if (!ad.itemId) continue;

    const price = listingPrice.get(ad.itemId);
    const costPerUnit = costMap.get(ad.itemId);
    const m = ad.metrics;

    const adSpend = m["investment"] ?? m["cost"] ?? 0;
    const revenue = m["revenue"] ?? m["total_amount"] ?? 0;
    const clicks = m["clicks"];
    const cvr = m["cvr"];
    const roas = m["roas"] ?? (adSpend > 0 ? revenue / adSpend : undefined);
    const acos = m["acos"] ?? (revenue > 0 ? adSpend / revenue : undefined);
    const sov = m["sov"];

    const directUnits = m["direct_units"] ?? 0;
    const indirectUnits = m["indirect_units"] ?? 0;
    const totalUnits = m["total_units"];
    const unitsFromAds = totalUnits ?? directUnits + indirectUnits;

    const cpc = m["cpc"] ?? (clicks && clicks > 0 ? adSpend / clicks : undefined);

    // Compute contribution metrics when cost data is available
    let grossContribution: number | undefined;
    let netContribution: number | undefined;
    let contributionMarginPct: number | undefined;
    let breakEvenCpa: number | undefined;
    let breakEvenCpc: number | undefined;

    if (price !== undefined && costPerUnit !== undefined) {
      grossContribution = (price - costPerUnit) * (unitsFromAds ?? 0);
      netContribution = grossContribution - adSpend;
      contributionMarginPct = revenue > 0 ? netContribution / revenue : undefined;
      breakEvenCpa = price - costPerUnit;
      if (cvr != null && cvr > 0) {
        breakEvenCpc = breakEvenCpa * cvr;
      }
    }

    // Compute data completeness
    const hasCost = costPerUnit !== undefined;
    const hasPrice = price !== undefined;
    const hasRevenue = revenue > 0 || adSpend > 0;
    const hasUnits = unitsFromAds !== undefined;
    const hasCvr = cvr != null;

    let dataCompleteness: "full" | "partial" | "insufficient";
    if (!hasCost) {
      dataCompleteness = "insufficient";
    } else if (hasPrice && hasRevenue && hasUnits && hasCvr) {
      dataCompleteness = "full";
    } else {
      dataCompleteness = "partial";
    }

    enriched.push({
      sellerId: ad.sellerId,
      campaignId: ad.campaignId,
      adId: ad.id,
      itemId: ad.itemId,
      ...(price !== undefined ? { price } : {}),
      ...(costPerUnit !== undefined ? { costPerUnit } : {}),
      ...(unitsFromAds !== undefined ? { unitsFromAds } : {}),
      adSpend,
      revenue,
      ...(clicks !== undefined ? { clicks } : {}),
      ...(cpc !== undefined ? { cpc } : {}),
      ...(cvr !== undefined ? { cvr } : {}),
      ...(roas !== undefined ? { roas } : {}),
      ...(acos !== undefined ? { acos } : {}),
      ...(sov !== undefined ? { sov } : {}),
      ...(grossContribution !== undefined ? { grossContribution } : {}),
      ...(netContribution !== undefined ? { netContribution } : {}),
      ...(contributionMarginPct !== undefined ? { contributionMarginPct } : {}),
      ...(breakEvenCpc !== undefined ? { breakEvenCpc } : {}),
      ...(breakEvenCpa !== undefined ? { breakEvenCpa } : {}),
      dataCompleteness,
    });
  }

  return enriched;
}
