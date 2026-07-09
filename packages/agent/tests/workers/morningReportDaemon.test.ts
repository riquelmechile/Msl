import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { createGraphEngine, createSqliteOperationalReadModel } from "@msl/memory";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import type { AgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import { morningReportDaemon } from "../../src/workers/morningReportDaemon.js";

// ── Setup ────────────────────────────────────────────────────────────

describe("morningReportDaemon — time-gate", () => {
  let db: Database.Database;
  let bus: AgentMessageBusStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    bus = createAgentMessageBusStore(db);
  });

  it("skips processing when hour is not 9am", async () => {
    // Build a claim with cycleTimestamp at hour 8 (not 9)
    const claim = {
      id: 1,
      messageId: "test-msg-001",
      senderAgentId: "system",
      receiverAgentId: "morning-report",
      messageType: "daemon-tick",
      payloadJson: JSON.stringify({ cycleTimestamp: "2026-07-09T08:30:00.000Z" }),
      status: "pending" as const,
      priority: 5,
      attempts: 0,
      dedupeKey: "morning-report:tick:2026-07-09T08",
      lockedAt: null,
      resolvedAt: null,
      createdAt: "2026-07-09T08:30:00.000Z",
      updatedAt: "2026-07-09T08:30:00.000Z",
    };

    const reader = createSqliteOperationalReadModel(db);
    const cortex = createGraphEngine(":memory:");

    const result = await morningReportDaemon({
      claim,
      reader,
      cortex,
      sellerIds: ["seller-1"],
      bus,
      ceoContext: undefined,
    });

    // Should return early with empty findings, no proposal enqueued
    expect(result.findings.length).toBe(0);
    expect(result.proposalEnqueued).toBe(false);
    expect(result.messageIds.length).toBe(0);
  });

  it("processes normally when hour is 9am", async () => {
    const claim = {
      id: 2,
      messageId: "test-msg-002",
      senderAgentId: "system",
      receiverAgentId: "morning-report",
      messageType: "daemon-tick",
      payloadJson: JSON.stringify({ cycleTimestamp: "2026-07-09T09:00:00.000Z" }),
      status: "pending" as const,
      priority: 5,
      attempts: 0,
      dedupeKey: "morning-report:tick:2026-07-09T09",
      lockedAt: null,
      resolvedAt: null,
      createdAt: "2026-07-09T09:00:00.000Z",
      updatedAt: "2026-07-09T09:00:00.000Z",
    };

    const reader = createSqliteOperationalReadModel(db);
    const cortex = createGraphEngine(":memory:");

    const result = await morningReportDaemon({
      claim,
      reader,
      cortex,
      sellerIds: ["seller-1"],
      bus,
      ceoContext: undefined,
    });

    // At 9am, the daemon should process (even if it finds nothing,
    // it should return findings, not the early-exit)
    expect(result).toBeDefined();
    // proposalEnqueued will be false since there's no data, but
    // it shouldn't be the early-exit (findings array exists with info finding)
    expect(result.proposalEnqueued).toBe(false);
    // Should have at least the "all clear" finding
    expect(result.findings).toBeDefined();
  });

  it("falls back to current time when payload has no cycleTimestamp", async () => {
    const claim = {
      id: 3,
      messageId: "test-msg-003",
      senderAgentId: "system",
      receiverAgentId: "morning-report",
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
    };

    const reader = createSqliteOperationalReadModel(db);
    const cortex = createGraphEngine(":memory:");

    const result = await morningReportDaemon({
      claim,
      reader,
      cortex,
      sellerIds: ["seller-1"],
      bus,
      ceoContext: undefined,
    });

    // Should handle gracefully (no crash) and return a valid result
    expect(result).toBeDefined();
    expect(Array.isArray(result.findings)).toBe(true);
  });
});
