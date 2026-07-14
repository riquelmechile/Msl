import { describe, expect, it, vi } from "vitest";
import {
  createProductionDataFetcher,
  MercadoLibreReadFailure,
  type EconomicReadClient,
  type ProductionDataFetcherOptions,
} from "./dataFetcher.js";

const clock = { now: () => 1_700_000_000_000 };

const order = {
  id: "order-1",
  totalAmount: 100,
  createdAt: "2026-01-01T00:00:00.000Z",
  orderItems: [],
};
const claim = { id: "claim-1", status: "opened" };
const ad = { id: "ad-1", metrics: { cost: 10 } };

function client(overrides: Partial<EconomicReadClient> = {}): EconomicReadClient {
  return {
    getOrders: () => Promise.resolve({ data: [order] }),
    searchClaims: () => Promise.resolve({ data: { results: [claim] } }),
    getProductAdsInsights: () => Promise.resolve({ data: { ads: [ad] } }),
    ...overrides,
  };
}

function fetcher(
  mlClient: EconomicReadClient,
  overrides: Omit<Partial<ProductionDataFetcherOptions>, "mlClient"> = {},
) {
  return createProductionDataFetcher({
    mlClient,
    clock,
    rateLimitDelayMs: 0,
    wait: () => Promise.resolve(),
    ...overrides,
  });
}

function sourceResults(
  result: Awaited<ReturnType<ReturnType<typeof createProductionDataFetcher>>>,
) {
  if (result.sourceResults === undefined)
    throw new Error("Production fetcher must return source results");
  return result.sourceResults;
}

