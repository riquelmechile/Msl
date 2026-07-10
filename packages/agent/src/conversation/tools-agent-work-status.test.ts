import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";

import { createAgentWorkSessionStore } from "../../src/sessions/AgentWorkSessionStore.js";
import { createGetAgentWorkStatusTool } from "../../src/conversation/tools/agentWorkStatusTool.js";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("get_agent_work_status tool", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  it("returns unavailable when session store is not configured", () => {
    const tool = createGetAgentWorkStatusTool();
    const result = tool.execute({}) as Record<string, unknown>;

    expect(result.noMutationExecuted).toBe(true);
    expect(result.estimatedCost).toBe("unavailable");
    expect(result.cacheEfficiency).toBe("unavailable");
    expect(Array.isArray(result.nextSteps)).toBe(true);
  });

  it("queries all agents today for a specific seller", () => {
    const store = createAgentWorkSessionStore(db);

    // Create a completed session
    const session = store.startSession({
      sessionId: "tool-test-1",
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
    store.completeSession(session.sessionId, "plasticov", "{}");

    const tool = createGetAgentWorkStatusTool(store);
    const result = tool.execute({ sellerId: "plasticov" }) as Record<string, unknown>;

    expect(result.noMutationExecuted).toBe(true);
    expect(result.perAccount).toBeDefined();
    const perAccount = result.perAccount as Record<string, unknown>;
    expect(perAccount["plasticov"]).toBeDefined();

    const plasticovData = perAccount["plasticov"] as Record<string, unknown>;
    expect(plasticovData.sessionsToday).toBeGreaterThanOrEqual(1);
    expect(plasticovData.status).toBe("active");
  });

  it("returns account-scoped data — no cross-contamination", () => {
    const store = createAgentWorkSessionStore(db);

    // Plasticov session
    const pSession = store.startSession({
      sessionId: "scope-p-1",
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
    store.completeSession(pSession.sessionId, "plasticov", "{}");

    const tool = createGetAgentWorkStatusTool(store);

    const plasticovResult = tool.execute({ sellerId: "plasticov" }) as Record<string, unknown>;
    const plasticovData = (plasticovResult.perAccount as Record<string, Record<string, unknown>>)[
      "plasticov"
    ]!;
    expect(plasticovData.sessionsToday).toBeGreaterThanOrEqual(1);

    const maustianResult = tool.execute({ sellerId: "maustian" }) as Record<string, unknown>;
    const maustianData = (maustianResult.perAccount as Record<string, Record<string, unknown>>)[
      "maustian"
    ]!;
    expect(maustianData.sessionsToday).toBe(0);
    expect(maustianData.status).toBe("no_activity");
  });

  it("includes transferable lessons when includeLessons is true", () => {
    const store = createAgentWorkSessionStore(db);

    const session = store.startSession({
      sessionId: "lesson-tool-1",
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
    store.addLesson({
      lessonId: "tool-lesson-1",
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      sessionId: session.sessionId,
      lesson: "Always check reputation before answering",
      transferable: true,
      learnedAt: new Date().toISOString(),
    });
    store.completeSession(session.sessionId, "plasticov", "{}");

    const tool = createGetAgentWorkStatusTool(store);
    const result = tool.execute({
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      includeLessons: true,
    }) as Record<string, unknown>;

    expect(result.noMutationExecuted).toBe(true);
    expect(result.transferableLessons).toBeDefined();
    expect((result.transferableLessons as string[]).length).toBeGreaterThanOrEqual(1);
  });

  it("always includes noMutationExecuted: true", () => {
    const tool = createGetAgentWorkStatusTool();
    const result = tool.execute({}) as Record<string, unknown>;

    expect(result.noMutationExecuted).toBe(true);

    // Run multiple times — safety invariant
    const result2 = tool.execute({ sellerId: "plasticov" }) as Record<string, unknown>;
    expect(result2.noMutationExecuted).toBe(true);
  });
});
