import OpenAI from "openai";
import { getDeepSeekClient } from "./deepseekClient.js";
import {
  buildDeepSeekChatCompletionRequest,
  resolveDeepSeekRuntimeConfig,
  resolveDeepSeekUserId,
} from "./deepseekRuntime.js";
import type { GraphEngine, OperationalReadModelWriter } from "@msl/memory";
import type {
  MlcApiClient,
  MlcClaimSummary,
  MlcListingSummary,
  MlcMessageSummary,
  MlcOrderSummary,
  MlcPerformanceSummary,
  MlcPriceToWinSummary,
  MlcProductAdsInsights,
  MlcQuestionSummary,
  MlcReputationSummary,
  MlcVisitsDetail,
  MlcVisitsSummary,
} from "@msl/mercadolibre";

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
  /**
   * Optional operational read-model store for dual-writing listing
   * snapshots outside Cortex. When set, every listing snapshot is
   * persisted to the operational store before the Cortex node, and
   * an ingestion checkpoint is saved after the listing loop.
   */
  operationalStore?: OperationalReadModelWriter;
  /** Maximum catalog competition items read per seller cycle. Default: 20. */
  pricingMaxItemsPerCycle?: number;
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

// ── Per-kind freshness TTLs ────────────────────────────────────────────

/**
 * Maximum age (in milliseconds) after which a snapshot is considered stale.
 * Used to gate re-ingestion: a processor skips the fetch if the checkpoint
 * is younger than the kind's TTL.
 */
export const KIND_FRESHNESS_TTL = {
  claim: 60 * 60 * 1000, // 1h — high velocity
  order: 60 * 60 * 1000, // 1h — high velocity
  question: 2 * 60 * 60 * 1000, // 2h — medium velocity
  message: 6 * 60 * 60 * 1000, // 6h — low velocity
  reputation: 6 * 60 * 60 * 1000, // 6h — low velocity
  "product-ads-insights": 24 * 60 * 60 * 1000, // 24h — seller-level ads snapshot
  "creative-snapshot": 24 * 60 * 60 * 1000, // 24h — seller-level creative snapshot
  pricing: 6 * 60 * 60 * 1000, // 6h — catalog competition snapshot
};

/** Default max pages per entity kind. Configurable per kind to guard rate budget. */
export const KIND_DEFAULT_MAX_PAGES = {
  claim: 100,
  order: 100,
  question: 100,
  message: 100,
  reputation: 1, // single snapshot per cycle
  "product-ads-insights": 1, // single seller-level snapshot per cycle
  "creative-snapshot": 1, // single seller-level snapshot per cycle
};

// ── Creative Snapshot type ──────────────────────────────────────────

/**
 * Snapshot of a listing's creative assets — picture count, moderation
 * status, and Phase 7 PICTURES score. Persisted with 24h TTL for the
 * creative-assets daemon to consume.
 */
export type CreativeSnapshotData = {
  itemId: string;
  sellerId: string;
  pictureCount: number;
  variationPictureCount: number;
  hasMainImage: boolean;
  moderationStatus: "none" | "active" | "paused" | "blocked";
  moderationTags: string[];
  moderationWordings: Array<{ kind: string; value: string }>;
  performancePicturesStatus?: "COMPLETED" | "PENDING";
  performancePicturesScore?: number;
  capturedAt: string;
};

/** Default max price-to-win reads per seller cycle. */
export const PRICING_MAX_ITEMS_PER_CYCLE = 20;

// ── Pagination helpers ─────────────────────────────────────────────────

export type PaginationConfig = { maxPages: number; pageSize?: number };

/**
 * Generic pagination helper: fetches all pages up to `maxPages` or until
 * exhaustion (fewer results than `pageSize` returned).
 *
 * @param fetchPage — function that takes an offset and returns `{ total, results }`.
 * @param config   — `maxPages` caps total pages; `pageSize` defaults to 200.
 * @returns accumulated results across all fetched pages.
 */
export async function paginateAll<T>(
  fetchPage: (offset: number) => Promise<{ total: number; results: T[] }>,
  config: PaginationConfig,
): Promise<T[]> {
  const pageSize = config.pageSize ?? 200;
  const allResults: T[] = [];
  let pagesFetched = 0;
  let offset = 0;

  while (pagesFetched < config.maxPages) {
    const { total, results } = await fetchPage(offset);

    if (results.length === 0) break;

    allResults.push(...results);
    pagesFetched++;

    // Stop if we've received all results or the page was incomplete.
    if (allResults.length >= total || results.length < pageSize) break;

    offset += pageSize;
  }

  return allResults;
}

// ── Helpers ────────────────────────────────────────────────────────────

function todayLabel(): string {
  return new Date().toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMlcListingSummary(value: unknown): value is MlcListingSummary {
  return isRecord(value);
}

function isMlcVisitsSummary(value: unknown): value is MlcVisitsSummary {
  return isRecord(value) && typeof value.itemId === "string";
}

function isMlcPerformanceSummary(value: unknown): value is MlcPerformanceSummary {
  return isRecord(value) && typeof value.entityId === "string";
}

function isMlcProductAdsInsights(value: unknown): value is MlcProductAdsInsights {
  return isRecord(value) && value.noMutationExecuted === true && value.performanceMetric === "roas";
}

function normalizeListings(
  data: ReadonlyArray<MlcListingSummary> | MlcListingSummary,
): ReadonlyArray<MlcListingSummary> {
  if (Array.isArray(data)) return data.filter(isMlcListingSummary);
  return [data as MlcListingSummary];
}

function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function defaultProductAdsDateRange(now = new Date()): { dateFrom: string; dateTo: string } {
  const dateTo = now.toISOString().slice(0, 10);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 30);
  const dateFrom = start.toISOString().slice(0, 10);
  return { dateFrom, dateTo };
}

function productAdsEntityId(dateFrom: string | undefined, dateTo: string | undefined): string {
  return `${dateFrom ?? "open"}_${dateTo ?? "open"}`;
}

