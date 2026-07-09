import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { createSqliteOperationalReadModel } from "@msl/memory";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import type {
  AgentMessageBusStore,
  AgentMessage,
} from "../../src/conversation/agentMessageBusStore.js";
import { unansweredQuestionsDaemon } from "../../src/workers/unansweredQuestionsDaemon.js";
import type { DaemonResult } from "../../src/workers/daemonTypes.js";

// ── Helpers ─────────────────────────────────────────────────────────

const SELLER_IDS = ["seller-plasticov"];

function claimFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 1,
    messageId: overrides.messageId ?? crypto.randomUUID(),
    senderAgentId: overrides.senderAgentId ?? "ceo",
    receiverAgentId: overrides.receiverAgentId ?? "unanswered-questions",
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

// ── Tests ───────────────────────────────────────────────────────────

describe("unansweredQuestionsDaemon", () => {
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
    it("returns empty findings when no question snapshots exist", async () => {
      const result: DaemonResult = await unansweredQuestionsDaemon({
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
      const result: DaemonResult = await unansweredQuestionsDaemon({
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

  // ── Unanswered question detection ────────────────────────────

  describe("unanswered question detection", () => {
    it("flags unanswered questions older than 24h as warning", async () => {
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 48); // 2 days ago

      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "Q-001",
        "question_snapshot",
        {
          status: "UNANSWERED",
          text: "¿Tienen este producto en color azul?",
          question_id: "Q55",
          created_at: oldDate.toISOString(),
        },
        oldDate.toISOString(),
      );

      const result = await unansweredQuestionsDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: {} as never,
        bus,
        sellerIds: SELLER_IDS,
      });

      const questionFindings = result.findings.filter(
        (f) => f.severity === "warning" && f.summary.includes("buyer question"),
      );
      expect(questionFindings.length).toBeGreaterThanOrEqual(1);
      expect(result.proposalEnqueued).toBe(true);
      expect(result.messageIds.length).toBeGreaterThan(0);
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
          status: "UNANSWERED",
          text: "¿Hacen envíos a región?",
          question_id: "Q56",
          created_at: recentDate.toISOString(),
        },
        recentDate.toISOString(),
      );

      const result = await unansweredQuestionsDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: {} as never,
        bus,
        sellerIds: SELLER_IDS,
      });

      const questionFindings = result.findings.filter(
        (f) => f.summary.includes("buyer question"),
      );
      expect(questionFindings).toEqual([]);
      expect(result.proposalEnqueued).toBe(false);
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
          status: "ANSWERED",
          text: "¿Tienen stock?",
          question_id: "Q57",
          created_at: oldDate.toISOString(),
        },
        oldDate.toISOString(),
      );

      const result = await unansweredQuestionsDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: {} as never,
        bus,
        sellerIds: SELLER_IDS,
      });

      const questionFindings = result.findings.filter(
        (f) => f.summary.includes("buyer question"),
      );
      expect(questionFindings).toEqual([]);
      expect(result.proposalEnqueued).toBe(false);
    });
  });

  // ── Multi-seller aggregation ─────────────────────────────────

  describe("multi-question aggregation", () => {
    it("groups multiple overdue questions into a single CEO proposal per seller", async () => {
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 48);

      // Two unanswered questions for the same seller
      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "Q-010",
        "question_snapshot",
        {
          status: "UNANSWERED",
          text: "¿Tienen envío gratis?",
          question_id: "Q70",
          created_at: oldDate.toISOString(),
        },
        oldDate.toISOString(),
      );

      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "Q-011",
        "question_snapshot",
        {
          status: "UNANSWERED",
          text: "¿Cuánto demora la entrega?",
          question_id: "Q71",
          created_at: oldDate.toISOString(),
        },
        oldDate.toISOString(),
      );

      const result = await unansweredQuestionsDaemon({
        claim: claimFixture(),
        reader: createSqliteOperationalReadModel(db),
        cortex: {} as never,
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.proposalEnqueued).toBe(true);
      // Should have 1 message (one per seller group, not per question)
      expect(result.messageIds.length).toBe(1);
      expect(result.findings.length).toBe(2); // 2 findings for 2 questions
    });
  });

  // ── CEO proposal ─────────────────────────────────────────────

  describe("CEO proposal enqueue", () => {
    it("enqueues proposal with correct sender/receiver and noMutationExecuted: true", async () => {
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 48);

      seedOrmSnapshot(
        db,
        SELLER_IDS[0]!,
        "Q-020",
        "question_snapshot",
        {
          status: "UNANSWERED",
          text: "¿Hay stock disponible?",
          question_id: "Q80",
          created_at: oldDate.toISOString(),
        },
        oldDate.toISOString(),
      );

      const result = await unansweredQuestionsDaemon({
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
      expect(row!.sender_agent_id).toBe("unanswered-questions");
      expect(row!.receiver_agent_id).toBe("ceo");
      expect(row!.message_type).toBe("proposal");

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const payload = JSON.parse(row!.payload_json as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(payload.noMutationExecuted).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(payload.sellerId).toBe(SELLER_IDS[0]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(Array.isArray(payload.questions)).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(payload.questions.length).toBe(1);
    });
  });
});
