import OpenAI from "openai";
import type { GraphEngine } from "@msl/memory";
import type { MlcApiClient, MlcListingSummary, MlcPerformanceSummary, MlcVisitsDetail } from "@msl/mercadolibre";

// ── Types ──────────────────────────────────────────────────────────────

export type BackgroundIngestionConfig = {
  mlcClient: MlcApiClient;
  engine: GraphEngine;
  sendProactiveMessage: (chatId: number, text: string) => Promise<void>;
  listActiveChats: () => Promise<number[]>;
  sellerIds: string[];
  /** Human-readable names for seller IDs: `{ [sellerId]: "Plasticov" | "Maustian" }`. */
  sellerNames?: Record<string, string>;
  /** Interval in milliseconds between ingestion runs. Default: 6 hours. */
  intervalMs?: number;
  /**
   * DeepSeek API key for generating daily business insights.
   * When provided, a DeepSeek inference pass runs after each ingestion cycle.
   * When absent, insight generation is silently skipped.
   */
  deepseekApiKey?: string;
};

// ── Constants ──────────────────────────────────────────────────────────

const LISTING_SNAPSHOT_KEEP = 30; // per item
const VISIT_SNAPSHOT_KEEP = 30; // per item
const ORDER_SNAPSHOT_KEEP_TOTAL = 90;
const TREND_WINDOW = 3; // consecutive periods for trend detection
const VISIT_SPIKE_THRESHOLD = 0.5; // ±50%
const SEASONAL_PEAK_MULTIPLIER = 1.5; // >50% above yearly average
const SEASONAL_RUN_EVERY_DAYS = 7;
const SEASONAL_ADVANCE_DAYS = 30; // alert N days before peak
const PRICE_CHANGE_THRESHOLD = 0.2; // ±20%
const SIMILAR_PRICE_RANGE = 0.2; // ±20% for cross-account matching
const QUALITY_CHECK_MAX_PER_CYCLE = 20; // listings per cycle
const QUALITY_SCORE_DROP_THRESHOLD = 10; // points
const QUALITY_LOW_SCORE_THRESHOLD = 70;
const RELIST_WINDOW_DAYS = 55; // 60-day limit minus 5-day buffer
const RELIST_EXPIRING_DAYS = 7; // warn when relist window closes within 7 days

// ── Helpers ────────────────────────────────────────────────────────────

