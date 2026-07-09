import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { createGraphEngine } from "@msl/memory";
import type { GraphEngine } from "@msl/memory";
import type { SupplierMirrorStore } from "@msl/memory";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import type {
  AgentMessageBusStore,
  AgentMessage,
} from "../../src/conversation/agentMessageBusStore.js";
import { supplierManagerDaemon } from "../../src/workers/supplierManagerDaemon.js";

// ── Helpers ─────────────────────────────────────────────────────────

const SELLER_IDS = ["seller-a", "seller-b"];

function claimFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 1,
    messageId: overrides.messageId ?? crypto.randomUUID(),
    senderAgentId: overrides.senderAgentId ?? "ceo",
    receiverAgentId: overrides.receiverAgentId ?? "supplier-manager",
    messageType: overrides.messageType ?? "task",
    payloadJson: overrides.payloadJson ?? "{}",
    status: overrides.status ?? "processing",
    priority: overrides.priority ?? 5,
    attempts: overrides.attempts ?? 0,
    dedupeKey: overrides.dedupeKey ?? null,
    lockedAt: overrides.lockedAt ?? null,
    resolvedAt: overrides.resolvedAt ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

/** Seed a Cortex listing snapshot node. */
function seedListingNode(
  engine: GraphEngine,
  itemId: string,
  overrides: {
    sellerId?: string;
    stock?: number;
    price?: number;
  } = {},
): number {
  const node = engine.getOrCreateNode(
    `listing_snapshot_${itemId}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    {
      type: "listing_snapshot",
      itemId,
      sellerId: overrides.sellerId ?? SELLER_IDS[0],
      stock: overrides.stock ?? 10,
      available_quantity: overrides.stock ?? 10,
      price: overrides.price ?? 10000,
    },
  );
  return node.id;
}

type StoreMethods = keyof SupplierMirrorStore;

/** Build a mock SupplierMirrorStore with configurable method implementations. */
function mockStore(
  overrides: Partial<{
    [K in StoreMethods]: SupplierMirrorStore[K];
  }> = {},
): SupplierMirrorStore {
  const noop = async () => {};
  const emptyList = () => Promise.resolve([]);
  const nullResult = () => Promise.resolve(null);

  return {
    upsertSupplier: overrides.upsertSupplier ?? noop,
    getSupplier: (overrides.getSupplier as SupplierMirrorStore["getSupplier"]) ?? nullResult,
    listEnabledSuppliers:
      overrides.listEnabledSuppliers ??
      (() =>
        Promise.resolve([
          {
            id: "su-1",
            name: "Test Supplier",
            enabled: true,
            primarySource: "mercadolibre-api" as const,
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ])),
    upsertSupplierItemSnapshot: overrides.upsertSupplierItemSnapshot ?? noop,
    getSupplierItemSnapshot:
      (overrides.getSupplierItemSnapshot as SupplierMirrorStore["getSupplierItemSnapshot"]) ??
      nullResult,
    listSupplierItemSnapshots:
      (overrides.listSupplierItemSnapshots as SupplierMirrorStore["listSupplierItemSnapshots"]) ??
      emptyList,
    recordStockObservation: overrides.recordStockObservation ?? noop,
    listStockObservations:
      (overrides.listStockObservations as SupplierMirrorStore["listStockObservations"]) ??
      emptyList,
    upsertTargetMapping: overrides.upsertTargetMapping ?? noop,
    listTargetMappings:
      (overrides.listTargetMappings as SupplierMirrorStore["listTargetMappings"]) ?? emptyList,
    upsertTargetPolicy: overrides.upsertTargetPolicy ?? noop,
    resolveTargetPolicy:
      (overrides.resolveTargetPolicy as SupplierMirrorStore["resolveTargetPolicy"]) ?? nullResult,
    appendLedger:
      (overrides.appendLedger as SupplierMirrorStore["appendLedger"]) ?? (async (r) => r), // eslint-disable-line @typescript-eslint/require-await
    getLedgerByIdempotencyKey:
      (overrides.getLedgerByIdempotencyKey as SupplierMirrorStore["getLedgerByIdempotencyKey"]) ??
      nullResult,
    recordNotificationEvent:
      (overrides.recordNotificationEvent as SupplierMirrorStore["recordNotificationEvent"]) ??
      (async (e) => e), // eslint-disable-line @typescript-eslint/require-await
    getNotificationEvent:
      (overrides.getNotificationEvent as SupplierMirrorStore["getNotificationEvent"]) ?? nullResult,
    listNotificationEvents:
      (overrides.listNotificationEvents as SupplierMirrorStore["listNotificationEvents"]) ??
      emptyList,
    saveNotificationPreference: overrides.saveNotificationPreference ?? noop,
    getNotificationPreference:
      (overrides.getNotificationPreference as SupplierMirrorStore["getNotificationPreference"]) ??
      nullResult,
    upsertLearnedFallbackPolicy: overrides.upsertLearnedFallbackPolicy ?? noop,
    getLearnedFallbackPolicy:
      (overrides.getLearnedFallbackPolicy as SupplierMirrorStore["getLearnedFallbackPolicy"]) ??
      nullResult,
    listTargetPolicies:
      (overrides.listTargetPolicies as SupplierMirrorStore["listTargetPolicies"]) ?? emptyList,
    listApprovedItemMappings:
      (overrides.listApprovedItemMappings as SupplierMirrorStore["listApprovedItemMappings"]) ??
      emptyList,
    listLearnedFallbackPolicies:
      (overrides.listLearnedFallbackPolicies as SupplierMirrorStore["listLearnedFallbackPolicies"]) ??
      emptyList,
  };
}

function defaultItem(overrides: Record<string, unknown> = {}) {
  return {
    supplierId: "su-1",
    supplierItemId: "ITM-1",
    title: "Test Product",
    sku: "TST-001",
    categoryId: "MLC1234",
    price: 10000,
    currency: "CLP",
    snapshot: {},
    source: "mercadolibre-api" as const,
    confidence: "high" as const,
    freshness: "fresh" as const,
    evidenceId: "ev-001",
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

function defaultMapping(overrides: Record<string, unknown> = {}) {
  return {
    supplierId: "su-1",
    supplierItemId: "ITM-1",
    targetSellerId: "seller-a",
    targetItemId: "MLC-A-001",
    policyRef: {
      scopeType: "supplier" as const,
      scopeId: "su-1",
      supplierId: "su-1",
    },
    state: "approved" as const,
    approvedAt: new Date().toISOString(),
    evidenceIds: [],
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("supplierManagerDaemon", () => {
  let bus: AgentMessageBusStore;
  let engine: GraphEngine;
  let busDb: Database.Database;

  beforeEach(() => {
    busDb = new Database(":memory:");
    busDb.pragma("journal_mode = WAL");
    bus = createAgentMessageBusStore(busDb);
    engine = createGraphEngine(":memory:");
  });

  // ── 3.1 Stock discrepancy ──────────────────────────────────────

  describe("stock discrepancy detection (task 3.1)", () => {
    it("detects stock gap: one seller >0, another =0 → critical finding", async () => {
      seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
      seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem()]),
        listTargetMappings: () =>
          Promise.resolve([
            defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }),
            defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }),
          ]),
        getLedgerByIdempotencyKey: () => Promise.resolve(null),
        appendLedger: (r) => Promise.resolve(r),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      expect(result.findings.length).toBe(1);
      expect(result.findings[0]!.severity).toBe("critical");
      expect(result.findings[0]!.kind).toBe("alert");
      expect(result.findings[0]!.summary).toContain("Stock discrepancy");
      expect(result.findings[0]!.summary).toContain("seller-a");
      expect(result.findings[0]!.summary).toContain("seller-b");
      expect(result.proposalEnqueued).toBe(true);
      expect(result.messageIds.length).toBeGreaterThan(0);
    });

    it("all stock >0 → no finding", async () => {
      seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
      seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 5 });

      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem()]),
        listTargetMappings: () =>
          Promise.resolve([
            defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }),
            defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }),
          ]),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      const stockGaps = result.findings.filter((f) => f.severity === "critical");
      expect(stockGaps.length).toBe(0);
    });

    it("single mapping → no stock discrepancy detection", async () => {
      seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });

      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem()]),
        listTargetMappings: () =>
          Promise.resolve([
            defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }),
          ]),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      const stockGaps = result.findings.filter((f) => f.severity === "critical");
      expect(stockGaps.length).toBe(0);
    });
  });

  // ── 3.2 Price change ───────────────────────────────────────────

  describe("price change detection (task 3.2)", () => {
    it(">5% delta → warning with old/new price", async () => {
      const capturedAt = new Date().toISOString();
      const hourKey = capturedAt.slice(0, 13); // eslint-disable-line @typescript-eslint/no-unused-vars
      const prevHour = new Date(Date.now() - 3_600_000).toISOString().slice(0, 13);

      // Seed a prior price record for the previous hour
      const appendLedger = ((r: Record<string, unknown>) => Promise.resolve(r)) as never;

      const store = mockStore({
        listSupplierItemSnapshots: () =>
          Promise.resolve([
            defaultItem({ price: 1100 }), // current price → 1100
          ]),
        listTargetMappings: () => Promise.resolve([]),
        getLedgerByIdempotencyKey: (key: string) => {
          // Return a prior record for the previous hour
          if (key.includes(prevHour)) {
            return Promise.resolve({
              id: `price-record-${prevHour}`,
              actionType: "skip",
              idempotencyKey: key,
              status: "skipped",
              reason: "Previous price check",
              supplierId: "su-1",
              supplierItemId: "ITM-1",
              evidenceIds: [],
              before: null,
              after: { price: 1000 }, // prior price → 1000
              createdAt: new Date(Date.now() - 3_600_000).toISOString(),
            });
          }
          return Promise.resolve(null); // no hourly record yet
        },
        appendLedger,
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      const priceFindings = result.findings.filter(
        (f) => f.severity === "warning" && f.summary.includes("Price"),
      );
      expect(priceFindings.length).toBe(1);
      expect(priceFindings[0]!.summary).toContain("increase");
      expect(priceFindings[0]!.summary).toContain("1000");
      expect(priceFindings[0]!.summary).toContain("1100");
      expect(priceFindings[0]!.summary).toContain("10.0%");
    });

    it("≤5% delta → no finding", async () => {
      const capturedAt = new Date().toISOString(); // eslint-disable-line @typescript-eslint/no-unused-vars
      const prevHour = new Date(Date.now() - 3_600_000).toISOString().slice(0, 13);

      const store = mockStore({
        listSupplierItemSnapshots: () =>
          Promise.resolve([
            defaultItem({ price: 1020 }), // 2% increase from 1000
          ]),
        listTargetMappings: () => Promise.resolve([]),
        getLedgerByIdempotencyKey: (key: string) => {
          if (key.includes(prevHour)) {
            return Promise.resolve({
              id: `price-record-${prevHour}`,
              actionType: "skip",
              idempotencyKey: key,
              status: "skipped",
              reason: "Previous price check",
              supplierId: "su-1",
              supplierItemId: "ITM-1",
              evidenceIds: [],
              before: null,
              after: { price: 1000 },
              createdAt: new Date(Date.now() - 3_600_000).toISOString(),
            });
          }
          return Promise.resolve(null);
        },
        appendLedger: (r) => Promise.resolve(r),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      const priceFindings = result.findings.filter(
        (f) => f.severity === "warning" && f.summary.includes("Price"),
      );
      expect(priceFindings.length).toBe(0);
    });

    it("single observation → no finding", async () => {
      // No prior ledger record → first time seeing this item
      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem({ price: 1000 })]),
        listTargetMappings: () => Promise.resolve([]),
        getLedgerByIdempotencyKey: () => Promise.resolve(null),
        appendLedger: (r) => Promise.resolve(r),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      const priceFindings = result.findings.filter(
        (f) => f.severity === "warning" && f.summary.includes("Price"),
      );
      expect(priceFindings.length).toBe(0);
    });

    it("item has no price → skipped", async () => {
      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem({ price: undefined })]),
        listTargetMappings: () => Promise.resolve([]),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      const priceFindings = result.findings.filter((f) => f.summary.includes("Price"));
      expect(priceFindings.length).toBe(0);
    });
  });

  // ── 3.3 Unfilled mirror ────────────────────────────────────────

  describe("unfilled mirror detection (task 3.3)", () => {
    it("no mlItemId + no mappings → warning finding", async () => {
      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem({ mlItemId: undefined })]),
        listTargetMappings: () => Promise.resolve([]),
        getLedgerByIdempotencyKey: () => Promise.resolve(null),
        appendLedger: (r) => Promise.resolve(r),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      const unfilled = result.findings.filter((f) => f.summary.includes("Unfilled mirror"));
      expect(unfilled.length).toBe(1);
      expect(unfilled[0]!.severity).toBe("warning");
      expect(unfilled[0]!.summary).toContain("ITM-1");
    });

    it("mlItemId set → no unfilled finding", async () => {
      const store = mockStore({
        listSupplierItemSnapshots: () =>
          Promise.resolve([defaultItem({ mlItemId: "MLC-EXISTING-001" })]),
        listTargetMappings: () => Promise.resolve([]),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      const unfilled = result.findings.filter((f) => f.summary.includes("Unfilled mirror"));
      expect(unfilled.length).toBe(0);
    });

    it("has mappings → no unfilled finding even without mlItemId", async () => {
      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem({ mlItemId: undefined })]),
        listTargetMappings: () => Promise.resolve([defaultMapping()]),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      const unfilled = result.findings.filter((f) => f.summary.includes("Unfilled mirror"));
      expect(unfilled.length).toBe(0);
    });
  });

  // ── 3.4 Graceful degrade ───────────────────────────────────────

  describe("graceful degrade (task 3.4)", () => {
    it("undefined store → empty findings, no error", async () => {
      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: undefined as never,
      });

      expect(result.findings).toEqual([]);
      expect(result.proposalEnqueued).toBe(false);
      expect(result.messageIds).toEqual([]);
    });

    it("store present but listEnabledSuppliers throws → graceful return", async () => {
      const store = mockStore({
        listEnabledSuppliers: () => Promise.reject(new Error("DB error")),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      expect(result.findings).toEqual([]);
      expect(result.proposalEnqueued).toBe(false);
    });

    it("store present but listSupplierItemSnapshots throws → graceful per supplier", async () => {
      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.reject(new Error("Item error")),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      expect(result.findings).toEqual([]);
      expect(result.proposalEnqueued).toBe(false);
    });
  });

  // ── 3.5 Dedupe ─────────────────────────────────────────────────

  describe("dedup via sync ledger (task 3.5)", () => {
    it("ledger key exists → signal skipped", async () => {
      const currentHour = new Date().toISOString().slice(0, 13);
      const idempotencyKey = `stock-gap_su-1_ITM-1_${currentHour}`;

      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem()]),
        listTargetMappings: () =>
          Promise.resolve([
            defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }),
            defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }),
          ]),
        getLedgerByIdempotencyKey: (key: string) => {
          // Return existing record for the stock gap key
          if (key === idempotencyKey) {
            return Promise.resolve({
              id: idempotencyKey,
              actionType: "skip",
              idempotencyKey,
              status: "skipped",
              reason: "Already detected",
              supplierId: "su-1",
              supplierItemId: "ITM-1",
              evidenceIds: [],
              before: null,
              after: null,
              createdAt: new Date().toISOString(),
            });
          }
          return Promise.resolve(null);
        },
        appendLedger: (r) => Promise.resolve(r),
      });

      seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
      seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      // Stock gap finding should be skipped due to existing ledger key
      const stockGaps = result.findings.filter((f) => f.severity === "critical");
      expect(stockGaps.length).toBe(0);
    });

    it("no match → finding enqueued and appended to ledger", async () => {
      let appended = false;

      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem({ mlItemId: undefined })]),
        listTargetMappings: () => Promise.resolve([]),
        getLedgerByIdempotencyKey: () => Promise.resolve(null),
        appendLedger: (r) => {
          appended = true;
          return Promise.resolve(r as never);
        },
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      expect(result.findings.length).toBeGreaterThan(0);
      expect(appended).toBe(true);
    });
  });

  // ── 3.6 Partial Cortex ─────────────────────────────────────────

  describe("partial Cortex data (task 3.6)", () => {
    it("one seller missing listing snapshot → other sellers evaluated", async () => {
      // Only seed Cortex data for seller-a, not seller-b
      seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });

      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem()]),
        listTargetMappings: () =>
          Promise.resolve([
            defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }),
            defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }),
          ]),
        getLedgerByIdempotencyKey: () => Promise.resolve(null),
        appendLedger: (r) => Promise.resolve(r),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      // seller-b has no Cortex data → only one seller in the map → no detection
      const stockGaps = result.findings.filter((f) => f.severity === "critical");
      expect(stockGaps.length).toBe(0);

      // The daemon should not crash
      expect(result).toBeDefined();
    });

    it("no Cortex data at all → no stock discrepancy findings", async () => {
      // No seedListingNode calls — Cortex is empty

      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem()]),
        listTargetMappings: () =>
          Promise.resolve([
            defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }),
            defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }),
          ]),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      const stockGaps = result.findings.filter((f) => f.severity === "critical");
      expect(stockGaps.length).toBe(0);
    });
  });

  // ── Combined / CEO enqueue ─────────────────────────────────────

  describe("CEO proposal enqueue", () => {
    it("enqueues grouped proposals with noMutationExecuted: true", async () => {
      seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
      seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem()]),
        listTargetMappings: () =>
          Promise.resolve([
            defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }),
            defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }),
          ]),
        getLedgerByIdempotencyKey: () => Promise.resolve(null),
        appendLedger: (r) => Promise.resolve(r),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.messageIds.length).toBeGreaterThan(0);

      // Check the enqueued messages
      const ceoMessages = busDb
        .prepare(
          "SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'ceo' AND message_type = 'proposal'",
        )
        .all() as Array<Record<string, unknown>>;

      expect(ceoMessages.length).toBeGreaterThan(0);

      for (const msg of ceoMessages) {
        const payload = JSON.parse(msg.payload_json as string); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        expect(payload.type).toBe("proposal"); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
        expect(payload.noMutationExecuted).toBe(true); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
        expect(payload.summary).toContain("Supplier"); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
        expect(msg.sender_agent_id).toBe("supplier-manager");
      }
    });

    it("no findings → proposalEnqueued: false", async () => {
      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([]),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      expect(result.findings).toEqual([]);
      expect(result.proposalEnqueued).toBe(false);
      expect(result.messageIds).toEqual([]);
    });
  });

  // ── Multi-supplier ─────────────────────────────────────────────

  describe("multiple suppliers", () => {
    it("processes multiple suppliers independently", async () => {
      seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 0 });
      seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 5 });

      const store = mockStore({
        listEnabledSuppliers: () =>
          Promise.resolve([
            {
              id: "su-1",
              name: "Supplier A",
              enabled: true,
              primarySource: "mercadolibre-api" as const,
              metadata: {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: "su-2",
              name: "Supplier B",
              enabled: true,
              primarySource: "mercadolibre-api" as const,
              metadata: {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ]),
        listSupplierItemSnapshots: (supplierId: string) => {
          if (supplierId === "su-1") {
            return Promise.resolve([defaultItem({ supplierItemId: "ITM-1", price: 1000 })]);
          }
          return Promise.resolve([
            defaultItem({ supplierItemId: "ITM-2", price: 2000, mlItemId: "MLC-EXISTS" }),
          ]);
        },
        listTargetMappings: (_sid: string, itemId: string) => {
          if (itemId === "ITM-1") {
            return Promise.resolve([
              defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }),
              defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }),
            ]);
          }
          return Promise.resolve([]);
        },
        getLedgerByIdempotencyKey: () => Promise.resolve(null),
        appendLedger: (r) => Promise.resolve(r),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
      });

      // ITM-1 from su-1 has stock gap → critical finding
      // ITM-2 from su-2 has mlItemId → no unfilled finding
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.proposalEnqueued).toBe(true);
    });
  });

  // ── 4.1 Advisor enrichment ─────────────────────────────────────

  describe("advisor enrichment (task 4)", () => {
    it("advisor present → stock-gap proposal includes aiEnrichment", async () => {
      seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
      seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

      const mockAdvisor = {
        analyze: () =>
          Promise.resolve({
            findings: [
              {
                kind: "stock-alert" as const,
                severity: "critical" as const,
                summary: "Critical stock imbalance detected",
                detail: "Stock on seller-a but not on seller-b",
                evidenceIds: ["supplier-item:ITM-1"],
              },
            ],
            summary: "AI analysis: stock imbalance requires attention",
            modelUsed: "deepseek-chat",
            costMicros: 100,
            cacheHitTokens: 0,
            cacheMissTokens: 500,
            outputTokens: 200,
          }),
      };

      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem()]),
        listTargetMappings: () =>
          Promise.resolve([
            defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }),
            defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }),
          ]),
        getLedgerByIdempotencyKey: () => Promise.resolve(null),
        appendLedger: (r) => Promise.resolve(r),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
        advisor: mockAdvisor as any, // eslint-disable-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
      });

      expect(result.findings.length).toBe(1);
      expect(result.proposalEnqueued).toBe(true);

      // Read the enqueued CEO proposal and verify aiEnrichment
      const ceoMessages = busDb
        .prepare(
          "SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'ceo' AND message_type = 'proposal'",
        )
        .all() as Array<Record<string, unknown>>;

      expect(ceoMessages.length).toBeGreaterThan(0);
      const payload = JSON.parse(ceoMessages[0]!.payload_json as string); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      expect(payload.aiEnrichment).toBeDefined(); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
      expect(payload.aiEnrichment.findings).toHaveLength(1); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
      expect(payload.aiEnrichment.findings[0].kind).toBe("stock-alert"); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
      expect(payload.aiEnrichment.summary).toBe("AI analysis: stock imbalance requires attention"); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
      expect(payload.aiEnrichment.modelUsed).toBe("deepseek-chat"); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
      expect(payload.aiEnrichment.enrichedAt).toBeDefined(); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
    });

    it("advisor failure → rule-only proposal without aiEnrichment", async () => {
      seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
      seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

      const failingAdvisor = {
        analyze: () => Promise.reject(new Error("DeepSeek API timeout")),
      };

      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem()]),
        listTargetMappings: () =>
          Promise.resolve([
            defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }),
            defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }),
          ]),
        getLedgerByIdempotencyKey: () => Promise.resolve(null),
        appendLedger: (r) => Promise.resolve(r),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
        advisor: failingAdvisor as any, // eslint-disable-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any
      });

      // Finding still present (rule-only fallback)
      expect(result.findings.length).toBe(1);
      expect(result.findings[0]!.severity).toBe("critical");
      expect(result.proposalEnqueued).toBe(true);

      // Payload must NOT have aiEnrichment
      const ceoMessages = busDb
        .prepare(
          "SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'ceo' AND message_type = 'proposal'",
        )
        .all() as Array<Record<string, unknown>>;

      expect(ceoMessages.length).toBeGreaterThan(0);
      const payload = JSON.parse(ceoMessages[0]!.payload_json as string); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      expect(payload.aiEnrichment).toBeUndefined(); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
    });

    it("advisor absent → rule-only proposal, no enrichment", async () => {
      seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
      seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

      const store = mockStore({
        listSupplierItemSnapshots: () => Promise.resolve([defaultItem()]),
        listTargetMappings: () =>
          Promise.resolve([
            defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }),
            defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }),
          ]),
        getLedgerByIdempotencyKey: () => Promise.resolve(null),
        appendLedger: (r) => Promise.resolve(r),
      });

      const result = await supplierManagerDaemon({
        claim: claimFixture(),
        reader: undefined as never,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
        supplierMirrorStore: store,
        // No advisor — should operate as before
      });

      expect(result.findings.length).toBe(1);
      expect(result.proposalEnqueued).toBe(true);

      const ceoMessages = busDb
        .prepare(
          "SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'ceo' AND message_type = 'proposal'",
        )
        .all() as Array<Record<string, unknown>>;

      expect(ceoMessages.length).toBeGreaterThan(0);
      const payload = JSON.parse(ceoMessages[0]!.payload_json as string); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      expect(payload.aiEnrichment).toBeUndefined(); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
    });
  });
});
