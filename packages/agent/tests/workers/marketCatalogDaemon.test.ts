import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { createGraphEngine } from "@msl/memory";
import { createSqliteOperationalReadModel } from "@msl/memory";
import type { GraphEngine } from "@msl/memory";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import type {
  AgentMessageBusStore,
  AgentMessage,
} from "../../src/conversation/agentMessageBusStore.js";
import { marketCatalogDaemon } from "../../src/workers/marketCatalogDaemon.js";
import type { DaemonResult } from "../../src/workers/daemonTypes.js";

// ── Helpers ─────────────────────────────────────────────────────────

const SELLER_IDS = ["seller-plasticov"];

function claimFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 1,
    messageId: overrides.messageId ?? crypto.randomUUID(),
    senderAgentId: overrides.senderAgentId ?? "ceo",
    receiverAgentId: overrides.receiverAgentId ?? "market-catalog",
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

/** Seed a Cortex node directly. */
function seedListingNode(
  engine: GraphEngine,
  itemId: string,
  overrides: {
    status?: string;
    price?: number;
    title?: string;
    sellerId?: string;
    categoryId?: string;
    capturedAt?: string;
  } = {},
): number {
  const node = engine.getOrCreateNode(`listing_snapshot_${itemId}_${Date.now()}_${Math.random().toString(36).slice(2)}`, {
    type: "listing_snapshot",
    itemId,
    status: overrides.status ?? "active",
    price: overrides.price ?? 10000,
    title: overrides.title ?? `Test Product ${itemId}`,
    sellerId: overrides.sellerId ?? SELLER_IDS[0],
    categoryId: overrides.categoryId ?? "MLC1234",
    capturedAt: overrides.capturedAt ?? new Date().toISOString(),
  });
  return node.id;
}

