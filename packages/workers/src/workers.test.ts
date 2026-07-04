import { describe, expect, it } from "vitest";
import type {
  SupplierItemSnapshot,
  SupplierRegistryEntry,
  SupplierStockObservation,
} from "@msl/domain";

import {
  createSupplierMirrorAdapterRegistry,
  createSupplierMirrorRateLimiter,
  createSupplierMirrorWorker,
  createSyncJobStubs,
  criticalSyncSignals,
  evaluateStaleCriticalSignal,
  persistSupplierMirrorIngestion,
  startSupplierMirrorScheduler,
  supplierMirrorDefaultPollIntervalMs,
  type SupplierMirrorStorePort,
  type SupplierSourceAdapter,
} from "./index.js";

describe("MercadoLibre sync job stubs", () => {
  it("creates scoped stubs for every critical business signal", async () => {
    const jobs = createSyncJobStubs("seller-1");

    expect(jobs.map((job) => job.signalKind)).toEqual(criticalSyncSignals);
    await expect(jobs[0]?.run()).resolves.toEqual({ status: "stubbed", signalKind: "order" });
  });
});

describe("stale critical-signal refresh policy", () => {
  it.each(criticalSyncSignals)("enqueues refresh for stale %s signals", (signalKind) => {
    const decision = evaluateStaleCriticalSignal({
      signalKind,
      capturedAt: new Date("2026-06-25T12:00:00.000Z"),
      now: new Date("2026-06-25T12:06:00.000Z"),
    });

    expect(decision).toMatchObject({
      signalKind,
      shouldEnqueueRefresh: true,
      refreshMode: "webhook-or-risk-scheduled",
      disclosure: "critical-signal-stale",
    });
  });

  it("does not enqueue a wasteful refresh for fresh critical signals", () => {
    const decision = evaluateStaleCriticalSignal({
      signalKind: "order",
      capturedAt: new Date("2026-06-25T12:00:00.000Z"),
      now: new Date("2026-06-25T12:01:00.000Z"),
    });

    expect(decision).toMatchObject({
      shouldEnqueueRefresh: false,
      refreshMode: "none",
      disclosure: "not-needed",
    });
  });
});

describe("Supplier Mirror worker foundation", () => {
  it("starts disabled by default with a 10-minute polling interval", () => {
    const store = createMockSupplierMirrorStore();
    const runtime = startSupplierMirrorScheduler({
      store,
      adapters: new Map(),
      setIntervalFn: () => {
        throw new Error("disabled scheduler must not register an interval");
      },
    });

    expect(runtime).toMatchObject({
      enabled: false,
      intervalMs: supplierMirrorDefaultPollIntervalMs,
    });
  });

  it("keeps source adapters in an explicit registry", () => {
    const adapter = createMockSourceAdapter({ status: "in-stock", quantity: 8 });
    const registry = createSupplierMirrorAdapterRegistry();

    registry.register("xkp", adapter);

    expect(registry.get("xkp")).toBe(adapter);
    expect(registry.asReadonlyMap().get("xkp")).toBe(adapter);
  });

  it("persists source ingestion snapshots and stock observations", async () => {
    const store = createMockSupplierMirrorStore();
    const adapter = createMockSourceAdapter({ status: "out-of-stock", quantity: 0 });
    const collectResult = await adapter.collect({ supplierId: "xkp" });

    const result = await persistSupplierMirrorIngestion(store, collectResult);

    expect(result).toEqual({
      itemsPersisted: 1,
      observationsPersisted: 1,
      evidenceIds: ["verified-api-evidence", "verified-stock-evidence"],
    });
    expect(store.snapshots).toHaveLength(1);
    expect(store.stockObservations).toHaveLength(1);
  });

  it("runs one disabled-by-default worker ingestion cycle through registered adapters", async () => {
    const store = createMockSupplierMirrorStore();
    const adapter = createMockSourceAdapter({ status: "in-stock", quantity: 8 });
    const registry = createSupplierMirrorAdapterRegistry(new Map([["xkp", adapter]]));
    const worker = createSupplierMirrorWorker({ store, adapters: registry.asReadonlyMap() });

    const result = await worker.runOnce();

    expect(result).toEqual({
      status: "completed",
      suppliersChecked: 1,
      suppliersSkippedByRateLimit: 0,
      itemsPersisted: 1,
      observationsPersisted: 1,
      evidenceIds: ["verified-api-evidence", "verified-stock-evidence"],
    });
  });

  it("applies per-supplier rate limits before ingestion", async () => {
    const store = createMockSupplierMirrorStore();
    const adapter = createMockSourceAdapter({ status: "out-of-stock", quantity: 0 });
    const rateLimiter = createSupplierMirrorRateLimiter({
      minIntervalMs: 60_000,
      now: () => new Date("2026-07-03T12:00:00.000Z"),
    });
    expect(rateLimiter.allow("supplier-mirror:rate-limit:supplier:xkp")).toBe(true);
    const worker = createSupplierMirrorWorker({
      store,
      adapters: new Map([["xkp", adapter]]),
      rateLimiter,
    });

    const result = await worker.runOnce();

    expect(result).toMatchObject({ suppliersChecked: 0, suppliersSkippedByRateLimit: 1 });
    expect(store.snapshots).toEqual([]);
    expect(store.stockObservations).toEqual([]);
  });
});

