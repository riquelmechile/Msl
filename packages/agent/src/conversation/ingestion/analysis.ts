import type { GraphEngine } from "@msl/memory";
import type { MlcListingSummary } from "@msl/mercadolibre";

import { isRecord, metadataString, todayLabel, categoryBreakdownFromMetadata } from "./utils.js";
import type { BackgroundIngestionConfig } from "./processors.js";

// ── Constants ──────────────────────────────────────────────────────────

const SEASONAL_RUN_EVERY_DAYS = 7;
const SEASONAL_ADVANCE_DAYS = 30;
const SEASONAL_PEAK_MULTIPLIER = 1.5;
const SIMILAR_PRICE_RANGE = 0.2;
const RELIST_WINDOW_DAYS = 55;
const RELIST_EXPIRING_DAYS = 7;
const LISTING_SNAPSHOT_KEEP = 30;
const VISIT_SNAPSHOT_KEEP = 30;
const ORDER_SNAPSHOT_KEEP_TOTAL = 90;

// ── Internal helpers ───────────────────────────────────────────────────

function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(
    a
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
  const tokensB = new Set(
    b
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

type CrossAccountMatch = {
  plasticovItem: MlcListingSummary;
  maustianItem: MlcListingSummary;
  similarity: number;
};

function matchCrossAccountListings(
  plasticovListings: ReadonlyArray<MlcListingSummary>,
  maustianListings: ReadonlyArray<MlcListingSummary>,
): CrossAccountMatch[] {
  const matches: CrossAccountMatch[] = [];
  const usedMaustianIds = new Set<string>();

  for (const pItem of plasticovListings) {
    if (!pItem.id) continue;
    const pTitle = (pItem.title ?? "").toLowerCase();
    const pCategory = pItem.categoryId ?? "";
    const pPrice = pItem.price ?? 0;

    let bestMatch: CrossAccountMatch | null = null;
    let bestScore = 0;

    for (const mItem of maustianListings) {
      if (!mItem.id || usedMaustianIds.has(mItem.id)) continue;
      const mTitle = (mItem.title ?? "").toLowerCase();
      const mCategory = mItem.categoryId ?? "";
      const mPrice = mItem.price ?? 0;

      const titleSim = titleSimilarity(pTitle, mTitle);
      const catMatch = pCategory && mCategory && pCategory === mCategory ? 0.3 : 0;

      let priceSim = 0;
      if (pPrice > 0 && mPrice > 0) {
        const diff = Math.abs(pPrice - mPrice) / pPrice;
        if (diff <= SIMILAR_PRICE_RANGE) {
          priceSim = 0.2;
        }
      }

      const score = titleSim * 0.5 + catMatch + priceSim;

      if (score > 0.3 && score > bestScore) {
        bestScore = score;
        bestMatch = {
          plasticovItem: pItem,
          maustianItem: mItem,
          similarity: score,
        };
      }
    }

    if (bestMatch) {
      matches.push(bestMatch);
      usedMaustianIds.add(bestMatch.maustianItem.id);
    }
  }

  return matches;
}

// ── Cross-account comparison ───────────────────────────────────────────

export function runCrossAccountComparison(
  config: BackgroundIngestionConfig,
  plasticovId: string,
  plasticovName: string,
  plasticovListings: ReadonlyArray<MlcListingSummary>,
  maustianId: string,
  maustianName: string,
  maustianListings: ReadonlyArray<MlcListingSummary>,
): string[] {
  const alerts: string[] = [];
  const matches = matchCrossAccountListings(plasticovListings, maustianListings);

  const matchedMaustianIds = new Set(matches.map((m) => m.maustianItem.id).filter(Boolean));
  const unmatchedPlasticov = plasticovListings.filter(
    (l) => l.id && !matches.some((m) => m.plasticovItem.id === l.id),
  );
  const unmatchedMaustian = maustianListings.filter((l) => l.id && !matchedMaustianIds.has(l.id));

  for (const match of matches) {
    const pId = match.plasticovItem.id;
    const mId = match.maustianItem.id;
    const pLabel = `listing_snapshot_${pId}_${todayLabel()}`;
    const mLabel = `listing_snapshot_${mId}_${todayLabel()}`;

    try {
      const pNode = config.engine.getOrCreateNode(pLabel, {});
      const mNode = config.engine.getOrCreateNode(mLabel, {});
      if (pNode.id && mNode.id) {
        try {
          config.engine.createEdge(pNode.id, mNode.id);
        } catch {
          // Edge already exists — ignore
        }
      }
    } catch {
      // Node or edge creation failed — skip
    }

    const pVisits = config.engine.queryByMetadata({
      type: "visit_snapshot",
      itemId: pId,
      limit: 1,
    });
    const mVisits = config.engine.queryByMetadata({
      type: "visit_snapshot",
      itemId: mId,
      limit: 1,
    });

    const pVisitsNode = pVisits[0];
    const mVisitsNode = mVisits[0];

    const pTotal = pVisitsNode ? Number(pVisitsNode.metadata.totalVisits ?? 0) : 0;
    const mTotal = mVisitsNode ? Number(mVisitsNode.metadata.totalVisits ?? 0) : 0;

    if (pTotal > 0 || mTotal > 0) {
      alerts.push(
        `🔍 ${pId} (${plasticovName}): ${pTotal} visitas vs ${mId} (${maustianName}): ${mTotal} visitas`,
      );
    }

    const pPrice = match.plasticovItem.price ?? 0;
    const mPrice = match.maustianItem.price ?? 0;
    if (pPrice > 0 && mPrice > 0 && pPrice !== mPrice) {
      const diff = Math.abs(pPrice - mPrice) / pPrice;
      if (diff > 0.01) {
        alerts.push(
          `⚠️ ${mId} (${maustianName}) tiene precio distinto: $${mPrice} vs $${pPrice} en ${plasticovName}`,
        );
      }
    }

    const pStatus = match.plasticovItem.status ?? "unknown";
    const mStatus = match.maustianItem.status ?? "unknown";
    if (pStatus !== mStatus) {
      alerts.push(
        `⚠️ ${mId} (${maustianName}) está ${mStatus} pero ${pId} (${plasticovName}) está ${pStatus}`,
      );
    }
  }

  for (const listing of unmatchedPlasticov) {
    if (!listing.id) continue;
    const visits = config.engine.queryByMetadata({
      type: "visit_snapshot",
      itemId: listing.id,
      limit: 1,
    });
    const visitsNode = visits[0];
    const totalVisits = visitsNode ? Number(visitsNode.metadata.totalVisits ?? 0) : 0;
    if (totalVisits > 0) {
      alerts.push(
        `🔄 ${listing.id} (${plasticovName}, ${totalVisits} visitas) no tiene equivalente en ${maustianName} — ¿sincronizar?`,
      );
    }
  }

  for (const listing of unmatchedMaustian) {
    if (!listing.id) continue;
    alerts.push(
      `🔄 ${listing.id} (${maustianName}) no tiene equivalente en ${plasticovName} — ¿está solo en esta cuenta?`,
    );
  }

  return alerts;
}

// ── Seasonal pattern detection ─────────────────────────────────────────

export function runSeasonalAnalysis(config: BackgroundIngestionConfig): string[] {
  const alerts: string[] = [];
  const now = new Date();

  const markerNodes = config.engine.queryByMetadata({
    type: "seasonal_marker",
    limit: 1,
  });

  const firstMarker = markerNodes[0];
  if (firstMarker) {
    const markerMeta = firstMarker.metadata;
    const lastRun = metadataString(markerMeta.lastRun);
    if (lastRun) {
      const lastRunDate = new Date(lastRun);
      const daysSince = (now.getTime() - lastRunDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < SEASONAL_RUN_EVERY_DAYS) {
        return alerts;
      }
    }
  }

  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const after = twoYearsAgo.toISOString().slice(0, 10);

  const orderSnaps = config.engine.queryByMetadata({
    type: "order_snapshot",
    after,
    limit: 1000,
  });

  if (orderSnaps.length < 12) {
    config.engine.getOrCreateNode("seasonal_marker", {
      type: "seasonal_marker",
      lastRun: now.toISOString(),
    });
    return alerts;
  }

  type MonthlyData = {
    month: number;
    year: number;
    orderCount: number;
    totalAmount: number;
  };

  const byCategoryMonth = new Map<string, MonthlyData[]>();

  for (const snap of orderSnaps) {
    const meta = snap.metadata;
    const capturedAt = metadataString(meta.capturedAt);
    const breakdown = categoryBreakdownFromMetadata(meta.categoryBreakdown);

    const date = new Date(capturedAt);
    if (isNaN(date.getTime())) continue;

    const month = date.getMonth();
    const year = date.getFullYear();

    for (const cat of breakdown) {
      const key = cat.categoryId;
      let monthly = byCategoryMonth.get(key);
      if (!monthly) {
        monthly = [];
        byCategoryMonth.set(key, monthly);
      }
      monthly.push({
        month,
        year,
        orderCount: cat.orderCount,
        totalAmount: cat.totalAmount,
      });
    }
  }

  for (const [categoryId, monthlyData] of byCategoryMonth) {
    const monthlyAvg = new Map<number, { total: number; years: number[] }>();
    for (const d of monthlyData) {
      const existing = monthlyAvg.get(d.month);
      if (existing) {
        existing.total += d.orderCount;
        existing.years.push(d.year);
      } else {
        monthlyAvg.set(d.month, { total: d.orderCount, years: [d.year] });
      }
    }

    let globalTotal = 0;
    let globalCount = 0;
    for (const [, data] of monthlyAvg) {
      globalTotal += data.total;
      globalCount += data.years.length;
    }
    const globalAvg = globalCount > 0 ? globalTotal / globalCount : 0;

    for (const [month, data] of monthlyAvg) {
      const monthlyAvgValue = data.total / data.years.length;
      if (
        globalAvg > 0 &&
        monthlyAvgValue > globalAvg * SEASONAL_PEAK_MULTIPLIER &&
        data.years.length >= 2
      ) {
        const confidence = Math.min(1.0, (monthlyAvgValue / globalAvg - 1) * 0.5 + 0.5);

        const patternLabel = `seasonal_pattern_${categoryId}_${month}`;
        config.engine.getOrCreateNode(patternLabel, {
          type: "seasonal_pattern",
          categoryId,
          month,
          avgOrderCount: Math.round(monthlyAvgValue),
          confidence,
          years: data.years,
          detectedAt: now.toISOString(),
        });

        const peakMonth = month;
        const currentMonth = now.getMonth();
        const monthsUntilPeak =
          peakMonth >= currentMonth ? peakMonth - currentMonth : 12 - currentMonth + peakMonth;
        const daysUntilPeak = monthsUntilPeak * 30;

        if (daysUntilPeak <= SEASONAL_ADVANCE_DAYS && daysUntilPeak >= 0) {
          const pctAbove = Math.round(((monthlyAvgValue - globalAvg) / globalAvg) * 100);
          alerts.push(
            `📅 Estacionalidad detectada: ${categoryId} pico en mes ${month + 1}. ` +
              `Últimos ${data.years.length} años: +${pctAbove}% órdenes vs promedio. ` +
              `Prepará stock y campañas.`,
          );
        }
      }
    }
  }

  config.engine.getOrCreateNode("seasonal_marker", {
    type: "seasonal_marker",
    lastRun: now.toISOString(),
  });

  return alerts;
}

// ── Pruning ────────────────────────────────────────────────────────────

export function pruneSnapshots(config: BackgroundIngestionConfig): void {
  const db = config.engine.db;

  const listingNodes = config.engine.queryByMetadata({
    type: "listing_snapshot",
    limit: 10000,
  });

  const byItem = new Map<string, Array<{ id: number; capturedAt: string }>>();
  for (const node of listingNodes) {
    const meta = node.metadata;
    const itemId = metadataString(meta.itemId);
    const capturedAt = metadataString(meta.capturedAt);
    if (!itemId) continue;
    let entries = byItem.get(itemId);
    if (!entries) {
      entries = [];
      byItem.set(itemId, entries);
    }
    entries.push({ id: node.id, capturedAt });
  }

  for (const [, entries] of byItem) {
    if (entries.length <= LISTING_SNAPSHOT_KEEP) continue;
    entries.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const toDelete = entries.slice(LISTING_SNAPSHOT_KEEP);
    const deleteStmt = db.prepare("DELETE FROM nodes WHERE id = ?");
    for (const entry of toDelete) {
      deleteStmt.run(entry.id);
    }
  }

  const visitNodes = config.engine.queryByMetadata({
    type: "visit_snapshot",
    limit: 10000,
  });

  const byVisitItem = new Map<string, Array<{ id: number; capturedAt: string }>>();
  for (const node of visitNodes) {
    const meta = node.metadata;
    const itemId = metadataString(meta.itemId);
    const capturedAt = metadataString(meta.capturedAt);
    if (!itemId) continue;
    let entries = byVisitItem.get(itemId);
    if (!entries) {
      entries = [];
      byVisitItem.set(itemId, entries);
    }
    entries.push({ id: node.id, capturedAt });
  }

  for (const [, entries] of byVisitItem) {
    if (entries.length <= VISIT_SNAPSHOT_KEEP) continue;
    entries.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const toDelete = entries.slice(VISIT_SNAPSHOT_KEEP);
    const deleteStmt = db.prepare("DELETE FROM nodes WHERE id = ?");
    for (const entry of toDelete) {
      deleteStmt.run(entry.id);
    }
  }

  const orderNodes = config.engine.queryByMetadata({
    type: "order_snapshot",
    limit: ORDER_SNAPSHOT_KEEP_TOTAL + 50,
  });

  if (orderNodes.length > ORDER_SNAPSHOT_KEEP_TOTAL) {
    orderNodes.sort((a, b) => {
      const aTime = metadataString(a.metadata.capturedAt);
      const bTime = metadataString(b.metadata.capturedAt);
      return bTime.localeCompare(aTime);
    });
    const toDelete = orderNodes.slice(ORDER_SNAPSHOT_KEEP_TOTAL);
    const deleteStmt = db.prepare("DELETE FROM nodes WHERE id = ?");
    for (const entry of toDelete) {
      deleteStmt.run(entry.id);
    }
  }

  db.prepare(
    "DELETE FROM edges WHERE source NOT IN (SELECT id FROM nodes) OR target NOT IN (SELECT id FROM nodes)",
  ).run();
}

// ── Relist checks ──────────────────────────────────────────────────────

export function runRelistChecks(config: BackgroundIngestionConfig): {
  alerts: string[];
  opportunitiesFound: number;
} {
  const alerts: string[] = [];
  const capturedAt = new Date().toISOString();
  const now = new Date();
  const relistDeadline = new Date(now);
  relistDeadline.setDate(relistDeadline.getDate() - RELIST_WINDOW_DAYS);
  const expiringAfter = new Date(now);
  expiringAfter.setDate(expiringAfter.getDate() + RELIST_EXPIRING_DAYS);
  const hardDeadline = new Date(now);
  hardDeadline.setDate(hardDeadline.getDate() - 60);

  const allSnaps = config.engine.queryByMetadata({
    type: "listing_snapshot",
    limit: 10000,
  });

  const byItem = new Map<
    string,
    Array<{
      id: number;
      itemId: string;
      sellerId: string;
      sellerName: string;
      title: string;
      status: string;
      capturedAt: string;
    }>
  >();
  for (const snap of allSnaps) {
    const m = snap.metadata;
    const itemId = metadataString(m.itemId);
    const status = metadataString(m.status);
    const sellerId = metadataString(m.sellerId);
    const sellerName = metadataString(m.sellerName, sellerId);
    const title = metadataString(m.title);
    const snapCapturedAt = metadataString(m.capturedAt);
    if (!itemId) continue;
    let entries = byItem.get(itemId);
    if (!entries) {
      entries = [];
      byItem.set(itemId, entries);
    }
    entries.push({
      id: snap.id,
      itemId,
      sellerId,
      sellerName,
      title,
      status,
      capturedAt: snapCapturedAt,
    });
  }

  let opportunitiesFound = 0;

  for (const [itemId, entries] of byItem) {
    entries.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const latest = entries[0]!;
    const currentStatus = latest.status;

    if (currentStatus === "closed") {
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

      if (closeDate < hardDeadline) continue;

      const daysSinceClose = Math.round(
        (now.getTime() - closeDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      const isWithinWindow = closeDate >= relistDeadline;
      if (!isWithinWindow) continue;

      let hadSalesHistory = false;
      let salesCount = 0;

      const visitNodes = config.engine.queryByMetadata({
        type: "visit_snapshot",
        itemId,
        limit: 1,
      });
      if (visitNodes.length > 0) {
        const vm = visitNodes[0]!.metadata;
        const totalVisits = Number(vm.totalVisits ?? 0);
        if (totalVisits > 0) hadSalesHistory = true;
      }

      const orderNodes = config.engine.queryByMetadata({
        type: "order_snapshot",
        limit: 100,
      });
      for (const on of orderNodes) {
        const om = on.metadata;
        const orders = Number(om.totalOrders ?? 0);
        if (orders > 0) {
          salesCount += orders;
          hadSalesHistory = true;
        }
      }

      let lastPrice = 0;
      const snapNode = config.engine.queryByMetadata({
        type: "listing_snapshot",
        itemId,
        limit: 1,
      });
      if (snapNode.length > 0) {
        const sm = snapNode[0]!.metadata;
        lastPrice = Number(sm.price ?? 0);
      }

      const relistLabel = `relist_opportunity_${itemId}`;
      config.engine.getOrCreateNode(relistLabel, {
        type: "relist_opportunity",
        itemId,
        sellerId: latest.sellerId,
        title: latest.title,
        closedAt: closeDateStr,
        daysSinceClose,
        hadSalesHistory,
        salesCount,
        suggestedPrice: lastPrice,
        capturedAt,
      });

      opportunitiesFound++;

      const expiryDate = new Date(closeDate);
      expiryDate.setDate(expiryDate.getDate() + 60);
      const expiryLabel = expiryDate.toISOString().slice(0, 10);
      const daysUntilExpiry = Math.round(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (hadSalesHistory || salesCount > 0) {
        if (daysUntilExpiry <= RELIST_EXPIRING_DAYS) {
          alerts.push(
            `⏰ ${itemId} vence en ${daysUntilExpiry} días para relist. Si no se republica antes del ${expiryLabel}, pierde el historial.`,
          );
        } else if (isWithinWindow) {
          alerts.push(
            `🔄 ${itemId} cerrada hace ${daysSinceClose} días, ${salesCount} ventas históricas. Elegible para relist hasta ${expiryLabel}. ¿Republicar con nuevo precio?`,
          );
        }
      }
    }

    if (currentStatus === "paused") {
      const visitNodes = config.engine.queryByMetadata({
        type: "visit_snapshot",
        itemId,
        limit: 2,
      });
      let totalVisits = 0;
      for (const vn of visitNodes) {
        const vm = vn.metadata;
        totalVisits += Number(vm.totalVisits ?? 0);
      }

      if (totalVisits > 0) {
        alerts.push(
          `💡 ${itemId} está pausada con ${totalVisits} visitas acumuladas. Si la cerrás, podés republicarla con nuevo precio/tipo y hereda el historial.`,
        );
        opportunitiesFound++;
      }
    }
  }

  return { alerts, opportunitiesFound };
}