function productAdsEvidenceId(sellerId: string, entityId: string, capturedAt: string): string {
  return `orm:product-ads-insights:${sellerId}:${entityId}:${capturedAt}`;
}

function isGracefulProductAdsNoDataError(error: unknown): boolean {
  if (!isRecord(error)) {
    const message = String(error).toLowerCase();
    return /unauthori[sz]ed|forbidden|not.?found|no.?advertiser|advertiser|disabled/.test(message);
  }

  const status = Number(error.status ?? error.statusCode ?? error.code);
  if ([401, 403, 404].includes(status)) return true;

  const message = metadataString(error.message).toLowerCase();
  return /unauthori[sz]ed|forbidden|not.?found|no.?advertiser|advertiser|disabled/.test(message);
}

export function isGracefulPricingNoDataError(error: unknown): boolean {
  if (!isRecord(error)) {
    const message = String(error).toLowerCase();
    return /unauthori[sz]ed|forbidden|not.?found|catalog|price.?to.?win|no.?data|unsupported/.test(
      message,
    );
  }

  const status = Number(error.status ?? error.statusCode ?? error.code);
  if ([401, 403, 404].includes(status)) return true;

  const message = metadataString(error.message).toLowerCase();
  return /unauthori[sz]ed|forbidden|not.?found|catalog|price.?to.?win|no.?data|unsupported/.test(
    message,
  );
}

function hasUsablePriceToWinData(
  data: MlcPriceToWinSummary | undefined,
): data is MlcPriceToWinSummary {
  if (!data || !data.itemId) return false;
  return (
    data.priceToWin !== undefined ||
    data.currentPrice !== undefined ||
    data.status !== undefined ||
    data.reason !== undefined ||
    data.catalogProductId !== undefined ||
    data.winner !== undefined ||
    data.boosts.length > 0
  );
}

function categoryBreakdownFromMetadata(
  value: unknown,
): Array<{ categoryId: string; orderCount: number; totalAmount: number }> {
  if (!Array.isArray(value)) return [];
  const breakdown: Array<{ categoryId: string; orderCount: number; totalAmount: number }> = [];
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) continue;
    const record = entry;
    breakdown.push({
      categoryId: metadataString(record.categoryId, "unknown"),
      orderCount: Number(record.orderCount ?? 0),
      totalAmount: Number(record.totalAmount ?? 0),
    });
  }
  return breakdown;
}

function firstVisitsSummary(
  data: MlcVisitsSummary | ReadonlyArray<MlcVisitsSummary>,
): MlcVisitsSummary | undefined {
  const raw: unknown = data;
  if (Array.isArray(raw)) return raw.find(isMlcVisitsSummary);
  return isMlcVisitsSummary(raw) ? raw : undefined;
}

function firstPerformanceSummary(
  data: MlcPerformanceSummary | ReadonlyArray<MlcPerformanceSummary>,
): MlcPerformanceSummary | undefined {
  const raw: unknown = data;
  if (Array.isArray(raw)) return raw.find(isMlcPerformanceSummary);
  return isMlcPerformanceSummary(raw) ? raw : undefined;
}

function firstProductAdsInsights(
  data: MlcProductAdsInsights | ReadonlyArray<MlcProductAdsInsights>,
): MlcProductAdsInsights | undefined {
  const raw: unknown = data;
  if (Array.isArray(raw)) return raw.find(isMlcProductAdsInsights);
  return isMlcProductAdsInsights(raw) ? raw : undefined;
}

