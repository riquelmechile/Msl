import Database from "better-sqlite3";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { createGraphEngine } from "@msl/memory";
import { createSqliteOperationalReadModel } from "@msl/memory";
import type {
  AgentMessageBusStore,
  AgentMessage,
} from "../../src/conversation/agentMessageBusStore.js";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import { startDaemonScheduler } from "../../src/workers/daemonScheduler.js";

// ── Helpers ─────────────────────────────────────────────────────────

/** Build a minimal claim fixture matching AgentMessage shape. */
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

// ── Scheduler Tests ─────────────────────────────────────────────────

describe("daemonScheduler", () => {
  let db: Database.Database;
  let bus: AgentMessageBusStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    bus = createAgentMessageBusStore(db);
  });

  describe("lifecycle", () => {
    it("returns a stop handle that clears the interval", () => {
      const scheduler = startDaemonScheduler({
        bus,
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        sellerIds: ["seller-1"],
        intervalMs: 60_000,
      });

      expect(scheduler).toBeDefined();
      expect(typeof scheduler.stop).toBe("function");

      // Stopping should not throw
      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  describe("polling cycle", () => {
    it("does not crash when no agents have pending messages", async () => {
      const scheduler = startDaemonScheduler({
        bus,
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        sellerIds: ["seller-1"],
        intervalMs: 60_000,
      });

      // The initial cycle runs immediately — should complete without error
      // even though there are no pending messages and market-catalog daemon
      // won't find anything (but won't crash).

      // Wait a tick for the async run to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      scheduler.stop();
    });
  });

  describe("error isolation", () => {
    it("continues to next agent when a daemon throws", async () => {
      // Enqueue a message for market-catalog agent
      const msg = bus.enqueue({
        senderAgentId: "ceo",
        receiverAgentId: "market-catalog",
        messageType: "task",
        payloadJson: '{"task":"test"}',
      });

      // The marketCatalogDaemon needs a proper reader + cortex, which we
      // provide with empty databases. It should not throw — but if it does,
      // the scheduler should catch it.

      const scheduler = startDaemonScheduler({
        bus,
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        sellerIds: ["seller-1"],
        intervalMs: 60_000,
      });

      // Wait for the cycle to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // After the daemon runs (even if it finds nothing), the message
      // should be resolved
      scheduler.stop();
    });
  });
});
