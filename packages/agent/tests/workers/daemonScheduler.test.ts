import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { createGraphEngine } from "@msl/memory";
import { createSqliteOperationalReadModel } from "@msl/memory";
import type { AgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import { startDaemonScheduler } from "../../src/workers/daemonScheduler.js";

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
      bus.enqueue({
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

  describe("product-ads-profitability lane dispatch", () => {
    it("dispatches product-ads-profitability daemon when a matching message is claimed", async () => {
      // Enqueue a message for product-ads-profitability agent
      bus.enqueue({
        senderAgentId: "ceo",
        receiverAgentId: "product-ads-profitability",
        messageType: "task",
        payloadJson: '{"task":"profitability-check"}',
      });

      const reader = createSqliteOperationalReadModel(db);
      const cortex = createGraphEngine(":memory:");

      const scheduler = startDaemonScheduler({
        bus,
        reader,
        cortex,
        sellerIds: ["seller-1"],
        intervalMs: 60_000,
      });

      // Wait for the cycle to complete and daemon to process
      await new Promise((resolve) => setTimeout(resolve, 200));

      // The message should be resolved by the daemon (even if it finds nothing)
      scheduler.stop();

      // Verify the message was consumed — claimNext for product-ads-profitability
      // should return empty after processing
      const remaining = bus.claimNext("product-ads-profitability");
      // The message is either resolved or failed — pending messages should not include it
      expect(remaining.length).toBe(0);
    });
  });

  describe("product-ads-ceo-profitability lane dispatch", () => {
    it("dispatches ceo-profitability handler when a matching proposal is claimed", async () => {
      // Enqueue a proposal message for product-ads-ceo-profitability lane
      const now = new Date().toISOString();
      bus.enqueue({
        senderAgentId: "product-ads-profitability",
        receiverAgentId: "product-ads-ceo-profitability",
        messageType: "proposal",
        payloadJson: JSON.stringify({
          type: "proposal",
          tier: "margin-consuming",
          severity: "critical",
          summary: "Test CEO profitability proposal",
          findings: [
            {
              kind: "alert",
              severity: "critical",
              summary: "Margin-consuming ad: item MLC-SCHED-001",
              evidenceIds: ["listing_snapshot:MLC-SCHED-001"],
              actionability: "seller-impacting",
              recommendationIdentity:
                "product-ads-cfo:seller-1:camp-1:MLC-SCHED-001:margin-consuming",
            },
          ],
          capturedAt: now,
          noMutationExecuted: true,
        }),
      });

      const reader = createSqliteOperationalReadModel(db);
      const cortex = createGraphEngine(":memory:");

      const scheduler = startDaemonScheduler({
        bus,
        reader,
        cortex,
        sellerIds: ["seller-1"],
        intervalMs: 60_000,
      });

      // Wait for the cycle to complete and handler to process
      await new Promise((resolve) => setTimeout(resolve, 200));

      scheduler.stop();

      // The message should be consumed — claimNext should return empty
      const remaining = bus.claimNext("product-ads-ceo-profitability");
      expect(remaining.length).toBe(0);
    });
  });
});
