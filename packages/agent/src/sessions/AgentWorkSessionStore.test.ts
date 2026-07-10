import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createAgentWorkSessionStore } from "./AgentWorkSessionStore.js";
import type { AgentWorkSession, AgentObservation, AgentLesson } from "@msl/domain";

// ── Helpers ────────────────────────────────────────────────────────────────

function createTestSession(overrides: Partial<AgentWorkSession> = {}): AgentWorkSession {
  return {
    sessionId: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sellerId: "plasticov-mlc",
    agentId: "product-ads-profitability",
    laneId: "product-ads-profitability",
    status: "planned",
    signalsHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    stablePromptHash: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7",
    evidenceHash: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
    cycleCount: 0,
    summaryJson: "{}",
    ...overrides,
  };
}

function createTestObservation(overrides: Partial<AgentObservation> = {}): AgentObservation {
  return {
    observationId: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sellerId: "plasticov-mlc",
    agentId: "product-ads-profitability",
    sessionId: "sess-test-1",
    kind: "new_signal",
    summary: "New unanswered question detected",
    severity: "info",
    metadataJson: "{}",
    ...overrides,
  };
}

function createTestLesson(overrides: Partial<AgentLesson> = {}): AgentLesson {
  return {
    lessonId: `lsn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sellerId: "plasticov-mlc",
    agentId: "product-ads-profitability",
    sessionId: "sess-test-1",
    lesson: "Don't adjust prices on Friday — ML validation runs on weekends",
    transferable: true,
    learnedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Schema ──────────────────────────────────────────────────────────────────

describe("AgentWorkSessionStore — schema", () => {
  it("creates all 5 tables on empty database", () => {
    const db = new Database(":memory:");
    createAgentWorkSessionStore(db);

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'agent_%' ORDER BY name`,
      )
      .all() as { name: string }[];

    expect(tables.map((t) => t.name)).toEqual([
      "agent_observations",
      "agent_session_lessons",
      "agent_session_proposals",
      "agent_shift_summaries",
      "agent_work_sessions",
    ]);

    db.close();
  });

  it("is idempotent — no error on repeated calls", () => {
    const db = new Database(":memory:");
    createAgentWorkSessionStore(db);
    expect(() => createAgentWorkSessionStore(db)).not.toThrow();
    db.close();
  });

  it("preserves rows across repeated factory calls", () => {
    const db = new Database(":memory:");
    const store1 = createAgentWorkSessionStore(db);
    const session = createTestSession();
    store1.startSession(session);

    const store2 = createAgentWorkSessionStore(db);
    const found = store2.getSession(session.sessionId, session.sellerId);
    expect(found).toBeDefined();
    expect(found!.sessionId).toBe(session.sessionId);
    db.close();
  });
});

// ── CRUD — Session ─────────────────────────────────────────────────────────