function todayLabel(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeListings(
  data: ReadonlyArray<MlcListingSummary> | MlcListingSummary,
): ReadonlyArray<MlcListingSummary> {
  if (Array.isArray(data)) return data;
  return [data as MlcListingSummary];
}

function normalizeVisitsDetail(
  detail: MlcVisitsDetail[] | undefined,
): ReadonlyArray<MlcVisitsDetail> {
  return detail ?? [];
}

/** Compute percentage change from previous value. Returns null if prev is 0. */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/**
 * Calculate text similarity between two strings (case-insensitive).
 * Simple token-overlap ratio for cross-account listing matching.
 */
function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter((t) => t.length >= 2));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter((t) => t.length >= 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

// ── Core: process one seller's listings and visits ─────────────────────

interface SellerProcessResult {
  listings: ReadonlyArray<MlcListingSummary>;
  alerts: string[];
}

async function processSellerListings(
  config: BackgroundIngestionConfig,
  sellerId: string,
  sellerName: string,
): Promise<SellerProcessResult> {
  const alerts: string[] = [];

  const snapshot = await config.mlcClient.getListings(sellerId);
  const listings = normalizeListings(snapshot.data);

  for (const listing of listings) {
    const itemId = listing.id;
    if (!itemId) continue;

    const capturedAt = new Date().toISOString();
    const snapshotLabel = `listing_snapshot_${itemId}_${todayLabel()}`;

    // ── Create listing snapshot node ─────────────────────────
    config.engine.getOrCreateNode(snapshotLabel, {
      type: "listing_snapshot",
      itemId,
      sellerId,
      sellerName,
      title: listing.title ?? "",
      price: listing.price ?? 0,
      currencyId: listing.currencyId ?? "CLP",
      status: listing.status ?? "unknown",
      categoryId: listing.categoryId ?? "",
      listingTypeId: listing.listingTypeId ?? "",
      capturedAt,
    });

    // ── Find previous snapshot for comparison ───────────────
    const previousSnapshots = config.engine.queryByMetadata({
      type: "listing_snapshot",
      itemId,
      limit: 2,
    });

    // Index 0 is the one we just created, index 1 is the previous
    const prevSnapshot =
      previousSnapshots.length >= 2 ? previousSnapshots[1] : null;

    if (prevSnapshot?.metadata) {
      const prevMeta = prevSnapshot.metadata as Record<string, unknown>;

      // ── Detect paused with sales history ──────────────────
      const newStatus = listing.status ?? "unknown";
      const prevStatus = String(prevMeta.status ?? "unknown");
      const salesCount = Number(prevMeta.salesCount ?? 0);

      if (
        newStatus === "paused" &&
        prevStatus !== "paused" &&
        salesCount > 0
      ) {
        alerts.push(
          `${itemId} (${sellerName}) se pausó. Tenía ${salesCount} ventas — ¿reutilizar?`,
        );
      }

      // ── Detect reactivation ───────────────────────────────
      if (newStatus === "active" && prevStatus === "paused") {
        alerts.push(`${itemId} (${sellerName}) volvió a activarse`);
      }

      // ── Detect significant price change (>20%) ────────────
      const newPrice = listing.price ?? 0;
      const prevPrice = Number(prevMeta.price ?? 0);
      if (prevPrice > 0 && newPrice > 0) {
        const change = Math.abs(newPrice - prevPrice) / prevPrice;
        if (change > PRICE_CHANGE_THRESHOLD) {
          const direction = newPrice > prevPrice ? "subió" : "bajó";
          const pct = Math.round(change * 100);
          alerts.push(
            `${itemId} (${sellerName}) ${direction} de precio en ${pct}% (${prevPrice} → ${newPrice})`,
          );
        }
      }
    }

    // ── Visits snapshot ─────────────────────────────────────
    if (typeof config.mlcClient.getItemVisits === "function") {
      try {
        const visitsSnapshot = await config.mlcClient.getItemVisits(
          sellerId,
          itemId,
        );
        const visitsSummary = Array.isArray(visitsSnapshot.data)
          ? visitsSnapshot.data[0]
          : visitsSnapshot.data;

        if (visitsSummary) {
          const detail = normalizeVisitsDetail(visitsSummary.visitsDetail);
          const totalVisits = visitsSummary.totalVisits ?? 0;

          const visitLabel = `visit_snapshot_${itemId}_${todayLabel()}`;
          config.engine.getOrCreateNode(visitLabel, {
            type: "visit_snapshot",
            itemId,
            sellerId,
            sellerName,
            totalVisits,
            visitsDetail: detail,
            capturedAt,
          });

          // ── Visit trend detection (3+ periods) ────────────
          const recentVisits = config.engine.queryByMetadata({
            type: "visit_snapshot",
            itemId,
            limit: TREND_WINDOW + 1, // current + N previous
          });

          if (recentVisits.length >= TREND_WINDOW) {
            const values = recentVisits
              .slice(0, TREND_WINDOW)
              .map(
                (n) =>
                  (n.metadata as Record<string, unknown>).totalVisits as number,
              )
              .filter((v) => typeof v === "number" && v > 0);

            if (values.length >= TREND_WINDOW) {
              // Determine direction: comparing consecutive pairs
              let trendingUp = true;
              let trendingDown = true;
              for (let i = 0; i < values.length - 1; i++) {
                const change = pctChange(values[i]!, values[i + 1]!);
                if (change === null || change <= 0) trendingUp = false;
                if (change === null || change >= 0) trendingDown = false;
              }

              const first = values[0]!;
              const last = values[values.length - 1]!;

              if (trendingUp) {
                const pct = Math.round(
                  ((first - last) / last) * 100,
                );
                alerts.push(
                  `📈 ${itemId} (${sellerName}) lleva ${TREND_WINDOW} períodos subiendo (+${pct}% total) — tendencia alcista confirmada`,
                );
              } else if (trendingDown) {
                const pct = Math.round(
                  ((last - first) / last) * 100,
                );
                alerts.push(
                  `📉 ${itemId} (${sellerName}) lleva ${TREND_WINDOW} períodos bajando (${pct}% total) — tendencia bajista`,
                );
              }
            }
          }

          // ── Single-period spike/drop (legacy behavior) ────
          const previousVisits = config.engine.queryByMetadata({
            type: "visit_snapshot",
            itemId,
            limit: 2,
          });

          const prevVisit =
            previousVisits.length >= 2 ? previousVisits[1] : null;

          if (prevVisit?.metadata) {
            const prevVisitMeta = prevVisit.metadata as Record<
              string,
              unknown
            >;
            const prevTotal = Number(prevVisitMeta.totalVisits ?? 0);

            if (prevTotal > 0) {
              const visitChange = (totalVisits - prevTotal) / prevTotal;

              if (visitChange > VISIT_SPIKE_THRESHOLD) {
                const pct = Math.round(visitChange * 100);
                alerts.push(
                  `📈 ${itemId} (${sellerName}) +${pct}% visitas esta semana. ¿Aumentar precio?`,
                );
              } else if (visitChange < -VISIT_SPIKE_THRESHOLD) {
                const pct = Math.round(Math.abs(visitChange) * 100);
                alerts.push(
                  `📉 ${itemId} (${sellerName}) -${pct}% visitas. ¿Revisar título/fotos/ads?`,
                );
              }
            }
          }
        }
      } catch {
        // Visits unavailable for this item — skip silently
      }
    }
  }

  return { listings, alerts };
}

// ── Order history snapshots ────────────────────────────────────────────

async function ingestOrderSnapshots(
  config: BackgroundIngestionConfig,
  sellerId: string,
  sellerName: string,
): Promise<{ alerts: string[]; orderCount: number; totalAmount: number }> {
  const alerts: string[] = [];

  try {
    const ordersSnapshot = await config.mlcClient.getOrders(sellerId);
    const orders = ordersSnapshot.data;

    if (!Array.isArray(orders) || orders.length === 0) {
      return { alerts, orderCount: 0, totalAmount: 0 };
    }

    const capturedAt = new Date().toISOString();
    let totalAmount = 0;

    // Build category breakdown by cross-referencing with Cortex listings
    const categoryMap = new Map<string, { orderCount: number; totalAmount: number }>();

    for (const order of orders) {
      const amount = order.totalAmount ?? 0;
      totalAmount += amount;

      // Look up category from listing snapshots
      // We use seller-scoped listing snapshots; if an order's items are not
      // in our snapshots yet, category is "unknown".
      const listingSnaps = config.engine.queryByMetadata({
        type: "listing_snapshot",
        sellerId,
        limit: 1,
      });

      // Use the first listing snapshot category as fallback — in practice,
      // most orders for a seller come from that seller's listings.
      let catId = "unknown";
      const firstSnap = listingSnaps[0];
      if (firstSnap) {
        catId = String(
          (firstSnap.metadata as Record<string, unknown>).categoryId ?? "unknown",
        );
      }

      const existing = categoryMap.get(catId);
      if (existing) {
        existing.orderCount++;
        existing.totalAmount += amount;
      } else {
        categoryMap.set(catId, { orderCount: 1, totalAmount: amount });
      }
    }

    const categoryBreakdown = Array.from(categoryMap.entries()).map(
      ([categoryId, data]) => ({
        categoryId,
        orderCount: data.orderCount,
        totalAmount: data.totalAmount,
      }),
    );

    const orderLabel = `order_snapshot_${sellerId}_${todayLabel()}`;
    config.engine.getOrCreateNode(orderLabel, {
      type: "order_snapshot",
      sellerId,
      sellerName,
      totalOrders: orders.length,
      totalAmount,
      categoryBreakdown,
      capturedAt,
    });

    // ── Category star alert ─────────────────────────────────
    if (categoryBreakdown.length > 0) {
      const topCategory = categoryBreakdown.reduce((a, b) =>
        a.totalAmount > b.totalAmount ? a : b,
      );
      alerts.push(
        `⭐ Categoría estrella (${sellerName}): ${topCategory.categoryId} con $${Math.round(topCategory.totalAmount).toLocaleString("es-CL")} CLP en ${topCategory.orderCount} órdenes`,
      );
    }

    return { alerts, orderCount: orders.length, totalAmount };
  } catch {
    console.error(
      `[background-ingestion] Failed to fetch orders for seller ${sellerId}`,
    );
    return { alerts, orderCount: 0, totalAmount: 0 };
  }
}

// ── Cross-account comparison ───────────────────────────────────────────

interface CrossAccountMatch {
  plasticovItem: MlcListingSummary;
  maustianItem: MlcListingSummary;
  similarity: number;
}

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

      // Title similarity
      const titleSim = titleSimilarity(pTitle, mTitle);

      // Category match bonus
      const catMatch = pCategory && mCategory && pCategory === mCategory ? 0.3 : 0;

      // Price similarity
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
      usedMaustianIds.add(bestMatch.maustianItem.id!);
    }
  }

  return matches;
}

