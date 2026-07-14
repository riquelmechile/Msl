import {
  createSourceFetchResult,
  type SourceFetchReasonCode,
  type SourceFetchResult,
  type SourceFetchStatus,
} from "@msl/domain";
import type { DataFetcher, FetchedData } from "./EconomicIngestionPipeline.js";
import {
  clipOperationTimeout,
  DEFAULT_ECONOMIC_DEADLINE_CONFIG,
  systemRuntimeClock,
  type RuntimeClock,
} from "./runtimeDeadline.js";
import { runBoundedFanout } from "./boundedFanout.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type ProductionDataFetcherOptions = {
  /** MercadoLibre read-only API client (already OAuth-configured). */
  mlClient: EconomicReadClient;
  /** Maximum provider requests per source. */
  maxAttempts?: number;
  /** Injectable, abort-aware delay used only between retry attempts. */
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  /** Maximum number of pages to fetch across all paginated endpoints. */
  maxPages?: number;
  /** Delay between retry attempts when the provider supplies no Retry-After (ms). */
  rateLimitDelayMs?: number;
  /**
   * Mapping from pipeline seller slugs ("plasticov", "maustian") to
   * MercadoLibre numeric seller IDs. Required for ML API calls.
   */
  sellerIdMap?: Record<string, string>;
  /** Injectable deterministic clock for outcome timestamps. */
  clock?: { now(): number };
  /** Per-request cap. It is clipped to the run deadline by the pipeline. */
  requestTimeoutMs?: number;
  /** Maximum time spent retrying one source, including provider backoff. */
  retryBudgetMs?: number;
  /** Budget for independent optional source fanout, clipped by the run deadline. */
  fanoutTimeoutMs?: number;
  /** Injectable scheduler; tests must not rely on real sleeps. */
  runtimeClock?: RuntimeClock;
};

/**
 * R2's cancellable ML read boundary. The current shared MLC client signatures
 * do not accept AbortSignal, so factory code must adapt it explicitly rather
 * than silently pretending cancellation reached that client.
 */
export type EconomicReadClient = {
  getOrders(
    sellerId: string,
    options?: {
      limit?: number;
      offset?: number;
      maxPages?: number;
      /** Provider-supported inclusive date lower bound, not an opaque cursor. */
      dateCreatedFrom?: string;
      signal?: AbortSignal | undefined;
    },
  ): Promise<{ data: unknown }>;
  searchClaims?(
    sellerId: string,
    options?: { limit?: number; offset?: number; signal?: AbortSignal | undefined },
  ): Promise<{ data: unknown; blockedMetadata?: { httpStatus: number } }>;
  getProductAdsInsights?(
    sellerId: string,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<{ data: unknown }>;
};

/** Typed read-boundary failure. Its message is deliberately never exposed. */
export class MercadoLibreReadFailure extends Error {
  constructor(
    readonly statusCode: number,
    message = "MercadoLibre read failed",
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "MercadoLibreReadFailure";
  }
}

class MalformedMercadoLibreResponse extends Error {}

type OutcomeInput = Omit<Parameters<typeof createSourceFetchResult>[0], "observedAt">;

function outcome(now: number, input: OutcomeInput): SourceFetchResult {
  const result = createSourceFetchResult({ ...input, observedAt: now });
  if (!result.success) throw new Error("Invalid source fetch outcome");
  return result.result;
}

function abortedOutcome(
  source: OutcomeInput["source"],
  now: number,
  attempts = 0,
): SourceFetchResult {
  return outcome(now, {
    source,
    status: "aborted",
    reasonCode: "global-abort",
    attemptedAt: attempts === 0 ? null : now,
    attempts,
    pages: 0,
    records: 0,
    retryable: false,
    cursor: { afterOccurredAt: null, afterSourceRecordId: null },
  });
}

/**
 * A required upstream source did not succeed, so this source was deliberately
 * not queried. This must not be represented as a confirmed empty response.
 */
function unavailableOutcome(source: OutcomeInput["source"], now: number): SourceFetchResult {
  return outcome(now, {
    source,
    status: "unavailable",
    reasonCode: "source-unavailable",
    attemptedAt: null,
    attempts: 0,
    pages: 0,
    records: 0,
    retryable: false,
    cursor: { afterOccurredAt: null, afterSourceRecordId: null },
  });
}

function classifyFailure(error: unknown): {
  status: SourceFetchStatus;
  reasonCode: SourceFetchReasonCode;
  retryable: boolean;
} {
  if (error instanceof MalformedMercadoLibreResponse) {
    return {
      status: "malformed-response",
      reasonCode: "invalid-provider-response",
      retryable: false,
    };
  }
  if (error instanceof MercadoLibreReadFailure) {
    if (error.statusCode === 401)
      return { status: "unauthorized", reasonCode: "credentials-rejected", retryable: false };
    if (error.statusCode === 403)
      return { status: "forbidden", reasonCode: "access-denied", retryable: false };
    if (error.statusCode === 429)
      return { status: "rate-limited", reasonCode: "rate-limit-exceeded", retryable: true };
    if (error.statusCode >= 500 && error.statusCode <= 599)
      return {
        status: "transient-failure",
        reasonCode: "temporary-provider-failure",
        retryable: true,
      };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { status: "source-timeout", reasonCode: "request-timed-out", retryable: true };
  }
  return { status: "transient-failure", reasonCode: "temporary-provider-failure", retryable: true };
}

function failureOutcome(
  source: OutcomeInput["source"],
  now: number,
  attempts: number,
  error: unknown,
): SourceFetchResult {
  const classification = classifyFailure(error);
  return outcome(now, {
    source,
    ...classification,
    attemptedAt: now,
    attempts,
    pages: 0,
    records: 0,
    retryAfterMs: error instanceof MercadoLibreReadFailure ? error.retryAfterMs : null,
    cursor: { afterOccurredAt: null, afterSourceRecordId: null },
  });
}

function exhaustedOutcome(
  source: OutcomeInput["source"],
  now: number,
  attempts: number,
  error: unknown,
): SourceFetchResult {
  const classification = classifyFailure(error);
  return outcome(now, {
    source,
    status: classification.status,
    reasonCode: "retry-budget-exhausted",
    attemptedAt: now,
    attempts,
    pages: 0,
    records: 0,
    retryable: false,
    retryAfterMs: error instanceof MercadoLibreReadFailure ? error.retryAfterMs : null,
    cursor: { afterOccurredAt: null, afterSourceRecordId: null },
  });
}

function waitWithClock(
  runtimeClock: RuntimeClock,
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    let settled = false;
    const abort = () => done(new DOMException("Aborted", "AbortError"));
    const done = (error?: DOMException): void => {
      if (settled) return;
      settled = true;
      runtimeClock.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const timer = runtimeClock.setTimeout(() => done(), delayMs);
    if (!settled) signal?.addEventListener("abort", abort, { once: true });
  });
}

