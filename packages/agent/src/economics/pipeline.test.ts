import { describe, it, expect, vi } from "vitest";
import { runEconomicIngestion } from "./EconomicIngestionPipeline.js";
import type { DataFetcher, FetchedData } from "./EconomicIngestionPipeline.js";
import type { EconomicOutcomeStore } from "@msl/memory";
import { DeterministicRunIdFactory } from "@msl/domain";

// ── Helpers ────────────────────────────────────────────────────────────────

function mockStore(): EconomicOutcomeStore {
  /* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
  const store: any = {
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
});