async function runCrossAccountComparison(
  config: BackgroundIngestionConfig,
  plasticovId: string,
  plasticovName: string,
  plasticovListings: ReadonlyArray<MlcListingSummary>,
  maustianId: string,
  maustianName: string,
  maustianListings: ReadonlyArray<MlcListingSummary>,
): Promise<string[]> {
  const alerts: string[] = [];
  const matches = matchCrossAccountListings(plasticovListings, maustianListings);

  const matchedMaustianIds = new Set(
    matches.map((m) => m.maustianItem.id!).filter(Boolean),
  );
  const unmatchedPlasticov = plasticovListings.filter(
    (l) =>
      l.id &&
      !matches.some(
        (m) => m.plasticovItem.id === l.id,
      ),
  );
  const unmatchedMaustian = maustianListings.filter(
    (l) => l.id && !matchedMaustianIds.has(l.id),
  );

  // Process matches
  for (const match of matches) {
    const pId = match.plasticovItem.id!;
    const mId = match.maustianItem.id!;
    const pLabel = `listing_snapshot_${pId}_${todayLabel()}`;
    const mLabel = `listing_snapshot_${mId}_${todayLabel()}`;

    // Create Cortex edge between matching listings
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

    // ── Visit comparison ────────────────────────────────────
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

    const pTotal =
      pVisitsNode
        ? Number(
            (pVisitsNode.metadata as Record<string, unknown>).totalVisits ?? 0,
          )
        : 0;
    const mTotal =
      mVisitsNode
        ? Number(
            (mVisitsNode.metadata as Record<string, unknown>).totalVisits ?? 0,
          )
        : 0;

    if (pTotal > 0 || mTotal > 0) {
      alerts.push(
        `🔍 ${pId} (${plasticovName}): ${pTotal} visitas vs ${mId} (${maustianName}): ${mTotal} visitas`,
      );
    }

    // ── Price comparison ────────────────────────────────────
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

    // ── Status comparison ───────────────────────────────────
    const pStatus = match.plasticovItem.status ?? "unknown";
    const mStatus = match.maustianItem.status ?? "unknown";
    if (pStatus !== mStatus) {
      alerts.push(
        `⚠️ ${mId} (${maustianName}) está ${mStatus} pero ${pId} (${plasticovName}) está ${pStatus}`,
      );
    }
  }

  // ── Unmatched alerts ──────────────────────────────────────
  for (const listing of unmatchedPlasticov) {
    if (!listing.id) continue;
    const visits = config.engine.queryByMetadata({
      type: "visit_snapshot",
      itemId: listing.id,
      limit: 1,
    });
    const visitsNode = visits[0];
    const totalVisits =
      visitsNode
        ? Number(
            (visitsNode.metadata as Record<string, unknown>).totalVisits ?? 0,
          )
        : 0;
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

async function runSeasonalAnalysis(
  config: BackgroundIngestionConfig,
): Promise<string[]> {
  const alerts: string[] = [];
  const now = new Date();

  // Check if we should run (every 7 days)
  const markerNodes = config.engine.queryByMetadata({
    type: "seasonal_marker",
    limit: 1,
  });

  const firstMarker = markerNodes[0];
  if (firstMarker) {
    const markerMeta = firstMarker.metadata as Record<string, unknown>;
    const lastRun = String(markerMeta.lastRun ?? "");
    if (lastRun) {
      const lastRunDate = new Date(lastRun);
      const daysSince = (now.getTime() - lastRunDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < SEASONAL_RUN_EVERY_DAYS) {
        return alerts;
      }
    }
  }

  // Fetch all order snapshots from last 2+ years
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const after = twoYearsAgo.toISOString().slice(0, 10);

  const orderSnaps = config.engine.queryByMetadata({
    type: "order_snapshot",
    after,
    limit: 1000,
  });

  if (orderSnaps.length < 12) {
    // Not enough data for seasonal analysis — update marker and skip
    config.engine.getOrCreateNode("seasonal_marker", {
      type: "seasonal_marker",
      lastRun: now.toISOString(),
    });
    return alerts;
  }

  // Group by month and category
  type MonthlyData = {
    month: number; // 0-11
    year: number;
    orderCount: number;
    totalAmount: number;
  };

  const byCategoryMonth = new Map<string, MonthlyData[]>();

  for (const snap of orderSnaps) {
    const meta = snap.metadata as Record<string, unknown>;
    const capturedAt = String(meta.capturedAt ?? "");
    const breakdown =
      (meta.categoryBreakdown as Array<{
        categoryId: string;
        orderCount: number;
        totalAmount: number;
      }>) ?? [];

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

  // Detect seasonal patterns per category/month
  for (const [categoryId, monthlyData] of byCategoryMonth) {
    // Calculate yearly average per month
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

    // Global yearly average across all months
    let globalTotal = 0;
    let globalCount = 0;
    for (const [, data] of monthlyAvg) {
      globalTotal += data.total;
      globalCount += data.years.length;
    }
    const globalAvg = globalCount > 0 ? globalTotal / globalCount : 0;

    // Find months with significantly higher orders
    for (const [month, data] of monthlyAvg) {
      const monthlyAvgValue = data.total / data.years.length;
      if (
        globalAvg > 0 &&
        monthlyAvgValue > globalAvg * SEASONAL_PEAK_MULTIPLIER &&
        data.years.length >= 2
      ) {
        const confidence = Math.min(
          1.0,
          (monthlyAvgValue / globalAvg - 1) * 0.5 + 0.5,
        );

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

        // Proactive alert 30 days before peak
        const peakMonth = month;
        const currentMonth = now.getMonth();
        const monthsUntilPeak =
          peakMonth >= currentMonth
            ? peakMonth - currentMonth
            : 12 - currentMonth + peakMonth;
        const daysUntilPeak = monthsUntilPeak * 30;

        if (daysUntilPeak <= SEASONAL_ADVANCE_DAYS && daysUntilPeak >= 0) {
          const pctAbove = Math.round(
            ((monthlyAvgValue - globalAvg) / globalAvg) * 100,
          );
          alerts.push(
            `📅 Estacionalidad detectada: ${categoryId} pico en mes ${month + 1}. ` +
              `Últimos ${data.years.length} años: +${pctAbove}% órdenes vs promedio. ` +
              `Prepará stock y campañas.`,
          );
        }
      }
    }
  }

  // Update seasonal marker
  config.engine.getOrCreateNode("seasonal_marker", {
    type: "seasonal_marker",
    lastRun: now.toISOString(),
  });

  return alerts;
}

// ── Pruning ────────────────────────────────────────────────────────────

async function pruneSnapshots(config: BackgroundIngestionConfig): Promise<void> {
  const db = config.engine.db;

  // Prune listing_snapshot per item (keep last 30)
  const listingNodes = config.engine.queryByMetadata({
    type: "listing_snapshot",
    limit: 10000,
  });

  const byItem = new Map<string, Array<{ id: number; capturedAt: string }>>();
  for (const node of listingNodes) {
    const meta = node.metadata as Record<string, unknown>;
    const itemId = String(meta.itemId ?? "");
    const capturedAt = String(meta.capturedAt ?? "");
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
    // Sort newest first, keep first N, delete rest
    entries.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const toDelete = entries.slice(LISTING_SNAPSHOT_KEEP);
    const deleteStmt = db.prepare("DELETE FROM nodes WHERE id = ?");
    for (const entry of toDelete) {
      deleteStmt.run(entry.id);
    }
  }

  // Prune visit_snapshot per item (keep last 30)
  const visitNodes = config.engine.queryByMetadata({
    type: "visit_snapshot",
    limit: 10000,
  });

  const byVisitItem = new Map<string, Array<{ id: number; capturedAt: string }>>();
  for (const node of visitNodes) {
    const meta = node.metadata as Record<string, unknown>;
    const itemId = String(meta.itemId ?? "");
    const capturedAt = String(meta.capturedAt ?? "");
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

  // Prune order_snapshot (keep last 90 total)
  const orderNodes = config.engine.queryByMetadata({
    type: "order_snapshot",
    limit: ORDER_SNAPSHOT_KEEP_TOTAL + 50,
  });

  if (orderNodes.length > ORDER_SNAPSHOT_KEEP_TOTAL) {
    orderNodes.sort((a, b) => {
      const aTime = String(
        (a.metadata as Record<string, unknown>).capturedAt ?? "",
      );
      const bTime = String(
        (b.metadata as Record<string, unknown>).capturedAt ?? "",
      );
      return bTime.localeCompare(aTime);
    });
    const toDelete = orderNodes.slice(ORDER_SNAPSHOT_KEEP_TOTAL);
    const deleteStmt = db.prepare("DELETE FROM nodes WHERE id = ?");
    for (const entry of toDelete) {
      deleteStmt.run(entry.id);
    }
  }

  // Also clean up orphaned edges
  db.prepare(
    "DELETE FROM edges WHERE source NOT IN (SELECT id FROM nodes) OR target NOT IN (SELECT id FROM nodes)",
  ).run();
}

// ── DeepSeek daily insights ────────────────────────────────────────────

/**
 * Structured business context assembled after an ingestion cycle,
 * used as input for the DeepSeek inference pass.
 */
export type DailyBusinessContext = {
  capturedAt: string;
  listings: {
    total: number;
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
    avgPrice: number;
  };
  visits: {
    trendingUp: string[];
    trendingDown: string[];
    totalSnapshots: number;
  };
  orders: {
    totalOrders: number;
    totalAmount: number;
    byCategory: Record<string, { orderCount: number; totalAmount: number }>;
  };
  seasonal: Array<Record<string, unknown>>;
  crossAccount: {
    plasticov: { total: number; byStatus: Record<string, number> };
    maustian: { total: number; byStatus: Record<string, number> };
  };
  alerts: string[];
};

/**
 * Generates 3–5 actionable business insights in Spanish using DeepSeek.
 *
 * Sends a structured prompt to the DeepSeek API with post-ingestion Cortex data
 * and returns a formatted natural-language summary the agent can push to chats.
 *
 * @param context — assembled business data from the current ingestion cycle.
 * @param openai — OpenAI client pointed at DeepSeek's API.
 * @returns Spanish-language insight summary with emoji markers.
 */
export async function generateDailyInsights(
  context: DailyBusinessContext,
  openai: OpenAI,
): Promise<string> {
  const prompt = `Sos un analista de negocio experto en MercadoLibre. Analizá estos datos del negocio
Plasticov/Maustian y generá 3-5 insights accionables en español. Cada insight debe:
- Identificar un patrón o anomalía concreta
- Explicar por qué importa para la utilidad neta
- Recomendar una acción específica (qué listing, qué cambiar, de qué valor a qué valor)
- Incluir los datos que respaldan la recomendación

Cuando corresponda, sugerí acciones concretas que el vendedor puede confirmar con "dale":
- Cambios de precio: "MLC99281 bajar de $15.000 a $12.500 (margen 34%, +23% ventas esperadas)"
- Ajustes de stock: "MLC77412 reponer 20 unidades (67% más visitas, stock crítico)"
- Presupuesto de ads: "Campaña X subir daily_budget de $12.000 a $25.000 (ROAS 4.2)"
- Reutilizar paused: "MLC84512 pausada (47 ventas) → reutilizar para nuevo producto"

DATOS DEL NEGOCIO:
${JSON.stringify(context, null, 2)}

Respondé en este formato exacto, máximo 5 insights:
🔍 [Insight 1 - patrón detectado]
💰 [Insight 2 - margen/utilidad con acción concreta]
📈 [Insight 3 - tendencia con acción concreta]
⚠️ [Insight 4 - riesgo con acción correctiva]
🎯 [Insight 5 - oportunidad con acción concreta]`;

  try {
    const completion = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      stream: false,
    });

    return completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    console.error(
      "[background-ingestion] DeepSeek insight generation failed:",
      err instanceof Error ? err.message : String(err),
    );
    return "";
  }
}

/**
 * Builds a {@link DailyBusinessContext} from the Cortex graph after ingestion.
 *
 * Queries listing, visit, order, and seasonal snapshots to produce a compact
 * structured summary suitable for the DeepSeek insight prompt.
 */
function buildDailyContext(
  engine: GraphEngine,
  sellerNames: Record<string, string>,
  alerts: string[],
): DailyBusinessContext {
  const capturedAt = new Date().toISOString();

  // ── Listings ────────────────────────────────────────────────
  const listingNodes = engine.queryByMetadata({
    type: "listing_snapshot",
    limit: 200,
  });

  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalPrice = 0;
  let priceCount = 0;

  for (const n of listingNodes) {
    const m = n.metadata;
    const status = String(m.status ?? "unknown");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const cat = String(m.categoryId ?? "");
    if (cat && cat !== "unknown") {
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }
    const price = Number(m.price ?? 0);
    if (price > 0) {
      totalPrice += price;
      priceCount++;
    }
  }

  // ── Visits ──────────────────────────────────────────────────
  const visitNodes = engine.queryByMetadata({
    type: "visit_snapshot",
    limit: 100,
  });

  const byVisitItem = new Map<string, number[]>();
  for (const n of visitNodes) {
    const m = n.metadata;
    const itemId = String(m.itemId ?? "unknown");
    const visits = Number(m.totalVisits ?? 0);
    let values = byVisitItem.get(itemId);
    if (!values) {
      values = [];
      byVisitItem.set(itemId, values);
    }
    values.push(visits);
  }

  const trendingUp: string[] = [];
  const trendingDown: string[] = [];
  for (const [itemId, values] of byVisitItem) {
    if (values.length < 2) continue;
    const first = values[0];
    const last = values[values.length - 1];
    if (first === undefined || last === undefined || first === 0) continue;
    const change = (last - first) / first;
    if (change > 0.1) trendingUp.push(itemId);
    else if (change < -0.1) trendingDown.push(itemId);
  }

  // ── Orders ──────────────────────────────────────────────────
  const orderNodes = engine.queryByMetadata({
    type: "order_snapshot",
    limit: 30,
  });

  let totalOrders = 0;
  let totalAmount = 0;
  const byOrderCategory: Record<string, { orderCount: number; totalAmount: number }> = {};

  for (const n of orderNodes) {
    const m = n.metadata;
    totalOrders += Number(m.totalOrders ?? 0);
    totalAmount += Number(m.totalAmount ?? 0);

    const breakdown = m.categoryBreakdown as
      | Array<{ categoryId: string; orderCount: number; totalAmount: number }>
      | undefined;
    if (breakdown) {
      for (const cat of breakdown) {
        const existing = byOrderCategory[cat.categoryId];
        if (existing) {
          existing.orderCount += cat.orderCount;
          existing.totalAmount += cat.totalAmount;
        } else {
          byOrderCategory[cat.categoryId] = {
            orderCount: cat.orderCount,
            totalAmount: cat.totalAmount,
          };
        }
      }
    }
  }

  // ── Seasonal ────────────────────────────────────────────────
  const seasonalNodes = engine.queryByMetadata({
    type: "seasonal_pattern",
    limit: 50,
  });
  const seasonal = seasonalNodes.map((n) => n.metadata);

  // ── Cross-account ───────────────────────────────────────────
  const plasticovListings = engine.queryByMetadata({
    type: "listing_snapshot",
    sellerId: "plasticov",
    limit: 200,
  });
  const maustianListings = engine.queryByMetadata({
    type: "listing_snapshot",
    sellerId: "maustian",
    limit: 200,
  });

  const pByStatus: Record<string, number> = {};
  for (const n of plasticovListings) {
    const s = String(n.metadata.status ?? "unknown");
    pByStatus[s] = (pByStatus[s] ?? 0) + 1;
  }
  const mByStatus: Record<string, number> = {};
  for (const n of maustianListings) {
    const s = String(n.metadata.status ?? "unknown");
    mByStatus[s] = (mByStatus[s] ?? 0) + 1;
  }

  return {
    capturedAt,
    listings: {
      total: listingNodes.length,
      byStatus,
      byCategory,
      avgPrice: priceCount > 0 ? Math.round(totalPrice / priceCount) : 0,
    },
    visits: {
      trendingUp,
      trendingDown,
      totalSnapshots: visitNodes.length,
    },
    orders: {
      totalOrders,
      totalAmount,
      byCategory: byOrderCategory,
    },
    seasonal,
    crossAccount: {
      plasticov: { total: plasticovListings.length, byStatus: pByStatus },
      maustian: { total: maustianListings.length, byStatus: mByStatus },
    },
    alerts,
  };
}

// ── Phase 7: Quality checks ────────────────────────────────────────────

/**
 * Runs listing quality checks using the MercadoLibre Item Performance API.
 *
 * Picks up to {@link QUALITY_CHECK_MAX_PER_CYCLE} active listings that
 * are most in need of a fresh quality check (oldest or missing snapshots),
 * calls `mlcClient.getItemPerformance`, persists `quality_snapshot` nodes,
 * and generates alerts for low scores and score drops.
 *
 * Silently skips when `getItemPerformance` is not available on the client.
 */
async function runQualityChecks(
  config: BackgroundIngestionConfig,
): Promise<{ alerts: string[]; checkedCount: number }> {
  const alerts: string[] = [];

  // Gracefully skip if the capability is not available
  if (typeof config.mlcClient.getItemPerformance !== "function") {
    console.log("[worker] Phase 7 quality: getItemPerformance not available, skipping");
    return { alerts, checkedCount: 0 };
  }

  const capturedAt = new Date().toISOString();

  // ── Find active listings from recent snapshots ──────────────
  const listingSnaps = config.engine.queryByMetadata({
    type: "listing_snapshot",
    limit: 5000,
  });

  // Group newest snapshot per itemId, keep only active ones
  const newestPerItem = new Map<
    string,
    { itemId: string; sellerId: string; sellerName: string; title: string; capturedAt: string }
  >();
  for (const snap of listingSnaps) {
    const m = snap.metadata as Record<string, unknown>;
    const itemId = String(m.itemId ?? "");
    const status = String(m.status ?? "");
    if (!itemId || status !== "active") continue;
    const sellerId = String(m.sellerId ?? "");
    const sellerName = String(m.sellerName ?? sellerId);
    const title = String(m.title ?? "");
    const snapCapturedAt = String(m.capturedAt ?? "");
    const existing = newestPerItem.get(itemId);
    if (!existing || snapCapturedAt > existing.capturedAt) {
      newestPerItem.set(itemId, { itemId, sellerId, sellerName, title, capturedAt: snapCapturedAt });
    }
  }

  if (newestPerItem.size === 0) {
    console.log("[worker] Phase 7 quality: no active listings found");
    return { alerts, checkedCount: 0 };
  }

  // ── Find existing quality snapshots per item ────────────────
  const qualitySnaps = config.engine.queryByMetadata({
    type: "quality_snapshot",
    limit: 5000,
  });

  const latestQualityPerItem = new Map<string, string>(); // itemId → capturedAt
  for (const snap of qualitySnaps) {
    const qm = snap.metadata as Record<string, unknown>;
    const itemId = String(qm.itemId ?? "");
    const qCapturedAt = String(qm.capturedAt ?? "");
    if (!itemId) continue;
    const existing = latestQualityPerItem.get(itemId);
    if (!existing || qCapturedAt > existing) {
      latestQualityPerItem.set(itemId, qCapturedAt);
    }
  }

  // ── Prioritise: missing first, then oldest ──────────────────
  const candidates = Array.from(newestPerItem.entries()).map(([itemId, info]) => {
    const lastQuality = latestQualityPerItem.get(itemId);
    return {
      ...info,
      hasQuality: lastQuality !== undefined,
      lastQualityAt: lastQuality ?? "",
    };
  });

  candidates.sort((a, b) => {
    // Missing quality checks first
    if (!a.hasQuality && b.hasQuality) return -1;
    if (a.hasQuality && !b.hasQuality) return 1;
    // Then oldest quality checks first
    return a.lastQualityAt.localeCompare(b.lastQualityAt);
  });

  const batch = candidates.slice(0, QUALITY_CHECK_MAX_PER_CYCLE);

  // ── Check each candidate ────────────────────────────────────
  for (const candidate of batch) {
    try {
      const perfSnapshot = await config.mlcClient.getItemPerformance!(
        candidate.sellerId,
        candidate.itemId,
      );
      const data = perfSnapshot.data as MlcPerformanceSummary;

      // Count pending OPPORTUNITY rules across all buckets
      let pendingOpportunities = 0;
      for (const bucket of data.buckets) {
        for (const variable of bucket.variables) {
          for (const rule of variable.rules) {
            if (rule.mode === "OPPORTUNITY" && rule.status === "PENDING") {
              pendingOpportunities++;
            }
          }
        }
      }

      // ── Persist quality snapshot ────────────────────────────
      const snapshotLabel = `quality_snapshot_${candidate.itemId}_${todayLabel()}`;
      config.engine.getOrCreateNode(snapshotLabel, {
        type: "quality_snapshot",
        itemId: candidate.itemId,
        sellerId: candidate.sellerId,
        score: data.score,
        level: data.level,
        levelWording: data.levelWording,
        pendingOpportunities,
        capturedAt,
      });

      // ── Score drop detection ────────────────────────────────
      const prevQualitySnaps = config.engine.queryByMetadata({
        type: "quality_snapshot",
        itemId: candidate.itemId,
        limit: 2,
      });
      const prevQuality = prevQualitySnaps.length >= 2 ? prevQualitySnaps[1] : null;
      if (prevQuality?.metadata) {
        const prevMeta = prevQuality.metadata as Record<string, unknown>;
        const prevScore = Number(prevMeta.score ?? 0);
        if (prevScore > 0) {
          const drop = prevScore - data.score;
          if (drop > QUALITY_SCORE_DROP_THRESHOLD) {
            alerts.push(
              `📉 ${candidate.itemId} bajó de ${prevScore} a ${data.score} (-${drop} pts). Revisar qué cambió.`,
            );
          }
        }
      }

      // ── Low score alert ─────────────────────────────────────
      if (data.score < QUALITY_LOW_SCORE_THRESHOLD) {
        // Build a summary of the weakest areas
        const weakAreas: string[] = [];
        for (const bucket of data.buckets) {
          for (const variable of bucket.variables) {
            if (variable.score < 50) {
              weakAreas.push(`${variable.title} (${variable.score}%)`);
            }
          }
        }
        const weakSummary =
          weakAreas.length > 0
            ? weakAreas.slice(0, 3).join(", ")
            : "múltiples áreas";
        alerts.push(
          `⚠️ ${candidate.itemId} score ${data.score}/100. ${weakSummary}. Corregilo para no perder exposición.`,
        );
      }
    } catch (err) {
      console.error(
        `[background-ingestion] Quality check failed for ${candidate.itemId}:`,
        err instanceof Error ? err.message : String(err),
      );
      // Continue with next candidate — don't abort the batch
    }
  }

  console.log(
    `[worker] Phase 7 quality: checked ${batch.length} listings, ${alerts.length} alerts`,
  );

  return { alerts, checkedCount: batch.length };
}

// ── Phase 8: Relist opportunities ──────────────────────────────────────

/**
 * Detects relist opportunities by scanning closed listings in Cortex.
 *
 * A MercadoLibre listing can be relisted within 60 days of closing and the
 * new listing inherits visits, questions, and sales history. This phase:
 *
 * 1. Queries Cortex for `listing_snapshot` nodes with status "closed".
 * 2. Estimates the close date from the first "closed" snapshot's `capturedAt`.
 * 3. Checks whether the listing had sales history (via visit/order Cortex data).
 * 4. Persists `relist_opportunity` nodes and generates alerts.
 *
 * Also surfaces paused listings with sales history as potential relist
 * candidates (close → relist path).
 */
async function runRelistChecks(
  config: BackgroundIngestionConfig,
): Promise<{ alerts: string[]; opportunitiesFound: number }> {
  const alerts: string[] = [];
  const capturedAt = new Date().toISOString();
  const now = new Date();
  const relistDeadline = new Date(now);
  relistDeadline.setDate(relistDeadline.getDate() - RELIST_WINDOW_DAYS);
  const expiringAfter = new Date(now);
  expiringAfter.setDate(expiringAfter.getDate() + RELIST_EXPIRING_DAYS);
  // Hard 60-day limit from MercadoLibre
  const hardDeadline = new Date(now);
  hardDeadline.setDate(hardDeadline.getDate() - 60);

  // ── Get all listing snapshots grouped by itemId ─────────────
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
    const m = snap.metadata as Record<string, unknown>;
    const itemId = String(m.itemId ?? "");
    const status = String(m.status ?? "");
    const sellerId = String(m.sellerId ?? "");
    const sellerName = String(m.sellerName ?? sellerId);
    const title = String(m.title ?? "");
    const snapCapturedAt = String(m.capturedAt ?? "");
    if (!itemId) continue;
    let entries = byItem.get(itemId);
    if (!entries) {
      entries = [];
      byItem.set(itemId, entries);
    }
    entries.push({ id: snap.id, itemId, sellerId, sellerName, title, status, capturedAt: snapCapturedAt });
  }

  let opportunitiesFound = 0;

  for (const [itemId, entries] of byItem) {
    // Sort newest first
    entries.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const latest = entries[0]!;
    const currentStatus = latest.status;

    // ── Closed listings ───────────────────────────────────────
    if (currentStatus === "closed") {
      // Find the first snapshot where status became "closed"
      // (scan from newest to oldest, find the earliest contiguous "closed")
      let closeDateStr = latest.capturedAt;
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]!;
        // Check if this snapshot and all newer ones are "closed"
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
      if (closeDate < hardDeadline) continue; // past 60 days, can't relist

      const daysSinceClose = Math.round(
        (now.getTime() - closeDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      // If closed within the 55-day window (buffer before 60-day limit)
      const isWithinWindow = closeDate >= relistDeadline;
      if (!isWithinWindow) continue;

      // ── Check sales history ─────────────────────────────────
      let hadSalesHistory = false;
      let salesCount = 0;

      // Check order snapshots that mention this item
      // (order_snapshot nodes have categoryBreakdown, not per-item — use visit data as proxy)
      const visitNodes = config.engine.queryByMetadata({
        type: "visit_snapshot",
        itemId,
        limit: 1,
      });
      if (visitNodes.length > 0) {
        const vm = visitNodes[0]!.metadata as Record<string, unknown>;
        const totalVisits = Number(vm.totalVisits ?? 0);
        if (totalVisits > 0) hadSalesHistory = true;
      }

      // Also try to find order data via seller-scoped query
      const orderNodes = config.engine.queryByMetadata({
        type: "order_snapshot",
        limit: 100,
      });
      for (const on of orderNodes) {
        const om = on.metadata as Record<string, unknown>;
        const orders = Number(om.totalOrders ?? 0);
        if (orders > 0) {
          salesCount += orders;
          hadSalesHistory = true;
        }
      }

      // ── Suggest relist price ─────────────────────────────────
      // Use the last known price from the listing snapshot
      const lastMeta = entries[0]!;
      const suggestedPrice = Number(
        ((entries.find((e) => e.status === "active") ?? lastMeta) as { price?: unknown })
          .price ?? 0,
      );
      // Actually the snapshot metadata has price in it — parse from latest snapshot
      let lastPrice = 0;
      for (const e of entries) {
        const snapNode = config.engine.queryByMetadata({ type: "listing_snapshot", itemId, limit: 1 });
        if (snapNode.length > 0) {
          const sm = snapNode[0]!.metadata as Record<string, unknown>;
          lastPrice = Number(sm.price ?? 0);
          break;
        }
      }

      // ── Persist relist opportunity node ──────────────────────
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

      // ── Calculate expiry date ───────────────────────────────
      const expiryDate = new Date(closeDate);
      expiryDate.setDate(expiryDate.getDate() + 60);
      const expiryLabel = expiryDate.toISOString().slice(0, 10);
      const daysUntilExpiry = Math.round(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      // ── Alerts ──────────────────────────────────────────────
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

    // ── Paused listings with sales history ────────────────────
    if (currentStatus === "paused") {
      // Check if there's visit or order data suggesting sales history
      const visitNodes = config.engine.queryByMetadata({
        type: "visit_snapshot",
        itemId,
        limit: 2,
      });
      let totalVisits = 0;
      for (const vn of visitNodes) {
        const vm = vn.metadata as Record<string, unknown>;
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

  console.log(
    `[worker] Phase 8 relist: found ${opportunitiesFound} opportunities, ${alerts.length} alerts`,
  );

  return { alerts, opportunitiesFound };
}

// ── Worker ─────────────────────────────────────────────────────────────

/**
 * Start a background ingestion worker that periodically syncs all listings,
 * visits, and orders into Cortex. Detects anomalies, cross-account gaps,
 * seasonal patterns, and pushes proactive alerts to active Telegram chats.
 *
 * Returns a `stop` handle to cancel the interval timer.
 */
export function startBackgroundIngestion(
  config: BackgroundIngestionConfig,
): { stop: () => void } {
  const intervalMs = config.intervalMs ?? 6 * 60 * 60 * 1000; // 6 hours
  const sellerNames = config.sellerNames ?? {};

  // ── DeepSeek client (optional) ──────────────────────────────
  const openai = config.deepseekApiKey
    ? new OpenAI({
        baseURL: "https://api.deepseek.com",
        apiKey: config.deepseekApiKey,
      })
    : undefined;

  const run = async () => {
    const runStart = Date.now();
    let totalListings = 0;
    let totalOrders = 0;
    const alerts: string[] = [];

    // Accumulate all listing data for cross-account comparison
    const sellerListingMap = new Map<string, ReadonlyArray<MlcListingSummary>>();

    // ── Phase 1: Process each seller ─────────────────────────
    for (const sellerId of config.sellerIds) {
      const sellerName = sellerNames[sellerId] ?? sellerId;

      try {
        // ── Listings & visits ──────────────────────────────
        const result = await processSellerListings(
          config,
          sellerId,
          sellerName,
        );
        sellerListingMap.set(sellerId, result.listings);
        totalListings += result.listings.length;
        alerts.push(...result.alerts);

        // ── Orders ─────────────────────────────────────────
        const orderResult = await ingestOrderSnapshots(
          config,
          sellerId,
          sellerName,
        );
        totalOrders += orderResult.orderCount;
        alerts.push(...orderResult.alerts);
      } catch (err) {
        console.error(
          `[background-ingestion] Failed to process seller ${sellerId}:`,
          err instanceof Error ? err.message : String(err),
        );
        // Skip this seller cycle, retry next interval
      }
    }

    // ── Phase 2: Cross-account comparison ────────────────────
    const sellerIds = config.sellerIds;
    if (sellerIds.length >= 2) {
      const firstId = sellerIds[0]!;
      const secondId = sellerIds[1]!;
      const firstName = sellerNames[firstId] ?? firstId;
      const secondName = sellerNames[secondId] ?? secondId;
      const firstListings = sellerListingMap.get(firstId);
      const secondListings = sellerListingMap.get(secondId);

      if (firstListings && secondListings) {
        try {
          const crossAlerts = await runCrossAccountComparison(
            config,
            firstId,
            firstName,
            firstListings,
            secondId,
            secondName,
            secondListings,
          );
          alerts.push(...crossAlerts);
        } catch (err) {
          console.error(
            "[background-ingestion] Cross-account comparison failed:",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    // ── Phase 3: Seasonal pattern detection ──────────────────
    try {
      const seasonalAlerts = await runSeasonalAnalysis(config);
      alerts.push(...seasonalAlerts);
    } catch (err) {
      console.error(
        "[background-ingestion] Seasonal analysis failed:",
        err instanceof Error ? err.message : String(err),
      );
    }

    // ── Phase 4: Pruning ─────────────────────────────────────
    try {
      await pruneSnapshots(config);
    } catch (err) {
      console.error(
        "[background-ingestion] Pruning failed:",
        err instanceof Error ? err.message : String(err),
      );
    }

    // ── Phase 5: Send proactive alerts ───────────────────────
    if (alerts.length > 0) {
      try {
        const chatIds = await config.listActiveChats();
        const alertMessage =
          `🔔 <b>Alerta de catálogo — ${todayLabel()}</b>\n\n` +
          alerts.map((a) => `• ${a}`).join("\n");

        for (const chatId of chatIds) {
          try {
            await config.sendProactiveMessage(chatId, alertMessage);
          } catch (err) {
            console.error(
              `[background-ingestion] Failed to send alert to chat ${chatId}:`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      } catch (err) {
        console.error(
          "[background-ingestion] Failed to list or message active chats:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const duration = Date.now() - runStart;
    console.log(
      `[background-ingestion] Ingestion complete: ${totalListings} listings, ` +
        `${totalOrders} orders, ${alerts.length} alerts (${duration}ms)`,
    );

    // ── Phase 6: DeepSeek daily insights ─────────────────────
    if (openai) {
      try {
        const dailyContext = buildDailyContext(config.engine, sellerNames, alerts);
        const insights = await generateDailyInsights(dailyContext, openai);

        if (insights) {
          const chatIds = await config.listActiveChats();
          const insightMessage =
            `🧠 <b>Análisis DeepSeek del negocio</b>\n\n${insights}`;

          for (const chatId of chatIds) {
            try {
              await config.sendProactiveMessage(chatId, insightMessage);
            } catch (err) {
              console.error(
                `[background-ingestion] Failed to send insights to chat ${chatId}:`,
                err instanceof Error ? err.message : String(err),
              );
            }
          }
        }
      } catch (err) {
        console.error(
          "[background-ingestion] DeepSeek insight phase failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  };

  // Run immediately on start, then on interval
  void run();

  const interval = setInterval(() => {
    void run();
  }, intervalMs);

  return {
    stop: () => {
      clearInterval(interval);
      console.log("[background-ingestion] Stopped");
    },
  };
}
