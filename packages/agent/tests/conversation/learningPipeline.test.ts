import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import type { AgentMessageBusStore, AgentMessage } from "../../src/conversation/agentMessageBusStore.js";
import { createGraphEngine, type GraphEngine } from "@msl/memory";
import {
  runLearningPipeline,
  scoreMessage,
} from "../../src/conversation/learningPipeline.js";

let db: Database.Database;
let bus: AgentMessageBusStore;
let engine: GraphEngine;

function createMsg(
  bus: AgentMessageBusStore,
  laneId: string,
  overrides?: Partial<{
    correlationId: string;
    sellerId: string;
    dedupeKey: string;
  }>,
): AgentMessage {
  const input: {
    senderAgentId: string;
    receiverAgentId: string;
    messageType: string;
    payloadJson: string;
    dedupeKey: string;
    correlationId?: string;
    sellerId?: string;
  } = {
    senderAgentId: "test",
    receiverAgentId: laneId,
    messageType: "test-message",
    payloadJson: JSON.stringify({ test: true }),
    dedupeKey: overrides?.dedupeKey ?? `test:${Date.now()}:${Math.random()}`,
  };
  if (overrides?.correlationId) input.correlationId = overrides.correlationId;
  if (overrides?.sellerId) input.sellerId = overrides.sellerId;
  return bus.enqueue(input);
}

/** Helper: fail a message repeatedly until it reaches 'failed' status (maxAttempts=3). */
function exhaustAndFail(bus: AgentMessageBusStore, msg: AgentMessage): void {
  let current = msg;
  for (let i = 0; i < 3; i++) {
    const next = bus.claimNext(current.receiverAgentId);
    if (next.length === 0) break;
    current = next[0]!;
    try {
      bus.fail(current.messageId, "test error");
    } catch {
      break;
    }
  }
}

beforeEach(() => {
  db = new Database(":memory:");
  bus = createAgentMessageBusStore(db);
  engine = createGraphEngine(":memory:");
});

afterEach(() => {
  db.close();
  engine.db.close();
});

describe("scoreMessage", () => {
  describe("resolved messages", () => {
    it("scores resolved with findings at base 0.7", () => {
      const msg: Partial<AgentMessage> = {
        status: "resolved",
        resultJson: JSON.stringify({ findings: [{ type: "alert" }] }),
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.score).toBeGreaterThanOrEqual(0.7);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });

    it("scores resolved with critical severity above 0.8", () => {
      const msg: Partial<AgentMessage> = {
        status: "resolved",
        resultJson: JSON.stringify({
          findings: [
            { type: "alert", severity: "critical" },
            { type: "alert", severity: "high" },
            { type: "alert", severity: "medium" },
            { type: "alert", severity: "low" },
          ],
          severity: "critical",
        }),
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.score).toBeGreaterThan(0.8);
    });

    it("scores resolved with no resultJson at 0.5", () => {
      const msg: Partial<AgentMessage> = {
        status: "resolved",
        resultJson: null,
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.score).toBe(0.5);
    });

    it("scores resolved with no findings at 0.5 max", () => {
      const msg: Partial<AgentMessage> = {
        status: "resolved",
        resultJson: JSON.stringify({ status: "ok" }),
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.score).toBeLessThanOrEqual(0.5);
    });

    it("uses description from resultJson in summary", () => {
      const msg: Partial<AgentMessage> = {
        status: "resolved",
        resultJson: JSON.stringify({
          description: "Price analysis completed",
          findings: [{ type: "alert" }],
        }),
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.summary).toContain("Price analysis completed");
    });
  });

  describe("failed messages", () => {
    it("scores permanent failure at 0.1 (3+ attempts)", () => {
      const msg: Partial<AgentMessage> = {
        status: "failed",
        errorJson: JSON.stringify({ message: "API exhausted after retries" }),
        attempts: 3,
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.score).toBe(0.1);
    });

    it("scores transient failure at 0.3", () => {
      const msg: Partial<AgentMessage> = {
        status: "failed",
        errorJson: JSON.stringify({ message: "timeout connecting to API" }),
        attempts: 1,
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.score).toBe(0.3);
    });

    it("scores permanent failure (exhausted keyword) at 0.1", () => {
      const msg: Partial<AgentMessage> = {
        status: "failed",
        errorJson: JSON.stringify({ message: "exhausted all retry attempts" }),
        attempts: 1,
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.score).toBe(0.1);
    });
  });

  describe("cancelled messages", () => {
    it("scores cancelled (superseded) at 0.5", () => {
      const msg: Partial<AgentMessage> = {
        status: "cancelled",
        cancelReason: "superseded by newer request",
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.score).toBe(0.5);
    });

    it("scores cancelled (stale) at 0.2", () => {
      const msg: Partial<AgentMessage> = {
        status: "cancelled",
        cancelReason: "timeout - request expired",
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.score).toBe(0.2);
    });

    it("scores cancelled (abandoned) at 0.0", () => {
      const msg: Partial<AgentMessage> = {
        status: "cancelled",
        cancelReason: "no longer relevant",
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.score).toBe(0.0);
    });

    it("scores cancelled without reason at 0.15", () => {
      const msg: Partial<AgentMessage> = {
        status: "cancelled",
        cancelReason: null,
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.score).toBe(0.15);
    });
  });

  describe("unexpected status", () => {
    it("returns 0 for unexpected status", () => {
      const msg: Partial<AgentMessage> = {
        status: "pending",
      };
      const result = scoreMessage(msg as AgentMessage);
      expect(result.score).toBe(0);
      expect(result.summary).toContain("pending");
    });
  });
});

