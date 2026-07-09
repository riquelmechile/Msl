import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";

import { createAgentMessageBusStore, createCeoInboxStore, runLearningPipeline } from "@msl/agent";
import type { AgentMessageBusStore, AgentMessage } from "@msl/agent";
import { createGraphEngine, type GraphEngine } from "@msl/memory";

let db: Database.Database;
let bus: AgentMessageBusStore;
let engine: GraphEngine;

// ── Setup in-memory SQLite per suite ────────────────────────────

beforeAll(() => {
  db = new Database(":memory:");
  bus = createAgentMessageBusStore(db);
  engine = createGraphEngine(":memory:");
});

afterAll(() => {
  db.close();
  engine.db.close();
});

// ── Helper: create a message for a daemon lane ────────────────

function enqueueTick(
  bus: AgentMessageBusStore,
  laneId: string,
  overrides?: Partial<{
    correlationId: string;
    sellerId: string;
    dedupeKey: string;
  }>,
): AgentMessage {
  return bus.enqueue({
    senderAgentId: "scheduler",
    receiverAgentId: laneId,
    messageType: "daemon-tick",
    payloadJson: JSON.stringify({
      cycleTimestamp: new Date().toISOString(),
      automated: true,
      source: "e2e-test",
    }),
    dedupeKey: overrides?.dedupeKey ?? `${laneId}:tick:${Date.now()}`,
    correlationId: overrides?.correlationId,
    sellerId: overrides?.sellerId,
  });
}

describe("Agent Pipeline E2E", () => {
  it("1. Enqueues a tick for operations-manager", () => {
    const msg = enqueueTick(bus, "operations-manager", {
      correlationId: "e2e-tick-1",
    });

    expect(msg.messageId).toBeTruthy();
    expect(msg.senderAgentId).toBe("scheduler");
    expect(msg.receiverAgentId).toBe("operations-manager");
    expect(msg.messageType).toBe("daemon-tick");
    expect(msg.status).toBe("pending");

    // Verify it's claimable
    const claimed = bus.claimNext("operations-manager");
    expect(claimed.length).toBe(1);
    expect(claimed[0].messageId).toBe(msg.messageId);
    expect(claimed[0].status).toBe("processing");
  });

  it("2. Verifies bus message lifecycle: pending → processing → resolved", () => {
    // Enqueue a new message
    const msg = enqueueTick(bus, "ceo", {
      correlationId: "e2e-lifecycle",
      sellerId: "seller-001",
    });
    expect(msg.status).toBe("pending");

    // Claim it
    const claimed = bus.claimNext("ceo");
    expect(claimed.length).toBe(1);
    expect(claimed[0].status).toBe("processing");

    // Resolve it with a result
    bus.resolve(claimed[0].messageId, {
      status: "completed",
      findings: [
        { type: "alert", severity: "low", message: "Test finding" },
        { type: "info", severity: "info", message: "Another test finding" },
      ],
    });

    // Verify resolved — query by correlationId to avoid ISO/SQLite format mismatch
    const byCorrelation = bus.getMessagesByCorrelationId("e2e-lifecycle");
    const resolved = byCorrelation.find((m) => m.messageId === claimed[0].messageId);
    expect(resolved).toBeDefined();
    expect(resolved!.status).toBe("resolved");
    expect(resolved!.resultJson).toBeTruthy();
    expect(resolved!.outcomeScore).toBeNull(); // Not yet learned
  });

  it("3. Verifies CEO proposal can be saved to inbox", () => {
    // Simulate a CEO finding message being enqueued and resolved
    const inbox = createCeoInboxStore(db);

    const proposal = inbox.insert({
      sender_agent_id: "operations-manager",
      proposal_type: "operational-alert",
      payload_json: JSON.stringify({
        alertType: "unanswered-questions",
        count: 3,
      }),
      normalized_summary: "3 unanswered questions detected",
      risk_level: "medium",
      seller_id: "seller-001",
    });

    expect(proposal.proposal_id).toBeTruthy();
    expect(proposal.status).toBe("pending");
    expect(proposal.risk_level).toBe("medium");

    // Verify can be listed
    const pending = inbox.listByStatus("pending");
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.some((p) => p.proposal_id === proposal.proposal_id)).toBe(true);
  });

  it("4. Verifies learning pipeline can process a resolved message", async () => {
    // Create and resolve a message for learning
    const msg = enqueueTick(bus, "market-catalog", {
      correlationId: "e2e-learning",
      sellerId: "seller-002",
    });
    bus.claimNext("market-catalog");
    bus.resolve(msg.messageId, {
      status: "completed",
      findings: [
        { type: "price-drop", severity: "critical", message: "Major price drop detected" },
        { type: "stock-alert", severity: "high", message: "Low stock warning" },
        { type: "competitor-change", severity: "medium", message: "Competitor changed price" },
        { type: "trend-shift", severity: "low", message: "Demand trend shifting" },
      ],
      severity: "critical",
      description: "Market catalog analysis completed",
    });

    // Run the learning pipeline
    const result = await runLearningPipeline(bus, engine, { batchSize: 50 });

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);

    // Verify the message was scored
    const scored = result.scored.find((s) => s.message.messageId === msg.messageId);
    expect(scored).toBeDefined();
    expect(scored!.outcomeScore).toBeGreaterThan(0.7); // 4 findings + critical severity bonus
    expect(scored!.summary).toContain("Market catalog analysis");

    // Verify it was persisted to bus
    const history = bus.getLearningHistory({ since: new Date(Date.now() - 60000).toISOString() });
    const learned = history.find((m) => m.messageId === msg.messageId);
    expect(learned).toBeDefined();
    expect(learned!.outcomeScore).toBeGreaterThan(0.7);

    // Verify Cortex node was created
    const nodes = engine.queryByMetadata({ type: "learning_outcome" });
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    const outcomeNode = nodes.find((n) => n.metadata.messageId === msg.messageId);
    expect(outcomeNode).toBeDefined();
    expect(outcomeNode!.metadata.outcomeScore).toBeGreaterThan(0.7);
  });

  it("5. Verifies learning pipeline handles failed messages", async () => {
    // Create and exhaust a message (fail 3 times to reach 'failed' status)
    const msg = enqueueTick(bus, "cost-supplier", {
      correlationId: "e2e-failed-learning",
      sellerId: "seller-003",
    });

    // Fail the message 3 times to reach failed status
    let current: import("@msl/agent").AgentMessage = msg;
    for (let i = 0; i < 3; i++) {
      const claimed = bus.claimNext("cost-supplier");
      if (claimed.length === 0) break;
      current = claimed[0];
      try {
        bus.fail(current.messageId, `Attempt ${i + 1}: API error`);
      } catch {
        break;
      }
    }

    const result = await runLearningPipeline(bus, engine, { batchSize: 50 });
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const scored = result.scored.find((s) => s.message.messageId === current.messageId);
    expect(scored).toBeDefined();
    expect(scored!.outcomeScore).toBeGreaterThanOrEqual(0.1);
  });

  it("6. Verifies learning pipeline creates Cortex observations", () => {
    // Check that the previously written Cortex nodes exist
    const nodes = engine.queryByMetadata({ type: "learning_outcome" });
    expect(nodes.length).toBeGreaterThanOrEqual(1);

    // Each node should have required metadata fields
    for (const node of nodes) {
      expect(node.metadata.messageId).toBeTruthy();
      expect(node.metadata.status).toBeTruthy();
      expect(typeof node.metadata.outcomeScore).toBe("number");
      expect(node.metadata.scoredAt).toBeTruthy();
    }
  });
});