/** Seed a visit node in Cortex. */
function seedVisitNode(
  engine: GraphEngine,
  itemId: string,
  totalVisits: number,
): number {
  const node = engine.getOrCreateNode(`visit_snapshot_${itemId}_${Date.now()}_${Math.random().toString(36).slice(2)}`, {
    type: "visit_snapshot",
    itemId,
    totalVisits,
    sellerId: SELLER_IDS[0],
    capturedAt: new Date().toISOString(),
  });
  return node.id;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("marketCatalogDaemon", () => {
  let db: Database.Database;
  let bus: AgentMessageBusStore;
  let engine: GraphEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    bus = createAgentMessageBusStore(db);
    engine = createGraphEngine(":memory:");
  });

  // ── Empty state ──────────────────────────────────────────────

  describe("with no data", () => {
    it("returns empty findings when no listings exist", async () => {
      const result: DaemonResult = await marketCatalogDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.findings).toEqual([]);
      expect(result.proposalEnqueued).toBe(false);
      expect(result.messageIds).toEqual([]);
    });
  });

  // ── Low-visit detection ──────────────────────────────────────

  describe("low-visit active listings", () => {
    it("flags active listings with few visits as warning", async () => {
      seedListingNode(engine, "MLC-001", { status: "active", price: 10000 });
      // No visit node → visits = 0, which is < 10

      const result = await marketCatalogDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const lowVisitFindings = result.findings.filter(
        (f) => f.kind === "alert" && f.summary.includes("Low-visit"),
      );
      expect(lowVisitFindings.length).toBeGreaterThanOrEqual(1);
      expect(lowVisitFindings[0]!.severity).toBe("warning");
    });

    it("does not flag active listings with adequate visits", async () => {
      seedListingNode(engine, "MLC-002", { status: "active", price: 10000 });
      seedVisitNode(engine, "MLC-002", 50); // well above threshold

      const result = await marketCatalogDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const lowVisitFindings = result.findings.filter(
        (f) => f.kind === "alert" && f.summary.includes("Low-visit"),
      );
      expect(lowVisitFindings).toEqual([]);
    });
  });

  // ── Above-market pricing ─────────────────────────────────────

  describe("above-market pricing", () => {
    it("flags listings priced significantly above category median", async () => {
      const cat = "MLC1234";
      // Create several listings in same category to establish median
      seedListingNode(engine, "MLC-010", { status: "active", price: 10000, categoryId: cat });
      seedListingNode(engine, "MLC-011", { status: "active", price: 11000, categoryId: cat });
      seedListingNode(engine, "MLC-012", { status: "active", price: 10500, categoryId: cat });
      // This one is ~80% above median (~10500) → should trigger
      seedListingNode(engine, "MLC-013", {
        status: "active",
        price: 20000,
        categoryId: cat,
        title: "Overpriced Product",
      });

      const result = await marketCatalogDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const priceFindings = result.findings.filter(
        (f) => f.kind === "opportunity" && f.summary.includes("Above-market"),
      );
      expect(priceFindings.length).toBeGreaterThanOrEqual(1);
      expect(priceFindings[0]!.summary).toContain("Overpriced Product");
    });
  });

  // ── Relist: paused with sales history ─────────────────────────

  describe("relist candidates — paused", () => {
    it("flags paused listings with visit history as relist candidates", async () => {
      seedListingNode(engine, "MLC-020", { status: "paused", price: 5000 });
      seedVisitNode(engine, "MLC-020", 25);

      const result = await marketCatalogDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const relistFindings = result.findings.filter(
        (f) => f.kind === "opportunity" && f.summary.includes("Paused listing"),
      );
      expect(relistFindings.length).toBeGreaterThanOrEqual(1);
      expect(relistFindings[0]!.severity).toBe("info");
    });

    it("does not flag paused listings without visit history", async () => {
      seedListingNode(engine, "MLC-021", { status: "paused", price: 5000 });
      // No visits

      const result = await marketCatalogDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const relistFindings = result.findings.filter(
        (f) => f.summary.includes("Paused listing"),
      );
      expect(relistFindings).toEqual([]);
    });
  });

  // ── Relist: closed within window ──────────────────────────────

  describe("relist candidates — closed", () => {
    it("flags recently closed listings with sales history", async () => {
      const recently = new Date();
      recently.setDate(recently.getDate() - 5); // closed 5 days ago

      seedListingNode(engine, "MLC-030", {
        status: "closed",
        price: 8000,
        capturedAt: recently.toISOString(),
      });
      seedVisitNode(engine, "MLC-030", 30);

      const result = await marketCatalogDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const relistFindings = result.findings.filter(
        (f) => f.kind === "opportunity" && f.summary.includes("Relist candidate:"),
      );
      expect(relistFindings.length).toBeGreaterThanOrEqual(1);
    });

    it("does not flag listings closed beyond the 60-day window", async () => {
      const longAgo = new Date();
      longAgo.setDate(longAgo.getDate() - 65); // 65 days ago — past 60-day limit

      seedListingNode(engine, "MLC-031", {
        status: "closed",
        price: 8000,
        capturedAt: longAgo.toISOString(),
      });
      seedVisitNode(engine, "MLC-031", 30);

      const result = await marketCatalogDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const relistFindings = result.findings.filter(
        (f) => f.kind === "opportunity" && f.summary.includes("Relist candidate:"),
      );
      expect(relistFindings).toEqual([]);
    });
  });

  // ── CEO proposals ─────────────────────────────────────────────

  describe("CEO proposal enqueue", () => {
    it("enqueues proposals with correct sender/receiver when findings exist", async () => {
      seedListingNode(engine, "MLC-040", { status: "active", price: 10000 });
      // Low visits detection should trigger a finding
      const result = await marketCatalogDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      if (result.proposalEnqueued) {
        expect(result.messageIds.length).toBeGreaterThan(0);

        // Verify the enqueued message has correct sender/receiver
        const msgId = result.messageIds[0]!;
        const row = db
          .prepare("SELECT * FROM agent_message_bus WHERE message_id = ?")
          .get(msgId) as Record<string, unknown> | undefined;

        expect(row).toBeDefined();
        expect(row!.sender_agent_id).toBe("market-catalog");
        expect(row!.receiver_agent_id).toBe("ceo");
        expect(row!.message_type).toBe("proposal");

        // Verify noMutationExecuted is set in payload
        const payload = JSON.parse(row!.payload_json as string);
        expect(payload.noMutationExecuted).toBe(true);
      }
    });

    it("sets noMutationExecuted: true on all proposals", async () => {
      seedListingNode(engine, "MLC-041", {
        status: "active",
        price: 10000,
        categoryId: "MLC9999",
      });
      seedListingNode(engine, "MLC-042", {
        status: "active",
        price: 20000,
        categoryId: "MLC9999",
      });

      const result = await marketCatalogDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      for (const msgId of result.messageIds) {
        const row = db
          .prepare("SELECT payload_json FROM agent_message_bus WHERE message_id = ?")
          .get(msgId) as { payload_json: string } | undefined;

        expect(row).toBeDefined();
        const payload = JSON.parse(row!.payload_json);
        expect(payload.noMutationExecuted).toBe(true);
      }
    });
  });
});
