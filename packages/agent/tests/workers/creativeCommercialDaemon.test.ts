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
import { creativeCommercialDaemon } from "../../src/workers/creativeCommercialDaemon.js";
import type { DaemonResult } from "../../src/workers/daemonTypes.js";

// ── Helpers ─────────────────────────────────────────────────────────

const SELLER_IDS = ["seller-plasticov"];

function claimFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 1,
    messageId: overrides.messageId ?? crypto.randomUUID(),
    senderAgentId: overrides.senderAgentId ?? "ceo",
    receiverAgentId: overrides.receiverAgentId ?? "creative-commercial",
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

function seedOrmSnapshot(
  db: Database.Database,
  sellerId: string,
  itemId: string,
  kind: string,
  data: Record<string, unknown>,
  capturedAt?: string,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO operational_snapshots
       (seller_id, item_id, kind, data_json, source, captured_at,
        freshness, completeness, confidence, evidence_id)
     VALUES (?, ?, ?, ?, 'daemon-test', ?, 'fresh', 'complete', 'high', ?)`,
  ).run(
    sellerId,
    itemId,
    kind,
    JSON.stringify(data),
    capturedAt ?? new Date().toISOString(),
    `evidence_${itemId}_${kind}`,
  );
}

function seedCortexNode(engine: GraphEngine, metadata: Record<string, unknown>): number {
  const node = engine.getOrCreateNode(
    `${metadata.type}_${metadata.itemId}_${Date.now()}_${Math.random().toString(36).slice(2)}`, // eslint-disable-line @typescript-eslint/restrict-template-expressions
    metadata,
  );
  return node.id;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("creativeCommercialDaemon", () => {
  let db: Database.Database;
  let bus: AgentMessageBusStore;
  let engine: GraphEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    bus = createAgentMessageBusStore(db);
    engine = createGraphEngine(":memory:");
    // Run ORM migration so the operational_snapshots table exists for seedOrmSnapshot
    createSqliteOperationalReadModel(db);
  });

  // ── Empty state ──────────────────────────────────────────────

  describe("with no data", () => {
    it("returns empty findings when no listings exist", async () => {
      const result: DaemonResult = await creativeCommercialDaemon({
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

  // ── High-visit, low-conversion ───────────────────────────────

  describe("high-visit, low-conversion", () => {
    it("flags listing with high visits but low conversion as warning", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-001", "listing_snapshot", {
        status: "active",
        price: 10000,
        title: "Popular but not selling",
      });

      // 100 visits but only 1 order = 1% conversion (< 2%)
      seedCortexNode(engine, {
        type: "visit_snapshot",
        itemId: "MLC-001",
        sellerId: SELLER_IDS[0],
        totalVisits: 100,
      });

      seedCortexNode(engine, {
        type: "order_snapshot",
        itemId: "MLC-001",
        sellerId: SELLER_IDS[0],
        orderId: "ORD-001",
        status: "paid",
        created_at: new Date().toISOString(),
      });

      const result = await creativeCommercialDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const conversionFindings = result.findings.filter(
        (f) => f.kind === "alert" && f.summary.includes("conversion"),
      );
      expect(conversionFindings.length).toBeGreaterThanOrEqual(1);
      expect(conversionFindings[0]!.severity).toBe("warning");
    });

    it("flags high-visit listings with good conversion as creative candidates", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-002", "listing_snapshot", {
        status: "active",
        price: 10000,
        title: "Best seller",
      });

      // 100 visits, 5 orders = 5% conversion (> 2%)
      seedCortexNode(engine, {
        type: "visit_snapshot",
        itemId: "MLC-002",
        sellerId: SELLER_IDS[0],
        totalVisits: 100,
      });

      for (let i = 0; i < 5; i++) {
        seedCortexNode(engine, {
          type: "order_snapshot",
          itemId: "MLC-002",
          sellerId: SELLER_IDS[0],
          orderId: `ORD-00${i}`,
          status: "paid",
          created_at: new Date().toISOString(),
        });
      }

      const result = await creativeCommercialDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const creativeFindings = result.findings.filter(
        (f) => f.kind === "opportunity" && f.summary.includes("Creative candidate"),
      );
      expect(creativeFindings.length).toBeGreaterThanOrEqual(1);
      expect(creativeFindings[0]!.severity).toBe("info");
    });

    it("does not flag listings with low visits", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-003", "listing_snapshot", {
        status: "active",
        price: 10000,
        title: "Unpopular item",
      });

      seedCortexNode(engine, {
        type: "visit_snapshot",
        itemId: "MLC-003",
        sellerId: SELLER_IDS[0],
        totalVisits: 5, // below threshold
      });

      const result = await creativeCommercialDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const allFindings = result.findings.filter((f) =>
        f.evidenceIds.includes("listing_snapshot:MLC-003"),
      );
      expect(allFindings).toEqual([]);
    });
  });

  // ── Stagnant stock ───────────────────────────────────────────

  describe("stagnant stock", () => {
    it("flags active listing with no orders after 30 days as stagnant", async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 45); // 45 days ago

      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "MLC-010",
        "listing_snapshot",
        {
          status: "active",
          price: 8000,
          title: "Forgotten item",
        },
        oldDate.toISOString(),
      );

      seedCortexNode(engine, {
        type: "visit_snapshot",
        itemId: "MLC-010",
        sellerId: SELLER_IDS[0],
        totalVisits: 15,
      });

      const result = await creativeCommercialDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const stagnantFindings = result.findings.filter((f) => f.summary.includes("Stagnant"));
      expect(stagnantFindings.length).toBeGreaterThanOrEqual(1);
      expect(stagnantFindings[0]!.severity).toBe("info");
    });

    it("does not flag active listing less than 30 days old as stagnant", async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 5);

      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "MLC-011",
        "listing_snapshot",
        {
          status: "active",
          price: 8000,
          title: "New item",
        },
        recentDate.toISOString(),
      );

      const result = await creativeCommercialDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const stagnantFindings = result.findings.filter((f) => f.summary.includes("Stagnant"));
      expect(stagnantFindings).toEqual([]);
    });

    it("does not flag old active listing that has orders", async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 50);

      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "MLC-012",
        "listing_snapshot",
        {
          status: "active",
          price: 8000,
          title: "Old but selling",
        },
        oldDate.toISOString(),
      );

      seedCortexNode(engine, {
        type: "visit_snapshot",
        itemId: "MLC-012",
        sellerId: SELLER_IDS[0],
        totalVisits: 40,
      });

      seedCortexNode(engine, {
        type: "order_snapshot",
        itemId: "MLC-012",
        sellerId: SELLER_IDS[0],
        orderId: "ORD-050",
        status: "paid",
      });

      const result = await creativeCommercialDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const stagnantFindings = result.findings.filter((f) => f.summary.includes("Stagnant"));
      expect(stagnantFindings).toEqual([]);
    });
  });

  // ── CEO proposal ─────────────────────────────────────────────

  describe("CEO proposal enqueue", () => {
    it("enqueues proposals with correct sender/receiver and noMutationExecuted: true", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-020", "listing_snapshot", {
        status: "active",
        price: 10000,
        title: "Conversion problem item",
      });

      seedCortexNode(engine, {
        type: "visit_snapshot",
        itemId: "MLC-020",
        sellerId: SELLER_IDS[0],
        totalVisits: 80,
      });

      seedCortexNode(engine, {
        type: "order_snapshot",
        itemId: "MLC-020",
        sellerId: SELLER_IDS[0],
        orderId: "ORD-099",
        status: "paid",
      });

      const result = await creativeCommercialDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.messageIds.length).toBeGreaterThan(0);

      const msgId = result.messageIds[0]!;
      const row = db.prepare("SELECT * FROM agent_message_bus WHERE message_id = ?").get(msgId) as
        Record<string, unknown> | undefined;

      expect(row).toBeDefined();
      expect(row!.sender_agent_id).toBe("creative-commercial");
      expect(row!.receiver_agent_id).toBe("ceo");
      expect(row!.message_type).toBe("proposal");

      const payload = JSON.parse(row!.payload_json as string); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      expect(payload.noMutationExecuted).toBe(true); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
    });
  });

  // ── Creative Studio delegation (Phase 5) ──────────────────────

  describe("creative-studio delegation", () => {
    it("enqueues social-pack request to creative-studio when env gate is enabled and creative candidates found", () => {
       
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 50);

      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "MLC-STUDIO-CC-001",
        "listing_snapshot",
        { status: "active", price: 12000, title: "Social candidate product" },
        oldDate.toISOString(),
      );

      // High visits → creative candidate
      seedCortexNode(engine, {
        type: "visit_snapshot",
        sellerId: SELLER_IDS[0],
        itemId: "MLC-STUDIO-CC-001",
        totalVisits: 200,
      });

      // Also seed orders for good conversion rate (need >= 2% of 200 visits)
      const sid = SELLER_IDS[0];
      seedCortexNode(engine, {
        type: "order_snapshot",
        sellerId: sid,
        itemId: "MLC-STUDIO-CC-001",
        orderId: "ORD-001",
        totalAmount: 500,
      });
      seedCortexNode(engine, {
        type: "order_snapshot",
        sellerId: sid,
        itemId: "MLC-STUDIO-CC-001",
        orderId: "ORD-002",
        totalAmount: 300,
      });
      seedCortexNode(engine, {
        type: "order_snapshot",
        sellerId: sid,
        itemId: "MLC-STUDIO-CC-001",
        orderId: "ORD-003",
        totalAmount: 200,
      });
      seedCortexNode(engine, {
        type: "order_snapshot",
        sellerId: sid,
        itemId: "MLC-STUDIO-CC-001",
        orderId: "ORD-004",
        totalAmount: 400,
      });
      seedCortexNode(engine, {
        type: "order_snapshot",
        sellerId: sid,
        itemId: "MLC-STUDIO-CC-001",
        orderId: "ORD-005",
        totalAmount: 350,
      });

      // Enable creative-studio env gate
      process.env.MSL_CREATIVE_STUDIO_ENABLED = "true";

      // CEO proposal should still be enqueued
      const ceoMessages = db
        .prepare("SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'ceo'")
        .all() as Array<Record<string, unknown>>;
      expect(ceoMessages.length).toBeGreaterThan(0);

      // creative-studio delegation should be enqueued
      const studioMessages = db
        .prepare("SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'creative-studio'")
        .all() as Array<Record<string, unknown>>;
      expect(studioMessages.length).toBeGreaterThan(0);
      expect(studioMessages[0]!.sender_agent_id).toBe("creative-commercial");
      expect(studioMessages[0]!.message_type).toBe("proposal");

      const payload = JSON.parse(studioMessages[0]!.payload_json as string); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      expect(payload.kind).toBe("social-pack"); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
      expect(payload.channel).toBe("mercadolibre"); // eslint-disable-line @typescript-eslint/no-unsafe-member-access

      delete process.env.MSL_CREATIVE_STUDIO_ENABLED;
    });

    it("does NOT enqueue social-pack to creative-studio when env gate is disabled", () => {
       
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 50);

      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "MLC-STUDIO-CC-002",
        "listing_snapshot",
        { status: "active", price: 12000, title: "Social candidate product 2" },
        oldDate.toISOString(),
      );

      const sid2 = SELLER_IDS[0];
      seedCortexNode(engine, {
        type: "visit_snapshot",
        sellerId: sid2,
        itemId: "MLC-STUDIO-CC-002",
        totalVisits: 200,
      });

      seedCortexNode(engine, {
        type: "order_snapshot",
        sellerId: sid2,
        itemId: "MLC-STUDIO-CC-002",
        orderId: "ORD-002",
        totalAmount: 500,
      });

      process.env.MSL_CREATIVE_STUDIO_ENABLED = "false";

      // CEO proposal still enqueued
      const ceoMessages = db
        .prepare("SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'ceo'")
        .all() as Array<Record<string, unknown>>;
      expect(ceoMessages.length).toBeGreaterThan(0);

      // No creative-studio delegation
      const studioMessages = db
        .prepare("SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'creative-studio'")
        .all() as Array<Record<string, unknown>>;
      expect(studioMessages).toEqual([]);

      delete process.env.MSL_CREATIVE_STUDIO_ENABLED;
    });
  });

  // ── Cortex fallback (ORM parity) ──────────────────────────────

  describe("Cortex fallback when ORM is empty", () => {
    it("detects stagnant stock from Cortex listing_snapshot nodes using listingCreatedAt", async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 50);

      // Do NOT seed any ORM listing_snapshot data — force Cortex fallback
      seedCortexNode(engine, {
        type: "listing_snapshot",
        itemId: "MLC-CRX-STG",
        sellerId: SELLER_IDS[0],
        status: "active",
        price: 12000,
        title: "Cortex stagnant product",
        date_created: oldDate.toISOString(),
        capturedAt: new Date().toISOString(), // recent — should NOT be used for stagnant check
      });

      // Low visits via Cortex (always reads from Cortex)
      seedCortexNode(engine, {
        type: "visit_snapshot",
        itemId: "MLC-CRX-STG",
        totalVisits: 3,
      });

      const result = await creativeCommercialDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const stagnantFindings = result.findings.filter((f) => f.summary.includes("stagnant"));
      expect(stagnantFindings.length).toBeGreaterThanOrEqual(1);
      expect(stagnantFindings[0]!.summary).toContain("MLC-CRX-STG");
      // Should show ~50 days active, not 0 days (capturedAt was set to now)
      expect(stagnantFindings[0]!.summary).toMatch(/4[0-9] days|5[0-9] days/);
    });
  });
});
