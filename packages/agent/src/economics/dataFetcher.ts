import type { MlcApiClient } from "@msl/mercadolibre";
import type { DataFetcher, FetchedData } from "./EconomicIngestionPipeline.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type ProductionDataFetcherOptions = {
  /** MercadoLibre read-only API client (already OAuth-configured). */
  mlClient: MlcApiClient;
  /** Maximum number of pages to fetch across all paginated endpoints. */
  maxPages?: number;
  /** Delay between pages for rate limiting (ms). Default: 500. */
  rateLimitDelayMs?: number;
  /**
   * Mapping from pipeline seller slugs ("plasticov", "maustian") to
   * MercadoLibre numeric seller IDs. Required for ML API calls.
   */
  sellerIdMap?: Record<string, string>;
};

// ── Retry helpers ──────────────────────────────────────────────────────────

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate") ||
    msg.includes("timeout") ||
    msg.includes("5xx") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound")
  );
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 500): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1 && isTransientError(err)) {
        const delay = baseDelayMs * Math.pow(2, i) + Math.random() * 200;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" || typeof value === "string" ? Number(value) : fallback;
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a production DataFetcher that sources economic data from the
 * MercadoLibre API using the given read-only MlcApiClient.
 *
 * The returned function matches the {@link DataFetcher} type expected by
 * {@link EconomicIngestionPipeline}.
 *
 * **Read-only** — never performs write operations against MercadoLibre.
 * **No PII** — raw API payloads are never persisted; the pipeline always
 *   passes data through its normalization layer before persistence.
 */
export function createProductionDataFetcher(opts: ProductionDataFetcherOptions): DataFetcher {
  const mlClient = opts.mlClient;
  const maxPages = opts.maxPages ?? 5;
  const rateLimitDelayMs = opts.rateLimitDelayMs ?? 500;
  const sellerIdMap = opts.sellerIdMap ?? {};

  return async function productionDataFetcher(
    sellerId: string,
    fetchOpts?: { maxPages?: number; abortSignal?: AbortSignal },
  ): Promise<FetchedData> {
    // Map pipeline slug to ML numeric seller ID for API calls
    const mlSellerId = sellerIdMap[sellerId] ?? sellerId;
    const effectiveMaxPages = fetchOpts?.maxPages ?? maxPages;
    const signal = fetchOpts?.abortSignal;

    function checkAborted(): void {
      if (signal?.aborted) throw new Error("Data fetch aborted");
    }

    // ── Fetch orders (paginated) ─────────────────────────────────────────

    const orders: FetchedData["orders"] = [];
    try {
      checkAborted();
      for (let page = 0; page < effectiveMaxPages; page++) {
        checkAborted();
        const pageSize = 50;
        const offset = page * pageSize;

        const snapshot = await withRetry(() =>
          mlClient.getOrders(mlSellerId, { limit: pageSize, offset }),
        );

        const rawData: unknown = snapshot.data;
        // MlcReadSnapshot.data can be a single item or an array — normalize
        const orderSummaries = Array.isArray(rawData)
          ? rawData.filter(isRecord)
          : isRecord(rawData)
            ? [rawData]
            : [];
        if (orderSummaries.length === 0) break;

        for (const row of orderSummaries) {
          // Map sanitized order items from MlcOrderSummary to the pipeline's expected format
          const pipelineItems: FetchedData["orders"][number]["order_items"] = [];
          const rawOrderItems = row.orderItems;
          if (Array.isArray(rawOrderItems)) {
            for (const oi of rawOrderItems) {
              if (!isRecord(oi)) continue;
              pipelineItems.push({
                item: {
                  id: stringValue(oi.itemId, ""),
                  title: "", // Title is intentionally stripped for PII safety
                },
                quantity: numberValue(oi.quantity, 1),
                unit_price: numberValue(oi.unitPrice, 0),
              });
            }
          }

          orders.push({
            id: stringValue(row.id, ""),
            status: stringValue(row.status, "unknown"),
            total_amount: numberValue(row.totalAmount, 0),
            currency_id: stringValue(row.currencyId, "CLP"),
            date_created: stringValue(row.createdAt, new Date().toISOString()),
            order_items: pipelineItems,
            // Enrichment fields initialized to zero/null — the adapters
            // handle missing data gracefully and adapters that need this
            // data will correctly report missingInput.
            sale_fee_amount: 0,
            shipping_cost: 0,
            seller_funded_discount: 0,
            refund_amount: 0,
            return_cost: 0,
            ad_cost: 0,
          });
        }

        if (orderSummaries.length < pageSize) break;
        await sleep(rateLimitDelayMs);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[DataFetcher] Order fetch warning for ${sellerId}: ${msg}`);
    }

    // ── Fetch claims (paginated) ─────────────────────────────────────────

    const claims: FetchedData["claims"] = [];
    try {
      checkAborted();
      const searchClaims = mlClient.searchClaims?.bind(mlClient);
      if (searchClaims) {
        for (let page = 0; page < effectiveMaxPages; page++) {
          checkAborted();
          const pageSize = 50;
          const offset = page * pageSize;

          const snapshot = await withRetry(() =>
            searchClaims(mlSellerId, { limit: pageSize, offset }),
          );

          const claimData: unknown = snapshot.data;
          if (!Array.isArray(claimData) || claimData.length === 0) break;

          for (const claim of claimData) {
            if (isRecord(claim)) claims.push(claim);
          }

          if (claimData.length < pageSize) break;
          await sleep(rateLimitDelayMs);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[DataFetcher] Claims fetch warning for ${sellerId}: ${msg}`);
    }

    // ── Fetch product ads costs ──────────────────────────────────────────

    const ads: FetchedData["ads"] = [];
    try {
      checkAborted();
      const getProductAdsInsights = mlClient.getProductAdsInsights?.bind(mlClient);
      if (getProductAdsInsights) {
        const snapshot = await withRetry(() => getProductAdsInsights(mlSellerId, {}));

        const insightData: unknown = snapshot.data;
        if (Array.isArray(insightData) && insightData.length > 0) {
          for (const insight of insightData) {
            if (!isRecord(insight)) continue;
            ads.push({
              campaignId: stringValue(insight.campaignId ?? insight.id, "unknown"),
              cost: numberValue(insight.cost ?? insight.totalCost ?? insight.spend, 0),
              currency: stringValue(insight.currency ?? insight.currencyId, "CLP"),
              ...(insight.dateFrom !== undefined || insight.dateTo !== undefined
                ? {
                    period: {
                      start: numberValue(insight.dateFrom, 0),
                      end: numberValue(insight.dateTo, Date.now()),
                    },
                  }
                : {}),
            });
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[DataFetcher] Ads fetch warning for ${sellerId}: ${msg}`);
    }

    const items: FetchedData["items"] = [];

    return { orders, items, claims, ads };
  };
}