function withRequestDeadline<T>(
  request: () => Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  runtimeClock: RuntimeClock,
  onTimeout?: () => void,
): Promise<T> {
  if (timeoutMs === undefined) return request();
  return new Promise<T>((resolve, reject) => {
    const timer = runtimeClock.setTimeout(() => {
      onTimeout?.();
      reject(new DOMException("Request timed out", "AbortError"));
    }, timeoutMs);
    const abort = () => {
      runtimeClock.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    void request().then(
      (value) => {
        runtimeClock.clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        runtimeClock.clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(error instanceof Error ? error : new Error("Economic request failed"));
      },
    );
  });
}

async function requestWithRetry<T>(input: {
  source: OutcomeInput["source"];
  signal?: AbortSignal | undefined;
  maxAttempts: number;
  defaultDelayMs: number;
  retryBudgetMs: number;
  now: () => number;
  wait: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  request: (
    signal: AbortSignal | undefined,
    timeoutMs?: number,
    onTimeout?: () => void,
  ) => Promise<T>;
  toRecords: (snapshot: T) => number;
  requestTimeoutMs: number | undefined;
  deadlineAt: number | undefined;
  preserveSignalIdentity?: boolean;
}): Promise<{ result: SourceFetchResult; snapshot?: T }> {
  if (input.signal?.aborted) return { result: abortedOutcome(input.source, input.now()) };
  const retryStartedAt = input.now();
  let lastError: unknown;
  for (let attempts = 1; attempts <= input.maxAttempts; attempts++) {
    const allowed =
      input.deadlineAt === undefined
        ? undefined
        : clipOperationTimeout({
            requestedMs: input.requestTimeoutMs ?? input.deadlineAt - input.now(),
            remainingMs: input.deadlineAt - input.now(),
          });
    if (allowed?.status !== undefined && allowed.status !== "allowed") {
      return { result: abortedOutcome(input.source, input.now(), attempts - 1) };
    }
    try {
      if (input.preserveSignalIdentity) {
        const snapshot = await input.request(input.signal, allowed?.timeoutMs);
        if (input.signal?.aborted)
          return { result: abortedOutcome(input.source, input.now(), attempts) };
        return {
          result: successfulOutcome(input.source, input.now(), input.toRecords(snapshot), attempts),
          snapshot,
        };
      }
      const requestController = new AbortController();
      const abort = () => requestController.abort(input.signal?.reason);
      input.signal?.addEventListener("abort", abort, { once: true });
      if (input.signal?.aborted) abort();
      try {
        const snapshot = await input.request(requestController.signal, allowed?.timeoutMs, () =>
          requestController.abort("request-deadline"),
        );
        if (input.signal?.aborted)
          return { result: abortedOutcome(input.source, input.now(), attempts) };
        return {
          result: successfulOutcome(input.source, input.now(), input.toRecords(snapshot), attempts),
          snapshot,
        };
      } finally {
        input.signal?.removeEventListener("abort", abort);
      }
    } catch (error) {
      if (input.signal?.aborted)
        return { result: abortedOutcome(input.source, input.now(), attempts) };
      lastError = error;
      const classified = classifyFailure(error);
      if (!classified.retryable)
        return { result: failureOutcome(input.source, input.now(), attempts, error) };
      if (attempts === input.maxAttempts)
        return { result: exhaustedOutcome(input.source, input.now(), attempts, error) };
      const delay = error instanceof MercadoLibreReadFailure ? error.retryAfterMs : null;
      const remainingRetryBudgetMs = input.retryBudgetMs - (input.now() - retryStartedAt);
      if (remainingRetryBudgetMs <= 0)
        return { result: exhaustedOutcome(input.source, input.now(), attempts, error) };
      try {
        const configuredDelay = Math.min(delay ?? input.defaultDelayMs, remainingRetryBudgetMs);
        const remainingDeadlineMs =
          input.deadlineAt === undefined ? configuredDelay : input.deadlineAt - input.now();
        const clippedDelay = clipOperationTimeout({
          requestedMs: configuredDelay,
          remainingMs: remainingDeadlineMs,
        });
        if (clippedDelay.status !== "allowed")
          return { result: exhaustedOutcome(input.source, input.now(), attempts, error) };
        await input.wait(clippedDelay.timeoutMs, input.signal);
      } catch {
        return { result: abortedOutcome(input.source, input.now(), attempts) };
      }
    }
  }
  return { result: failureOutcome(input.source, input.now(), input.maxAttempts, lastError) };
}

function successfulOutcome(
  source: OutcomeInput["source"],
  now: number,
  records: number,
  attempts = 1,
): SourceFetchResult {
  const common = {
    source,
    attemptedAt: now,
    attempts,
    pages: 1,
    records,
    cursor: { afterOccurredAt: null, afterSourceRecordId: null },
  };
  return records > 0
    ? outcome(now, { ...common, status: "success-with-data" })
    : outcome(now, { ...common, status: "success-empty", reasonCode: "no-records" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFetchedOrder(order: unknown): FetchedData["orders"][number] | null {
  if (!isRecord(order) || typeof order.id !== "string" || typeof order.createdAt !== "string")
    return null;
  const rawItems = Array.isArray(order.orderItems) ? order.orderItems : [];
  const orderItems = rawItems.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.itemId !== "string" ||
      typeof item.quantity !== "number" ||
      typeof item.unitPrice !== "number"
    )
      return [];
    return [
      { item: { id: item.itemId, title: "" }, quantity: item.quantity, unit_price: item.unitPrice },
    ];
  });
  return {
    id: order.id,
    status: typeof order.status === "string" ? order.status : "unknown",
    total_amount: typeof order.totalAmount === "number" ? order.totalAmount : 0,
    ...(typeof order.currencyId === "string" ? { currency_id: order.currencyId } : {}),
    date_created: order.createdAt,
    order_items: orderItems,
  };
}

function strictAfterCursor(
  orders: FetchedData["orders"],
  cursorBefore?: { occurredAt: number; sourceRecordId: string },
): FetchedData["orders"] {
  if (cursorBefore === undefined) return orders;
  return orders.filter((order) => {
    const occurredAt = Date.parse(order.date_created);
    return (
      Number.isFinite(occurredAt) &&
      (occurredAt > cursorBefore.occurredAt ||
        (occurredAt === cursorBefore.occurredAt && order.id > cursorBefore.sourceRecordId))
    );
  });
}

function toFetchedClaim(claim: unknown): Record<string, unknown> | null {
  if (!isRecord(claim) || typeof claim.id !== "string") return null;
  return { id: claim.id, ...(typeof claim.status === "string" ? { status: claim.status } : {}) };
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
  const maxAttempts = opts.maxAttempts ?? 2;
  const sellerIdMap = opts.sellerIdMap ?? {};
  const clock = opts.clock ?? { now: Date.now };
  const runtimeClock = opts.runtimeClock ?? systemRuntimeClock;
  const wait =
    opts.wait ??
    ((delayMs: number, signal?: AbortSignal) => waitWithClock(runtimeClock, delayMs, signal));
  const requestTimeoutMs = opts.requestTimeoutMs;
  const retryBudgetMs = opts.retryBudgetMs ?? DEFAULT_ECONOMIC_DEADLINE_CONFIG.retryBudgetMs;
  if (
    (requestTimeoutMs !== undefined &&
      (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0)) ||
    !Number.isSafeInteger(retryBudgetMs) ||
    retryBudgetMs < 0
  ) {
    throw new Error("Invalid economic fetch deadline configuration");
  }

  return async function productionDataFetcher(
    sellerId: string,
    fetchOpts?: {
      maxPages?: number;
      abortSignal?: AbortSignal;
      cursorBefore?: { occurredAt: number; sourceRecordId: string };
      deadlineAt?: number;
    },
  ): Promise<FetchedData> {
    const mlSellerId = sellerIdMap[sellerId] ?? sellerId;
    const effectiveMaxPages = fetchOpts?.maxPages ?? maxPages;
    const signal = fetchOpts?.abortSignal;
    const orders: FetchedData["orders"] = [];
    const claims: FetchedData["claims"] = [];
    const ads: FetchedData["ads"] = [];
    if (signal?.aborted) {
      return {
        orders,
        claims,
        ads,
        items: [],
        sourceResults: {
          orders: abortedOutcome("orders", clock.now()),
          claims: abortedOutcome("claims", clock.now()),
          productAds: abortedOutcome("product-ads", clock.now()),
        },
      };
    }

    const ordersRequest = await requestWithRetry<
      Awaited<ReturnType<EconomicReadClient["getOrders"]>>
    >({
      source: "orders",
      signal,
      maxAttempts,
      defaultDelayMs: opts.rateLimitDelayMs ?? 500,
      retryBudgetMs,
      requestTimeoutMs,
      deadlineAt: fetchOpts?.deadlineAt,
      now: () => clock.now(),
      wait,
      request: (requestSignal, timeoutMs, onTimeout) =>
        withRequestDeadline(
          () =>
            mlClient.getOrders(mlSellerId, {
              limit: 50,
              offset: 0,
              maxPages: effectiveMaxPages,
              // MercadoLibre supports an inclusive creation-date lower bound, but
              // not the compound `(date, order id)` cursor. Preserve correctness
              // with the deterministic strict-after filter below.
              ...(fetchOpts?.cursorBefore
                ? { dateCreatedFrom: new Date(fetchOpts.cursorBefore.occurredAt).toISOString() }
                : {}),
              signal: requestSignal,
            }),
          requestSignal,
          timeoutMs ?? requestTimeoutMs,
          runtimeClock,
          onTimeout,
        ),
      toRecords: (snapshot) => {
        const rawOrders = Array.isArray(snapshot.data) ? snapshot.data : [snapshot.data];
        for (const item of rawOrders.slice(0, effectiveMaxPages * 50)) {
          const order = toFetchedOrder(item);
          if (order === null) throw new MalformedMercadoLibreResponse();
          orders.push(order);
        }
        return orders.length;
      },
    });
    const resumedOrders = strictAfterCursor(orders, fetchOpts?.cursorBefore);
    orders.splice(0, orders.length, ...resumedOrders);
    const ordersResult = { ...ordersRequest.result, records: orders.length };

    if (ordersResult.status !== "success-with-data" && ordersResult.status !== "success-empty") {
      const skipped = signal?.aborted ? abortedOutcome : unavailableOutcome;
      return {
        orders,
        claims,
        ads,
        items: [],
        sourceResults: {
          orders: ordersResult,
          claims: skipped("claims", clock.now()),
          productAds: skipped("product-ads", clock.now()),
        },
      };
    }

    const fetchClaims = async (fanoutSignal: AbortSignal): Promise<SourceFetchResult> => {
      if (fanoutSignal.aborted) return abortedOutcome("claims", clock.now());
      if (!mlClient.searchClaims) return unavailableOutcome("claims", clock.now());
      const claimsRequest = await requestWithRetry<
        Awaited<ReturnType<NonNullable<EconomicReadClient["searchClaims"]>>>
      >({
        source: "claims",
        signal: fanoutSignal,
        maxAttempts,
        defaultDelayMs: opts.rateLimitDelayMs ?? 500,
        retryBudgetMs,
        requestTimeoutMs,
        deadlineAt: fetchOpts?.deadlineAt,
        preserveSignalIdentity: true,
        now: () => clock.now(),
        wait,
        request: (requestSignal, timeoutMs, onTimeout) =>
          withRequestDeadline(
            () =>
              mlClient.searchClaims!(mlSellerId, {
                limit: 50,
                offset: 0,
                signal: requestSignal,
              }),
            requestSignal,
            timeoutMs ?? requestTimeoutMs,
            runtimeClock,
            onTimeout,
          ),
        toRecords: (snapshot) => {
          if (snapshot.blockedMetadata?.httpStatus === 429) throw new MercadoLibreReadFailure(429);
          if (!isRecord(snapshot.data) || !Array.isArray(snapshot.data.results))
            throw new MalformedMercadoLibreResponse();
          for (const claim of snapshot.data.results) {
            const fetchedClaim = toFetchedClaim(claim);
            if (fetchedClaim === null) throw new MalformedMercadoLibreResponse();
            claims.push(fetchedClaim);
          }
          return claims.length;
        },
      });
      return claimsRequest.result;
    };

    const fetchProductAds = async (fanoutSignal: AbortSignal): Promise<SourceFetchResult> => {
      if (fanoutSignal.aborted) return abortedOutcome("product-ads", clock.now());
      if (!mlClient.getProductAdsInsights) return unavailableOutcome("product-ads", clock.now());
      const adsRequest = await requestWithRetry<
        Awaited<ReturnType<NonNullable<EconomicReadClient["getProductAdsInsights"]>>>
      >({
        source: "product-ads",
        signal: fanoutSignal,
        maxAttempts,
        defaultDelayMs: opts.rateLimitDelayMs ?? 500,
        retryBudgetMs,
        requestTimeoutMs,
        deadlineAt: fetchOpts?.deadlineAt,
        preserveSignalIdentity: true,
        now: () => clock.now(),
        wait,
        request: (requestSignal, timeoutMs, onTimeout) =>
          withRequestDeadline(
            () => mlClient.getProductAdsInsights!(mlSellerId, { signal: requestSignal }),
            requestSignal,
            timeoutMs ?? requestTimeoutMs,
            runtimeClock,
            onTimeout,
          ),
        toRecords: (snapshot) => {
          const insight = snapshot.data;
          if (!isRecord(insight) || !Array.isArray(insight.ads))
            throw new MalformedMercadoLibreResponse();
          for (const ad of insight.ads) {
            if (
              !isRecord(ad) ||
              typeof ad.id !== "string" ||
              !isRecord(ad.metrics) ||
              typeof ad.metrics.cost !== "number"
            )
              throw new MalformedMercadoLibreResponse();
            ads.push({
              campaignId: typeof ad.campaignId === "string" ? ad.campaignId : ad.id,
              cost: ad.metrics.cost,
              currency: "CLP",
            });
          }
          return ads.length;
        },
      });
      return adsRequest.result;
    };
    // Orders are mandatory and have completed. Claims and ads are independent,
    // optional enrichments, so start them through the bounded production fanout.
    const requestedFanoutTimeout =
      opts.fanoutTimeoutMs ?? DEFAULT_ECONOMIC_DEADLINE_CONFIG.fanoutTimeoutMs;
    const fanoutWindow =
      fetchOpts?.deadlineAt === undefined
        ? { status: "allowed" as const, timeoutMs: requestedFanoutTimeout }
        : clipOperationTimeout({
            requestedMs: requestedFanoutTimeout,
            remainingMs: fetchOpts.deadlineAt - clock.now(),
          });
    if (fanoutWindow.status !== "allowed") {
      return {
        orders,
        items: [],
        claims,
        ads,
        sourceResults: {
          orders: ordersResult,
          claims: abortedOutcome("claims", clock.now()),
          productAds: abortedOutcome("product-ads", clock.now()),
        },
      };
    }
    const fanout = await runBoundedFanout([fetchClaims, fetchProductAds], {
      concurrency: 2,
      ...(signal === undefined ? {} : { signal }),
      clock: runtimeClock,
      timeoutMs: fanoutWindow.timeoutMs,
    });
    const sourceResult = (index: number, source: "claims" | "product-ads"): SourceFetchResult => {
      const result = fanout[index];
      return result?.status === "fulfilled"
        ? result.value
        : signal?.aborted
          ? abortedOutcome(source, clock.now())
          : failureOutcome(source, clock.now(), 0, result?.reason);
    };
    const claimsResult = sourceResult(0, "claims");
    const productAdsResult = sourceResult(1, "product-ads");
    return {
      orders,
      items: [],
      claims,
      ads,
      sourceResults: { orders: ordersResult, claims: claimsResult, productAds: productAdsResult },
    };
  };
}
