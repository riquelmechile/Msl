import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEconomicIngestionDaemon } from "./economicIngestionDaemon.js";
import type { EconomicOutcomeStore } from "@msl/memory";
import type { EconomicCostComponent } from "@msl/domain";
import type { DataFetcher } from "../economics/EconomicIngestionPipeline.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";
import Database from "better-sqlite3";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDummyComponent(): EconomicCostComponent {
  return {
    id: "cc-1",
    sellerId: "plasticov",
    type: "other",
    amount: { amountMinor: 0, currency: "CLP" },
    currency: "CLP",
    source: "derived",
    occurredAt: 0,
    observedAt: 0,
    verification: "unverified",
    confidence: 0,
  };
}

function mockStore(): EconomicOutcomeStore {
  // Create a real in-memory DB so the transaction path works
  const db = new Database(":memory:");
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
    insertCostComponent: vi.fn(() => makeDummyComponent()),
    upsertCostComponent: vi.fn(() => makeDummyComponent()),
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
    summarizeProfit: vi.fn(() => ({ sellerId: "seller", currency: "CLP" as const, totalRevenue: 0, totalCosts: 0, netProfit: 0, netMargin: 0, snapshotCount: 0 })),
  };
  /* eslint-enable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
  return store as EconomicOutcomeStore;
}

function makeSampleFetcher(): DataFetcher {
  return vi.fn().mockResolvedValue({
    orders: [
      {
        id: "order-1",
        status: "paid",
        total_amount: 10000,
        currency_id: "CLP",
        date_created: "2026-01-15T10:00:00Z",
        order_items: [{ item: { id: "MLI-123", title: "Test" }, quantity: 1, unit_price: 10000 }],
        sale_fee_amount: 1100,
        shipping_cost: 800,
        shipping_mode: "seller",
        seller_funded_discount: 500,
      },
    ],
    items: [],
    claims: [],
    ads: [],
  });
}

function makeClaim(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    id: 1,
    messageId: "msg-1",
    senderAgentId: "system",
    receiverAgentId: "economic-ingestion",
    messageType: "daemon-tick",
    payloadJson: JSON.stringify({ cycleTimestamp: new Date().toISOString(), sellerId: "plasticov" }),
    status: "pending",
    priority: 0,
    attempts: 0,
    dedupeKey: "test-tick",
    lockedAt: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resultJson: null,
    errorJson: null,
    cancelReason: null,
    correlationId: null,
    parentMessageId: null,
    sellerId: "plasticov",
    learnedAt: null,
    outcomeScore: null,
    actionId: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("economicIngestionDaemon", () => {
  beforeEach(() => {
    delete (process.env as Record<string, string | undefined>).MSL_ECONOMIC_INGESTION_ENABLED;
  });

  describe("feature gate off", () => {
    it("returns empty result when enabled flag is false", async () => {
      const handler = createEconomicIngestionDaemon({
        enabled: false,
      });

      const result = await handler({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov"],
      });

      expect(result.findings).toHaveLength(0);
      expect(result.proposalEnqueued).toBe(false);
    });

    it("returns empty result when env var is not 'true'", async () => {
      const handler = createEconomicIngestionDaemon({
        enabled: true,
      });

      const result = await handler({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov"],
      });

      expect(result.findings).toHaveLength(0);
      expect(result.proposalEnqueued).toBe(false);
    });
  });

  describe("feature gate on", () => {
    beforeEach(() => {
      process.env.MSL_ECONOMIC_INGESTION_ENABLED = "true";
    });

    it("runs pipeline and returns findings", async () => {
      const handler = createEconomicIngestionDaemon({
        enabled: true,
        store: mockStore(),
        dataFetcher: makeSampleFetcher(),
        defaultSellerId: "plasticov",
      });

      const result = await handler({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov"],
      });

      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings[0]!.kind).toBe("info");
      expect(result.findings[0]!.summary).toContain("plasticov");
    });

    it("alerts when store dependency is missing", async () => {
      const handler = createEconomicIngestionDaemon({
        enabled: true,
        dataFetcher: makeSampleFetcher(),
      });

      const result = await handler({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov"],
      });

      expect(result.findings[0]!.kind).toBe("alert");
      expect(result.findings[0]!.summary).toContain("missing store");
    });

    it("alerts when dataFetcher dependency is missing", async () => {
      const handler = createEconomicIngestionDaemon({
        enabled: true,
        store: mockStore(),
      });

      const result = await handler({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov"],
      });

      expect(result.findings[0]!.kind).toBe("alert");
      expect(result.findings[0]!.summary).toContain("missing store");
    });

    it("falls back to first sellerId when defaultSellerId is not set", async () => {
      const handler = createEconomicIngestionDaemon({
        enabled: true,
        store: mockStore(),
        dataFetcher: makeSampleFetcher(),
      });

      const result = await handler({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov", "maustian"],
      });

      expect(result.findings[0]!.summary).toContain("plasticov");
    });
  });

  describe("idempotency / checkpoint", () => {
    beforeEach(() => {
      process.env.MSL_ECONOMIC_INGESTION_ENABLED = "true";
    });

    it("can be called multiple times without errors", async () => {
      const handler = createEconomicIngestionDaemon({
        enabled: true,
        store: mockStore(),
        dataFetcher: makeSampleFetcher(),
        defaultSellerId: "plasticov",
      });

      const ctx = {
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov"],
      };

      const result1 = await handler(ctx);
      const result2 = await handler(ctx);

      expect(result1.findings.length).toBeGreaterThan(0);
      expect(result2.findings.length).toBeGreaterThan(0);
    });
  });
});