describe("AgentWorkSessionStore — sessions", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAgentWorkSessionStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createAgentWorkSessionStore(db);
  });

  it("starts a session, transitions to running, and retrieves it", () => {
    const session = createTestSession();
    const started = store.startSession(session);

    expect(started.status).toBe("running");
    expect(started.startedAt).toBeDefined();
    expect(started.sessionId).toBe(session.sessionId);
    expect(started.sellerId).toBe(session.sellerId);
  });

  it("completes a session with summary", () => {
    const session = createTestSession();
    store.startSession(session);
    store.completeSession(session.sessionId, session.sellerId, '{"result": "ok"}');

    const found = store.getSession(session.sessionId, session.sellerId)!;
    expect(found.status).toBe("completed");
    expect(found.endedAt).toBeDefined();
    expect(found.summaryJson).toBe('{"result": "ok"}');
  });

  it("fails a session with error", () => {
    const session = createTestSession();
    store.startSession(session);
    store.failSession(session.sessionId, session.sellerId, '{"error": "timeout"}');

    const found = store.getSession(session.sessionId, session.sellerId)!;
    expect(found.status).toBe("failed");
    expect(found.errorJson).toBe('{"error": "timeout"}');
  });

  it("skips a session with reason", () => {
    const session = createTestSession();
    store.startSession(session);
    store.skipSession(session.sessionId, session.sellerId, "no new signals");

    const found = store.getSession(session.sessionId, session.sellerId)!;
    expect(found.status).toBe("skipped");
    expect(found.summaryJson).toContain("no new signals");
  });

  it("returns undefined for non-existent session", () => {
    const found = store.getSession("nonexistent", "plasticov-mlc");
    expect(found).toBeUndefined();
  });

  it("lists recent sessions by agent", () => {
    for (let i = 0; i < 3; i++) {
      const session = createTestSession({
        sessionId: `sess-${i}`,
        agentId: "operations-manager",
      });
      store.startSession(session);
      store.completeSession(session.sessionId, session.sellerId, "{}");
    }

    const sessions = store.listRecentSessionsByAgent("plasticov-mlc", "operations-manager");
    expect(sessions).toHaveLength(3);
    expect(sessions.every((s) => s.agentId === "operations-manager")).toBe(true);
  });

  it("respects limit on list", () => {
    for (let i = 0; i < 5; i++) {
      const session = createTestSession({ sessionId: `sess-${i}` });
      store.startSession(session);
      store.completeSession(session.sessionId, session.sellerId, "{}");
    }

    const sessions = store.listRecentSessionsByAgent(
      "plasticov-mlc",
      "product-ads-profitability",
      2,
    );
    expect(sessions).toHaveLength(2);
  });

  it("finds last session by signalsHash", () => {
    const hash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const session1 = createTestSession({ sessionId: "sess-old", signalsHash: hash });
    const session2 = createTestSession({ sessionId: "sess-new", signalsHash: hash });

    store.startSession(session1);
    store.completeSession(session1.sessionId, session1.sellerId, "{}");
    store.startSession(session2);

    const found = store.getLastSessionForSignals(
      "plasticov-mlc",
      "product-ads-profitability",
      hash,
    );
    expect(found).toBeDefined();
    expect(found!.sessionId).toBe("sess-new"); // most recent
  });

  it("returns undefined for getLastSessionForSignals with no match", () => {
    const session = createTestSession({ signalsHash: "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111" });
    store.startSession(session);

    const found = store.getLastSessionForSignals(
      "plasticov-mlc",
      "product-ads-profitability",
      "differenthashdifferenthashdiffer",
    );
    expect(found).toBeUndefined();
  });
});

// ── Seller scoping ─────────────────────────────────────────────────────────

describe("AgentWorkSessionStore — seller scoping", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAgentWorkSessionStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createAgentWorkSessionStore(db);
  });

  it("does not leak Plasticov sessions into Maustian queries", () => {
    const plasticovSession = createTestSession({
      sessionId: "plasticov-sess",
      sellerId: "plasticov-mlc",
    });
    const maustianSession = createTestSession({
      sessionId: "maustian-sess",
      sellerId: "maustian-mlc",
    });

    store.startSession(plasticovSession);
    store.startSession(maustianSession);

    const plasticovList = store.listRecentSessionsByAgent(
      "plasticov-mlc",
      "product-ads-profitability",
    );
    expect(plasticovList).toHaveLength(1);
    expect(plasticovList[0]!.sellerId).toBe("plasticov-mlc");

    const maustianList = store.listRecentSessionsByAgent(
      "maustian-mlc",
      "product-ads-profitability",
    );
    expect(maustianList).toHaveLength(1);
    expect(maustianList[0]!.sellerId).toBe("maustian-mlc");
  });

  it("scopes getSession by sellerId", () => {
    const session = createTestSession({ sessionId: "sess-x", sellerId: "plasticov-mlc" });
    store.startSession(session);

    // Correct sellerId returns session
    expect(store.getSession("sess-x", "plasticov-mlc")).toBeDefined();

    // Wrong sellerId returns undefined
    expect(store.getSession("sess-x", "maustian-mlc")).toBeUndefined();
  });
});

