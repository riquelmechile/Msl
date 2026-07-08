import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";

import {
  createAgentMessageBusStore,
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
  }> = {},
) {
  return {
    senderAgentId: overrides.senderAgentId ?? "sender-1",
    receiverAgentId: overrides.receiverAgentId ?? "receiver-1",
    messageType: overrides.messageType ?? "task",
    payloadJson: overrides.payloadJson ?? '{"task":"do-something"}',
    ...(overrides.priority != null ? { priority: overrides.priority } : {}),
    ...(overrides.dedupeKey != null ? { dedupeKey: overrides.dedupeKey } : {}),
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
  // Lifecycle transitions (4 scenarios)
  // ═══════════════════════════════════════════════════════════════

  describe("lifecycle", () => {
    it("resolves a processing message", () => {
      store.enqueue(enqInput({ receiverAgentId: "w" }));
      const [claimed] = store.claimNext("w");
      expect(claimed!.status).toBe("processing");

      store.resolve(claimed!.messageId, { outcome: "ok" });

      // Re-fetch to verify
      const row = db
        .prepare("SELECT status, resolved_at FROM agent_message_bus WHERE message_id = ?")
        .get(claimed!.messageId) as { status: string; resolved_at: string | null };
      expect(row.status).toBe("resolved");
      expect(row.resolved_at).toBeTruthy();
    });

    it("cancels a pending message", () => {
      const msg = store.enqueue(enqInput({ receiverAgentId: "w" }));
      expect(msg.status).toBe("pending");

      store.cancel(msg.messageId);

      const row = db
        .prepare("SELECT status FROM agent_message_bus WHERE message_id = ?")
        .get(msg.messageId) as { status: string };
      expect(row.status).toBe("cancelled");
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
  // Retry guard (3 scenarios)
  // ═══════════════════════════════════════════════════════════════

  describe("fail / retry", () => {
    it("increments attempts and resets to pending on first failure", () => {
      store.enqueue(enqInput({ receiverAgentId: "w" }));
      const [claimed] = store.claimNext("w");

      store.fail(claimed!.messageId, "something went wrong");

      const row = db
        .prepare("SELECT status, attempts, locked_at FROM agent_message_bus WHERE message_id = ?")
        .get(claimed!.messageId) as {
        status: string;
        attempts: number;
        locked_at: string | null;
      };
      expect(row.attempts).toBe(1);
      expect(row.status).toBe("pending");
      expect(row.locked_at).toBeNull();
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
  });

  // ═══════════════════════════════════════════════════════════════
  // Schema integrity (2 scenarios)
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

    it("has all required columns and does not affect existing tables", () => {
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
      const columnNames = columns.map((c) => c.name);
      expect(columns.length).toBe(14);

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
      ];
      expect(columnNames).toEqual(expected);
    });
  });
});