function firstPriceToWinSummary(
  data: MlcPriceToWinSummary | ReadonlyArray<MlcPriceToWinSummary>,
): MlcPriceToWinSummary | undefined {
  const raw: unknown = data;
  if (Array.isArray(raw)) return raw.find(isRecord) as MlcPriceToWinSummary | undefined;
  return isRecord(raw) ? (raw as MlcPriceToWinSummary) : undefined;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function selectRotatedPricingListings(
  sellerId: string,
  listings: ReadonlyArray<MlcListingSummary>,
  maxItems: number,
  checkpointCapturedAt?: string,
): ReadonlyArray<MlcListingSummary> {
  if (maxItems <= 0) return [];

  const candidates = listings
    .filter((listing) => typeof listing.id === "string" && listing.id.length > 0)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  if (candidates.length <= maxItems) return candidates;

  const seed = `${sellerId}:${checkpointCapturedAt ?? "initial"}`;
  const start = hashString(seed) % candidates.length;

  return Array.from(
    { length: maxItems },
    (_, index) => candidates[(start + index) % candidates.length]!,
  );
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

// ── Core: process one seller's listings and visits ─────────────────────

type SellerProcessResult = {
  listings: ReadonlyArray<MlcListingSummary>;
  alerts: string[];
};

export async function processSellerListings(
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

    // ── Operational store dual-write ─────────────────────────
    if (config.operationalStore) {
      await config.operationalStore.upsertSnapshot({
        sellerId,
        kind: "listing",
        source: "mercadolibre-api",
        data: listing,
        completeness: "complete",
        freshness: {
          source: "mercadolibre-api",
          signalKind: "listing",
          risk: "medium",
          capturedAt: new Date(capturedAt),
          maxAgeMs: 60 * 60 * 1000,
          status: "fresh",
        },
        confidence: "high",
        evidence: {
          evidenceId: `orm:listing:${sellerId}:${itemId}:${capturedAt}`,
          snapshotKind: "listing",
          sellerId,
          entityId: itemId,
          capturedAt: new Date(capturedAt),
          freshnessStatus: "fresh",
          completeness: "complete",
          source: "operational-read-model",
        },
      });
    }

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
    const prevSnapshot = previousSnapshots.length >= 2 ? previousSnapshots[1] : null;

    if (prevSnapshot?.metadata) {
      const prevMeta = prevSnapshot.metadata;

      // ── Detect paused with sales history ──────────────────
      const newStatus = listing.status ?? "unknown";
      const prevStatus = metadataString(prevMeta.status, "unknown");
      const salesCount = Number(prevMeta.salesCount ?? 0);

      if (newStatus === "paused" && prevStatus !== "paused" && salesCount > 0) {
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
        const visitsSnapshot = await config.mlcClient.getItemVisits(sellerId, itemId);
        const visitsSummary = firstVisitsSummary(visitsSnapshot.data);

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
              .map((n) => Number(n.metadata.totalVisits ?? 0))
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
                const pct = Math.round(((first - last) / last) * 100);
                alerts.push(
                  `📈 ${itemId} (${sellerName}) lleva ${TREND_WINDOW} períodos subiendo (+${pct}% total) — tendencia alcista confirmada`,
                );
              } else if (trendingDown) {
                const pct = Math.round(((last - first) / last) * 100);
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

          const prevVisit = previousVisits.length >= 2 ? previousVisits[1] : null;

          if (prevVisit?.metadata) {
            const prevVisitMeta = prevVisit.metadata;
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

  // ── Operational store checkpoint ─────────────────────────
  if (config.operationalStore) {
    await config.operationalStore.upsertCheckpoint(sellerId, "listing", new Date().toISOString());
  }

  return { listings, alerts };
}

const PAGE_SIZE = 50;

// ── Claims processor ────────────────────────────────────────────────

async function processSellerClaims(
  config: BackgroundIngestionConfig,
  sellerId: string,
  sellerName: string,
): Promise<{ alerts: string[]; claimCount: number }> {
  const alerts: string[] = [];

  if (typeof config.mlcClient.searchClaims !== "function") return { alerts, claimCount: 0 };

  try {
    const claims = await paginateAll<MlcClaimSummary>(
      (offset) =>
        config.mlcClient.searchClaims!(sellerId, { limit: PAGE_SIZE, offset }).then((snap) => ({
          total: snap.data.paging.total,
          results: [...snap.data.results],
        })),
      { maxPages: KIND_DEFAULT_MAX_PAGES.claim, pageSize: PAGE_SIZE },
    );

    for (const claim of claims) {
      const itemId = claim.id;
      if (!itemId) continue;
      const capturedAt = new Date().toISOString();
      const evidenceId = `orm:claim:${sellerId}:${itemId}:${capturedAt}`;

      if (config.operationalStore) {
        await config.operationalStore.upsertSnapshot({
          sellerId,
          kind: "claim",
          source: "mercadolibre-api",
          data: claim,
          completeness: "complete",
          freshness: {
            source: "mercadolibre-api",
            signalKind: "claim",
            risk: "critical",
            capturedAt: new Date(capturedAt),
            maxAgeMs: KIND_FRESHNESS_TTL.claim,
            status: "fresh",
          },
          confidence: "high",
          evidence: {
            evidenceId,
            snapshotKind: "claim",
            sellerId,
            entityId: itemId,
            capturedAt: new Date(capturedAt),
            freshnessStatus: "fresh",
            completeness: "complete",
            source: "operational-read-model",
          },
        });
      }

      // Cortex node
      const label = `claim_snapshot_${itemId}_${todayLabel()}`;
      config.engine.getOrCreateNode(label, {
        type: "claim_snapshot",
        itemId,
        sellerId,
        sellerName,
        status: claim.status ?? "",
        stage: claim.stage ?? "",
        type_: claim.type ?? "",
        dateCreated: claim.dateCreated ?? "",
        capturedAt,
      });
    }

    if (config.operationalStore) {
      await config.operationalStore.upsertCheckpoint(sellerId, "claim", new Date().toISOString());
    }

    return { alerts, claimCount: claims.length };
  } catch (err) {
    console.error(
      `[background-ingestion] Failed to process claims for seller ${sellerId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { alerts, claimCount: 0 };
  }
}

// ── Questions processor ─────────────────────────────────────────────

async function processSellerQuestions(
  config: BackgroundIngestionConfig,
  sellerId: string,
  sellerName: string,
): Promise<{ alerts: string[]; questionCount: number }> {
  const alerts: string[] = [];

  if (typeof config.mlcClient.getQuestions !== "function") return { alerts, questionCount: 0 };

  try {
    const questions = await paginateAll<MlcQuestionSummary>(
      (offset) =>
        config.mlcClient.getQuestions!(sellerId, { limit: PAGE_SIZE, offset }).then((snap) => ({
          total: snap.data.paging.total,
          results: [...snap.data.results],
        })),
      { maxPages: KIND_DEFAULT_MAX_PAGES.question, pageSize: PAGE_SIZE },
    );

    for (const question of questions) {
      const itemId = question.id;
      if (!itemId) continue;
      const capturedAt = new Date().toISOString();
      const evidenceId = `orm:question:${sellerId}:${itemId}:${capturedAt}`;

      if (config.operationalStore) {
        await config.operationalStore.upsertSnapshot({
          sellerId,
          kind: "question",
          source: "mercadolibre-api",
          data: question,
          completeness: "complete",
          freshness: {
            source: "mercadolibre-api",
            signalKind: "question",
            risk: "medium",
            capturedAt: new Date(capturedAt),
            maxAgeMs: KIND_FRESHNESS_TTL.question,
            status: "fresh",
          },
          confidence: "high",
          evidence: {
            evidenceId,
            snapshotKind: "question",
            sellerId,
            entityId: itemId,
            capturedAt: new Date(capturedAt),
            freshnessStatus: "fresh",
            completeness: "complete",
            source: "operational-read-model",
          },
        });
      }

      const label = `question_snapshot_${itemId}_${todayLabel()}`;
      config.engine.getOrCreateNode(label, {
        type: "question_snapshot",
        itemId,
        sellerId,
        sellerName,
        text: question.text ?? "",
        answerText: question.answerText ?? "",
        status: question.status ?? "",
        dateCreated: question.dateCreated ?? "",
        capturedAt,
      });
    }

    if (config.operationalStore) {
      await config.operationalStore.upsertCheckpoint(
        sellerId,
        "question",
        new Date().toISOString(),
      );
    }

    return { alerts, questionCount: questions.length };
  } catch (err) {
    console.error(
      `[background-ingestion] Failed to process questions for seller ${sellerId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { alerts, questionCount: 0 };
  }
}

// ── Messages processor ──────────────────────────────────────────────

async function processSellerMessages(
  config: BackgroundIngestionConfig,
  sellerId: string,
  sellerName: string,
): Promise<{ alerts: string[]; messageCount: number }> {
  const alerts: string[] = [];

  try {
    const messages = await paginateAll<MlcMessageSummary>(
      (offset) =>
        config.mlcClient.getMessages(sellerId, { limit: PAGE_SIZE, offset }).then((snap) => ({
          total: snap.paging?.total ?? 0,
          results: Array.isArray(snap.data)
            ? (snap.data as unknown as MlcMessageSummary[])
            : [snap.data as MlcMessageSummary],
        })),
      { maxPages: KIND_DEFAULT_MAX_PAGES.message, pageSize: PAGE_SIZE },
    );

    for (const message of messages) {
      const itemId = message.id;
      if (!itemId) continue;
      const capturedAt = new Date().toISOString();
      const evidenceId = `orm:message:${sellerId}:${itemId}:${capturedAt}`;

      if (config.operationalStore) {
        await config.operationalStore.upsertSnapshot({
          sellerId,
          kind: "message",
          source: "mercadolibre-api",
          data: {
            id: message.id,
            role: message.fromUserId ? "buyer" : "unknown",
            date: message.createdAt,
            snippet: (message.subject ?? "").slice(0, 500),
            status: message.status,
          },
          completeness: "complete",
          freshness: {
            source: "mercadolibre-api",
            signalKind: "message",
            risk: "critical",
            capturedAt: new Date(capturedAt),
            maxAgeMs: KIND_FRESHNESS_TTL.message,
            status: "fresh",
          },
          confidence: "high",
          evidence: {
            evidenceId,
            snapshotKind: "message",
            sellerId,
            entityId: itemId,
            capturedAt: new Date(capturedAt),
            freshnessStatus: "fresh",
            completeness: "complete",
            source: "operational-read-model",
          },
        });
      }

      const label = `message_snapshot_${itemId}_${todayLabel()}`;
      config.engine.getOrCreateNode(label, {
        type: "message_snapshot",
        itemId,
        sellerId,
        sellerName,
        subject: message.subject ?? "",
        status: message.status ?? "",
        fromUserId: message.fromUserId ?? "",
        createdAt: message.createdAt ?? "",
        capturedAt,
      });
    }

    if (config.operationalStore) {
      await config.operationalStore.upsertCheckpoint(sellerId, "message", new Date().toISOString());
    }

    return { alerts, messageCount: messages.length };
  } catch (err) {
    console.error(
      `[background-ingestion] Failed to process messages for seller ${sellerId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { alerts, messageCount: 0 };
  }
}

// ── Reputation processor ────────────────────────────────────────────

async function processSellerReputation(
  config: BackgroundIngestionConfig,
  sellerId: string,
  sellerName: string,
): Promise<{ alerts: string[] }> {
  const alerts: string[] = [];

  try {
    const snap = await config.mlcClient.getReputation(sellerId);
    const reputation = snap.data as MlcReputationSummary;
    const capturedAt = new Date().toISOString();
    const period = reputation.metricPeriodDays ?? 60;
    const periodLabel = `${period}d`;
    const evidenceId = `orm:reputation:${sellerId}:${periodLabel}:${capturedAt}`;

    if (config.operationalStore) {
      await config.operationalStore.upsertSnapshot({
        sellerId,
        kind: "reputation",
        source: "mercadolibre-api",
        data: reputation,
        completeness: "complete",
        freshness: {
          source: "mercadolibre-api",
          signalKind: "reputation",
          risk: "critical",
          capturedAt: new Date(capturedAt),
          maxAgeMs: KIND_FRESHNESS_TTL.reputation,
          status: "fresh",
        },
        confidence: "high",
        evidence: {
          evidenceId,
          snapshotKind: "reputation",
          sellerId,
          entityId: periodLabel,
          capturedAt: new Date(capturedAt),
          freshnessStatus: "fresh",
          completeness: "complete",
          source: "operational-read-model",
        },
      });
    }

    const label = `reputation_snapshot_${sellerId}_${todayLabel()}`;
    config.engine.getOrCreateNode(label, {
      type: "reputation_snapshot",
      sellerId,
      sellerName,
      level: reputation.level ?? "",
      powerSellerStatus: reputation.powerSellerStatus ?? "",
      completedTransactions: reputation.completedTransactions ?? 0,
      totalTransactions: reputation.totalTransactions ?? 0,
      claimsRate: reputation.claimsRate ?? 0,
      metricPeriodDays: period,
      capturedAt,
    });

    if (config.operationalStore) {
      await config.operationalStore.upsertCheckpoint(
        sellerId,
        "reputation",
        new Date().toISOString(),
      );
    }

    return { alerts };
  } catch (err) {
    console.error(
      `[background-ingestion] Failed to process reputation for seller ${sellerId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { alerts };
  }
}

export async function processSellerProductAds(
  config: BackgroundIngestionConfig,
  sellerId: string,
): Promise<{ persisted: boolean }> {
  if (!config.operationalStore || typeof config.mlcClient.getProductAdsInsights !== "function") {
    return { persisted: false };
  }

  try {
    const defaultRange = defaultProductAdsDateRange();
    const snapshot = await config.mlcClient.getProductAdsInsights(sellerId, {
      ...defaultRange,
      limit: 50,
      offset: 0,
    });

    const data = firstProductAdsInsights(snapshot.data);
    if (!data) return { persisted: false };
    const dateFrom = data.dateFrom ?? defaultRange.dateFrom;
    const dateTo = data.dateTo ?? defaultRange.dateTo;
    const entityId = productAdsEntityId(dateFrom, dateTo);
    const capturedAt = new Date().toISOString();
    const capturedAtDate = new Date(capturedAt);

    await config.operationalStore.upsertSnapshot({
      sellerId,
      kind: "product-ads-insights",
      source: "mercadolibre-api",
      data: {
        ...data,
        noMutationExecuted: true,
        performanceMetric: "roas",
      },
      completeness: snapshot.completeness,
      freshness: {
        ...snapshot.freshness,
        signalKind: "product-ads-insights",
        capturedAt: capturedAtDate,
        maxAgeMs: KIND_FRESHNESS_TTL["product-ads-insights"],
        status: snapshot.freshness.status,
      },
      confidence: snapshot.confidence,
      evidence: {
        evidenceId: productAdsEvidenceId(sellerId, entityId, capturedAt),
        snapshotKind: "product-ads-insights",
        sellerId,
        entityId,
        capturedAt: capturedAtDate,
        freshnessStatus: snapshot.freshness.status,
        completeness: snapshot.completeness,
        source: "operational-read-model",
      },
    });

    await config.operationalStore.upsertCheckpoint(sellerId, "product-ads-insights", capturedAt);

    return { persisted: true };
  } catch (err) {
    if (isGracefulProductAdsNoDataError(err)) {
      return { persisted: false };
    }
    throw err;
  }
}

export async function processSellerCreativeAssets(
  config: BackgroundIngestionConfig,
  sellerId: string,
): Promise<{ persisted: number }> {
  if (!config.operationalStore) return { persisted: 0 };

  const BATCH_SIZE = 50;

  try {
    // ── Read listing snapshots from ORM ──────────────────────────
    const listingSnaps = await config.operationalStore.searchSnapshots<Record<string, unknown>>({
      sellerId,
      kind: "listing_snapshot",
      limit: BATCH_SIZE,
    });

    if (listingSnaps.length === 0) return { persisted: 0 };

    let persisted = 0;

    for (const snap of listingSnaps) {
      const itemId = snap.itemId;
      if (!itemId) continue;

      const data = snap.data;
      const pictures = (data.pictures as Array<unknown> | undefined) ?? [];
      const pictureCount = Array.isArray(pictures) ? pictures.length : 0;

      // Detect variations and their picture_ids (common ML API pattern)
      const variations = (data.variations as Array<Record<string, unknown>> | undefined) ?? [];
      let variationPictureCount = 0;
      for (const v of variations) {
        const ids = (v.picture_ids as Array<unknown> | undefined) ?? [];
        variationPictureCount += Array.isArray(ids) ? ids.length : 0;
      }

      const hasMainImage = pictureCount > 0;

      // ── Moderation status check ────────────────────────────────
      let moderationStatus: CreativeSnapshotData["moderationStatus"] = "none";
      const moderationTags: string[] = [];
      const moderationWordings: Array<{ kind: string; value: string }> = [];

      if (typeof config.mlcClient.getModerationStatus === "function") {
        try {
          const modSnap = await config.mlcClient.getModerationStatus(sellerId, itemId);
          const modData = modSnap.data;

          if (modData.blocked) {
            moderationStatus = "blocked";
          } else if (data.status === "active") {
            moderationStatus = "active";
          } else if (data.status === "paused") {
            moderationStatus = "paused";
          }

          if (modData.wordings) {
            for (const w of modData.wordings) {
              moderationTags.push(w.kind);
              moderationWordings.push({ kind: w.kind, value: w.value });
            }
          }
        } catch {
          // 429 backoff or other error — skip moderation data
          moderationStatus = data.status === "active" ? "active" : "none";
        }
      }

      // ── PICTURES score extraction from Cortex quality snapshots ─
      let performancePicturesStatus: "COMPLETED" | "PENDING" | undefined;
      let performancePicturesScore: number | undefined;

      try {
        const qualitySnaps = config.engine.queryByMetadata({
          type: "quality_snapshot",
          itemId,
          limit: 1,
        });

        const qualitySnap = qualitySnaps[0];
        if (qualitySnap?.metadata) {
          const meta = qualitySnap.metadata as Record<string, unknown>;
          const score = Number(meta.score ?? 0);

          // Check for PICTURES bucket in the performance data
          // The quality snapshot stores the raw MlcPerformanceSummary
          // which has buckets with variables like "PICTURES"
          const buckets = (meta.buckets ?? meta.variables) as
            | Array<Record<string, unknown>>
            | undefined;

          if (Array.isArray(buckets)) {
            for (const bucket of buckets) {
              const title = bucket.title ?? "";
              if (typeof title === "string" && title.toUpperCase().includes("PICTURE")) {
                const tmpStatus = bucket.status as string | undefined;
                if (tmpStatus === "COMPLETED" || tmpStatus === "PENDING") {
                  performancePicturesStatus = tmpStatus;
                  performancePicturesScore = Number(bucket.score ?? score);
                }
                break;
              }
              // Also check variables within buckets
              const variables = bucket.variables as Array<Record<string, unknown>> | undefined;
              if (Array.isArray(variables)) {
                for (const v of variables) {
                  const vTitle = v.title ?? "";
                  if (typeof vTitle === "string" && vTitle.toUpperCase().includes("PICTURE")) {
                    const tmpStatus = v.status as string | undefined;
                    if (tmpStatus === "COMPLETED" || tmpStatus === "PENDING") {
                      performancePicturesStatus = tmpStatus;
                      performancePicturesScore = Number(v.score ?? score);
                    }
                    break;
                  }
                }
              }
            }
          }
        }
      } catch {
        // Missing or unavailable quality data — skip silently
      }

      // ── Upsert creative-snapshot to ORM ─────────────────────────
      const capturedAt = new Date().toISOString();
      const capturedAtDate = new Date(capturedAt);
      const creativeData: CreativeSnapshotData = {
        itemId,
        sellerId,
        pictureCount,
        variationPictureCount,
        hasMainImage,
        moderationStatus,
        moderationTags,
        moderationWordings,
        performancePicturesStatus,
        performancePicturesScore,
        capturedAt,
      };

      await config.operationalStore.upsertSnapshot({
        sellerId,
        kind: "creative-snapshot",
        source: "mercadolibre-api",
        data: creativeData,
        completeness: "complete",
        freshness: {
          source: "mercadolibre-api",
          signalKind: "creative-snapshot",
          risk: "medium",
          capturedAt: capturedAtDate,
          maxAgeMs: KIND_FRESHNESS_TTL["creative-snapshot"],
          status: "fresh",
        },
        confidence: "high",
        evidence: {
          evidenceId: `orm:creative-snapshot:${sellerId}:${itemId}:${capturedAt}`,
          snapshotKind: "creative-snapshot",
          sellerId,
          entityId: itemId,
          capturedAt: capturedAtDate,
          freshnessStatus: "fresh",
          completeness: "complete",
          source: "operational-read-model",
        },
      });

      persisted++;
    }

    await config.operationalStore.upsertCheckpoint(sellerId, "creative-snapshot", new Date().toISOString());

    return { persisted };
  } catch (err) {
    console.error(
      `[background-ingestion] Failed to process creative assets for seller ${sellerId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { persisted: 0 };
  }
}

export async function processSellerPricing(
  config: BackgroundIngestionConfig,
  sellerId: string,
  listings: ReadonlyArray<MlcListingSummary>,
): Promise<{ persisted: number; skipped: number }> {
  if (!config.operationalStore || typeof config.mlcClient.getItemPriceToWin !== "function") {
    return { persisted: 0, skipped: 0 };
  }

  const maxItems = config.pricingMaxItemsPerCycle ?? PRICING_MAX_ITEMS_PER_CYCLE;
  const checkpoint = await config.operationalStore.getCheckpoint(sellerId, "pricing");
  const batch = selectRotatedPricingListings(
    sellerId,
    listings,
    maxItems,
    checkpoint?.last_captured_at,
  );
  let persisted = 0;
  let skipped = 0;

  for (const listing of batch) {
    const itemId = listing.id;
    let snapshot: Awaited<ReturnType<NonNullable<MlcApiClient["getItemPriceToWin"]>>>;

    try {
      snapshot = await config.mlcClient.getItemPriceToWin(sellerId, itemId);
    } catch (err) {
      if (isGracefulPricingNoDataError(err)) {
        skipped++;
        continue;
      }
      skipped++;
      continue;
    }

    const data = firstPriceToWinSummary(snapshot.data);
    if (!hasUsablePriceToWinData(data)) {
      skipped++;
      continue;
    }

    const capturedAt = new Date().toISOString();
    const capturedAtDate = new Date(capturedAt);
    const completeness = snapshot.completeness;

    await config.operationalStore.upsertSnapshot({
      sellerId,
      kind: "pricing",
      source: "mercadolibre-api",
      data: {
        ...data,
        noMutationExecuted: true,
      },
      completeness,
      freshness: {
        ...snapshot.freshness,
        signalKind: "pricing",
        capturedAt: capturedAtDate,
        maxAgeMs: KIND_FRESHNESS_TTL.pricing,
        status: snapshot.freshness.status,
      },
      confidence: snapshot.confidence,
      evidence: {
        evidenceId: `orm:pricing:${sellerId}:${itemId}:${capturedAt}`,
        snapshotKind: "pricing",
        sellerId,
        entityId: itemId,
        capturedAt: capturedAtDate,
        freshnessStatus: snapshot.freshness.status,
        completeness,
        source: "operational-read-model",
      },
    });
    persisted++;
  }

  await config.operationalStore.upsertCheckpoint(sellerId, "pricing", new Date().toISOString());

  return { persisted, skipped };
}

// ── Orders processor (refactored from ingestOrderSnapshots) ────────

async function processSellerOrders(
  config: BackgroundIngestionConfig,
  sellerId: string,
  sellerName: string,
): Promise<{ alerts: string[]; orderCount: number; totalAmount: number }> {
  const alerts: string[] = [];

  try {
    const orders = await paginateAll<MlcOrderSummary>(
      (offset) =>
        config.mlcClient.getOrders(sellerId, { limit: PAGE_SIZE, offset }).then((snap) => ({
          total: snap.paging?.total ?? 0,
          results: Array.isArray(snap.data)
            ? (snap.data as unknown as MlcOrderSummary[])
            : [snap.data as MlcOrderSummary],
        })),
      { maxPages: KIND_DEFAULT_MAX_PAGES.order, pageSize: PAGE_SIZE },
    );

    if (orders.length === 0) {
      return { alerts, orderCount: 0, totalAmount: 0 };
    }

    const capturedAt = new Date().toISOString();
    let totalAmount = 0;

    // Build category breakdown by cross-referencing with Cortex listings
    const categoryMap = new Map<string, { orderCount: number; totalAmount: number }>();

    for (const order of orders) {
      const amount = Number(order.totalAmount ?? 0);
      totalAmount += amount;

      const listingSnaps = config.engine.queryByMetadata({
        type: "listing_snapshot",
        sellerId,
        limit: 1,
      });

      let catId = "unknown";
      const firstSnap = listingSnaps[0];
      if (firstSnap) {
        catId = metadataString(firstSnap.metadata.categoryId, "unknown");
      }

      const existing = categoryMap.get(catId);
      if (existing) {
        existing.orderCount++;
        existing.totalAmount += amount;
      } else {
        categoryMap.set(catId, { orderCount: 1, totalAmount: amount });
      }

      // ── Operational store dual-write per order ─────────────
      if (config.operationalStore) {
        const evidenceId = `orm:order:${sellerId}:${order.id}:${capturedAt}`;
        await config.operationalStore.upsertSnapshot({
          sellerId,
          kind: "order",
          source: "mercadolibre-api",
          data: order,
          completeness: "complete",
          freshness: {
            source: "mercadolibre-api",
            signalKind: "order",
            risk: "critical",
            capturedAt: new Date(capturedAt),
            maxAgeMs: KIND_FRESHNESS_TTL.order,
            status: "fresh",
          },
          confidence: "high",
          evidence: {
            evidenceId,
            snapshotKind: "order",
            sellerId,
            entityId: order.id,
            capturedAt: new Date(capturedAt),
            freshnessStatus: "fresh",
            completeness: "complete",
            source: "operational-read-model",
          },
        });
      }
    }

    const categoryBreakdown = Array.from(categoryMap.entries()).map(([categoryId, data]) => ({
      categoryId,
      orderCount: data.orderCount,
      totalAmount: data.totalAmount,
    }));

    // ── Cortex aggregated order snapshot (preserved from existing path) ─
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

    if (config.operationalStore) {
      await config.operationalStore.upsertCheckpoint(sellerId, "order", new Date().toISOString());
    }

    return { alerts, orderCount: orders.length, totalAmount };
  } catch (err) {
    console.error(
      `[background-ingestion] Failed to process orders for seller ${sellerId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { alerts, orderCount: 0, totalAmount: 0 };
  }
}

// ── Cross-account comparison ───────────────────────────────────────────

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
      usedMaustianIds.add(bestMatch.maustianItem.id);
    }
  }

  return matches;
}

function runCrossAccountComparison(
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

  // Process matches
  for (const match of matches) {
    const pId = match.plasticovItem.id;
    const mId = match.maustianItem.id;
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

    const pTotal = pVisitsNode ? Number(pVisitsNode.metadata.totalVisits ?? 0) : 0;
    const mTotal = mVisitsNode ? Number(mVisitsNode.metadata.totalVisits ?? 0) : 0;

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

function runSeasonalAnalysis(config: BackgroundIngestionConfig): string[] {
  const alerts: string[] = [];
  const now = new Date();

  // Check if we should run (every 7 days)
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

        // Proactive alert 30 days before peak
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

  // Update seasonal marker
  config.engine.getOrCreateNode("seasonal_marker", {
    type: "seasonal_marker",
    lastRun: now.toISOString(),
  });

  return alerts;
}

// ── Pruning ────────────────────────────────────────────────────────────

function pruneSnapshots(config: BackgroundIngestionConfig): void {
  const db = config.engine.db;

  // Prune listing_snapshot per item (keep last 30)
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

  // Prune order_snapshot (keep last 90 total)
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
  userId = resolveDeepSeekUserId({ laneId: "ceo", agentId: "background-ingestion" }),
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
    const request = buildDeepSeekChatCompletionRequest({
      model: resolveDeepSeekRuntimeConfig().model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      ...(userId ? { userId, user: userId } : {}),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const completion = await openai.chat.completions.create(request as any);

    return completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    console.error(
      "[background-ingestion] DeepSeek insight generation failed:",
      err instanceof Error ? err.message : String(err),
    );
    return "";
  }
}

export function resolveDailyInsightsDeepSeekUserId(sellerIds: ReadonlyArray<string>): string {
  return resolveDeepSeekUserId({
    laneId: "market-catalog",
    sellerId: sellerIds.join("-"),
    agentId: "background-ingestion",
  });
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
    const status = metadataString(m.status, "unknown");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const cat = metadataString(m.categoryId);
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
    const itemId = metadataString(m.itemId, "unknown");
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

    const breakdown = categoryBreakdownFromMetadata(m.categoryBreakdown);
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
    const s = metadataString(n.metadata.status, "unknown");
    pByStatus[s] = (pByStatus[s] ?? 0) + 1;
  }
  const mByStatus: Record<string, number> = {};
  for (const n of maustianListings) {
    const s = metadataString(n.metadata.status, "unknown");
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
    const m = snap.metadata;
    const itemId = metadataString(m.itemId);
    const status = metadataString(m.status);
    if (!itemId || status !== "active") continue;
    const sellerId = metadataString(m.sellerId);
    const sellerName = metadataString(m.sellerName, sellerId);
    const title = metadataString(m.title);
    const snapCapturedAt = metadataString(m.capturedAt);
    const existing = newestPerItem.get(itemId);
    if (!existing || snapCapturedAt > existing.capturedAt) {
      newestPerItem.set(itemId, {
        itemId,
        sellerId,
        sellerName,
        title,
        capturedAt: snapCapturedAt,
      });
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
    const qm = snap.metadata;
    const itemId = metadataString(qm.itemId);
    const qCapturedAt = metadataString(qm.capturedAt);
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
      const perfSnapshot = await config.mlcClient.getItemPerformance(
        candidate.sellerId,
        candidate.itemId,
      );
      const data = firstPerformanceSummary(perfSnapshot.data);
      if (!data) continue;

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
        const prevMeta = prevQuality.metadata;
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
          weakAreas.length > 0 ? weakAreas.slice(0, 3).join(", ") : "múltiples áreas";
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
function runRelistChecks(config: BackgroundIngestionConfig): {
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
        const vm = visitNodes[0]!.metadata;
        const totalVisits = Number(vm.totalVisits ?? 0);
        if (totalVisits > 0) hadSalesHistory = true;
      }

      // Also try to find order data via seller-scoped query
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

      // ── Suggest relist price ─────────────────────────────────
      // Use the last known price from the listing snapshot
      // Actually the snapshot metadata has price in it — parse from latest snapshot
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

  console.log(
    `[worker] Phase 8 relist: found ${opportunitiesFound} opportunities, ${alerts.length} alerts`,
  );

  return { alerts, opportunitiesFound };
}

// ── Freshness skip-gate helper ────────────────────────────────────────

/**
 * Skip a processor if a recent checkpoint exists and is within the
 * kind's TTL.  Falls back to `fallback` (matching the processor's
 * return type) when the checkpoint is fresh.
 */
async function withFreshnessSkip<T>(
  config: BackgroundIngestionConfig,
  sellerId: string,
  kind: keyof typeof KIND_FRESHNESS_TTL,
  processor: () => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!config.operationalStore) return processor();
  try {
    const checkpoint = await config.operationalStore.getCheckpoint(sellerId, kind);
    if (checkpoint) {
      const age = Date.now() - new Date(checkpoint.last_captured_at).getTime();
      if (age < KIND_FRESHNESS_TTL[kind]) {
        console.log(
          `[background-ingestion] Skipping ${kind} for ${sellerId} — checkpoint is fresh (${Math.round(age / 1000)}s old, TTL: ${Math.round(KIND_FRESHNESS_TTL[kind] / 1000)}s)`,
        );
        return fallback;
      }
    }
  } catch {
    // proceed if checkpoint check fails
  }
  return processor();
}

// ── Worker ─────────────────────────────────────────────────────────────

/**
 * Start a background ingestion worker that periodically syncs all listings,
 * visits, and orders into Cortex. Detects anomalies, cross-account gaps,
 * seasonal patterns, and pushes proactive alerts to active Telegram chats.
 *
 * Returns a `stop` handle to cancel the interval timer.
 */
export function startBackgroundIngestion(config: BackgroundIngestionConfig): { stop: () => void } {
  const intervalMs = config.intervalMs ?? 6 * 60 * 60 * 1000; // 6 hours
  const sellerNames = config.sellerNames ?? {};

  // ── DeepSeek client (optional) ──────────────────────────────
  const deepSeekRuntime = resolveDeepSeekRuntimeConfig({
    ...process.env,
    DEEPSEEK_API_KEY: config.deepseekApiKey,
  });
  const openai = deepSeekRuntime.apiKey
    ? getDeepSeekClient(deepSeekRuntime.apiKey, deepSeekRuntime.baseURL)
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
        // ── Listings & visits (must run first — feeds pricing and cross-account) ──
        const result = await processSellerListings(config, sellerId, sellerName);
        sellerListingMap.set(sellerId, result.listings);
        totalListings += result.listings.length;
        alerts.push(...result.alerts);

        // ── Parallel independent phases (each wrapped with freshness gate) ──
        const [, orderResult, claimsResult, questionsResult, messagesResult, reputationResult] = await Promise.all([
          withFreshnessSkip(config, sellerId, "pricing",
            () => processSellerPricing(config, sellerId, result.listings).then(() => ({ alerts: [] as string[] })),
            { alerts: [] as string[] },
          ),
          withFreshnessSkip(config, sellerId, "order",
            () => processSellerOrders(config, sellerId, sellerName),
            { alerts: [], orderCount: 0, totalAmount: 0 },
          ),
          withFreshnessSkip(config, sellerId, "claim",
            () => processSellerClaims(config, sellerId, sellerName),
            { alerts: [], claimCount: 0 },
          ),
          withFreshnessSkip(config, sellerId, "question",
            () => processSellerQuestions(config, sellerId, sellerName),
            { alerts: [], questionCount: 0 },
          ),
          withFreshnessSkip(config, sellerId, "message",
            () => processSellerMessages(config, sellerId, sellerName),
            { alerts: [], messageCount: 0 },
          ),
          withFreshnessSkip(config, sellerId, "reputation",
            () => processSellerReputation(config, sellerId, sellerName),
            { alerts: [] },
          ),
        ]);

        totalOrders += orderResult.orderCount;
        alerts.push(...orderResult.alerts);
        alerts.push(...claimsResult.alerts);
        alerts.push(...questionsResult.alerts);
        alerts.push(...messagesResult.alerts);
        alerts.push(...reputationResult.alerts);

        // ── Product Ads + Creative Assets (freshness-gated) ──
        await Promise.all([
          withFreshnessSkip(config, sellerId, "product-ads-insights",
            () => processSellerProductAds(config, sellerId),
            { persisted: false },
          ),
          withFreshnessSkip(config, sellerId, "creative-snapshot",
            () => processSellerCreativeAssets(config, sellerId),
            { persisted: 0 },
          ),
        ]);
      } catch (err) {
        console.error(
          `[background-ingestion] Failed to process seller ${sellerId}:`,
          err instanceof Error ? err.message : String(err),
        );
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
          const crossAlerts = runCrossAccountComparison(
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
      const seasonalAlerts = runSeasonalAnalysis(config);
      alerts.push(...seasonalAlerts);
    } catch (err) {
      console.error(
        "[background-ingestion] Seasonal analysis failed:",
        err instanceof Error ? err.message : String(err),
      );
    }

    // ── Phase 4: Pruning ─────────────────────────────────────
    try {
      pruneSnapshots(config);
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

        await Promise.all(
          chatIds.map(async (chatId) => {
            try {
              await config.sendProactiveMessage(chatId, alertMessage);
            } catch (err) {
              console.error(
                `[background-ingestion] Failed to send alert to chat ${chatId}:`,
                err instanceof Error ? err.message : String(err),
              );
            }
          }),
        );
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
        const insightsUserId = resolveDailyInsightsDeepSeekUserId(config.sellerIds);
        const insights = await generateDailyInsights(dailyContext, openai, insightsUserId);

        if (insights) {
          const chatIds = await config.listActiveChats();
          const insightMessage = `🧠 <b>Análisis DeepSeek del negocio</b>\n\n${insights}`;

          await Promise.all(
            chatIds.map(async (chatId) => {
              try {
                await config.sendProactiveMessage(chatId, insightMessage);
              } catch (err) {
                console.error(
                  `[background-ingestion] Failed to send insights to chat ${chatId}:`,
                  err instanceof Error ? err.message : String(err),
                );
              }
            }),
          );
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