// ── Observations ───────────────────────────────────────────────────────────

describe("AgentWorkSessionStore — observations", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAgentWorkSessionStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createAgentWorkSessionStore(db);
  });

  it("adds an observation and it is queryable indirectly via summarizeShift", () => {
    // Create a session first (FK constraint)
    const session = createTestSession({ sessionId: "sess-obs-test" });
    store.startSession(session);

    const obs = createTestObservation({
      observationId: "obs-1",
      sessionId: "sess-obs-test",
      kind: "risk",
      severity: "critical",
      summary: "Reputation drop detected",
    });
    store.addObservation(obs);

    // Observations are queryable through shift summary
    const summary = store.summarizeShift("plasticov-mlc", "2020-01-01T00:00:00Z");
    expect(summary.observationCounts.risk).toBe(1);
    expect(summary.observationCounts.new_signal).toBe(0);
  });

  it("throws on invalid observation kind", () => {
    const obs = createTestObservation({ kind: "invalid_kind" as "risk" });
    expect(() => store.addObservation(obs)).toThrow("invalid observation kind");
  });

  it("throws on invalid severity", () => {
    const obs = createTestObservation({ severity: "extreme" as "critical" });
    expect(() => store.addObservation(obs)).toThrow("invalid observation severity");
  });
});

// ── Proposals ──────────────────────────────────────────────────────────────

describe("AgentWorkSessionStore — proposal links", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAgentWorkSessionStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createAgentWorkSessionStore(db);
  });

  it("adds a proposal link and counts it in shift summary", () => {
    store.addProposalLink("sess-test-1", "prop-abc", "plasticov-mlc");
    store.addProposalLink("sess-test-1", "prop-def", "plasticov-mlc");

    const summary = store.summarizeShift("plasticov-mlc", "2020-01-01T00:00:00Z");
    expect(summary.proposalCount).toBe(2);
  });

  it("deduplicates proposal links (UNIQUE constraint)", () => {
    store.addProposalLink("sess-test-1", "prop-abc", "plasticov-mlc");
    // Second insert of same pair should be silently ignored
    expect(() => store.addProposalLink("sess-test-1", "prop-abc", "plasticov-mlc")).not.toThrow();

    const summary = store.summarizeShift("plasticov-mlc", "2020-01-01T00:00:00Z");
    expect(summary.proposalCount).toBe(1);
  });
});

// ── Lessons ────────────────────────────────────────────────────────────────

describe("AgentWorkSessionStore — lessons", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAgentWorkSessionStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createAgentWorkSessionStore(db);
  });

  it("adds and lists lessons", () => {
    const now = Date.now();
    const lesson1 = createTestLesson({
      lessonId: "lsn-1",
      lesson: "Lesson 1",
      learnedAt: new Date(now).toISOString(),
    });
    const lesson2 = createTestLesson({
      lessonId: "lsn-2",
      lesson: "Lesson 2",
      transferable: false,
      learnedAt: new Date(now - 1000).toISOString(),
    });

    store.addLesson(lesson1);
    store.addLesson(lesson2);

    const lessons = store.listRecentLessons("plasticov-mlc", "product-ads-profitability");
    expect(lessons).toHaveLength(2);
    expect(lessons[0]!.transferable).toBe(true);
    expect(lessons[1]!.transferable).toBe(false);
  });

  it("respects seller scoping for lessons", () => {
    const plasticovLesson = createTestLesson({
      lessonId: "lsn-p",
      sellerId: "plasticov-mlc",
      lesson: "Plasticov strategy",
    });
    store.addLesson(plasticovLesson);

    const maustianLessons = store.listRecentLessons("maustian-mlc", "product-ads-profitability");
    expect(maustianLessons).toHaveLength(0);

    const plasticovLessons = store.listRecentLessons("plasticov-mlc", "product-ads-profitability");
    expect(plasticovLessons).toHaveLength(1);
    expect(plasticovLessons[0]!.lesson).toBe("Plasticov strategy");
  });

  it("lists transferable lessons", () => {
    store.addLesson(
      createTestLesson({ lessonId: "lsn-t1", transferable: true, lesson: "Keep 40% margin" }),
    );
    store.addLesson(
      createTestLesson({ lessonId: "lsn-t2", transferable: false, lesson: "Plasticov ships slow" }),
    );
    store.addLesson(
      createTestLesson({
        lessonId: "lsn-t3",
        transferable: true,
        lesson: "Check competitor prices",
      }),
    );

    const lessons = store.listRecentLessons("plasticov-mlc", "product-ads-profitability");
    const transferable = lessons.filter((l) => l.transferable);
    expect(transferable).toHaveLength(2);
  });
});

