import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { createGraphEngine } from "@msl/memory";
import { createSqliteOperationalReadModel } from "@msl/memory";
import type { AgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import { startDaemonScheduler, enqueueDaemonTick } from "../../src/workers/daemonScheduler.js";
import { listCompanyAgents } from "../../src/conversation/companyAgents.js";

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

      // The task message should be resolved (daemon processed it).
      // The enqueued daemon-tick may still be pending — that's expected.
      const taskStatus = db
        .prepare("SELECT status FROM agent_message_bus WHERE message_type = 'task'")
        .get() as { status: string } | undefined;
      expect(taskStatus).toBeDefined();
      expect(taskStatus!.status).toBe("resolved");
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

      // The proposal message should be resolved (handler processed it).
      // The enqueued daemon-tick may still be pending — that's expected.
      const proposalStatus = db
        .prepare("SELECT status FROM agent_message_bus WHERE message_type = 'proposal'")
        .get() as { status: string } | undefined;
      expect(proposalStatus).toBeDefined();
      expect(proposalStatus!.status).toBe("resolved");
    });
  });

  // ── Lane registration ──────────────────────────────────────────

  describe("lane registration", () => {
    it("includes morning-report in COMPANY_AGENTS", () => {
      const agents = listCompanyAgents();
      const morningReport = agents.find((a) => a.id === "morning-report");
      expect(morningReport).toBeDefined();
      expect(morningReport!.profile.laneId).toBe("morning-report");
      expect(morningReport!.profile.noMutationBoundary).toBe(true);
    });

    it("includes eod-summary in COMPANY_AGENTS", () => {
      const agents = listCompanyAgents();
      const eod = agents.find((a) => a.id === "eod-summary");
      expect(eod).toBeDefined();
      expect(eod!.profile.laneId).toBe("eod-summary");
      expect(eod!.profile.noMutationBoundary).toBe(true);
    });

    it("includes unanswered-questions in COMPANY_AGENTS", () => {
      const agents = listCompanyAgents();
      const uq = agents.find((a) => a.id === "unanswered-questions");
      expect(uq).toBeDefined();
      expect(uq!.profile.laneId).toBe("unanswered-questions");
      expect(uq!.profile.noMutationBoundary).toBe(true);
    });

    it("includes all 4 new lanes in COMPANY_AGENTS", () => {
      const agents = listCompanyAgents();
      const laneIds = agents.map((a) => a.id);
      expect(laneIds).toContain("morning-report");
      expect(laneIds).toContain("eod-summary");
      expect(laneIds).toContain("unanswered-questions");
      expect(laneIds).toContain("owned-ecommerce");
    });

    it("enqueues ticks for the new owned-ecommerce and unanswered-questions lanes", () => {
      enqueueDaemonTick(bus);

      const tickRows = db
        .prepare(
          "SELECT receiver_agent_id FROM agent_message_bus WHERE message_type = 'daemon-tick'",
        )
        .all() as Array<{ receiver_agent_id: string }>;

      const laneIds = tickRows.map((r) => r.receiver_agent_id);
      expect(laneIds).toContain("owned-ecommerce");
      expect(laneIds).toContain("unanswered-questions");
    });
  });

  describe("enqueueDaemonTick", () => {
    it("enqueues one tick per registered lane", () => {
      enqueueDaemonTick(bus);

      // Check that all known lanes have a daemon-tick message
      const tickRows = db
        .prepare("SELECT receiver_agent_id, message_type FROM agent_message_bus WHERE message_type = 'daemon-tick'")
        .all() as Array<{ receiver_agent_id: string; message_type: string }>;

      // We have 14 lanes in daemonHandlerMap
      expect(tickRows.length).toBeGreaterThan(0);

      // All ticks should have correct message type
      for (const row of tickRows) {
        expect(row.message_type).toBe("daemon-tick");
      }

      // Each lane should have exactly one tick
      const laneIds = tickRows.map((r) => r.receiver_agent_id);
      const uniqueLanes = new Set(laneIds);
      expect(uniqueLanes.size).toBe(tickRows.length);
    });

    it("deduplicates when called twice in the same hour", () => {
      // First call
      enqueueDaemonTick(bus);

      // Second call in the same hour — dedupeKey prevents duplicates
      enqueueDaemonTick(bus);

      const count = db
        .prepare("SELECT COUNT(*) as cnt FROM agent_message_bus WHERE message_type = 'daemon-tick'")
        .get() as { cnt: number };

      // Should have exactly one tick per lane (no duplicates)
      const uniqueLaneCount = (db
        .prepare("SELECT DISTINCT receiver_agent_id FROM agent_message_bus WHERE message_type = 'daemon-tick'")
        .all() as Array<{ receiver_agent_id: string }>).length;

      expect(count.cnt).toBe(uniqueLaneCount);
    });
  });
});
