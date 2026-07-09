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
import { costSupplierDaemon } from "../../src/workers/costSupplierDaemon.js";
import type { DaemonResult } from "../../src/workers/daemonTypes.js";

// ── Helpers ─────────────────────────────────────────────────────────

const SELLER_IDS = ["seller-plasticov"];

function claimFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 1,
    messageId: overrides.messageId ?? crypto.randomUUID(),
    senderAgentId: overrides.senderAgentId ?? "ceo",
    receiverAgentId: overrides.receiverAgentId ?? "cost-supplier",
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

describe("costSupplierDaemon", () => {
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
      const result: DaemonResult = await costSupplierDaemon({
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

  // ── Margin detection ─────────────────────────────────────────

  describe("margin viability", () => {
    it("flags listing with margin below 30% as warning", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-001", "listing_snapshot", {
        status: "active",
        price: 10000,
        title: "Low margin product",
      });
      // With default commission=15% + shipping=$5000:
      // costs = 1500 + 5000 = 6500, margin = (10000-6500)/10000 = 35% → no warning
      // Price of $8000 → costs = 1200+5000=6200, margin = (8000-6200)/8000 = 22.5% → warning

      // But wait, the default shipping is 5000, commission 15%:
      // For price=10000, margin = (10000 - 1500 - 5000) / 10000 = 3500/10000 = 35% — this is actually above 30%
      // Let's use a lower price to trigger margin detection
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-002", "listing_snapshot", {
        status: "active",
        price: 8000, // margin = (8000-1200-5000)/8000 = 1800/8000 = 22.5%
        title: "Thin margin product",
      });

      const result = await costSupplierDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const marginFindings = result.findings.filter((f) => f.summary.includes("margin"));
      // MLC-002 should trigger warning (22.5% < 30%)
      expect(marginFindings.length).toBeGreaterThanOrEqual(1);
      expect(marginFindings[0]!.severity).toBe("warning");
      expect(marginFindings[0]!.summary).toContain("MLC-002");
    });

    it("flags listing with margin below 10% as critical", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-010", "listing_snapshot", {
        status: "active",
        price: 6000, // (6000-900-5000)/6000 = 100/6000 = 1.7% → critical
        title: "Near-cost product",
      });

      const result = await costSupplierDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const criticalMargin = result.findings.filter(
        (f) => f.severity === "critical" && f.summary.includes("margin"),
      );
      expect(criticalMargin.length).toBeGreaterThanOrEqual(1);
    });

    it("does not flag healthy margins", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-020", "listing_snapshot", {
        status: "active",
        price: 50000, // (50000-7500-5000)/50000 = 37500/50000 = 75% — healthy
        title: "High margin product",
      });

      const result = await costSupplierDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const marginFindings = result.findings.filter((f) => f.summary.includes("margin"));
      expect(marginFindings).toEqual([]);
    });
  });

  // ── Cost detection ───────────────────────────────────────────

  describe("selling below cost", () => {
    it("flags listing priced below known cost as critical", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-030", "listing_snapshot", {
        status: "active",
        price: 8000,
        title: "Below cost product",
      });

      // Seed cost data in Cortex
      seedCortexNode(engine, {
        type: "cost_snapshot",
        itemId: "MLC-030",
        sellerId: SELLER_IDS[0],
        cost: 12000, // cost > price
      });

      const result = await costSupplierDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const costFindings = result.findings.filter((f) => f.summary.includes("below cost"));
      expect(costFindings.length).toBeGreaterThanOrEqual(1);
      expect(costFindings[0]!.severity).toBe("critical");
    });

    it("does not flag listing priced above known cost", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-031", "listing_snapshot", {
        status: "active",
        price: 15000,
        title: "Above cost product",
      });

      seedCortexNode(engine, {
        type: "cost_snapshot",
        itemId: "MLC-031",
        sellerId: SELLER_IDS[0],
        cost: 8000,
      });

      const result = await costSupplierDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const costFindings = result.findings.filter((f) => f.summary.includes("below cost"));
      expect(costFindings).toEqual([]);
    });
  });

  // ── Restock opportunity ──────────────────────────────────────

  describe("restock signals", () => {
    it("flags out-of-stock listing with visits as restock opportunity", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-040", "listing_snapshot", {
        status: "active",
        price: 15000,
        title: "Out of stock item",
        stock: 0,
        available_quantity: 0,
      });

      seedCortexNode(engine, {
        type: "visit_snapshot",
        itemId: "MLC-040",
        sellerId: SELLER_IDS[0],
        totalVisits: 25,
      });

      const result = await costSupplierDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const restockFindings = result.findings.filter((f) => f.summary.includes("Restock"));
      expect(restockFindings.length).toBeGreaterThanOrEqual(1);
      expect(restockFindings[0]!.severity).toBe("info");
    });

    it("does not flag out-of-stock listings with few visits", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-041", "listing_snapshot", {
        status: "active",
        price: 15000,
        title: "Unpopular out of stock",
        stock: 0,
      });

      seedCortexNode(engine, {
        type: "visit_snapshot",
        itemId: "MLC-041",
        sellerId: SELLER_IDS[0],
        totalVisits: 1,
      });

      const result = await costSupplierDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const restockFindings = result.findings.filter((f) => f.summary.includes("Restock"));
      expect(restockFindings).toEqual([]);
    });
  });

  // ── CEO proposal ─────────────────────────────────────────────

  describe("CEO proposal enqueue", () => {
    it("enqueues proposals with correct sender/receiver and noMutationExecuted: true", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-050", "listing_snapshot", {
        status: "active",
        price: 6000,
        title: "Low margin test",
      });

      const result = await costSupplierDaemon({
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
      expect(row!.sender_agent_id).toBe("cost-supplier");
      expect(row!.receiver_agent_id).toBe("ceo");
      expect(row!.message_type).toBe("proposal");

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const payload = JSON.parse(row!.payload_json as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(payload.noMutationExecuted).toBe(true);
    });
  });

  // ── Cortex fallback (ORM parity) ──────────────────────────────

  describe("Cortex fallback when ORM is empty", () => {
    it("detects margin issues from Cortex listing_snapshot nodes (fallback path)", async () => {
      // Do NOT seed any ORM listing_snapshot data — force Cortex fallback
      seedCortexNode(engine, {
        type: "listing_snapshot",
        itemId: "MLC-CRX-001",
        sellerId: SELLER_IDS[0],
        status: "active",
        price: 6000, // margin = (6000-900-5000)/6000 = 1.7% → critical
        title: "Cortex fallback product",
      });

      const result = await costSupplierDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const marginFindings = result.findings.filter(
        (f) => f.severity === "critical" && f.summary.includes("margin"),
      );
      expect(marginFindings.length).toBeGreaterThanOrEqual(1);
      expect(marginFindings[0]!.summary).toContain("MLC-CRX-001");
    });

    it("skips paused/closed listings in Cortex fallback (status: active filter)", async () => {
      // Seed a paused listing in Cortex — should be ignored
      seedCortexNode(engine, {
        type: "listing_snapshot",
        itemId: "MLC-CRX-002",
        sellerId: SELLER_IDS[0],
        status: "paused",
        price: 6000,
        title: "Paused Cortex product",
      });

      const result = await costSupplierDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      // No findings should be produced for the paused listing
      const findings = result.findings.filter((f) => f.summary.includes("MLC-CRX-002"));
      expect(findings).toEqual([]);
      expect(result.proposalEnqueued).toBe(false);
    });
  });
});