describe("runLearningPipeline", () => {
  it("returns empty result when no unscored messages exist", async () => {
    const result = await runLearningPipeline(bus, engine);
    expect(result.processed).toBe(0);
    expect(result.scored).toHaveLength(0);
  });

  it("scores resolved messages and creates Cortex nodes", async () => {
    // Enqueue, claim, and resolve a message
    const msg = createMsg(bus, "operations-manager");
    bus.claimNext("operations-manager");
    bus.resolve(msg.messageId, {
      status: "completed",
      findings: [
        { type: "alert", severity: "medium", message: "Test finding" },
      ],
      severity: "medium",
      description: "Resolved test message",
    });

    // Pipeline should find the resolved (but unscored) message
    const result = await runLearningPipeline(bus, engine);
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);

    // Verify scoring was recorded on bus
    const scored = result.scored.find((s) => s.message.messageId === msg.messageId);
    expect(scored).toBeDefined();
    expect(scored!.outcomeScore).toBeGreaterThanOrEqual(0.7);

    // Verify Cortex node was created
    const nodes = engine.queryByMetadata({ type: "learning_outcome" });
    const node = nodes.find((n) => n.metadata.messageId === msg.messageId);
    expect(node).toBeDefined();
    expect(node!.metadata.outcomeScore).toBeGreaterThanOrEqual(0.7);
  });

  it("processes failed messages through the pipeline", async () => {
    const msg = createMsg(bus, "market-catalog");
    exhaustAndFail(bus, msg);

    const result = await runLearningPipeline(bus, engine);
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);

    // Verify outcome recorded on bus
    const history = bus.getLearningHistory({ minScore: 0 });
    const scored = history.find((m) => m.messageId === msg.messageId);
    expect(scored).toBeDefined();
    expect(scored!.outcomeScore).toBeGreaterThan(0);
  });

  it("respects batch size option", async () => {
    // Create several messages and resolve them
    const messages: AgentMessage[] = [];
    for (let i = 0; i < 5; i++) {
      const msg = createMsg(bus, `lane-${i}`, { dedupeKey: `batch-test-${i}` });
      bus.claimNext(`lane-${i}`);
      bus.resolve(msg.messageId, { status: "ok", findings: [] });
      messages.push(msg);
    }

    // Process with small batch
    const result = await runLearningPipeline(bus, engine, { batchSize: 2 });
    expect(result.processed).toBeLessThanOrEqual(2);
    expect(result.scored.length).toBeLessThanOrEqual(2);

    // Process remaining
    const result2 = await runLearningPipeline(bus, engine, { batchSize: 10 });
    expect(result2.processed).toBeGreaterThanOrEqual(1);
  });

  it("handles passthrough strategy", async () => {
    const msg = createMsg(bus, "ceo");
    bus.claimNext("ceo");
    bus.resolve(msg.messageId, { status: "ok", findings: [] });

    const result = await runLearningPipeline(bus, engine, { strategy: "passthrough" });
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.scored[0]!.outcomeScore).toBe(0.5); // default for passthrough
  });
});

describe("getUnscoredMessages", () => {
  it("returns empty array when no messages exist", () => {
    const unscored = bus.getUnscoredMessages();
    expect(unscored).toHaveLength(0);
  });

  it("includes resolved messages without outcome scores", () => {
    const msg = createMsg(bus, "ceo");
    bus.claimNext("ceo");
    bus.resolve(msg.messageId, { status: "ok", findings: [] });

    const unscored = bus.getUnscoredMessages();
    expect(unscored.length).toBeGreaterThanOrEqual(1);
    expect(unscored.some((m) => m.messageId === msg.messageId)).toBe(true);
  });

  it("excludes already-scored messages", () => {
    const msg = createMsg(bus, "ceo");
    bus.claimNext("ceo");
    bus.resolve(msg.messageId, { status: "ok", findings: [] });
    bus.recordOutcome(msg.messageId, 0.5, new Date().toISOString());

    const unscored = bus.getUnscoredMessages();
    expect(unscored.some((m) => m.messageId === msg.messageId)).toBe(false);
  });

  it("includes failed messages", () => {
    const msg = createMsg(bus, "ceo");
    exhaustAndFail(bus, msg);

    const unscored = bus.getUnscoredMessages();
    expect(unscored.length).toBeGreaterThanOrEqual(1);
    expect(unscored.some((m) => m.messageId === msg.messageId)).toBe(true);
  });
});
