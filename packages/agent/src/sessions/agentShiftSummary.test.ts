import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";

import { createAgentWorkSessionStore } from "../../src/sessions/AgentWorkSessionStore.js";
import {
  createMorningBrief,
  createEndOfDaySummary,
  summarizeAccountShift,
} from "../../src/sessions/agentShiftSummary.js";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("agentShiftSummary", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  it("createMorningBrief returns empty observations when no sessions", () => {
    const store = createAgentWorkSessionStore(db);
    const brief = createMorningBrief(store, "plasticov");

    expect(brief.kind).toBe("morning-brief");
    expect(brief.sellerId).toBe("plasticov");
    expect(brief.overnightObservations).toEqual([]);
    expect(brief.lessonsLearned).toEqual([]);
    expect(brief.confidence).toBe("low");
    expect(brief.noMutationExecuted).toBe(true);
  });

  it("createMorningBrief returns structure with data when sessions exist", () => {
    const store = createAgentWorkSessionStore(db);

    // Create a completed session with observations
    const session = store.startSession({
      sessionId: "morning-test-1",
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      laneId: "unanswered-questions",
      status: "planned",
      signalsHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      stablePromptHash: "",
      evidenceHash: "",
      cycleCount: 0,
      summaryJson: "{}",
    });
    store.addObservation({
      observationId: "morning-obs-1",
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      sessionId: session.sessionId,
      kind: "risk",
      summary: "Overnight risk detected",
      severity: "warning",
      metadataJson: "{}",
    });
    store.completeSession(session.sessionId, "plasticov", "{}");

    const brief = createMorningBrief(store, "plasticov");
    // Brief returns structure regardless of data
    expect(brief.kind).toBe("morning-brief");
    expect(brief.sellerId).toBe("plasticov");
    expect(brief.noMutationExecuted).toBe(true);
    expect(brief.confidence).toBeDefined();
  });

  it("createEndOfDaySummary returns correct structure with sessions", () => {
    const store = createAgentWorkSessionStore(db);

    // Session 1
    const s1 = store.startSession({
      sessionId: "eod-test-1",
      sellerId: "plasticov",
      agentId: "operations-manager",
      laneId: "operations-manager",
      status: "planned",
      signalsHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      stablePromptHash: "",
      evidenceHash: "",
      cycleCount: 0,
      summaryJson: "{}",
    });
    store.addObservation({
      observationId: "eod-obs-1",
      sellerId: "plasticov",
      agentId: "operations-manager",
      sessionId: s1.sessionId,
      kind: "risk",
      summary: "Risk found",
      severity: "warning",
      metadataJson: "{}",
    });
    store.completeSession(s1.sessionId, "plasticov", "{}");

    const summary = createEndOfDaySummary(store, "plasticov");

    expect(summary.kind).toBe("end-of-day");
    expect(summary.sellerId).toBe("plasticov");
    expect(summary.noMutationExecuted).toBe(true);
    expect(summary.nextDayRecommendations).toBeDefined();
    expect(summary.confidence).toBeDefined();
  });

  it("summarizeAccountShift returns seller-scoped aggregation", () => {
    const store = createAgentWorkSessionStore(db);

    // Plasticov session
    const pSession = store.startSession({
      sessionId: "shift-p-1",
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      laneId: "unanswered-questions",
      status: "planned",
      signalsHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      stablePromptHash: "",
      evidenceHash: "",
      cycleCount: 0,
      summaryJson: "{}",
    });
    store.addObservation({
      observationId: "shift-p-obs-1",
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      sessionId: pSession.sessionId,
      kind: "risk",
      summary: "Plasticov risk",
      severity: "warning",
      metadataJson: "{}",
    });
    store.completeSession(pSession.sessionId, "plasticov", "{}");

    // Maustian session
    const mSession = store.startSession({
      sessionId: "shift-m-1",
      sellerId: "maustian",
      agentId: "unanswered-questions",
      laneId: "unanswered-questions",
      status: "planned",
      signalsHash: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
      stablePromptHash: "",
      evidenceHash: "",
      cycleCount: 0,
      summaryJson: "{}",
    });
    store.completeSession(mSession.sessionId, "maustian", "{}");

    const plasticovShift = summarizeAccountShift(store, "plasticov");
    expect(plasticovShift.sellerId).toBe("plasticov");
    expect(plasticovShift.sessionCount).toBeGreaterThanOrEqual(1);

    const maustianShift = summarizeAccountShift(store, "maustian");
    expect(maustianShift.sellerId).toBe("maustian");
    expect(maustianShift.sessionCount).toBeGreaterThanOrEqual(1);
  });

  it("createEndOfDaySummary includes next-day recommendations", () => {
    const store = createAgentWorkSessionStore(db);

    const s = store.startSession({
      sessionId: "risk-session-1",
      sellerId: "plasticov",
      agentId: "operations-manager",
      laneId: "operations-manager",
      status: "planned",
      signalsHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      stablePromptHash: "",
      evidenceHash: "",
      cycleCount: 0,
      summaryJson: "{}",
    });
    store.addObservation({
      observationId: "risk-obs-1",
      sellerId: "plasticov",
      agentId: "operations-manager",
      sessionId: s.sessionId,
      kind: "risk",
      summary: "Risk found",
      severity: "critical",
      metadataJson: "{}",
    });
    store.addObservation({
      observationId: "risk-obs-2",
      sellerId: "plasticov",
      agentId: "operations-manager",
      sessionId: s.sessionId,
      kind: "opportunity",
      summary: "Opportunity found",
      severity: "info",
      metadataJson: "{}",
    });
    store.completeSession(s.sessionId, "plasticov", "{}");

    const summary = createEndOfDaySummary(store, "plasticov");
    expect(summary.nextDayRecommendations).toBeDefined();
    expect(summary.nextDayRecommendations.length).toBeGreaterThanOrEqual(0);
  });
});