// ── Shift summary ──────────────────────────────────────────────────────────

describe("AgentWorkSessionStore — shift summary", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAgentWorkSessionStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createAgentWorkSessionStore(db);
  });

  it("summarizes a shift with observations, proposals, and lessons", () => {
    // Start and complete a session
    const session = createTestSession({ sessionId: "sess-summary-test" });
    store.startSession(session);
    store.completeSession("sess-summary-test", "plasticov-mlc", '{"done": true}');

    // Add observations
    store.addObservation(
      createTestObservation({
        observationId: "obs-a",
        sessionId: "sess-summary-test",
        kind: "risk",
        severity: "warning",
      }),
    );
    store.addObservation(
      createTestObservation({
        observationId: "obs-b",
        sessionId: "sess-summary-test",
        kind: "opportunity",
      }),
    );
    store.addObservation(
      createTestObservation({
        observationId: "obs-c",
        sessionId: "sess-summary-test",
        kind: "risk",
      }),
    );

    // Add proposal link
    store.addProposalLink("sess-summary-test", "prop-1", "plasticov-mlc");

    // Add lesson
    store.addLesson(createTestLesson({ lessonId: "lsn-sum", sessionId: "sess-summary-test" }));

    const summary = store.summarizeShift("plasticov-mlc", "2020-01-01T00:00:00Z");

    expect(summary.sellerId).toBe("plasticov-mlc");
    expect(summary.sessionCount).toBe(1);
    expect(summary.observationCounts.risk).toBe(2);
    expect(summary.observationCounts.opportunity).toBe(1);
    expect(summary.proposalCount).toBe(1);
    expect(summary.lessonCount).toBe(1);
    expect(summary.completedSessionIds).toContain("sess-summary-test");
  });

  it("returns zero counts for empty shift", () => {
    const summary = store.summarizeShift("plasticov-mlc", new Date().toISOString());

    expect(summary.sessionCount).toBe(0);
    expect(summary.proposalCount).toBe(0);
    expect(summary.lessonCount).toBe(0);
    expect(Object.values(summary.observationCounts).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

// ── Defensive parsing ──────────────────────────────────────────────────────

describe("AgentWorkSessionStore — defensive parsing", () => {
  it("skips malformed session rows after direct SQL injection", () => {
    const db = new Database(":memory:");
    const store = createAgentWorkSessionStore(db);

    // Insert a valid session
    const session = createTestSession({ sessionId: "good-sess" });
    store.startSession(session);
    store.completeSession("good-sess", "plasticov-mlc", "{}");

    // Insert a malformed session with invalid status directly
    db.prepare(
      `
      INSERT INTO agent_work_sessions (session_id, seller_id, agent_id, lane_id, status, signals_hash)
      VALUES ('bad-sess', 'plasticov-mlc', 'op', 'lane', 'INVALID', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')
    `,
    ).run();

    const sessions = store.listRecentSessionsByAgent(
      "plasticov-mlc",
      "product-ads-profitability",
      10,
    );
    // Malformed row is silently skipped; only the valid one remains
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe("good-sess");

    db.close();
  });
});
