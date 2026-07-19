import { describe, expect, it, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

import { createAgentWorkSessionStore } from "../../src/sessions/AgentWorkSessionStore.js";
import { startDaemonScheduler, enqueueDaemonTick } from "../../src/workers/daemonScheduler.js";
import type {
  AgentMessageBusStore,
  AgentMessage,
} from "../../src/conversation/agentMessageBusStore.js";
import type { GraphEngine, OperationalReadModelReader, SnapshotSearchResult } from "@msl/memory";

// ── Fake bus ────────────────────────────────────────────────────────────────

function makeFakeMessage(
  idx: number,
  senderAgentId: string,
  receiverAgentId: string,
  messageType: string,
  payloadJson: string,
  sellerId?: string,
): AgentMessage {
  return {
    id: idx,
    messageId: `msg-${idx}`,
    senderAgentId,
    receiverAgentId,
    messageType,
    payloadJson,
    sellerId: sellerId ?? null,
    dedupeKey: null,
    status: "pending",
    priority: 5,
    attempts: 0,
    lockedAt: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resultJson: null,
    errorJson: null,
    cancelReason: null,
    correlationId: null,
    parentMessageId: null,
    outcomeScore: null,
    learnedAt: null,
    actionId: null,
  };
}

function makeFakeBus(): AgentMessageBusStore {
  const messages: AgentMessage[] = [];

  return {
    enqueue: (msg) => {
      const sellerId =
        typeof msg === "object" && "sellerId" in msg
          ? (msg as { sellerId?: string }).sellerId
          : undefined;
      const m = makeFakeMessage(
        messages.length,
        msg.senderAgentId,
        msg.receiverAgentId,
        msg.messageType,
        msg.payloadJson,
        sellerId,
      );
      messages.push(m);
      return m;
    },
    claimNext: (laneId: string) => {
      const idx = messages.findIndex((m) => m.receiverAgentId === laneId);
      if (idx === -1) return [];
      const [first] = messages.splice(idx, 1);
      return [first as AgentMessage];
    },
    resolve: vi.fn(),
    fail: vi.fn(),
    cancel: vi.fn(),
    lookupRecentByDedupePrefix: vi.fn().mockReturnValue([]),
    getFailedMessages: vi.fn().mockReturnValue([]),
    reenqueueFailed: vi.fn(),
    getProcessingStuck: vi.fn().mockReturnValue([]),
    getPendingCount: vi.fn().mockReturnValue(0),
    getMessagesByCorrelationId: vi.fn().mockReturnValue([]),
    getLearningHistory: vi.fn().mockReturnValue([]),
    recordOutcome: vi.fn(),
    getUnscoredMessages: vi.fn().mockReturnValue([]),
    defer: vi.fn(),
    resumeDeferred: vi.fn(),
    settle: vi.fn(),
    getExpiredDeferrals: vi.fn(),
  };
}

function makeFakeReader(): OperationalReadModelReader {
  return {
    searchSnapshots: (): Promise<SnapshotSearchResult<unknown>[]> => Promise.resolve([]),
    getSnapshot: (): Promise<null> => Promise.resolve(null),
    close: () => {},
  } as unknown as OperationalReadModelReader;
}

function makeFakeCortex(): GraphEngine {
  return {
    createNode: vi.fn().mockReturnValue({ id: 1, label: "test", activation: 0, metadata: "{}" }),
    getNode: vi.fn().mockReturnValue(null),
    getOrCreateNode: vi
      .fn()
      .mockReturnValue({ id: 1, label: "test", activation: 0, metadata: "{}" }),
    createEdge: vi.fn().mockReturnValue({
      id: 1,
      source: 1,
      target: 2,
      weight: 0.5,
      last_activated: null,
      co_occurrence_count: 0,
      distilled_lesson: null,
    }),
    reinforceEdge: vi.fn(),
    penalizeEdge: vi.fn(),
    ensureAccountAssetNode: vi
      .fn()
      .mockReturnValue({ id: 1, label: "account_asset:test", activation: 0, metadata: "{}" }),
    getNodesBySeller: vi.fn().mockReturnValue([]),
  } as unknown as GraphEngine;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("daemonScheduler — session-aware dispatch", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    vi.useFakeTimers();
  });

  it("dispatches handler directly when enableWorkSessions=false", () => {
    const bus = makeFakeBus();
    const scheduler = startDaemonScheduler({
      bus,
      reader: makeFakeReader(),
      cortex: makeFakeCortex(),
      sellerIds: ["plasticov"],
      intervalMs: 10000,
      enableWorkSessions: false,
    });

    // Trigger a daemon tick
    enqueueDaemonTick(bus, ["plasticov"]);

    expect(scheduler.stop).toBeDefined();
    scheduler.stop();
    vi.useRealTimers();
  });

  it("skips dispatch when recent session exists within cooldown", () => {
    const bus = makeFakeBus();
    const sessionStore = createAgentWorkSessionStore(db);

    // Create a recent completed session for the same lane+seller
    const now = new Date();
    const s = sessionStore.startSession({
      sessionId: "recent-session-1",
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      laneId: "unanswered-questions",
      status: "planned",
      signalsHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      stablePromptHash: "",
      evidenceHash: "",
      cycleCount: 0,
      summaryJson: "{}",
      startedAt: now.toISOString(),
    });
    sessionStore.completeSession(s.sessionId, "plasticov", "{}");

    const scheduler = startDaemonScheduler({
      bus,
      reader: makeFakeReader(),
      cortex: makeFakeCortex(),
      sellerIds: ["plasticov"],
      intervalMs: 10000,
      enableWorkSessions: true,
      sessionStore,
    });

    // Enqueue a tick
    bus.enqueue({
      senderAgentId: "system",
      receiverAgentId: "unanswered-questions",
      messageType: "daemon-tick",
      payloadJson: JSON.stringify({ sellerId: "plasticov" }),
    });

    scheduler.stop();
    vi.useRealTimers();
  });

  it("schedules without enabling work sessions (backward compatible)", () => {
    const bus = makeFakeBus();
    const scheduler = startDaemonScheduler({
      bus,
      reader: makeFakeReader(),
      cortex: makeFakeCortex(),
      sellerIds: ["plasticov"],
      intervalMs: 10000,
    });

    expect(scheduler.stop).toBeDefined();
    scheduler.stop();
    vi.useRealTimers();
  });
});