describe("createProductionDataFetcher R2 source matrix", () => {
  it("passes the resume tuple into the production Orders seam and strictly excludes it locally", async () => {
    const getOrders = vi.fn<EconomicReadClient["getOrders"]>(() =>
      Promise.resolve({
        data: [
          order,
          { ...order, id: "order-0", createdAt: "2026-01-01T00:00:00.000Z" },
          { ...order, id: "order-2", createdAt: "2026-01-01T00:00:00.000Z" },
          { ...order, id: "order-3", createdAt: "2026-01-02T00:00:00.000Z" },
        ],
      }),
    );
    const cursorBefore = {
      occurredAt: Date.parse("2026-01-01T00:00:00.000Z"),
      sourceRecordId: "order-1",
    };

    const result = await fetcher(client({ getOrders }), { maxPages: 2 })("plasticov", {
      cursorBefore,
    });

    const firstCall = getOrders.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (firstCall === undefined) throw new Error("Expected Orders to be requested");
    expect(firstCall[0]).toBe("plasticov");
    expect(firstCall[1]).toMatchObject({
      limit: 50,
      offset: 0,
      maxPages: 2,
      dateCreatedFrom: "2026-01-01T00:00:00.000Z",
    });
    expect(firstCall[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(result.orders.map(({ id }) => id)).toEqual(["order-2", "order-3"]);
    expect(sourceResults(result).orders.records).toBe(2);
  });

  const sources = [
    {
      name: "orders",
      resultKey: "orders",
      withData: () => client(),
      empty: () => client({ getOrders: () => Promise.resolve({ data: [] }) }),
      fail: (error: Error) => client({ getOrders: () => Promise.reject(error) }),
      malformed: () => client({ getOrders: () => Promise.resolve({ data: { invalid: true } }) }),
    },
    {
      name: "claims",
      resultKey: "claims",
      withData: () => client(),
      empty: () => client({ searchClaims: () => Promise.resolve({ data: { results: [] } }) }),
      fail: (error: Error) => client({ searchClaims: () => Promise.reject(error) }),
      malformed: () => client({ searchClaims: () => Promise.resolve({ data: { invalid: true } }) }),
    },
    {
      name: "ads",
      resultKey: "productAds",
      withData: () => client(),
      empty: () => client({ getProductAdsInsights: () => Promise.resolve({ data: { ads: [] } }) }),
      fail: (error: Error) => client({ getProductAdsInsights: () => Promise.reject(error) }),
      malformed: () =>
        client({ getProductAdsInsights: () => Promise.resolve({ data: { invalid: true } }) }),
    },
  ] as const;

  it.each(sources)("records successful data and confirmed empty for $name", async (source) => {
    expect(
      sourceResults(await fetcher(source.withData())("plasticov"))[source.resultKey].status,
    ).toBe("success-with-data");
    expect(sourceResults(await fetcher(source.empty())("plasticov"))[source.resultKey].status).toBe(
      "success-empty",
    );
  });

  it.each(sources)(
    "classifies 401, 403, network, and malformed $name responses",
    async (source) => {
      const cases = [
        [new MercadoLibreReadFailure(401, "token=hidden"), "unauthorized", "credentials-rejected"],
        [new MercadoLibreReadFailure(403, "token=hidden"), "forbidden", "access-denied"],
        [
          new MercadoLibreReadFailure(500, "token=hidden"),
          "transient-failure",
          "retry-budget-exhausted",
        ],
        [new TypeError("network unavailable"), "transient-failure", "retry-budget-exhausted"],
        [null, "malformed-response", "invalid-provider-response"],
      ] as const;
      for (const [error, status, reasonCode] of cases) {
        const result =
          error === null
            ? await fetcher(source.malformed(), { maxAttempts: 1 })("plasticov")
            : await fetcher(source.fail(error), { maxAttempts: 1 })("plasticov");
        expect(sourceResults(result)[source.resultKey]).toMatchObject({ status, reasonCode });
        expect(JSON.stringify(sourceResults(result)[source.resultKey])).not.toContain("hidden");
      }
    },
  );

  it("passes the exact bounded-fanout signal to Claims and Ads transports", async () => {
    const received: AbortSignal[] = [];
    await fetcher(
      client({
        searchClaims: (_sellerId, options) => {
          if (options?.signal) received.push(options.signal);
          return Promise.resolve({ data: { results: [] } });
        },
        getProductAdsInsights: (_sellerId, options) => {
          if (options?.signal) received.push(options.signal);
          return Promise.resolve({ data: { ads: [] } });
        },
      }),
    )("plasticov");
    expect(received).toHaveLength(2);
    expect(received[0]).toBe(received[1]);
  });

  it.each(sources)(
    "uses Retry-After, retries $name without sleep, and classifies exhausted budget",
    async (source) => {
      const retryAfterMs = 321;
      const wait = vi.fn(() => Promise.resolve());
      const limited = new MercadoLibreReadFailure(429, "retry=hidden", retryAfterMs);
      const success = source.withData();
      const request =
        source.name === "orders"
          ? vi
              .fn()
              .mockRejectedValueOnce(limited)
              .mockResolvedValueOnce({ data: [order] })
          : source.name === "claims"
            ? vi
                .fn()
                .mockRejectedValueOnce(limited)
                .mockResolvedValueOnce({ data: { results: [claim] } })
            : vi
                .fn()
                .mockRejectedValueOnce(limited)
                .mockResolvedValueOnce({ data: { ads: [ad] } });
      const retryClient =
        source.name === "orders"
          ? client({ getOrders: request })
          : source.name === "claims"
            ? client({ searchClaims: request })
            : client({ getProductAdsInsights: request });
      const retried = await fetcher(retryClient, { maxAttempts: 2, wait })("plasticov");
      expect(sourceResults(retried)[source.resultKey]).toMatchObject({
        status: "success-with-data",
        attempts: 2,
      });
      expect(wait).toHaveBeenCalledWith(
        retryAfterMs,
        source.name === "orders" ? undefined : expect.any(AbortSignal),
      );
      expect(success).toBeDefined();

      const exhausted = await fetcher(source.fail(limited), { maxAttempts: 2, wait })("plasticov");
      expect(sourceResults(exhausted)[source.resultKey]).toMatchObject({
        status: "rate-limited",
        reasonCode: "retry-budget-exhausted",
        retryAfterMs,
        attempts: 2,
        retryable: false,
      });
    },
  );

  it.each(sources)("does not start $name when globally aborted before request", async (source) => {
    const controller = new AbortController();
    controller.abort();
    const result = await fetcher(source.withData())("plasticov", {
      abortSignal: controller.signal,
    });
    expect(sourceResults(result)[source.resultKey]).toMatchObject({
      status: "aborted",
      attempts: 0,
    });
  });

  it.each(sources)(
    "passes the signal to $name and reports abort during request",
    async (source) => {
      const controller = new AbortController();
      let received: AbortSignal | undefined;
      const aborting = () => {
        controller.abort();
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      };
      const abortClient =
        source.name === "orders"
          ? client({
              getOrders: (_seller, options) => {
                received = options?.signal;
                return aborting();
              },
            })
          : source.name === "claims"
            ? client({
                searchClaims: (_seller, options) => {
                  received = options?.signal;
                  return aborting();
                },
              })
            : client({
                getProductAdsInsights: (_seller, options) => {
                  received = options?.signal;
                  return aborting();
                },
              });
      const result = await fetcher(abortClient)("plasticov", { abortSignal: controller.signal });
      expect(received).toBeInstanceOf(AbortSignal);
      expect(received).not.toBe(controller.signal);
      expect(received?.aborted).toBe(true);
      expect(sourceResults(result)[source.resultKey]).toMatchObject({
        status: "aborted",
        attempts: 1,
      });
    },
  );

  it.each(sources)(
    "reports local $name timeout without masquerading as a global abort",
    async (source) => {
      const controller = new AbortController();
      const timeout = new DOMException("Timed out", "AbortError");
      const timeoutClient =
        source.name === "orders"
          ? client({ getOrders: () => Promise.reject(timeout) })
          : source.name === "claims"
            ? client({ searchClaims: () => Promise.reject(timeout) })
            : client({ getProductAdsInsights: () => Promise.reject(timeout) });

      const timedOut = await fetcher(timeoutClient, { maxAttempts: 1 })("plasticov", {
        abortSignal: controller.signal,
      });

      expect(controller.signal.aborted).toBe(false);
      expect(sourceResults(timedOut)[source.resultKey]).toMatchObject({
        status: "source-timeout",
        attempts: 1,
      });

      const globalController = new AbortController();
      const globallyAborting = () => {
        globalController.abort();
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      };
      const globalClient =
        source.name === "orders"
          ? client({ getOrders: globallyAborting })
          : source.name === "claims"
            ? client({ searchClaims: globallyAborting })
            : client({ getProductAdsInsights: globallyAborting });
      const globallyAborted = await fetcher(globalClient)("plasticov", {
        abortSignal: globalController.signal,
      });

      expect(sourceResults(globallyAborted)[source.resultKey]).toMatchObject({
        status: "aborted",
        reasonCode: "global-abort",
        attempts: 1,
      });
    },
  );

  it.each(sources)(
    "aborts $name during fake-clock backoff without another request",
    async (source) => {
      const controller = new AbortController();
      const wait = vi.fn((_delayMs: number, signal?: AbortSignal) => {
        expect(signal).toBe(controller.signal);
        controller.abort();
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      });
      const limited = new MercadoLibreReadFailure(429, "retry=hidden", 10);
      const request = vi.fn(() => Promise.reject(limited));
      const abortClient =
        source.name === "orders"
          ? client({ getOrders: request })
          : source.name === "claims"
            ? client({ searchClaims: request })
            : client({ getProductAdsInsights: request });
      const result = await fetcher(abortClient, { maxAttempts: 2, wait })("plasticov", {
        abortSignal: controller.signal,
      });
      expect(request).toHaveBeenCalledTimes(1);
      expect(sourceResults(result)[source.resultKey]).toMatchObject({
        status: "aborted",
        attempts: 1,
      });
    },
  );

  it.each([
    {
      name: "failure",
      maxAttempts: 1,
      getOrders: () => () => Promise.reject(new MercadoLibreReadFailure(401)),
      expectedStatus: "unauthorized",
      expectedSkippedStatus: "unavailable",
    },
    {
      name: "malformed response",
      maxAttempts: 1,
      getOrders: () => () => Promise.resolve({ data: { invalid: true } }),
      expectedStatus: "malformed-response",
      expectedSkippedStatus: "unavailable",
    },
    {
      name: "rate budget exhaustion",
      maxAttempts: 2,
      getOrders: () => () => Promise.reject(new MercadoLibreReadFailure(429)),
      expectedStatus: "rate-limited",
      expectedSkippedStatus: "unavailable",
    },
    {
      name: "global abort",
      maxAttempts: 1,
      getOrders: (controller: AbortController) => () => {
        controller.abort();
        return Promise.reject(new DOMException("Aborted", "AbortError"));
      },
      expectedStatus: "aborted",
      expectedSkippedStatus: "aborted",
    },
  ])(
    "does not query Claims or Ads after terminal Orders $name",
    async ({ maxAttempts, getOrders, expectedStatus, expectedSkippedStatus }) => {
      const controller = new AbortController();
      const searchClaims = vi.fn(() => Promise.resolve({ data: { results: [claim] } }));
      const getProductAdsInsights = vi.fn(() => Promise.resolve({ data: { ads: [ad] } }));
      const getOrdersRequest = getOrders(controller);
      const result = await fetcher(
        client({ getOrders: getOrdersRequest, searchClaims, getProductAdsInsights }),
        { maxAttempts },
      )("plasticov", { abortSignal: controller.signal });

      const results = sourceResults(result);
      expect(results.orders.status).toBe(expectedStatus);
      expect(results.claims).toMatchObject({
        status: expectedSkippedStatus,
        attempts: 0,
        records: 0,
      });
      expect(results.productAds).toMatchObject({
        status: expectedSkippedStatus,
        attempts: 0,
        records: 0,
      });
      expect(searchClaims).not.toHaveBeenCalled();
      expect(getProductAdsInsights).not.toHaveBeenCalled();
    },
  );
});
