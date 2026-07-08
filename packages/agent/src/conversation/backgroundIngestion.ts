import OpenAI from "openai";
import { getDeepSeekClient } from "./deepseekClient.js";
import {
  resolveDeepSeekRuntimeConfig,
} from "./deepseekRuntime.js";
import type { GraphEngine, OperationalReadModelWriter } from "@msl/memory";
import type {
  MlcListingSummary,
  MlcPerformanceSummary,
} from "@msl/mercadolibre";

import {
  processSellerListings,
  processSellerOrders,
  processSellerClaims,
  processSellerQuestions,
  processSellerMessages,
  processSellerReputation,
  processSellerProductAds,
  processSellerCreativeAssets,
  processSellerPricing,
  runCrossAccountComparison,
  runSeasonalAnalysis,
  runRelistChecks,
  pruneSnapshots,
  generateDailyInsights,
  buildDailyContext,
  resolveDailyInsightsDeepSeekUserId,
  withFreshnessSkip,
  KIND_FRESHNESS_TTL,
  KIND_DEFAULT_MAX_PAGES,
  type BackgroundIngestionConfig,
  type CreativeSnapshotData,
  PRICING_MAX_ITEMS_PER_CYCLE,
} from "./ingestion/index.js";

// Re-export barrel so consumers importing from backgroundIngestion get everything
export * from "./ingestion/index.js";

// ── Constants (kept local for quality checks and orchestrator) ─────────

const QUALITY_CHECK_MAX_PER_CYCLE = 20; // listings per cycle
const QUALITY_SCORE_DROP_THRESHOLD = 10; // points
const QUALITY_LOW_SCORE_THRESHOLD = 70;

// ── Internal helpers kept with the orchestrator ────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMlcPerformanceSummary(value: unknown): value is MlcPerformanceSummary {
  return isRecord(value) && typeof value.entityId === "string";
}

function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function todayLabel(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstPerformanceSummary(
  data: MlcPerformanceSummary | ReadonlyArray<MlcPerformanceSummary>,
): MlcPerformanceSummary | undefined {
  const raw: unknown = data;
  if (Array.isArray(raw)) return raw.find(isMlcPerformanceSummary);
  return isMlcPerformanceSummary(raw) ? raw : undefined;
}

// ── Phase 7: Quality checks ────────────────────────────────────────────

/**
 * Runs listing quality checks using the MercadoLibre Item Performance API.
 * Picks up to QUALITY_CHECK_MAX_PER_CYCLE active listings that are most in
 * need of a fresh quality check, calls mlcClient.getItemPerformance, persists
 * quality_snapshot nodes, and generates alerts for low scores and score drops.
 */
async function runQualityChecks(
  config: BackgroundIngestionConfig,
): Promise<{ alerts: string[]; checkedCount: number }> {
  const alerts: string[] = [];

  if (typeof config.mlcClient.getItemPerformance !== "function") {
    console.log("[worker] Phase 7 quality: getItemPerformance not available, skipping");
    return { alerts, checkedCount: 0 };
  }

  const capturedAt = new Date().toISOString();

  const listingSnaps = config.engine.queryByMetadata({
    type: "listing_snapshot",
    limit: 5000,
  });

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

  const qualitySnaps = config.engine.queryByMetadata({
    type: "quality_snapshot",
    limit: 5000,
  });

  const latestQualityPerItem = new Map<string, string>();
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

  const candidates = Array.from(newestPerItem.entries()).map(([itemId, info]) => {
    const lastQuality = latestQualityPerItem.get(itemId);
    return {
      ...info,
      hasQuality: lastQuality !== undefined,
      lastQualityAt: lastQuality ?? "",
    };
  });

  candidates.sort((a, b) => {
    if (!a.hasQuality && b.hasQuality) return -1;
    if (a.hasQuality && !b.hasQuality) return 1;
    return a.lastQualityAt.localeCompare(b.lastQualityAt);
  });

  const batch = candidates.slice(0, QUALITY_CHECK_MAX_PER_CYCLE);

  for (const candidate of batch) {
    try {
      const perfSnapshot = await config.mlcClient.getItemPerformance(
        candidate.sellerId,
        candidate.itemId,
      );
      const data = firstPerformanceSummary(perfSnapshot.data);
      if (!data) continue;

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

      if (data.score < QUALITY_LOW_SCORE_THRESHOLD) {
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
    }
  }

  console.log(
    `[worker] Phase 7 quality: checked ${batch.length} listings, ${alerts.length} alerts`,
  );

  return { alerts, checkedCount: batch.length };
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
