import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createSqliteSupplierMirrorStore } from "@msl/memory";
import type {
  SupplierItemSnapshot,
  SupplierMirrorLedgerRecord,
  SupplierMirrorNotificationEvent,
  SupplierRegistryEntry,
  SupplierStockObservation,
  SupplierTargetMapping,
  SupplierTargetPolicy,
} from "@msl/domain";

import {
  createSupplierMirrorAdapterRegistry,
  createSupplierMirrorRateLimiter,
  createSupplierMirrorWorker,
  createSyncJobStubs,
  criticalSyncSignals,
  evaluateSupplierMirrorRuntimeGate,
  evaluateStaleCriticalSignal,
  persistSupplierMirrorIngestion,
  runJinpengBootstrap,
  runSupplierMirrorStockBreakMonitor,
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

  it("fails closed unless the runtime gate explicitly approves scheduler startup", () => {
    const store = createMockSupplierMirrorStore();
    const intervalHandle = { scheduler: "supplier-mirror" };
    const setIntervalFn = vi.fn(() => intervalHandle as unknown as ReturnType<typeof setInterval>);
    const clearIntervalFn = vi.fn();

    const missingGateRuntime = startSupplierMirrorScheduler({
      enabled: true,
      store,
      adapters: new Map(),
      setIntervalFn,
    });

    expect(missingGateRuntime).toMatchObject({ enabled: false });
    expect(setIntervalFn).not.toHaveBeenCalled();

    const blockedGateRuntime = startSupplierMirrorScheduler({
      enabled: true,
      runtimeGate: {
        workerEnabled: false,
        status: "blocked",
        reasons: ["runtime readiness is not approved"],
        noMutationExecuted: true,
      },
      store,
      adapters: new Map(),
      setIntervalFn,
    });

    expect(blockedGateRuntime).toMatchObject({ enabled: false });
    expect(setIntervalFn).not.toHaveBeenCalled();

    const approvedGateRuntime = startSupplierMirrorScheduler({
      enabled: true,
      runtimeGate: {
        workerEnabled: true,
        status: "enabled",
        reasons: [],
        noMutationExecuted: true,
      },
      store,
      adapters: new Map(),
      intervalMs: 1_000,
      jitterMs: 0,
      setIntervalFn,
      clearIntervalFn,
    });

    expect(approvedGateRuntime).toMatchObject({ enabled: true, intervalMs: 1_000 });
    expect(setIntervalFn).toHaveBeenCalledTimes(1);

    approvedGateRuntime.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(intervalHandle);
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

  it("pauses a mapped listing only after authoritative stock-break verification and ledgers CEO notice", async () => {
    const store = createMockSupplierMirrorMonitorStore({ policyTargetSellerIds: ["maustian"] });
    const pause = vi.fn().mockResolvedValue({ status: "paused", evidenceId: "pause-evidence" });

    const result = await runSupplierMirrorStockBreakMonitor({
      store,
      pauseExecutor: { pause },
      now: () => new Date("2026-07-04T12:00:00.000Z"),
    });

    expect(pause).toHaveBeenCalledWith({
      targetSellerId: "maustian",
      targetItemId: "MLC-target-1",
      idempotencyKey: "supplier-mirror:stock-break:pause:xkp:XKP-1:maustian:MLC-target-1",
      evidenceIds: ["verified-stock-evidence", "verified-item-evidence", "mapping-evidence"],
    });
    expect(result).toMatchObject({
      candidatesEvaluated: 1,
      pausesExecuted: 1,
      deferred: 0,
      skipped: 0,
    });
    expect(store.ledgerRecords).toMatchObject([
      {
        actionType: "pause-listing",
        status: "executed",
        reason: "verified-stock-break-auto-pause-executed",
        targetSellerId: "maustian",
      },
    ]);
    expect(store.notificationEvents).toMatchObject([
      {
        type: "stock-break-confirmed",
        status: "pending",
        targetSellerId: "maustian",
      },
    ]);
  });

  it("defers and never calls the pause executor when the mapped target seller is no longer allowed by policy", async () => {
    const store = createMockSupplierMirrorMonitorStore({ policyTargetSellerIds: ["plasticov"] });
    const pause = vi.fn().mockResolvedValue({ status: "paused" });

    const result = await runSupplierMirrorStockBreakMonitor({
      store,
      pauseExecutor: { pause },
      now: () => new Date("2026-07-04T12:00:00.000Z"),
    });

    expect(pause).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      candidatesEvaluated: 1,
      pausesExecuted: 0,
      deferred: 1,
      skipped: 0,
    });
    expect(store.ledgerRecords).toMatchObject([
      {
        actionType: "defer",
        status: "deferred",
        reason: "target-seller-not-allowed-by-policy",
        targetSellerId: "maustian",
      },
    ]);
    expect(store.notificationEvents).toMatchObject([
      {
        type: "pause-deferred",
        reason: "target-seller-not-allowed-by-policy",
        targetSellerId: "maustian",
      },
    ]);
  });

  it("records an inconclusive verification notification without pausing", async () => {
    const store = createMockSupplierMirrorMonitorStore({
      policyTargetSellerIds: ["maustian"],
      observation: { confidence: "low", authority: "fallback-evidence" },
    });
    const pause = vi.fn().mockResolvedValue({ status: "paused" });

    const result = await runSupplierMirrorStockBreakMonitor({
      store,
      pauseExecutor: { pause },
      now: () => new Date("2026-07-04T12:00:00.000Z"),
    });

    expect(pause).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      candidatesEvaluated: 1,
      pausesExecuted: 0,
      deferred: 0,
      skipped: 1,
    });
    expect(store.ledgerRecords).toEqual([]);
    expect(store.notificationEvents).toMatchObject([
      {
        type: "verification-inconclusive",
        reason: "stock-break-verification-inconclusive",
      },
    ]);
  });
});

