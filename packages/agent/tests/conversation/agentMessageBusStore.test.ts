import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";

import {
  createAgentMessageBusStore,
  migrateBusSchema,
  type AgentMessageBusStore,
} from "../../src/conversation/agentMessageBusStore.js";

// ── Helpers ─────────────────────────────────────────────────────────

/** Insert a message directly via SQL, bypassing dedup. */
function insertMessageDirect(
  db: Database.Database,
  overrides: Partial<{
    message_id: string;
    sender_agent_id: string;
    receiver_agent_id: string;
    message_type: string;
    payload_json: string;
    status: string;
    priority: number;
    attempts: number;
    dedupe_key: string | null;
    locked_at: string | null;
  }> = {},
): string {
  const messageId = overrides.message_id ?? crypto.randomUUID();
  db.prepare(
    `INSERT INTO agent_message_bus
       (message_id, sender_agent_id, receiver_agent_id, message_type, payload_json,
        status, priority, attempts, dedupe_key, locked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    messageId,
    overrides.sender_agent_id ?? "agent-a",
    overrides.receiver_agent_id ?? "agent-b",
    overrides.message_type ?? "test",
    overrides.payload_json ?? '{"key":"value"}',
    overrides.status ?? "pending",
    overrides.priority ?? 5,
    overrides.attempts ?? 0,
    overrides.dedupe_key ?? null,
    overrides.locked_at ?? null,
  );
  return messageId;
}

/** Build an enqueue input fixture. */
function enqInput(
  overrides: Partial<{
    senderAgentId: string;
    receiverAgentId: string;
    messageType: string;
    payloadJson: string;
    priority: number;
    dedupeKey: string;
    correlationId: string;
    parentMessageId: string;
    sellerId: string;
    actionId: string;
  }> = {},
) {
  return {
    senderAgentId: overrides.senderAgentId ?? "sender-1",
    receiverAgentId: overrides.receiverAgentId ?? "receiver-1",
    messageType: overrides.messageType ?? "task",
    payloadJson: overrides.payloadJson ?? '{"task":"do-something"}',
    ...(overrides.priority != null ? { priority: overrides.priority } : {}),
    ...(overrides.dedupeKey != null ? { dedupeKey: overrides.dedupeKey } : {}),
    ...(overrides.correlationId != null ? { correlationId: overrides.correlationId } : {}),
    ...(overrides.parentMessageId != null ? { parentMessageId: overrides.parentMessageId } : {}),
    ...(overrides.sellerId != null ? { sellerId: overrides.sellerId } : {}),
    ...(overrides.actionId != null ? { actionId: overrides.actionId } : {}),
  };
}

// ── Setup ────────────────────────────────────────────────────────────

describe("agentMessageBusStore", () => {
  let db: Database.Database;
  let store: AgentMessageBusStore;

  beforeEach(() => {
    db = new Database(":memory:");
    // Enable WAL for realistic transaction behavior (same as production)
    db.pragma("journal_mode = WAL");
    store = createAgentMessageBusStore(db);
  });

  // ═══════════════════════════════════════════════════════════════
  // Enqueue (3 scenarios)
  // ═══════════════════════════════════════════════════════════════

  describe("enqueue", () => {
    it("persists a message with status pending", () => {
      const msg = store.enqueue(enqInput());

      expect(msg.messageId).toBeTruthy();
      expect(msg.senderAgentId).toBe("sender-1");
      expect(msg.receiverAgentId).toBe("receiver-1");
      expect(msg.messageType).toBe("task");
      expect(msg.payloadJson).toBe('{"task":"do-something"}');
      expect(msg.status).toBe("pending");
      expect(msg.priority).toBe(5);
      expect(msg.attempts).toBe(0);
      expect(msg.dedupeKey).toBeNull();
      expect(msg.lockedAt).toBeNull();
      expect(msg.resolvedAt).toBeNull();
      expect(msg.createdAt).toBeTruthy();
      expect(msg.updatedAt).toBeTruthy();
      // New columns default to null
      expect(msg.correlationId).toBeNull();
      expect(msg.parentMessageId).toBeNull();
      expect(msg.sellerId).toBeNull();
      expect(msg.actionId).toBeNull();
      expect(msg.resultJson).toBeNull();
      expect(msg.errorJson).toBeNull();
      expect(msg.cancelReason).toBeNull();
      expect(msg.learnedAt).toBeNull();
      expect(msg.outcomeScore).toBeNull();
    });

    it("returns existing message when dedupeKey matches", () => {
      const first = store.enqueue(enqInput({ dedupeKey: "abc" }));
      const second = store.enqueue(enqInput({ dedupeKey: "abc" }));

      // Should return the SAME message (same id, same messageId)
      expect(second.id).toBe(first.id);
      expect(second.messageId).toBe(first.messageId);

      // Verify only one row exists in the table
      const count = (
        db.prepare("SELECT COUNT(*) as cnt FROM agent_message_bus").get() as {
          cnt: number;
        }
      ).cnt;
      expect(count).toBe(1);
    });

    it("creates two distinct rows when dedupeKey is omitted", () => {
      const first = store.enqueue(enqInput());
      const second = store.enqueue(enqInput());

      expect(second.id).not.toBe(first.id);
      expect(second.messageId).not.toBe(first.messageId);

      const count = (
        db.prepare("SELECT COUNT(*) as cnt FROM agent_message_bus").get() as {
          cnt: number;
        }
      ).cnt;
      expect(count).toBe(2);
    });

    // ── Correlation / seller / action fields ───────────────

    it("stores correlationId when provided", () => {
      const msg = store.enqueue(enqInput({ correlationId: "corr-123" }));
      expect(msg.correlationId).toBe("corr-123");

      const row = db
        .prepare("SELECT correlation_id FROM agent_message_bus WHERE message_id = ?")
        .get(msg.messageId) as { correlation_id: string | null };
      expect(row.correlation_id).toBe("corr-123");
    });

    it("stores sellerId when provided", () => {
      const msg = store.enqueue(enqInput({ sellerId: "seller-42" }));
      expect(msg.sellerId).toBe("seller-42");

      const row = db
        .prepare("SELECT seller_id FROM agent_message_bus WHERE message_id = ?")
        .get(msg.messageId) as { seller_id: string | null };
      expect(row.seller_id).toBe("seller-42");
    });

    it("stores parentMessageId when provided", () => {
      const msg = store.enqueue(enqInput({ parentMessageId: "parent-1" }));
      expect(msg.parentMessageId).toBe("parent-1");

      const row = db
        .prepare("SELECT parent_message_id FROM agent_message_bus WHERE message_id = ?")
        .get(msg.messageId) as { parent_message_id: string | null };
      expect(row.parent_message_id).toBe("parent-1");
    });

    it("stores actionId when provided", () => {
      const msg = store.enqueue(enqInput({ actionId: "action-99" }));
      expect(msg.actionId).toBe("action-99");

      const row = db
        .prepare("SELECT action_id FROM agent_message_bus WHERE message_id = ?")
        .get(msg.messageId) as { action_id: string | null };
      expect(row.action_id).toBe("action-99");
    });

    it("stores all correlation fields as null when omitted", () => {
      const msg = store.enqueue(enqInput());
      expect(msg.correlationId).toBeNull();
      expect(msg.parentMessageId).toBeNull();
      expect(msg.sellerId).toBeNull();
      expect(msg.actionId).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // claimNext (5 scenarios)
  // ═══════════════════════════════════════════════════════════════

  describe("claimNext", () => {
    it("claims the next pending message and locks it", () => {
      store.enqueue(enqInput({ receiverAgentId: "worker-1" }));
      const claimed = store.claimNext("worker-1");

      expect(claimed).toHaveLength(1);
      expect(claimed[0]!.status).toBe("processing");
      expect(claimed[0]!.lockedAt).toBeTruthy();
    });

    it("returns messages in priority order (lower = higher priority)", () => {
      store.enqueue(enqInput({ receiverAgentId: "w", priority: 5 }));
      store.enqueue(enqInput({ receiverAgentId: "w", priority: 1 }));
      store.enqueue(enqInput({ receiverAgentId: "w", priority: 3 }));

      const claimed = store.claimNext("w", { limit: 3 });

      expect(claimed).toHaveLength(3);
      expect(claimed[0]!.priority).toBe(1);
      expect(claimed[1]!.priority).toBe(3);
      expect(claimed[2]!.priority).toBe(5);
    });

    it("returns empty array when no messages are pending", () => {
      const claimed = store.claimNext("nonexistent");
      expect(claimed).toEqual([]);
    });

    it("reclaims stale processing messages past the timeout", () => {
      const msgId = insertMessageDirect(db, {
        receiver_agent_id: "worker-1",
        status: "processing",
        priority: 1,
        locked_at: "2020-01-01T00:00:00Z", // well past timeout
      });

      const claimed = store.claimNext("worker-1");

      expect(claimed).toHaveLength(1);
      expect(claimed[0]!.messageId).toBe(msgId);
      expect(claimed[0]!.status).toBe("processing");
      expect(claimed[0]!.lockedAt).toBeTruthy();
      // locked_at should be refreshed (not the 2020 value)
      expect(claimed[0]!.lockedAt).not.toBe("2020-01-01T00:00:00Z");
    });

    it("returns different messages for sequential claims from the same receiver", () => {
      store.enqueue(enqInput({ receiverAgentId: "worker-1" }));
      store.enqueue(enqInput({ receiverAgentId: "worker-1" }));

      const first = store.claimNext("worker-1");
      const second = store.claimNext("worker-1");

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(first[0]!.messageId).not.toBe(second[0]!.messageId);
    });

    it("returns empty array when re-claiming the only message (double-claim guard)", () => {
      // One pending message — simulates two concurrent callers claiming at once
      store.enqueue(enqInput({ receiverAgentId: "worker-1" }));

      // First claim succeeds and locks the message
      const first = store.claimNext("worker-1");
      expect(first).toHaveLength(1);
      expect(first[0]!.status).toBe("processing");

      // Second claim returns empty — message already claimed/locked
      const second = store.claimNext("worker-1");
      expect(second).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Lifecycle transitions — new column writes (7 scenarios)
  // ═══════════════════════════════════════════════════════════════

  describe("lifecycle", () => {
    it("resolves a processing message", () => {
      store.enqueue(enqInput({ receiverAgentId: "w" }));
      const [claimed] = store.claimNext("w");
      expect(claimed!.status).toBe("processing");

      store.resolve(claimed!.messageId, { outcome: "ok" });

      // Re-fetch to verify
      const row = db
        .prepare("SELECT status, resolved_at, result_json FROM agent_message_bus WHERE message_id = ?")
        .get(claimed!.messageId) as { status: string; resolved_at: string | null; result_json: string | null };
      expect(row.status).toBe("resolved");
      expect(row.resolved_at).toBeTruthy();
      expect(row.result_json).toBe('{"outcome":"ok"}');
    });

    it("resolves without result leaves result_json null", () => {
      store.enqueue(enqInput({ receiverAgentId: "w" }));
      const [claimed] = store.claimNext("w");

      store.resolve(claimed!.messageId);

      const row = db
        .prepare("SELECT result_json FROM agent_message_bus WHERE message_id = ?")
        .get(claimed!.messageId) as { result_json: string | null };
      expect(row.result_json).toBeNull();
    });

    it("cancels a pending message and writes cancel_reason", () => {
      const msg = store.enqueue(enqInput({ receiverAgentId: "w" }));
      expect(msg.status).toBe("pending");

      store.cancel(msg.messageId, "obsolete");

      const row = db
        .prepare("SELECT status, cancel_reason FROM agent_message_bus WHERE message_id = ?")
        .get(msg.messageId) as { status: string; cancel_reason: string | null };
      expect(row.status).toBe("cancelled");
      expect(row.cancel_reason).toBe("obsolete");
    });

    it("cancels without reason leaves cancel_reason null", () => {
      const msg = store.enqueue(enqInput({ receiverAgentId: "w" }));

      store.cancel(msg.messageId);

      const row = db
        .prepare("SELECT cancel_reason FROM agent_message_bus WHERE message_id = ?")
        .get(msg.messageId) as { cancel_reason: string | null };
      expect(row.cancel_reason).toBeNull();
    });

    it("does not return cancelled messages from claimNext", () => {
      const msg = store.enqueue(enqInput({ receiverAgentId: "w" }));
      store.cancel(msg.messageId);

      const claimed = store.claimNext("w");
      expect(claimed).toEqual([]);
    });

    it("throws when resolving a non-existent messageId", () => {
      expect(() => store.resolve("nonexistent", {})).toThrow(/"nonexistent" not found/);
    });

    it("throws when cancelling a non-existent messageId", () => {
      expect(() => store.cancel("nonexistent")).toThrow(/"nonexistent" not found/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Retry guard + error_json (5 scenarios)
  // ═══════════════════════════════════════════════════════════════

  describe("fail / retry", () => {
    it("increments attempts and writes error_json on first failure", () => {
      store.enqueue(enqInput({ receiverAgentId: "w" }));
      const [claimed] = store.claimNext("w");

      store.fail(claimed!.messageId, "something went wrong");

      const row = db
        .prepare(
          "SELECT status, attempts, locked_at, error_json FROM agent_message_bus WHERE message_id = ?",
        )
        .get(claimed!.messageId) as {
        status: string;
        attempts: number;
        locked_at: string | null;
        error_json: string | null;
      };
      expect(row.attempts).toBe(1);
      expect(row.status).toBe("pending");
      expect(row.locked_at).toBeNull();
      expect(row.error_json).toBeTruthy();
      // Validate the error_json is valid JSON with the expected shape
      const parsed = JSON.parse(row.error_json!);
      expect(parsed.message).toBe("something went wrong");
      expect(parsed.timestamp).toBeTruthy();
    });

    it("sets status to failed when max attempts reached", () => {
      store.enqueue(enqInput({ receiverAgentId: "w" }));
      const [claimed] = store.claimNext("w");

      // Manually set attempts to 2 so next fail hits max
      db.prepare("UPDATE agent_message_bus SET attempts = 2 WHERE message_id = ?").run(
        claimed!.messageId,
      );

      store.fail(claimed!.messageId, "fatal error");

      const row = db
        .prepare("SELECT status, attempts FROM agent_message_bus WHERE message_id = ?")
        .get(claimed!.messageId) as { status: string; attempts: number };
      expect(row.attempts).toBe(3);
      expect(row.status).toBe("failed");
    });

    it("does not return failed messages from claimNext", () => {
      store.enqueue(enqInput({ receiverAgentId: "w" }));
      const [claimed] = store.claimNext("w");

      // Force to max attempts + failed
      db.prepare(
        "UPDATE agent_message_bus SET attempts = 3, status = 'failed' WHERE message_id = ?",
      ).run(claimed!.messageId);

      const result = store.claimNext("w");
      expect(result).toEqual([]);
    });

    it("throws when failing a non-existent messageId", () => {
      expect(() => store.fail("nonexistent", "error")).toThrow(/"nonexistent" not found/);
    });

    it("fail without error leaves error_json null", () => {
      store.enqueue(enqInput({ receiverAgentId: "w" }));
      const [claimed] = store.claimNext("w");

      store.fail(claimed!.messageId);

      const row = db
        .prepare("SELECT error_json FROM agent_message_bus WHERE message_id = ?")
        .get(claimed!.messageId) as { error_json: string | null };
      expect(row.error_json).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Schema integrity (3 scenarios)
  // ═══════════════════════════════════════════════════════════════

  describe("schema integrity", () => {
    it("migration is idempotent (runs twice, no error, data preserved)", () => {
      // Insert data via original store (migration already ran in beforeEach)
      const msg = store.enqueue(enqInput({ receiverAgentId: "worker-1" }));

      // Run migration again via a new factory call — must not throw
      const store2 = createAgentMessageBusStore(db);

      // Data should survive and be claimable through the new store
      const claimed = store2.claimNext("worker-1");
      expect(claimed).toHaveLength(1);
      expect(claimed[0]!.messageId).toBe(msg.messageId);
    });

    it("migrateBusSchema adds new columns to existing legacy table", () => {
      // Create a DB with only the legacy schema (no migration columns)
      const db2 = new Database(":memory:");
      db2.exec(`
        CREATE TABLE agent_message_bus (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id TEXT NOT NULL UNIQUE,
          sender_agent_id TEXT NOT NULL,
          receiver_agent_id TEXT NOT NULL,
          message_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          priority INTEGER NOT NULL DEFAULT 5,
          attempts INTEGER NOT NULL DEFAULT 0,
          dedupe_key TEXT,
          locked_at TEXT,
          resolved_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Insert legacy data before migration
      const legacyId = crypto.randomUUID();
      db2.prepare(
        `INSERT INTO agent_message_bus (message_id, sender_agent_id, receiver_agent_id, message_type, payload_json)
         VALUES (?, 'legacy', 'worker', 'test', '{}')`,
      ).run(legacyId);

      // Run migration
      migrateBusSchema(db2);

      // Verify all 9 new columns exist
      const columns = db2.pragma("table_info(agent_message_bus)") as Array<{
        cid: number;
        name: string;
        type: string;
      }>;
      const columnNames = columns.map((c) => c.name);
      expect(columnNames).toContain("result_json");
      expect(columnNames).toContain("error_json");
      expect(columnNames).toContain("cancel_reason");
      expect(columnNames).toContain("correlation_id");
      expect(columnNames).toContain("parent_message_id");
      expect(columnNames).toContain("seller_id");
      expect(columnNames).toContain("learned_at");
      expect(columnNames).toContain("outcome_score");
      expect(columnNames).toContain("action_id");

      // Legacy data should survive
      const row = db2
        .prepare("SELECT message_id FROM agent_message_bus WHERE message_id = ?")
        .get(legacyId) as { message_id: string } | undefined;
      expect(row?.message_id).toBe(legacyId);

      // New columns should be NULL for legacy rows
      const legacyRow = db2
        .prepare("SELECT result_json, error_json, correlation_id FROM agent_message_bus WHERE message_id = ?")
        .get(legacyId) as { result_json: null; error_json: null; correlation_id: null };
      expect(legacyRow.result_json).toBeNull();
      expect(legacyRow.error_json).toBeNull();
      expect(legacyRow.correlation_id).toBeNull();
    });

    it("has all 23 required columns after migration", () => {
      // Create a fresh DB that already has a table before migration
      const db2 = new Database(":memory:");
      db2.exec("CREATE TABLE pre_existing (id INTEGER PRIMARY KEY, name TEXT)");
      db2.prepare("INSERT INTO pre_existing (name) VALUES (?)").run("test-row");

      // Run migration
      createAgentMessageBusStore(db2);

      // Pre-existing table must be untouched
      const preRow = db2.prepare("SELECT name FROM pre_existing").get() as { name: string };
      expect(preRow.name).toBe("test-row");

      // Verify column count and names
      const columns = db2.pragma("table_info(agent_message_bus)") as Array<{
        cid: number;
        name: string;
        type: string;
      }>;
      expect(columns.length).toBe(23);

      const columnNames = columns.map((c) => c.name);
      const expected = [
        "id",
        "message_id",
        "sender_agent_id",
        "receiver_agent_id",
        "message_type",
        "payload_json",
        "status",
        "priority",
        "attempts",
        "dedupe_key",
        "locked_at",
        "resolved_at",
        "created_at",
        "updated_at",
        "result_json",
        "error_json",
        "cancel_reason",
        "correlation_id",
        "parent_message_id",
        "seller_id",
        "learned_at",
        "outcome_score",
        "action_id",
      ];
      expect(columnNames).toEqual(expected);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getMessagesByCorrelationId (2 scenarios)
  // ═══════════════════════════════════════════════════════════════

  describe("getMessagesByCorrelationId", () => {
    it("returns messages with the given correlation ID in creation order", () => {
      store.enqueue(enqInput({ correlationId: "corr-a" }));
      store.enqueue(enqInput({ correlationId: "corr-b" }));
      const msg2 = store.enqueue(enqInput({ correlationId: "corr-a" }));
      const msg3 = store.enqueue(enqInput({ correlationId: "corr-a" }));

      const results = store.getMessagesByCorrelationId("corr-a");

      expect(results).toHaveLength(3);
      expect(results[0]!.correlationId).toBe("corr-a");
      expect(results[1]!.messageId).toBe(msg2.messageId);
      expect(results[2]!.messageId).toBe(msg3.messageId);
      // Verify creation order (asc)
      expect(results[0]!.id).toBeLessThan(results[1]!.id);
      expect(results[1]!.id).toBeLessThan(results[2]!.id);
    });

    it("returns empty array when correlation ID has no matches", () => {
      const results = store.getMessagesByCorrelationId("nonexistent");
      expect(results).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getLearningHistory (2 scenarios)
  // ═══════════════════════════════════════════════════════════════

  describe("getLearningHistory", () => {
    it("returns messages that have outcome scores", () => {
      const msg1 = store.enqueue(enqInput());
      const msg2 = store.enqueue(enqInput());
      store.enqueue(enqInput()); // no outcome — should not appear

      store.recordOutcome(msg1.messageId, 0.85, "2026-07-09T12:00:00Z");
      store.recordOutcome(msg2.messageId, 0.42, "2026-07-09T13:00:00Z");

      const results = store.getLearningHistory();

      expect(results).toHaveLength(2);
      expect(results[0]!.outcomeScore).toBe(0.42); // DESC by learned_at
      expect(results[1]!.outcomeScore).toBe(0.85);
    });

    it("filters by minScore when provided", () => {
      const msg1 = store.enqueue(enqInput());
      const msg2 = store.enqueue(enqInput());

      store.recordOutcome(msg1.messageId, 0.9, "2026-07-09T12:00:00Z");
      store.recordOutcome(msg2.messageId, 0.3, "2026-07-09T13:00:00Z");

      const results = store.getLearningHistory({ minScore: 0.5 });

      expect(results).toHaveLength(1);
      expect(results[0]!.outcomeScore).toBe(0.9);
    });

    it("filters by since when provided", () => {
      const msg1 = store.enqueue(enqInput());
      const msg2 = store.enqueue(enqInput());

      store.recordOutcome(msg1.messageId, 0.9, "2026-07-09T10:00:00Z");
      store.recordOutcome(msg2.messageId, 0.8, "2026-07-09T15:00:00Z");

      const results = store.getLearningHistory({ since: "2026-07-09T12:00:00Z" });

      expect(results).toHaveLength(1);
      expect(results[0]!.outcomeScore).toBe(0.8);
    });

    it("returns empty array when no outcomes recorded", () => {
      const results = store.getLearningHistory();
      expect(results).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // recordOutcome (2 scenarios)
  // ═══════════════════════════════════════════════════════════════

  describe("recordOutcome", () => {
    it("sets outcome_score and learned_at for a message", () => {
      const msg = store.enqueue(enqInput());

      store.recordOutcome(msg.messageId, 0.75, "2026-07-09T14:30:00Z");

      const row = db
        .prepare("SELECT outcome_score, learned_at FROM agent_message_bus WHERE message_id = ?")
        .get(msg.messageId) as { outcome_score: number | null; learned_at: string | null };
      expect(row.outcome_score).toBe(0.75);
      expect(row.learned_at).toBe("2026-07-09T14:30:00Z");
    });

    it("can overwrite an existing outcome score", () => {
      const msg = store.enqueue(enqInput());

      store.recordOutcome(msg.messageId, 0.5, "2026-07-09T12:00:00Z");
      store.recordOutcome(msg.messageId, 0.95, "2026-07-09T15:00:00Z");

      const row = db
        .prepare("SELECT outcome_score, learned_at FROM agent_message_bus WHERE message_id = ?")
        .get(msg.messageId) as { outcome_score: number | null; learned_at: string | null };
      expect(row.outcome_score).toBe(0.95);
      expect(row.learned_at).toBe("2026-07-09T15:00:00Z");
    });
  });
});
