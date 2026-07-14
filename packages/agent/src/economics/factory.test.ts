import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEconomicIngestionRuntime } from "./factory.js";
import type { DataFetcher } from "./EconomicIngestionPipeline.js";
import type { MlcApiClient } from "@msl/mercadolibre";

describe("economic ingestion runtime factory", () => {
  it("constructs the admitted memory runtime from a safe database path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-economic-factory-"));
    const sourceSellerId = process.env.MERCADOLIBRE_SOURCE_SELLER_ID;
    const targetSellerId = process.env.MERCADOLIBRE_TARGET_SELLER_ID;
    process.env.MERCADOLIBRE_SOURCE_SELLER_ID = "1001";
    process.env.MERCADOLIBRE_TARGET_SELLER_ID = "1002";
    const dataFetcher = vi.fn<DataFetcher>(() =>
      Promise.resolve({ orders: [], items: [], claims: [], ads: [] }),
    );
    const runtime = createEconomicIngestionRuntime("source", {
      databasePath: join(directory, "economic.sqlite"),
      dataFetcher,
    });
    try {
      expect(runtime.health).toMatchObject({
        sellerId: "plasticov",
        storeReady: true,
        runStoreReady: true,
        evidenceStoreReady: true,
        maintenanceAdmissionReady: true,
      });
      await runtime.dataFetcher("plasticov");
      expect(dataFetcher).toHaveBeenCalledWith("plasticov", undefined);
    } finally {
      runtime.close();
      if (sourceSellerId === undefined) delete process.env.MERCADOLIBRE_SOURCE_SELLER_ID;
      else process.env.MERCADOLIBRE_SOURCE_SELLER_ID = sourceSellerId;
      if (targetSellerId === undefined) delete process.env.MERCADOLIBRE_TARGET_SELLER_ID;
      else process.env.MERCADOLIBRE_TARGET_SELLER_ID = targetSellerId;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("passes the productive request signal through the MLC adapter", async () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-economic-factory-signal-"));
    const sourceSellerId = process.env.MERCADOLIBRE_SOURCE_SELLER_ID;
    const targetSellerId = process.env.MERCADOLIBRE_TARGET_SELLER_ID;
    process.env.MERCADOLIBRE_SOURCE_SELLER_ID = "1001";
    process.env.MERCADOLIBRE_TARGET_SELLER_ID = "1002";
    const getOrders = vi.fn(
      (_sellerId: string, options?: { signal?: AbortSignal }) =>
        new Promise<{ data: unknown }>((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve({ data: [] }), { once: true });
        }),
    );
    const runtime = createEconomicIngestionRuntime("source", {
      databasePath: join(directory, "economic.sqlite"),
      mlClient: { getOrders } as unknown as MlcApiClient,
    });
    const controller = new AbortController();
    try {
      const fetchPromise = runtime.dataFetcher("plasticov", { abortSignal: controller.signal });
      await vi.waitFor(() => expect(getOrders).toHaveBeenCalledOnce());
      const requestSignal = getOrders.mock.calls[0]?.[1]?.signal;
      expect(requestSignal).toBeInstanceOf(AbortSignal);
      expect(requestSignal).not.toBe(controller.signal);
      controller.abort("test-deadline");
      await fetchPromise;
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      runtime.close();
      if (sourceSellerId === undefined) delete process.env.MERCADOLIBRE_SOURCE_SELLER_ID;
      else process.env.MERCADOLIBRE_SOURCE_SELLER_ID = sourceSellerId;
      if (targetSellerId === undefined) delete process.env.MERCADOLIBRE_TARGET_SELLER_ID;
      else process.env.MERCADOLIBRE_TARGET_SELLER_ID = targetSellerId;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      runtimeSeller: "source" as const,
      matchingSellerId: "plasticov",
      otherSellerId: "maustian",
      numericSellerId: "1001",
    },
    {
      runtimeSeller: "target" as const,
      matchingSellerId: "maustian",
      otherSellerId: "plasticov",
      numericSellerId: "1002",
    },
  ])(
    "binds the $runtimeSeller runtime to its configured seller",
    async ({ runtimeSeller, matchingSellerId, otherSellerId, numericSellerId }) => {
      const directory = mkdtempSync(join(tmpdir(), `msl-economic-factory-${runtimeSeller}-`));
      const sourceSellerId = process.env.MERCADOLIBRE_SOURCE_SELLER_ID;
      const targetSellerId = process.env.MERCADOLIBRE_TARGET_SELLER_ID;
      process.env.MERCADOLIBRE_SOURCE_SELLER_ID = "1001";
      process.env.MERCADOLIBRE_TARGET_SELLER_ID = "1002";
      const dataFetcher = vi.fn<DataFetcher>(() =>
        Promise.resolve({ orders: [], items: [], claims: [], ads: [] }),
      );
      const pipeline = vi.fn(() => Promise.resolve({} as never));
      const runtime = createEconomicIngestionRuntime(runtimeSeller, {
        databasePath: join(directory, `${runtimeSeller}.sqlite`),
        dataFetcher,
        pipeline,
      });
      const config = { sellerId: matchingSellerId, mode: "incremental" as const };
      try {
        expect(runtime.health).toMatchObject({
          sellerId: matchingSellerId,
          numericSellerId,
          sellerSlug: runtimeSeller,
        });
        expect(() => runtime.dataFetcher(otherSellerId)).toThrow("seller mismatch");
        expect(dataFetcher).not.toHaveBeenCalled();
        expect(() => runtime.pipeline({ ...config, sellerId: otherSellerId })).toThrow(
          "seller mismatch",
        );
        expect(pipeline).not.toHaveBeenCalled();

        await runtime.dataFetcher(matchingSellerId);
        await runtime.pipeline(config);
        expect(dataFetcher).toHaveBeenCalledWith(matchingSellerId, undefined);
        expect(pipeline).toHaveBeenCalledWith(config);
      } finally {
        runtime.close();
        if (sourceSellerId === undefined) delete process.env.MERCADOLIBRE_SOURCE_SELLER_ID;
        else process.env.MERCADOLIBRE_SOURCE_SELLER_ID = sourceSellerId;
        if (targetSellerId === undefined) delete process.env.MERCADOLIBRE_TARGET_SELLER_ID;
        else process.env.MERCADOLIBRE_TARGET_SELLER_ID = targetSellerId;
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
