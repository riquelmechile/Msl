import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { createSqliteOperationalReadModel } from "@msl/memory";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import type {
  AgentMessageBusStore,
  AgentMessage,
} from "../../src/conversation/agentMessageBusStore.js";
import { ownedEcommerceDaemon } from "../../src/workers/ownedEcommerceDaemon.js";
import type { DaemonResult } from "../../src/workers/daemonTypes.js";

// ── Helpers ─────────────────────────────────────────────────────────

const SELLER_IDS = ["seller-plasticov"];

function claimFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 1,
    messageId: overrides.messageId ?? crypto.randomUUID(),
    senderAgentId: overrides.senderAgentId ?? "ceo",
    receiverAgentId: overrides.receiverAgentId ?? "owned-ecommerce",
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

// ── Tests ───────────────────────────────────────────────────────────

describe("ownedEcommerceDaemon", () => {
  let db: Database.Database;
  let bus: AgentMessageBusStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    bus = createAgentMessageBusStore(db);
    createSqliteOperationalReadModel(db);
  });

  // ── Empty state ──────────────────────────────────────────────

  describe("with no data", () => {
    it("returns empty findings when no listing snapshots exist", async () => {
      const result: DaemonResult = await ownedEcommerceDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: {} as never,
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.findings).toEqual([]);
      expect(result.proposalEnqueued).toBe(false);
      expect(result.messageIds).toEqual([]);
    });
  });

  // ── DaemonResult contract compliance ─────────────────────────

  describe("DaemonResult contract", () => {
    it("returns valid DaemonResult with correct shape", async () => {
      const result: DaemonResult = await ownedEcommerceDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: {} as never,
        bus,
        sellerIds: SELLER_IDS,
      });

      // Must have findings array
      expect(Array.isArray(result.findings)).toBe(true);
      // proposalEnqueued is boolean
      expect(typeof result.proposalEnqueued).toBe("boolean");
      // messageIds is string array
      expect(Array.isArray(result.messageIds)).toBe(true);
      for (const id of result.messageIds) {
        expect(typeof id).toBe("string");
      }

      // Each finding follows DaemonFinding contract
      for (const f of result.findings) {
        expect(["opportunity", "alert", "info"]).toContain(f.kind);
        expect(["info", "warning", "critical"]).toContain(f.severity);
        expect(typeof f.summary).toBe("string");
        expect(Array.isArray(f.evidenceIds)).toBe(true);
      }
    });
  });

  // ── Image detection ──────────────────────────────────────────

  describe("missing images", () => {
    it("flags listings without thumbnail as warning", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "ITEM-001", "listing_snapshot", {
        title: "Producto de prueba",
        price: 15000,
        available_quantity: 50,
        thumbnail: "",
        category_id: "CAT-001",
        status: "active",
      });

      const result = await ownedEcommerceDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: {} as never,
        bus,
        sellerIds: SELLER_IDS,
      });

      const imageFindings = result.findings.filter(
        (f) => f.summary.includes("thumbnail") || f.summary.includes("image"),
      );
      expect(imageFindings.length).toBeGreaterThanOrEqual(1);
      expect(imageFindings[0]!.severity).toBe("warning");
    });

    it("does not flag listings with thumbnail", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "ITEM-002", "listing_snapshot", {
        title: "Producto con imagen",
        price: 25000,
        available_quantity: 30,
        thumbnail: "https://example.com/img.jpg",
        category_id: "CAT-001",
        status: "active",
      });

      const result = await ownedEcommerceDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: {} as never,
        bus,
        sellerIds: SELLER_IDS,
      });

      const imageFindings = result.findings.filter(
        (f) => f.summary.includes("thumbnail") || f.summary.includes("image"),
      );
      expect(imageFindings).toEqual([]);
    });
  });

  // ── Stock detection ─────────────────────────────────────────

  describe("low stock", () => {
    it("flags listings with very low stock as warning", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "ITEM-003", "listing_snapshot", {
        title: "Producto con stock bajo",
        price: 10000,
        available_quantity: 2,
        thumbnail: "https://example.com/img.jpg",
        category_id: "CAT-001",
        status: "active",
      });

      const result = await ownedEcommerceDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: {} as never,
        bus,
        sellerIds: SELLER_IDS,
      });

      const stockFindings = result.findings.filter((f) => f.summary.includes("low stock"));
      expect(stockFindings.length).toBeGreaterThanOrEqual(1);
      expect(stockFindings[0]!.severity).toBe("warning");
    });

    it("does not flag listings with adequate stock", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "ITEM-004", "listing_snapshot", {
        title: "Producto con stock suficiente",
        price: 30000,
        available_quantity: 100,
        thumbnail: "https://example.com/img.jpg",
        category_id: "CAT-001",
        status: "active",
      });

      const result = await ownedEcommerceDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: {} as never,
        bus,
        sellerIds: SELLER_IDS,
      });

      const stockFindings = result.findings.filter((f) => f.summary.includes("low stock"));
      expect(stockFindings).toEqual([]);
    });
  });

  // ── CEO proposal ─────────────────────────────────────────────

  describe("CEO proposal enqueue", () => {
    it("enqueues proposal with correct sender/receiver and noMutationExecuted: true", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "ITEM-005", "listing_snapshot", {
        title: "Producto sin imagen",
        price: 5000,
        available_quantity: 2,
        thumbnail: "",
        category_id: "CAT-001",
        status: "active",
      });

      const result = await ownedEcommerceDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: {} as never,
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.messageIds.length).toBeGreaterThan(0);

      const msgId = result.messageIds[0]!;
      const row = db.prepare("SELECT * FROM agent_message_bus WHERE message_id = ?").get(msgId) as
        Record<string, unknown> | undefined;

      expect(row).toBeDefined();
      expect(row!.sender_agent_id).toBe("owned-ecommerce");
      expect(row!.receiver_agent_id).toBe("ceo");
      expect(row!.message_type).toBe("proposal");

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const payload = JSON.parse(row!.payload_json as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(payload.noMutationExecuted).toBe(true);
    });
  });
});
