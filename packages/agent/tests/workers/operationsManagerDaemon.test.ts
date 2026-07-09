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
import { operationsManagerDaemon } from "../../src/workers/operationsManagerDaemon.js";
import type { DaemonResult } from "../../src/workers/daemonTypes.js";

// ── Helpers ─────────────────────────────────────────────────────────

const SELLER_IDS = ["seller-plasticov"];

function claimFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 1,
    messageId: overrides.messageId ?? crypto.randomUUID(),
    senderAgentId: overrides.senderAgentId ?? "ceo",
    receiverAgentId: overrides.receiverAgentId ?? "operations-manager",
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

/**
 * Upsert an operational snapshot row via the ORM's writer.
 * The ORM's listSnapshots reads from `operational_snapshots` table
 * by seller_id + kind. We insert directly so the reader picks it up.
 */
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

describe("operationsManagerDaemon", () => {
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
    it("returns empty findings when no snapshots exist", async () => {
      const result: DaemonResult = await operationsManagerDaemon({
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

  // ── Open claims detection ────────────────────────────────────

  describe("open claims", () => {
    it("flags open claims as critical", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "CLAIM-001", "claim_snapshot", {
        status: "open",
        reason: "Producto no recibido",
        claim_id: "C123",
      });

      const result = await operationsManagerDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const claimFindings = result.findings.filter(
        (f) => f.severity === "critical" && f.summary.includes("claim"),
      );
      expect(claimFindings.length).toBeGreaterThanOrEqual(1);
      expect(claimFindings[0]!.severity).toBe("critical");
    });

    it("does not flag closed or resolved claims", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "CLAIM-002", "claim_snapshot", {
        status: "closed",
        reason: "Devuelto",
        claim_id: "C124",
      });

      const result = await operationsManagerDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const claimFindings = result.findings.filter((f) => f.summary.includes("claim"));
      expect(claimFindings).toEqual([]);
    });
  });

  // ── Unanswered questions ─────────────────────────────────────

  describe("unanswered questions", () => {
    it("flags unanswered questions older than 24h as warning", async () => {
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 48); // 2 days ago

      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "Q-001",
        "question_snapshot",
        {
          status: "unanswered",
          text: "¿Tienen este producto en color azul?",
          question_id: "Q55",
          created_at: oldDate.toISOString(),
        },
        oldDate.toISOString(),
      );

      const result = await operationsManagerDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const questionFindings = result.findings.filter(
        (f) => f.severity === "warning" && f.summary.includes("question"),
      );
      expect(questionFindings.length).toBeGreaterThanOrEqual(1);
    });

    it("does not flag recent unanswered questions (<24h)", async () => {
      const recentDate = new Date();
      recentDate.setHours(recentDate.getHours() - 2);

      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "Q-002",
        "question_snapshot",
        {
          status: "unanswered",
          text: "¿Hacen envíos a región?",
          question_id: "Q56",
          created_at: recentDate.toISOString(),
        },
        recentDate.toISOString(),
      );

      const result = await operationsManagerDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const questionFindings = result.findings.filter((f) => f.summary.includes("question"));
      expect(questionFindings).toEqual([]);
    });

    it("does not flag answered questions", async () => {
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 48);

      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "Q-003",
        "question_snapshot",
        {
          status: "answered",
          text: "¿Tienen stock?",
          question_id: "Q57",
          created_at: oldDate.toISOString(),
        },
        oldDate.toISOString(),
      );

      const result = await operationsManagerDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const questionFindings = result.findings.filter((f) => f.summary.includes("question"));
      expect(questionFindings).toEqual([]);
    });
  });

  // ── Delayed orders ───────────────────────────────────────────

  describe("delayed orders", () => {
    it("flags orders marked as delayed as critical", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "ORD-001", "order_snapshot", {
        status: "delayed",
        order_id: "O100",
      });

      const result = await operationsManagerDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const delayedFindings = result.findings.filter(
        (f) => f.severity === "critical" && f.summary.includes("Delayed"),
      );
      expect(delayedFindings.length).toBeGreaterThanOrEqual(1);
    });

    it("flags orders past estimated delivery date as critical", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5); // 5 days past

      seedOrmSnapshot(db, SELLER_IDS[0]!, "ORD-002", "order_snapshot", {
        status: "delayed",
        order_id: "O101",
        estimated_delivery: pastDate.toISOString(),
      });

      const result = await operationsManagerDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const delayedFindings = result.findings.filter((f) =>
        f.summary.includes("past estimated delivery"),
      );
      expect(delayedFindings.length).toBeGreaterThanOrEqual(1);
    });

    it("does not flag orders still within estimated delivery", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);

      seedOrmSnapshot(db, SELLER_IDS[0]!, "ORD-003", "order_snapshot", {
        status: "delayed",
        order_id: "O102",
        estimated_delivery: futureDate.toISOString(),
      });

      const result = await operationsManagerDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const delayedFindings = result.findings.filter((f) => f.summary.includes("delivery"));
      expect(delayedFindings).toEqual([]);
    });
  });

  // ── Reputation ───────────────────────────────────────────────

  describe("reputation", () => {
    it("flags reputation score below threshold as warning", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "REP-001", "reputation_snapshot", {
        score: 0.25,
        color: "red",
        level: "bajo",
      });

      const result = await operationsManagerDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const repFindings = result.findings.filter((f) => f.summary.includes("reputation"));
      expect(repFindings.length).toBeGreaterThanOrEqual(1);
      expect(repFindings[0]!.severity).toBe("warning");
    });

    it("does not flag reputation score above threshold", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "REP-002", "reputation_snapshot", {
        score: 0.85,
        color: "green",
        level: "alto",
      });

      const result = await operationsManagerDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const repFindings = result.findings.filter((f) => f.summary.includes("reputation"));
      expect(repFindings).toEqual([]);
    });
  });

  // ── CEO proposal ─────────────────────────────────────────────

  describe("CEO proposal enqueue", () => {
    it("enqueues proposals with correct sender/receiver and noMutationExecuted: true", async () => {
      seedOrmSnapshot(db, SELLER_IDS[0]!, "CLAIM-010", "claim_snapshot", {
        status: "open",
        reason: "Producto defectuoso",
        claim_id: "C200",
      });

      const result = await operationsManagerDaemon({
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
      expect(row!.sender_agent_id).toBe("operations-manager");
      expect(row!.receiver_agent_id).toBe("ceo");
      expect(row!.message_type).toBe("proposal");

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const payload = JSON.parse(row!.payload_json as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(payload.noMutationExecuted).toBe(true);
    });
  });
});