describe("Jinpeng Supplier Mirror bootstrap", () => {
  it("seeds disabled Jinpeng policy proposals idempotently with SQLite store evidence", async () => {
    const db = new Database(":memory:");
    try {
      const store = createSqliteSupplierMirrorStore(db);
      const options = {
        store,
        config: {
          mode: "apply-seed" as const,
          mlSellerId: "123456",
          mlNickname: "JINPENG-CL",
          xkpUrl: "https://www.xkp.cl/products",
          maustianSellerId: "maustian-ml",
          plasticovSellerId: "plasticov-ml",
          mlAccessTokenPresent: true,
          mlClientIdPresent: true,
          mlClientSecretPresent: true,
        },
        now: () => new Date("2026-07-04T12:00:00.000Z"),
      };

      const first = await runJinpengBootstrap(options);
      const second = await runJinpengBootstrap(options);

      await expect(store.getSupplier("jinpeng")).resolves.toMatchObject({
        id: "jinpeng",
        enabled: false,
        metadata: {
          secretsPersisted: false,
          runtimeEnabled: false,
          workerEnabled: false,
          defaultLowStockThreshold: 2,
        },
      });
      await expect(
        store.resolveTargetPolicy({ supplierId: "jinpeng", supplierItemId: "any-item" }),
      ).resolves.toMatchObject({
        scopeType: "supplier",
        scopeId: "jinpeng",
        targetSellerIds: ["maustian-ml", "plasticov-ml"],
        lowStockThreshold: 2,
        autoPauseAllowed: false,
      });
      await expect(
        store.getLearnedFallbackPolicy("supplier-mirror:pricing:jinpeng:maustian"),
      ).resolves.toMatchObject({
        policyType: "pricing",
        status: "proposed",
        decision: {
          multiplier: 2.5,
          contentPolicy: "owned/improved titles and descriptions",
          requiresCeoConfirmation: true,
        },
      });
      await expect(
        store.getLearnedFallbackPolicy("supplier-mirror:pricing:jinpeng:plasticov"),
      ).resolves.toMatchObject({
        policyType: "pricing",
        status: "proposed",
        decision: { multiplier: 2, requiresCeoConfirmation: true },
      });
      expect(second.ledgerRecords.map((record) => record.id)).toEqual(
        first.ledgerRecords.map((record) => record.id),
      );
      expect(db.prepare("SELECT COUNT(*) AS count FROM sync_ledger").get()).toEqual({ count: 3 });
      await expect(store.listEnabledSuppliers()).resolves.toEqual([]);
      expect(first.readinessReport).toMatchObject({
        status: "ready-for-ceo-decision",
        noMutationExecuted: true,
        workerEnabled: false,
      });
    } finally {
      db.close();
    }
  });

  it("keeps runtime disabled unless explicit config and readiness approval are present", () => {
    const unapprovedSupplier: SupplierRegistryEntry = {
      id: "jinpeng",
      name: "Jinpeng",
      enabled: false,
      primarySource: "mercadolibre-api",
      metadata: {
        runtimeEnabled: false,
        requiresCeoConfirmation: true,
        missingCredentials: [],
        missingSourceInfo: [],
      },
      createdAt: "2026-07-04T12:00:00.000Z",
      updatedAt: "2026-07-04T12:00:00.000Z",
    };
    const approvedSupplier: SupplierRegistryEntry = {
      ...unapprovedSupplier,
      enabled: true,
      metadata: {
        runtimeEnabled: true,
        requiresCeoConfirmation: false,
        missingCredentials: [],
        missingSourceInfo: [],
      },
    };

    expect(
      evaluateSupplierMirrorRuntimeGate({
        explicitWorkerEnabled: false,
        supplier: approvedSupplier,
      }),
    ).toMatchObject({ status: "disabled", workerEnabled: false, noMutationExecuted: true });
    const blockedGate = evaluateSupplierMirrorRuntimeGate({
      explicitWorkerEnabled: true,
      supplier: unapprovedSupplier,
    });
    expect(blockedGate).toMatchObject({
      status: "blocked",
      workerEnabled: false,
    });
    expect(blockedGate.reasons).toEqual(
      expect.arrayContaining([
        "supplier is not enabled after CEO approval",
        "runtime readiness is not approved",
        "CEO confirmation is still required",
      ]),
    );
    expect(
      evaluateSupplierMirrorRuntimeGate({
        explicitWorkerEnabled: true,
        supplier: approvedSupplier,
      }),
    ).toMatchObject({ status: "enabled", workerEnabled: true, reasons: [] });
  });

  it("records missing credentials and source gaps as blocked data without enabling runtime", async () => {
    const db = new Database(":memory:");
    try {
      const store = createSqliteSupplierMirrorStore(db);

      const result = await runJinpengBootstrap({
        store,
        config: {
          mode: "dry-run",
          mlAccessTokenPresent: false,
          mlClientIdPresent: false,
          mlClientSecretPresent: false,
        },
        now: () => new Date("2026-07-04T12:00:00.000Z"),
      });

      expect(result.readinessReport).toMatchObject({
        status: "blocked",
        missingCredentials: ["MELI_ACCESS_TOKEN", "MELI_CLIENT_ID", "MELI_CLIENT_SECRET"],
        missingSourceInfo: [
          "MSL_JINPENG_ML_SELLER_ID or MSL_JINPENG_ML_NICKNAME",
          "MSL_JINPENG_XKP_URL",
        ],
        noMutationExecuted: true,
        workerEnabled: false,
      });
      await expect(store.getSupplier("jinpeng")).resolves.toMatchObject({ enabled: false });
      await expect(store.listEnabledSuppliers()).resolves.toEqual([]);
      await expect(
        store.getLedgerByIdempotencyKey(
          "supplier-mirror:jinpeng-bootstrap:validation-skip:credentials",
        ),
      ).resolves.toMatchObject({
        actionType: "skip",
        status: "skipped",
        reason: "missing-mercadolibre-runtime-credentials",
      });
      await expect(
        store.getLedgerByIdempotencyKey("supplier-mirror:jinpeng-bootstrap:enablement-block"),
      ).resolves.toMatchObject({
        actionType: "defer",
        status: "deferred",
        reason: "jinpeng-enable-blocked-by-readiness-gaps",
      });
    } finally {
      db.close();
    }
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

function createMockSupplierMirrorMonitorStore(input: {
  policyTargetSellerIds: readonly string[];
  observation?: Partial<
    Pick<SupplierStockObservation, "authority" | "confidence" | "status" | "quantity">
  >;
}): SupplierMirrorStorePort & {
  ledgerRecords: SupplierMirrorLedgerRecord[];
  notificationEvents: SupplierMirrorNotificationEvent[];
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
  const snapshot: SupplierItemSnapshot = {
    supplierId: "xkp",
    supplierItemId: "XKP-1",
    mlItemId: "MLC-supplier-1",
    title: "Supplier item",
    categoryId: "tires",
    snapshot: {},
    source: "mercadolibre-api",
    confidence: "high",
    freshness: "fresh",
    evidenceId: "verified-item-evidence",
    capturedAt: "2026-07-04T11:59:00.000Z",
  };
  const policy: SupplierTargetPolicy = {
    scopeType: "supplier",
    scopeId: "xkp",
    supplierId: "xkp",
    targetSellerIds: input.policyTargetSellerIds,
    lowStockThreshold: 2,
    autoPauseAllowed: true,
  };
  const observation: SupplierStockObservation = {
    id: "stock-observation-1",
    supplierId: "xkp",
    supplierItemId: "XKP-1",
    source: "mercadolibre-api",
    authority: input.observation?.authority ?? "stock-authoritative",
    quantity: input.observation?.quantity ?? 0,
    status: input.observation?.status ?? "out-of-stock",
    confidence: input.observation?.confidence ?? "high",
    evidenceId: "verified-stock-evidence",
    capturedAt: "2026-07-04T11:59:30.000Z",
  };
  const mapping: SupplierTargetMapping = {
    supplierId: "xkp",
    supplierItemId: "XKP-1",
    targetSellerId: "maustian",
    targetItemId: "MLC-target-1",
    policyRef: { scopeType: "supplier", scopeId: "xkp", supplierId: "xkp" },
    state: "approved",
    approvedAt: "2026-07-04T11:00:00.000Z",
    evidenceIds: ["mapping-evidence"],
  };
  const ledgerRecords: SupplierMirrorLedgerRecord[] = [];
  const notificationEvents: SupplierMirrorNotificationEvent[] = [];

  return {
    ledgerRecords,
    notificationEvents,
    listEnabledSuppliers: () => Promise.resolve([supplier]),
    upsertSupplierItemSnapshot: () => Promise.resolve(),
    recordStockObservation: () => Promise.resolve(),
    listSupplierItemSnapshots: () => Promise.resolve([snapshot]),
    listStockObservations: () => Promise.resolve([observation]),
    listTargetMappings: () => Promise.resolve([mapping]),
    resolveTargetPolicy: () => Promise.resolve(policy),
    appendLedger(record) {
      ledgerRecords.push(record);
      return Promise.resolve(record);
    },
    recordNotificationEvent(event) {
      notificationEvents.push(event);
      return Promise.resolve(event);
    },
  };
}
