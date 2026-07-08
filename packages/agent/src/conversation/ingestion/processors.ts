import OpenAI from "openai";
import { getDeepSeekClient } from "../deepseekClient.js";
import {
  buildDeepSeekChatCompletionRequest,
  resolveDeepSeekRuntimeConfig,
  resolveDeepSeekUserId,
} from "../deepseekRuntime.js";
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

import {
  isRecord,
  metadataString,
  todayLabel,
  categoryBreakdownFromMetadata,
  hashString,
  paginateAll,
  isGracefulPricingNoDataError,
  selectRotatedPricingListings,
} from "./utils.js";
import { KIND_FRESHNESS_TTL, KIND_DEFAULT_MAX_PAGES } from "./constants.js";

// ── Types re-exported from original ────────────────────────────────────

export type BackgroundIngestionConfig = {
  mlcClient: MlcApiClient;
  engine: GraphEngine;
  sendProactiveMessage: (chatId: number, text: string) => Promise<void>;
  listActiveChats: () => Promise<number[]>;
  sellerIds: string[];
  sellerNames?: Record<string, string>;
  intervalMs?: number;
  deepseekApiKey?: string;
  operationalStore?: OperationalReadModelWriter;
  pricingMaxItemsPerCycle?: number;
};

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

export const PRICING_MAX_ITEMS_PER_CYCLE = 20;

// ── Constants ──────────────────────────────────────────────────────────

const LISTING_SNAPSHOT_KEEP = 30;
const TREND_WINDOW = 3;
const VISIT_SPIKE_THRESHOLD = 0.5;
const PRICE_CHANGE_THRESHOLD = 0.2;
const PAGE_SIZE = 50;

// ── Internal helpers ───────────────────────────────────────────────────

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

function normalizeVisitsDetail(
  detail: MlcVisitsDetail[] | undefined,
): ReadonlyArray<MlcVisitsDetail> {
  return detail ?? [];
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
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

// ── Types ──────────────────────────────────────────────────────────────

/** Result shape returned by processSellerListings. */
export type SellerProcessResult = {
  listings: ReadonlyArray<MlcListingSummary>;
  alerts: string[];
};

// ── Processors ─────────────────────────────────────────────────────────

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

export async function processSellerClaims(
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

export async function processSellerQuestions(
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

export async function processSellerMessages(
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

export async function processSellerReputation(
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
    const listingSnaps: Array<{
      itemId: string;
      data: Record<string, unknown>;
      capturedAt: string;
      freshness: string;
      evidenceId: string;
    }> = await (config.operationalStore as any).searchSnapshots({
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

      const variations = (data.variations as Array<Record<string, unknown>> | undefined) ?? [];
      let variationPictureCount = 0;
      for (const v of variations) {
        const ids = (v.picture_ids as Array<unknown> | undefined) ?? [];
        variationPictureCount += Array.isArray(ids) ? ids.length : 0;
      }

      const hasMainImage = pictureCount > 0;

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
          moderationStatus = data.status === "active" ? "active" : "none";
        }
      }

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
        ...(performancePicturesStatus !== undefined ? { performancePicturesStatus } : {}),
        ...(performancePicturesScore !== undefined ? { performancePicturesScore } : {}),
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

    await config.operationalStore.upsertCheckpoint(
      sellerId,
      "creative-snapshot",
      new Date().toISOString(),
    );

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

export async function processSellerOrders(
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