function createMockSupplierMirrorStore(): SupplierMirrorStorePort & {
  snapshots: SupplierItemSnapshot[];
  stockObservations: SupplierStockObservation[];
} {
  const supplier: SupplierRegistryEntry = {
    id: "xkp",
    name: "Jinpeng / XKP",
    enabled: true,
    primarySource: "mercadolibre-api",
    metadata: {},
    createdAt: "2026-07-03T11:00:00.000Z",
    updatedAt: "2026-07-03T11:00:00.000Z",
  };
  const snapshots: SupplierItemSnapshot[] = [];
  const stockObservations: SupplierStockObservation[] = [];

  return {
    snapshots,
    stockObservations,
    listEnabledSuppliers: () => Promise.resolve([supplier]),
    upsertSupplierItemSnapshot(snapshot) {
      snapshots.push(snapshot);
      return Promise.resolve();
    },
    recordStockObservation(observation) {
      stockObservations.push(observation);
      return Promise.resolve();
    },
  };
}

function createMockSourceAdapter(
  input: Pick<SupplierStockObservation, "status" | "quantity"> &
    Partial<Pick<SupplierStockObservation, "authority" | "confidence">>,
): SupplierSourceAdapter {
  return {
    source: "mercadolibre-api",
    collect(request) {
      const supplierItemId = request.itemIds?.[0] ?? "XKP-1";
      const capturedAt = "2026-07-03T12:00:00.000Z";
      return Promise.resolve({
        supplierId: request.supplierId,
        source: "mercadolibre-api",
        items: [
          {
            supplierId: request.supplierId,
            supplierItemId,
            mlItemId: "MLC-supplier-1",
            title: "Supplier item",
            categoryId: "tires",
            snapshot: {},
            source: "mercadolibre-api",
            confidence: "high",
            freshness: "fresh",
            evidenceId: "verified-item-evidence",
            capturedAt,
          },
        ],
        stockObservations: [
          {
            id: "stock-observation-1",
            supplierId: request.supplierId,
            supplierItemId,
            source: "mercadolibre-api",
            authority: input.authority ?? "stock-authoritative",
            quantity: input.quantity,
            status: input.status,
            confidence: input.confidence ?? "high",
            evidenceId: "verified-stock-evidence",
            capturedAt,
          },
        ],
        evidence: [
          {
            id: "verified-api-evidence",
            supplierId: request.supplierId,
            supplierItemId,
            source: "mercadolibre-api",
            confidence: input.confidence ?? "high",
            freshness: "fresh",
            capturedAt,
            summary: "Mock verification evidence.",
            metadata: {},
          },
        ],
      });
    },
  };
}
