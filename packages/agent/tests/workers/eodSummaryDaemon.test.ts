import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { createGraphEngine, createSqliteOperationalReadModel } from "@msl/memory";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import type { AgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import { eodSummaryDaemon } from "../../src/workers/eodSummaryDaemon.js";

// ── Setup ────────────────────────────────────────────────────────────

describe("eodSummaryDaemon — time-gate", () => {
  let db: Database.Database;
  let bus: AgentMessageBusStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    bus = createAgentMessageBusStore(db);
  });

  it("skips processing when hour is not 6pm (18)", async () => {
    const claim = {
      id: 1,
      messageId: "test-msg-001",
      senderAgentId: "system",
      receiverAgentId: "eod-summary",
      messageType: "daemon-tick",
      payloadJson: JSON.stringify({ cycleTimestamp: "2026-07-09T17:00:00.000Z" }),
      status: "pending" as const,
      priority: 5,
      attempts: 0,
      dedupeKey: "eod-summary:tick:2026-07-09T17",
      lockedAt: null,
      resolvedAt: null,
      createdAt: "2026-07-09T17:00:00.000Z",
      updatedAt: "2026-07-09T17:00:00.000Z",
      resultJson: null,
      errorJson: null,
      cancelReason: null,
      correlationId: null,
      parentMessageId: null,
      sellerId: null,
      learnedAt: null,
      outcomeScore: null,
      actionId: null,
    };

    const reader = createSqliteOperationalReadModel(db);
    const cortex = createGraphEngine(":memory:");

    const result = await eodSummaryDaemon({
      claim,
      reader,
      cortex,
      sellerIds: ["seller-1"],
      bus,
    });

    expect(result.findings.length).toBe(0);
    expect(result.proposalEnqueued).toBe(false);
    expect(result.messageIds.length).toBe(0);
  });

  it("processes normally when hour is 6pm (18)", async () => {
    const claim = {
      id: 2,
      messageId: "test-msg-002",
      senderAgentId: "system",
      receiverAgentId: "eod-summary",
      messageType: "daemon-tick",
      payloadJson: JSON.stringify({ cycleTimestamp: "2026-07-09T18:00:00.000Z" }),
      status: "pending" as const,
      priority: 5,
      attempts: 0,
      dedupeKey: "eod-summary:tick:2026-07-09T18",
      lockedAt: null,
      resolvedAt: null,
      createdAt: "2026-07-09T18:00:00.000Z",
      updatedAt: "2026-07-09T18:00:00.000Z",
      resultJson: null,
      errorJson: null,
      cancelReason: null,
      correlationId: null,
      parentMessageId: null,
      sellerId: null,
      learnedAt: null,
      outcomeScore: null,
      actionId: null,
    };

    const reader = createSqliteOperationalReadModel(db);
    const cortex = createGraphEngine(":memory:");

    const result = await eodSummaryDaemon({
      claim,
      reader,
      cortex,
      sellerIds: ["seller-1"],
      bus,
    });

    expect(result).toBeDefined();
    expect(result.proposalEnqueued).toBe(false);
    expect(result.findings).toBeDefined();
  });

  it("falls back to current time when payload has no cycleTimestamp", async () => {
    const claim = {
      id: 3,
      messageId: "test-msg-003",
      senderAgentId: "system",
      receiverAgentId: "eod-summary",
      messageType: "daemon-tick",
      payloadJson: JSON.stringify({}),
      status: "pending" as const,
      priority: 5,
      attempts: 0,
      dedupeKey: null,
      lockedAt: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resultJson: null,
      errorJson: null,
      cancelReason: null,
      correlationId: null,
      parentMessageId: null,
      sellerId: null,
      learnedAt: null,
      outcomeScore: null,
      actionId: null,
    };

    const reader = createSqliteOperationalReadModel(db);
    const cortex = createGraphEngine(":memory:");

    const result = await eodSummaryDaemon({
      claim,
      reader,
      cortex,
      sellerIds: ["seller-1"],
      bus,
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.findings)).toBe(true);
  });
});
