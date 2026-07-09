import Database from "better-sqlite3";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createGraphEngine } from "@msl/memory";
import { createSqliteOperationalReadModel } from "@msl/memory";
import type { GraphEngine } from "@msl/memory";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import type { AgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import { startDaemonScheduler } from "../../src/workers/daemonScheduler.js";

// ── Helpers ─────────────────────────────────────────────────────────

const SELLER_IDS = ["seller-plasticov"];

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
    `${metadata.type}_${metadata.itemId}_${Date.now()}_${Math.random().toString(36).slice(2)}`,  // eslint-disable-line @typescript-eslint/restrict-template-expressions
    metadata,
  );
  return node.id;
}

// ── Integration Tests ───────────────────────────────────────────────

describe("daemon integration — scheduler + daemons + bus", () => {
  let db: Database.Database;
  let bus: AgentMessageBusStore;
  let engine: GraphEngine;
  let scheduler: ReturnType<typeof startDaemonScheduler>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    bus = createAgentMessageBusStore(db);
    engine = createGraphEngine(":memory:");
    // Run ORM migration so the operational_snapshots table exists for seedOrmSnapshot
    createSqliteOperationalReadModel(db);
  });

  afterEach(() => {
    if (scheduler) scheduler.stop();
  });

  describe("marketCatalogDaemon via scheduler", () => {
    it("processes a pending message end-to-end: claim → daemon → CEO proposal → resolve", async () => {
      // Seed a low-visit listing that will trigger a finding
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-INT001", "listing_snapshot", {
        status: "active",
        price: 10000,
        title: "Integration test product",
      });

      // Enqueue a task message for market-catalog agent
      bus.enqueue({
        senderAgentId: "ceo",
        receiverAgentId: "market-catalog",
        messageType: "task",
        payloadJson: '{"task":"check-catalog"}',
      });

      // Start the scheduler with a very short interval
      scheduler = startDaemonScheduler({
        bus,
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        sellerIds: SELLER_IDS,
        intervalMs: 1000,
      });

      // Wait for the initial cycle to run
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Check that CEO proposals were enqueued
      const ceoMessages = db
        .prepare(
          "SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'ceo' AND message_type = 'proposal'",
        )
        .all() as Array<Record<string, unknown>>;

      expect(ceoMessages.length).toBeGreaterThan(0);
      const proposal = ceoMessages[0]!;
      expect(proposal.sender_agent_id).toBe("market-catalog");

      // Verify noMutationExecuted
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const payload = JSON.parse(proposal.payload_json as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(payload.noMutationExecuted).toBe(true);

      // The original task message should be resolved
      const taskMessages = db
        .prepare(
          "SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'market-catalog' AND message_type = 'task'",
        )
        .all() as Array<Record<string, unknown>>;

      expect(taskMessages.length).toBeGreaterThan(0);
      expect(taskMessages[0]!.status).toBe("resolved");
    });
  });

  describe("operationsManagerDaemon via scheduler", () => {
    it("routes operations-manager messages to the correct daemon", async () => {
      // Seed an open claim
      seedOrmSnapshot(db, SELLER_IDS[0]!, "CL-INT001", "claim_snapshot", {
        status: "open",
        reason: "Integration test claim",
        claim_id: "C999",
      });

      // Enqueue a task for operations-manager
      bus.enqueue({
        senderAgentId: "ceo",
        receiverAgentId: "operations-manager",
        messageType: "task",
        payloadJson: '{"task":"check-operations"}',
      });

      scheduler = startDaemonScheduler({
        bus,
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        sellerIds: SELLER_IDS,
        intervalMs: 1000,
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const proposals = db
        .prepare(
          "SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'ceo' AND sender_agent_id = 'operations-manager'",
        )
        .all() as Array<Record<string, unknown>>;

      expect(proposals.length).toBeGreaterThan(0);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const payload = JSON.parse(proposals[0]!.payload_json as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(payload.noMutationExecuted).toBe(true);
    });
  });

  describe("costSupplierDaemon via scheduler", () => {
    it("routes cost-supplier messages and detects margin issues", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-CS001", "listing_snapshot", {
        status: "active",
        price: 6000, // low margin → critical
        title: "Cost test product",
      });

      bus.enqueue({
        senderAgentId: "ceo",
        receiverAgentId: "cost-supplier",
        messageType: "task",
        payloadJson: '{"task":"check-costs"}',
      });

      scheduler = startDaemonScheduler({
        bus,
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        sellerIds: SELLER_IDS,
        intervalMs: 1000,
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const proposals = db
        .prepare(
          "SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'ceo' AND sender_agent_id = 'cost-supplier'",
        )
        .all() as Array<Record<string, unknown>>;

      expect(proposals.length).toBeGreaterThan(0);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const payload = JSON.parse(proposals[0]!.payload_json as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(payload.noMutationExecuted).toBe(true);
    });
  });

  describe("creativeCommercialDaemon via scheduler", () => {
    it("routes creative-commercial messages and detects stagnant stock", async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 50);

      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "MLC-CC001",
        "listing_snapshot",
        {
          status: "active",
          price: 12000,
          title: "Stagnant creative product",
        },
        oldDate.toISOString(),
      );

      seedCortexNode(engine, {
        type: "visit_snapshot",
        itemId: "MLC-CC001",
        totalVisits: 3,
      });

      bus.enqueue({
        senderAgentId: "ceo",
        receiverAgentId: "creative-commercial",
        messageType: "task",
        payloadJson: '{"task":"check-creative"}',
      });

      scheduler = startDaemonScheduler({
        bus,
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        sellerIds: SELLER_IDS,
        intervalMs: 1000,
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const proposals = db
        .prepare(
          "SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'ceo' AND sender_agent_id = 'creative-commercial'",
        )
        .all() as Array<Record<string, unknown>>;

      expect(proposals.length).toBeGreaterThan(0);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const payload = JSON.parse(proposals[0]!.payload_json as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(payload.noMutationExecuted).toBe(true);
    });
  });

  describe("error isolation", () => {
    it("continues processing when one daemon has no data", async () => {
      // Only seed data for market-catalog, nothing for operations-manager
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-ERR001", "listing_snapshot", {
        status: "active",
        price: 10000,
        title: "Error test",
      });

      // Enqueue for both agents
      bus.enqueue({
        senderAgentId: "ceo",
        receiverAgentId: "market-catalog",
        messageType: "task",
        payloadJson: '{"task":"test1"}',
      });

      bus.enqueue({
        senderAgentId: "ceo",
        receiverAgentId: "operations-manager",
        messageType: "task",
        payloadJson: '{"task":"test2"}',
      });

      scheduler = startDaemonScheduler({
        bus,
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        sellerIds: SELLER_IDS,
        intervalMs: 1000,
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Both should be resolved
      const tasks = db
        .prepare(
          "SELECT receiver_agent_id, status FROM agent_message_bus WHERE message_type = 'task'",
        )
        .all() as Array<{ receiver_agent_id: string; status: string }>;

      for (const task of tasks) {
        expect(task.status).toBe("resolved");
      }
    });
  });

  describe("all four daemons", () => {
    it("processes messages for all four daemon lanes", async () => {
      // Seed data for all daemons
      seedOrmSnapshot(db, SELLER_IDS[0]!, "MLC-ALL", "listing_snapshot", {
        status: "active",
        price: 10000,
        title: "All daemons test",
      });

      // Enqueue for all four lanes
      const lanes = [
        "market-catalog",
        "operations-manager",
        "cost-supplier",
        "creative-commercial",
      ];

      for (const lane of lanes) {
        bus.enqueue({
          senderAgentId: "ceo",
          receiverAgentId: lane,
          messageType: "task",
          payloadJson: JSON.stringify({ task: `check-${lane}` }),
        });
      }

      scheduler = startDaemonScheduler({
        bus,
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        sellerIds: SELLER_IDS,
        intervalMs: 1000,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify all task messages were resolved
      const tasks = db
        .prepare(
          "SELECT receiver_agent_id, status FROM agent_message_bus WHERE message_type = 'task'",
        )
        .all() as Array<{ receiver_agent_id: string; status: string }>;

      for (const task of tasks) {
        expect(task.status).toBe("resolved");
      }
    });
  });
});
