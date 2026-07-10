import Database from "better-sqlite3";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
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
    resultJson: overrides.resultJson ?? null,
    errorJson: overrides.errorJson ?? null,
    cancelReason: overrides.cancelReason ?? null,
    correlationId: overrides.correlationId ?? null,
    parentMessageId: overrides.parentMessageId ?? null,
    sellerId: overrides.sellerId ?? null,
    learnedAt: overrides.learnedAt ?? null,
    outcomeScore: overrides.outcomeScore ?? null,
    actionId: overrides.actionId ?? null,
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
      (overrides.appendLedger as SupplierMirrorStore["appendLedger"]) ??
      ((r) => Promise.resolve(r)),
    getLedgerByIdempotencyKey:
      (overrides.getLedgerByIdempotencyKey as SupplierMirrorStore["getLedgerByIdempotencyKey"]) ??
      nullResult,
    recordNotificationEvent:
      (overrides.recordNotificationEvent as SupplierMirrorStore["recordNotificationEvent"]) ??
      ((e) => Promise.resolve(e)),
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

/** Query the bus DB directly for owned-ecommerce signals. */
function getOwnedEcommerceSignals(busDb: Database.Database): Array<Record<string, unknown>> {
  return busDb
    .prepare(
      "SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'owned-ecommerce' AND message_type = 'supplier-web-signal'",
    )
    .all() as Array<Record<string, unknown>>;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("supplierManagerDaemon — owned-ecommerce supplier-web-signal", () => {
  let bus: AgentMessageBusStore;
  let engine: GraphEngine;
  let busDb: Database.Database;

  beforeEach(() => {
    busDb = new Database(":memory:");
    busDb.pragma("journal_mode = WAL");
    bus = createAgentMessageBusStore(busDb);
    engine = createGraphEngine(":memory:");
    // Enable owned-ecommerce intelligence by default
    process.env.MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED;
  });

  // ── new-supplier-product ──────────────────────────────────────

  it("enqueues new-supplier-product signal when unfilled mirror detected", async () => {
    const store = mockStore({
      listSupplierItemSnapshots: () => Promise.resolve([defaultItem({ price: 15000 }) as never]),
      listTargetMappings: () => Promise.resolve([]),
      getLedgerByIdempotencyKey: () => Promise.resolve(null),
      appendLedger: (r) => Promise.resolve(r),
    });

    await supplierManagerDaemon({
      claim: claimFixture(),
      reader: undefined as never,
      cortex: engine,
      bus,
      sellerIds: SELLER_IDS,
      supplierMirrorStore: store,
    });

    const signals = getOwnedEcommerceSignals(busDb);
    const newProductSignal = signals.find((s) => {
      const p = JSON.parse(s.payload_json as string) as Record<string, unknown>;
      return p.signalKind === "new-supplier-product";
    });

    expect(newProductSignal).toBeDefined();
    const payload = JSON.parse(newProductSignal!.payload_json as string) as Record<string, unknown>;
    expect(payload.type).toBe("supplier-web-signal");
    expect(payload.signalKind).toBe("new-supplier-product");
    expect(payload.supplierId).toBe("su-1");
    expect(payload.supplierItemId).toBe("ITM-1");
    expect(payload.recommendedAction).toBe("prepare-storefront-candidate");
    expect(payload.severity).toBe("warning");
    expect(payload.noMutationExecuted).toBe(true);
    expect(Array.isArray(payload.evidenceIds)).toBe(true);
    expect(payload.evidenceIds as string[]).toContain("supplier-item:ITM-1");
    expect(typeof payload.capturedAt).toBe("string");
  });

  // ── stock-gap ─────────────────────────────────────────────────

  it("enqueues stock-gap signal with affectedSellerIds and critical severity", async () => {
    seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
    seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

    const store = mockStore({
      listSupplierItemSnapshots: () => Promise.resolve([defaultItem() as never]),
      listTargetMappings: () =>
        Promise.resolve([
          defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }) as never,
          defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }) as never,
        ]),
      getLedgerByIdempotencyKey: () => Promise.resolve(null),
      appendLedger: (r) => Promise.resolve(r),
    });

    await supplierManagerDaemon({
      claim: claimFixture(),
      reader: undefined as never,
      cortex: engine,
      bus,
      sellerIds: SELLER_IDS,
      supplierMirrorStore: store,
    });

    const signals = getOwnedEcommerceSignals(busDb);
    const stockGapSignal = signals.find((s) => {
      const p = JSON.parse(s.payload_json as string) as Record<string, unknown>;
      return p.signalKind === "stock-gap";
    });

    expect(stockGapSignal).toBeDefined();
    const payload = JSON.parse(stockGapSignal!.payload_json as string) as Record<string, unknown>;
    expect(payload.signalKind).toBe("stock-gap");
    expect(payload.severity).toBe("critical");
    expect(payload.recommendedAction).toBe("review-storefront-availability");
    expect(Array.isArray(payload.affectedSellerIds)).toBe(true);
    expect(payload.affectedSellerIds as string[]).toContain("seller-a");
    expect(payload.affectedSellerIds as string[]).toContain("seller-b");
    expect(payload.noMutationExecuted).toBe(true);
    expect(Array.isArray(payload.evidenceIds)).toBe(true);
  });

  // ── supplier-price-change ─────────────────────────────────────

  it("enqueues supplier-price-change signal on >5% price delta", async () => {
    const prevHour = new Date(Date.now() - 3_600_000).toISOString().slice(0, 13);

    const store = mockStore({
      listSupplierItemSnapshots: () => Promise.resolve([defaultItem({ price: 1100 }) as never]),
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

    await supplierManagerDaemon({
      claim: claimFixture(),
      reader: undefined as never,
      cortex: engine,
      bus,
      sellerIds: SELLER_IDS,
      supplierMirrorStore: store,
    });

    const signals = getOwnedEcommerceSignals(busDb);
    const priceSignal = signals.find((s) => {
      const p = JSON.parse(s.payload_json as string) as Record<string, unknown>;
      return p.signalKind === "supplier-price-change";
    });

    expect(priceSignal).toBeDefined();
    const payload = JSON.parse(priceSignal!.payload_json as string) as Record<string, unknown>;
    expect(payload.signalKind).toBe("supplier-price-change");
    expect(payload.recommendedAction).toBe("prepare-price-review");
    expect(payload.severity).toBe("warning");
    expect(payload.noMutationExecuted).toBe(true);
  });

  // ── stock-restored ────────────────────────────────────────────

  it("enqueues supplier-stock-restored when all sellers have stock", async () => {
    seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
    seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 5 });

    const store = mockStore({
      listSupplierItemSnapshots: () => Promise.resolve([defaultItem() as never]),
      listTargetMappings: () =>
        Promise.resolve([
          defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }) as never,
          defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }) as never,
        ]),
      getLedgerByIdempotencyKey: () => Promise.resolve(null),
      appendLedger: (r) => Promise.resolve(r),
    });

    await supplierManagerDaemon({
      claim: claimFixture(),
      reader: undefined as never,
      cortex: engine,
      bus,
      sellerIds: SELLER_IDS,
      supplierMirrorStore: store,
    });

    const signals = getOwnedEcommerceSignals(busDb);
    const restoredSignal = signals.find((s) => {
      const p = JSON.parse(s.payload_json as string) as Record<string, unknown>;
      return p.signalKind === "supplier-stock-restored";
    });

    expect(restoredSignal).toBeDefined();
    const payload = JSON.parse(restoredSignal!.payload_json as string) as Record<string, unknown>;
    expect(payload.signalKind).toBe("supplier-stock-restored");
    expect(payload.recommendedAction).toBe("prepare-reactivation-review");
    expect(payload.severity).toBe("info");
    expect(payload.noMutationExecuted).toBe(true);
  });

  // ── stock-out ─────────────────────────────────────────────────

  it("enqueues supplier-stock-out when all sellers have zero stock", async () => {
    seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 0 });
    seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

    const store = mockStore({
      listSupplierItemSnapshots: () => Promise.resolve([defaultItem() as never]),
      listTargetMappings: () =>
        Promise.resolve([
          defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }) as never,
          defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }) as never,
        ]),
      getLedgerByIdempotencyKey: () => Promise.resolve(null),
      appendLedger: (r) => Promise.resolve(r),
    });

    await supplierManagerDaemon({
      claim: claimFixture(),
      reader: undefined as never,
      cortex: engine,
      bus,
      sellerIds: SELLER_IDS,
      supplierMirrorStore: store,
    });

    const signals = getOwnedEcommerceSignals(busDb);
    const outSignal = signals.find((s) => {
      const p = JSON.parse(s.payload_json as string) as Record<string, unknown>;
      return p.signalKind === "supplier-stock-out";
    });

    expect(outSignal).toBeDefined();
    const payload = JSON.parse(outSignal!.payload_json as string) as Record<string, unknown>;
    expect(payload.signalKind).toBe("supplier-stock-out");
    expect(payload.recommendedAction).toBe("prepare-availability-pause");
    expect(payload.severity).toBe("critical");
    expect(payload.noMutationExecuted).toBe(true);
  });

  // ── publish-opportunity ───────────────────────────────────────

  it("enqueues publish-opportunity when unfilled mirror has price evidence", async () => {
    const store = mockStore({
      listSupplierItemSnapshots: () => Promise.resolve([defaultItem({ price: 15000 }) as never]),
      listTargetMappings: () => Promise.resolve([]),
      getLedgerByIdempotencyKey: () => Promise.resolve(null),
      appendLedger: (r) => Promise.resolve(r),
    });

    await supplierManagerDaemon({
      claim: claimFixture(),
      reader: undefined as never,
      cortex: engine,
      bus,
      sellerIds: SELLER_IDS,
      supplierMirrorStore: store,
    });

    const signals = getOwnedEcommerceSignals(busDb);
    const pubSignal = signals.find((s) => {
      const p = JSON.parse(s.payload_json as string) as Record<string, unknown>;
      return p.signalKind === "publish-opportunity";
    });

    expect(pubSignal).toBeDefined();
    const payload = JSON.parse(pubSignal!.payload_json as string) as Record<string, unknown>;
    expect(payload.signalKind).toBe("publish-opportunity");
    expect(payload.recommendedAction).toBe("prepare-product-page");
    expect(payload.severity).toBe("info");
    expect(payload.noMutationExecuted).toBe(true);
    expect(pubSignal!.sender_agent_id).toBe("supplier-manager");
  });

  // ── missing evidence → collect-more-evidence ──────────────────

  it("uses collect-more-evidence when unfilled mirror has no price", async () => {
    const store = mockStore({
      listSupplierItemSnapshots: () =>
        Promise.resolve([defaultItem({ price: undefined }) as never]),
      listTargetMappings: () => Promise.resolve([]),
      getLedgerByIdempotencyKey: () => Promise.resolve(null),
      appendLedger: (r) => Promise.resolve(r),
    });

    await supplierManagerDaemon({
      claim: claimFixture(),
      reader: undefined as never,
      cortex: engine,
      bus,
      sellerIds: SELLER_IDS,
      supplierMirrorStore: store,
    });

    const signals = getOwnedEcommerceSignals(busDb);
    const newProdSignal = signals.find((s) => {
      const p = JSON.parse(s.payload_json as string) as Record<string, unknown>;
      return p.signalKind === "new-supplier-product";
    });

    expect(newProdSignal).toBeDefined();
    const payload = JSON.parse(newProdSignal!.payload_json as string) as Record<string, unknown>;
    expect(payload.recommendedAction).toBe("collect-more-evidence");

    // No publish-opportunity should be enqueued without price
    const pubSignal = signals.find((s) => {
      const p = JSON.parse(s.payload_json as string) as Record<string, unknown>;
      return p.signalKind === "publish-opportunity";
    });
    expect(pubSignal).toBeUndefined();
  });

  // ── noMutationExecuted ────────────────────────────────────────

  it("every signal carries noMutationExecuted: true", async () => {
    seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
    seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

    const store = mockStore({
      listSupplierItemSnapshots: () => Promise.resolve([defaultItem() as never]),
      listTargetMappings: () =>
        Promise.resolve([
          defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }) as never,
          defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }) as never,
        ]),
      getLedgerByIdempotencyKey: () => Promise.resolve(null),
      appendLedger: (r) => Promise.resolve(r),
    });

    await supplierManagerDaemon({
      claim: claimFixture(),
      reader: undefined as never,
      cortex: engine,
      bus,
      sellerIds: SELLER_IDS,
      supplierMirrorStore: store,
    });

    const signals = getOwnedEcommerceSignals(busDb);
    expect(signals.length).toBeGreaterThan(0);

    for (const signal of signals) {
      const payload = JSON.parse(signal.payload_json as string) as Record<string, unknown>;
      expect(payload.noMutationExecuted).toBe(true);
    }
  });

  // ── evidence IDs ──────────────────────────────────────────────

  it("signal preserves evidence IDs in payload", async () => {
    seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
    seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

    const store = mockStore({
      listSupplierItemSnapshots: () => Promise.resolve([defaultItem() as never]),
      listTargetMappings: () =>
        Promise.resolve([
          defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }) as never,
          defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }) as never,
        ]),
      getLedgerByIdempotencyKey: () => Promise.resolve(null),
      appendLedger: (r) => Promise.resolve(r),
    });

    await supplierManagerDaemon({
      claim: claimFixture(),
      reader: undefined as never,
      cortex: engine,
      bus,
      sellerIds: SELLER_IDS,
      supplierMirrorStore: store,
    });

    const signals = getOwnedEcommerceSignals(busDb);
    const stockGapSignal = signals.find((s) => {
      const p = JSON.parse(s.payload_json as string) as Record<string, unknown>;
      return p.signalKind === "stock-gap";
    });

    expect(stockGapSignal).toBeDefined();
    const payload = JSON.parse(stockGapSignal!.payload_json as string) as Record<string, unknown>;
    expect(Array.isArray(payload.evidenceIds)).toBe(true);
    const evidenceIds = payload.evidenceIds as string[];
    expect(evidenceIds.length).toBeGreaterThanOrEqual(2);
    expect(evidenceIds).toContain("supplier-item:ITM-1");
  });

  // ── dedupe ────────────────────────────────────────────────────

  it("dedupe prevents duplicate signals within the same hour window", async () => {
    seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
    seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

    const store = mockStore({
      listSupplierItemSnapshots: () => Promise.resolve([defaultItem() as never]),
      listTargetMappings: () =>
        Promise.resolve([
          defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }) as never,
          defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }) as never,
        ]),
      getLedgerByIdempotencyKey: () => Promise.resolve(null),
      appendLedger: (r) => Promise.resolve(r),
    });

    // Run twice with the same setup — second run should be deduped by bus dedupeKey
    await supplierManagerDaemon({
      claim: claimFixture(),
      reader: undefined as never,
      cortex: engine,
      bus,
      sellerIds: SELLER_IDS,
      supplierMirrorStore: store,
    });

    // Second invocation — same data, same hour, bus dedupeKey blocks re-enqueue
    await supplierManagerDaemon({
      claim: claimFixture(),
      reader: undefined as never,
      cortex: engine,
      bus,
      sellerIds: SELLER_IDS,
      supplierMirrorStore: store,
    });

    const signals = getOwnedEcommerceSignals(busDb);
    const stockGapSignals = signals.filter((s) => {
      const p = JSON.parse(s.payload_json as string) as Record<string, unknown>;
      return p.signalKind === "stock-gap";
    });

    // Should have at most one stock-gap signal (first enqueue succeeds, second deduped)
    expect(stockGapSignals.length).toBe(1);
  });

  // ── feature flag ──────────────────────────────────────────────

  it("does NOT enqueue owned-ecommerce signals when feature flag is off", async () => {
    // Disable the feature flag
    delete process.env.MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED;

    seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
    seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

    const store = mockStore({
      listSupplierItemSnapshots: () => Promise.resolve([defaultItem({ price: 15000 }) as never]),
      listTargetMappings: () =>
        Promise.resolve([
          defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }) as never,
          defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }) as never,
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

    // CEO findings still produced (existing behavior)
    expect(result.findings.length).toBeGreaterThan(0);

    // No owned-ecommerce signals
    const signals = getOwnedEcommerceSignals(busDb);
    expect(signals.length).toBe(0);
  });

  it("does NOT enqueue signals when feature flag is explicitly 'false'", async () => {
    process.env.MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED = "false";

    seedListingNode(engine, "MLC-A-001", { sellerId: "seller-a", stock: 12 });
    seedListingNode(engine, "MLC-B-001", { sellerId: "seller-b", stock: 0 });

    const store = mockStore({
      listSupplierItemSnapshots: () => Promise.resolve([defaultItem({ price: 15000 }) as never]),
      listTargetMappings: () =>
        Promise.resolve([
          defaultMapping({ targetSellerId: "seller-a", targetItemId: "MLC-A-001" }) as never,
          defaultMapping({ targetSellerId: "seller-b", targetItemId: "MLC-B-001" }) as never,
        ]),
      getLedgerByIdempotencyKey: () => Promise.resolve(null),
      appendLedger: (r) => Promise.resolve(r),
    });

    await supplierManagerDaemon({
      claim: claimFixture(),
      reader: undefined as never,
      cortex: engine,
      bus,
      sellerIds: SELLER_IDS,
      supplierMirrorStore: store,
    });

    const signals = getOwnedEcommerceSignals(busDb);
    expect(signals.length).toBe(0);
  });
});
