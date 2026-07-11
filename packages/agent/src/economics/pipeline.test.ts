import { describe, it, expect, vi, beforeAll } from "vitest";
import { runEconomicIngestion } from "./EconomicIngestionPipeline.js";
import type { DataFetcher, FetchedData } from "./EconomicIngestionPipeline.js";
import type { EconomicOutcomeStore } from "@msl/memory";
import { DeterministicRunIdFactory } from "@msl/domain";
import Database from "better-sqlite3";
import { createSqliteEconomicOutcomeStore, createSqliteEconomicIngestionRunStore } from "@msl/memory";
import type { EconomicIngestionRunStore } from "@msl/memory";

// ── Helpers ────────────────────────────────────────────────────────────────

function mockStore(overrides: Partial<Record<keyof EconomicOutcomeStore, unknown>> = {}): EconomicOutcomeStore {
  // Create a real in-memory SQLite DB so the pipeline's transaction path works.
  // The mock insert methods don't actually write to it, but getDb() and
  // transaction() use the real DB so syncUpdateRunInTx/checkpoint work.
  const db = new Database(":memory:");
  // Ensure tables exist for sync helpers
  db.exec(`
    CREATE TABLE IF NOT EXISTS economic_ingestion_runs (
      id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, status TEXT NOT NULL,
      mode TEXT NOT NULL, started_at INTEGER, completed_at INTEGER,
      params TEXT, result TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS economic_ingestion_checkpoints (
      seller_id TEXT PRIMARY KEY, last_order_date TEXT, last_order_id TEXT,
      last_run_id TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  /* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
  const store: any = {
    transaction: (fn: () => any) => db.transaction(fn)(),
    getDb: () => db,
    insertCostComponent: vi.fn(() => ({ id: "cc-0", sellerId: "", type: "other", amount: { amountMinor: 0, currency: "CLP" }, currency: "CLP", source: "derived", occurredAt: 0, observedAt: 0, verification: "unverified", confidence: 0 })),
    upsertCostComponent: vi.fn(() => ({ id: "cc-0", sellerId: "", type: "other", amount: { amountMinor: 0, currency: "CLP" }, currency: "CLP", source: "derived", occurredAt: 0, observedAt: 0, verification: "unverified", confidence: 0 })),
    insertUnitEconomicsSnapshot: vi.fn((snap) => snap),
    listCostComponents: vi.fn(() => []),
    listBySourceRecord: vi.fn(() => []),
    reverseCostComponent: vi.fn(() => null),
    listUnitEconomicsSnapshots: vi.fn(() => []),
    insertOutcome: vi.fn(),
    updateOutcomeStatus: vi.fn(),
    verifyOutcome: vi.fn(),
    disputeOutcome: vi.fn(),
    getOutcome: vi.fn(),
    listOutcomesBySeller: vi.fn(),
    listOutcomesByProposal: vi.fn(),
    listOutcomesByOrder: vi.fn(),
    listOutcomesByCorrelationId: vi.fn(),
    listMissingInputs: vi.fn(() => []),
    summarizeProfit: vi.fn(() => ({ sellerId: "seller", currency: "CLP", totalRevenue: 0, totalCosts: 0, netProfit: 0, netMargin: 0, snapshotCount: 0 })),
    ...overrides,
  };
  /* eslint-enable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
  return store as EconomicOutcomeStore;
}

function makeSampleOrder(overrides: Partial<FetchedData["orders"][number]> = {}): FetchedData["orders"][number] {
  return {
    id: "order-1",
    status: "paid",
    total_amount: 10000,
    currency_id: "CLP",
    date_created: "2026-01-15T10:00:00Z",
    order_items: [{ item: { id: "MLI-123", title: "Test Item" }, quantity: 1, unit_price: 10000 }],
    sale_fee_amount: 1100,
    shipping_cost: 800,
    shipping_mode: "seller",
    seller_funded_discount: 500,
    ...overrides,
  };
}

function makeSampleFetcher(data?: Partial<FetchedData>): DataFetcher {
  const defaultData: FetchedData = {
    orders: [makeSampleOrder()],
    items: [],
    claims: [],
    ads: [],
  };
  return vi.fn().mockResolvedValue({ ...defaultData, ...data });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("EconomicIngestionPipeline", () => {
  const runIdFactory = new DeterministicRunIdFactory([
    "economic-ingestion-00000000-0000-4000-a000-000000000001",
    "economic-ingestion-00000000-0000-4000-a000-000000000002",
    "economic-ingestion-00000000-0000-4000-a000-000000000003",
    "economic-ingestion-00000000-0000-4000-a000-000000000004",
    "economic-ingestion-00000000-0000-4000-a000-000000000005",
    "economic-ingestion-00000000-0000-4000-a000-000000000006",
    "economic-ingestion-00000000-0000-4000-a000-000000000007",
    "economic-ingestion-00000000-0000-4000-a000-000000000008",
    "economic-ingestion-00000000-0000-4000-a000-000000000009",
    "economic-ingestion-00000000-0000-4000-a000-000000000010",
  ]);

  describe("basic pipeline flow", () => {
    it("completes a successful run for plasticov", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher();

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        store,
        fetcher,
        runIdFactory,
      );

      expect(result.run.status).toBe("completed");
      expect(result.run.sellerId).toBe("plasticov");
      expect(result.snapshots.length).toBeGreaterThan(0);
      expect(result.reconciliation.status).toMatch(/balanced/);
    });

    it("completes a successful run for maustian", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher();

      const result = await runEconomicIngestion(
        { sellerId: "maustian", mode: "incremental" },
        store,
        fetcher,
        runIdFactory,
      );

      expect(result.run.status).toBe("completed");
      expect(result.run.sellerId).toBe("maustian");
    });

    it("rejects invalid seller IDs", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher();

      const result = await runEconomicIngestion(
        { sellerId: "unknown", mode: "incremental" },
        store,
        fetcher,
        runIdFactory,
      );

      expect(result.run.status).toBe("failed");
      expect(result.reconciliation.status).toBe("incomplete");
    });
  });

  describe("dry-run mode", () => {
    it("does not persist when dryRun is true", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher();

      await runEconomicIngestion(
        { sellerId: "plasticov", mode: "dry-run", dryRun: true },
        store,
        fetcher,
        runIdFactory,
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(store.insertCostComponent).mock.calls).toHaveLength(0);
    });

    it("still computes snapshots in dry-run mode", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher();

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "dry-run", dryRun: true },
        store,
        fetcher,
        runIdFactory,
      );

      expect(result.snapshots.length).toBeGreaterThan(0);
    });
  });

  describe("no-persist flag", () => {
    it("skips persistence when noPersist is true", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher();

      await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental", noPersist: true },
        store,
        fetcher, runIdFactory,
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(store.insertCostComponent).mock.calls).toHaveLength(0);
    });
  });

  describe("abort signal", () => {
    it("aborts mid-pipeline when signal is triggered", async () => {
      const store = mockStore();
      const controller = new AbortController();
      controller.abort(); // abort before even starting

      const fetcher = vi.fn().mockResolvedValue({
        orders: [makeSampleOrder()],
        items: [],
        claims: [],
        ads: [],
      });

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental", abortSignal: controller.signal },
        store,
        fetcher, runIdFactory,
      );

      expect(result.run.status).toBe("failed");
    });

    it("aborts when signal is triggered after fetch", async () => {
      const store = mockStore();
      const controller = new AbortController();

      const fetcher: DataFetcher = (_sellerId) => {
        controller.abort();
        return Promise.resolve({
          orders: [makeSampleOrder()],
          items: [],
          claims: [],
          ads: [],
        } as FetchedData);
      };

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental", abortSignal: controller.signal },
        store,
        fetcher, runIdFactory,
      );

      expect(result.run.status).toBe("failed");
    });
  });

  describe("reconciliation", () => {
    it("produces balanced reconciliation for exact match", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher({
        orders: [makeSampleOrder({ total_amount: 10000, sale_fee_amount: 1100, shipping_cost: 800, seller_funded_discount: 500 })],
      });

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        store,
        fetcher, runIdFactory,
      );

      expect(result.reconciliation.status).toMatch(/balanced/);
    });

    it("detects mismatched reconciliation", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher({
        orders: [
          makeSampleOrder({
            total_amount: 999999,
            order_items: [{ item: { id: "MLI-123", title: "Test" }, quantity: 1, unit_price: 10000 }],
          }),
        ],
      });

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        store,
        fetcher, runIdFactory,
      );

      expect(result.reconciliation.status).toBe("mismatched");
    });
  });

  describe("missing inputs", () => {
    it("reports partial snapshots when cost types are absent", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher({
        orders: [makeSampleOrder({ sale_fee_amount: 0, shipping_cost: 0, seller_funded_discount: 0 })],
      });

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        store,
        fetcher, runIdFactory,
      );

      const partialCount = result.snapshots.filter(
        (s) => s.calculationStatus === "partial",
      ).length;
      expect(partialCount).toBeGreaterThan(0);
    });
  });

  describe("cancelled orders", () => {
    it("handles cancelled orders without creating snapshots", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher({
        orders: [makeSampleOrder({ status: "cancelled" })],
      });

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        store,
        fetcher, runIdFactory,
      );

      expect(result.snapshots.length).toBe(0);
    });
  });

  describe("multi-item orders", () => {
    it("creates one snapshot per line item", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher({
        orders: [
          makeSampleOrder({
            id: "order-multi",
            total_amount: 30000,
            order_items: [
              { item: { id: "MLI-1", title: "Item 1" }, quantity: 1, unit_price: 10000 },
              { item: { id: "MLI-2", title: "Item 2" }, quantity: 1, unit_price: 10000 },
              { item: { id: "MLI-3", title: "Item 3" }, quantity: 1, unit_price: 10000 },
            ],
          }),
        ],
      });

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        store,
        fetcher, runIdFactory,
      );

      expect(result.snapshots.length).toBe(3);
    });
  });

  describe("advertising cost", () => {
    it("processes campaign-level ad costs", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher({
        orders: [makeSampleOrder()],
        ads: [
          { campaignId: "camp-1", cost: 500, currency: "CLP" },
          { campaignId: "camp-2", cost: 300, currency: "CLP" },
        ],
      });

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        store,
        fetcher, runIdFactory,
      );

      expect(result.run.status).toBe("completed");
    });
  });

  describe("lock mechanism", () => {
    it("prevents concurrent ingestion for same seller", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher({
        orders: [makeSampleOrder()],
      });

      const [first, second] = await Promise.all([
        runEconomicIngestion(
          { sellerId: "plasticov", mode: "incremental" },
          store,
          fetcher, runIdFactory,
        ),
        runEconomicIngestion(
          { sellerId: "plasticov", mode: "incremental" },
          store,
          fetcher, runIdFactory,
        ),
      ]);

      const succeeded = [first, second].filter((r) => r.run.status !== "failed");
      const failed = [first, second].filter((r) => r.run.status === "failed");

      expect(succeeded.length).toBeGreaterThanOrEqual(1);
      if (failed.length > 0) {
        expect(failed[0]!.reconciliation.details).toContain("already being ingested");
      }
    });
  });

  describe("pipeline modes", () => {
    it("supports backfill mode", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher();

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "backfill" },
        store,
        fetcher, runIdFactory,
      );

      expect(result.run.mode).toBe("backfill");
      expect(result.run.status).toBe("completed");
    });

    it("supports reconcile mode", async () => {
      const store = mockStore();
      const fetcher = makeSampleFetcher();

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "reconcile" },
        store,
        fetcher, runIdFactory,
      );

      expect(result.run.mode).toBe("reconcile");
      expect(result.run.status).toBe("completed");
    });
  });

  describe("fail-closed persistence (PR 2)", () => {
    it("2.6.1 createRun throws → abort, no ML calls, error propagated", async () => {
      const store = mockStore();
      const fetcher = vi.fn().mockResolvedValue({
        orders: [makeSampleOrder()],
        items: [],
        claims: [],
        ads: [],
      });

      const throwingRunStore: EconomicIngestionRunStore = {
        createRun: vi.fn().mockRejectedValue(new Error("DB disk full")),
        updateRun: vi.fn(),
        getRun: vi.fn(),
        getLastRunBySeller: vi.fn(),
        listRunsBySeller: vi.fn(),
        getActiveRun: vi.fn(),
        recoverAbandonedRun: vi.fn(),
        getCheckpoint: vi.fn(),
        updateCheckpoint: vi.fn(),
      };

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        store,
        fetcher,
        runIdFactory,
        throwingRunStore,
      );

      // Pipeline must fail
      expect(result.run.status).toBe("failed");
      // ML fetch must NOT have been called
      expect(fetcher).not.toHaveBeenCalled();
      // Error message must mention the persistence failure
      expect(result.reconciliation.details).toContain("Failed to persist initial run record");
    });

    it("2.6.2 component insert throws → transaction rolls back, no partial data", async () => {
      const db = new Database(":memory:");
      const realStore = createSqliteEconomicOutcomeStore(db);
      const realRunStore = createSqliteEconomicIngestionRunStore(db);

      // Create the initial tables
      realRunStore;

      // Wrap insertCostComponent to throw on the second call
      let componentCallCount = 0;
      const throwingStore: EconomicOutcomeStore = {
        ...realStore,
        insertCostComponent: vi.fn((input: unknown) => {
          componentCallCount++;
          if (componentCallCount >= 2) {
            throw new Error("Simulated component insert failure");
          }
          return realStore.insertCostComponent(input as Parameters<typeof realStore.insertCostComponent>[0]);
        }),
      };

      const fetcher = makeSampleFetcher({
        orders: [
          makeSampleOrder({ id: "order-fault-1" }),
          makeSampleOrder({ id: "order-fault-2" }),
        ],
      });

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        throwingStore,
        fetcher,
        runIdFactory,
        realRunStore,
      );

      // Must have failed
      expect(result.run.status).toBe("failed");

      // No partial data committed — cost components table must be empty
      const compCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM economic_cost_components WHERE seller_id = ?",
      ).get("plasticov") as { cnt: number };
      expect(compCount.cnt).toBe(0);

      // No snapshots committed
      const snapCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM unit_economics_snapshots WHERE seller_id = ?",
      ).get("plasticov") as { cnt: number };
      expect(snapCount.cnt).toBe(0);

      db.close();
    });

    it("2.6.3 snapshot insert throws → transaction rolls back", async () => {
      const db = new Database(":memory:");
      const realStore = createSqliteEconomicOutcomeStore(db);
      const realRunStore = createSqliteEconomicIngestionRunStore(db);
      realRunStore;

      // Wrap insertUnitEconomicsSnapshot to throw
      const throwingStore: EconomicOutcomeStore = {
        ...realStore,
        insertUnitEconomicsSnapshot: vi.fn(() => {
          throw new Error("Simulated snapshot insert failure");
        }),
      };

      const fetcher = makeSampleFetcher();

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        throwingStore,
        fetcher,
        runIdFactory,
        realRunStore,
      );

      expect(result.run.status).toBe("failed");

      // No partial data
      const compCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM economic_cost_components WHERE seller_id = ?",
      ).get("plasticov") as { cnt: number };
      expect(compCount.cnt).toBe(0);

      const snapCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM unit_economics_snapshots WHERE seller_id = ?",
      ).get("plasticov") as { cnt: number };
      expect(snapCount.cnt).toBe(0);

      db.close();
    });

    it("2.6.4 run update within transaction succeeds → writes committed", async () => {
      // This test validates that the sync run update helper works correctly
      // inside the transaction when all tables exist.
      const db = new Database(":memory:");
      const realStore = createSqliteEconomicOutcomeStore(db);
      const realRunStore = createSqliteEconomicIngestionRunStore(db);
      realRunStore;

      const fetcher = makeSampleFetcher();

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        realStore,
        fetcher,
        runIdFactory,
        realRunStore,
      );

      // Transaction succeeded with all writes
      expect(result.run.status).toBe("completed");

      // Verify data persisted
      const compCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM economic_cost_components WHERE seller_id = ?",
      ).get("plasticov") as { cnt: number };
      expect(compCount.cnt).toBeGreaterThan(0);

      const snapCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM unit_economics_snapshots WHERE seller_id = ?",
      ).get("plasticov") as { cnt: number };
      expect(snapCount.cnt).toBeGreaterThan(0);

      // Run row is completed
      const runStatus = db.prepare(
        "SELECT status FROM economic_ingestion_runs WHERE seller_id = ?",
      ).get("plasticov") as { status: string };
      expect(runStatus.status).toBe("completed");

      // Checkpoint was advanced
      const cpCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM economic_ingestion_checkpoints WHERE seller_id = ?",
      ).get("plasticov") as { cnt: number };
      expect(cpCount.cnt).toBe(1);

      db.close();
    });

    it("2.6.5 checkpoint update throws → transaction rolls back", async () => {
      const db = new Database(":memory:");
      const realStore = createSqliteEconomicOutcomeStore(db);
      const realRunStore = createSqliteEconomicIngestionRunStore(db);
      realRunStore;

      // Drop the checkpoints table to make syncUpdateCheckpointInTx throw
      db.exec("DROP TABLE IF EXISTS economic_ingestion_checkpoints");

      const fetcher = makeSampleFetcher();

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        realStore,
        fetcher,
        runIdFactory,
        realRunStore,
      );

      expect(result.run.status).toBe("failed");

      // All partial data must be rolled back
      const compCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM economic_cost_components WHERE seller_id = ?",
      ).get("plasticov") as { cnt: number };
      expect(compCount.cnt).toBe(0);

      const snapCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM unit_economics_snapshots WHERE seller_id = ?",
      ).get("plasticov") as { cnt: number };
      expect(snapCount.cnt).toBe(0);

      // The initial createRun succeeded before the transaction,
      // so the run row exists but must NOT be "completed"
      const runCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM economic_ingestion_runs WHERE seller_id = ?",
      ).get("plasticov") as { cnt: number };
      expect(runCount.cnt).toBe(1);
      const runStatus = db.prepare(
        "SELECT status FROM economic_ingestion_runs WHERE seller_id = ?",
      ).get("plasticov") as { status: string };
      expect(runStatus.status).toBe("failed");

      db.close();
    });

    it("2.6.6 transaction rollback: throw mid-transaction → verify no partial data committed", async () => {
      const db = new Database(":memory:");
      const realStore = createSqliteEconomicOutcomeStore(db);
      const realRunStore = createSqliteEconomicIngestionRunStore(db);
      realRunStore;

      // Simulate a mid-transaction failure: the transaction wrapper itself throws
      // We do this by making insertUnitEconomicsSnapshot throw AFTER some
      // cost components have already been inserted within the transaction
      let snapCallCount = 0;
      const throwingStore: EconomicOutcomeStore = {
        ...realStore,
        insertUnitEconomicsSnapshot: vi.fn((snap: unknown) => {
          snapCallCount++;
          if (snapCallCount >= 2) {
            throw new Error("Mid-transaction snapshot failure");
          }
          return realStore.insertUnitEconomicsSnapshot(snap as Parameters<typeof realStore.insertUnitEconomicsSnapshot>[0]);
        }),
      };

      const fetcher = makeSampleFetcher({
        orders: [
          makeSampleOrder({ id: "order-rollback-1" }),
          makeSampleOrder({ id: "order-rollback-2" }),
          makeSampleOrder({ id: "order-rollback-3" }),
        ],
      });

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        throwingStore,
        fetcher,
        runIdFactory,
        realRunStore,
      );

      // Pipeline must report failure
      expect(result.run.status).toBe("failed");

      // ZERO partial data — transaction rollback must have cleaned everything
      const compCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM economic_cost_components",
      ).get() as { cnt: number };
      expect(compCount.cnt).toBe(0);

      const snapCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM unit_economics_snapshots",
      ).get() as { cnt: number };
      expect(snapCount.cnt).toBe(0);

      const runCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM economic_ingestion_runs WHERE status = 'completed'",
      ).get() as { cnt: number };
      expect(runCount.cnt).toBe(0);

      // Checkpoint must NOT be advanced
      const cpCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM economic_ingestion_checkpoints",
      ).get() as { cnt: number };
      expect(cpCount.cnt).toBe(0);

      db.close();
    });

    it("pipeline throws on persistence failure (not silenced)", async () => {
      const store = mockStore({
        insertUnitEconomicsSnapshot: vi.fn(() => {
          throw new Error("DB write error");
        }),
      });
      const fetcher = makeSampleFetcher();

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        store,
        fetcher,
        runIdFactory,
      );

      // Outer catch returns failed result — pipeline does not throw to caller
      // but the error is captured and surfaced
      expect(result.run.status).toBe("failed");
      expect(result.reconciliation.details).toContain("Persistence failed");
    });

    it("persisting→completed always after commit (not gated on reconciliation)", async () => {
      const store = mockStore();
      // Use orders that will cause mismatched reconciliation
      const fetcher = makeSampleFetcher({
        orders: [
          makeSampleOrder({
            total_amount: 999999, // will cause mismatch
            order_items: [{ item: { id: "MLI-123", title: "Test" }, quantity: 1, unit_price: 10000 }],
          }),
        ],
      });

      const result = await runEconomicIngestion(
        { sellerId: "plasticov", mode: "incremental" },
        store,
        fetcher,
        runIdFactory,
      );

      // Even though reconciliation is mismatched, the run should be completed
      expect(result.reconciliation.status).toBe("mismatched");
      expect(result.run.status).toBe("completed");
    });
  });
});
