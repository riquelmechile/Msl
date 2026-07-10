import { describe, expect, it, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { GraphEngine, createDatabase } from "@msl/memory";

import {
  recordWorkSessionToCortex,
  recordObservationToCortex,
  recordLessonToCortex,
  connectSessionToProposal,
  connectSessionToOutcome,
} from "../../src/sessions/agentWorkCortexBridge.js";
import type { AgentWorkSession, AgentObservation, AgentLesson } from "@msl/domain";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeSession(overrides?: Partial<AgentWorkSession>): AgentWorkSession {
  return {
    sessionId: "test-session-1",
    sellerId: "plasticov",
    agentId: "unanswered-questions",
    laneId: "unanswered-questions",
    status: "completed",
    signalsHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    stablePromptHash: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
    evidenceHash: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
    cycleCount: 1,
    summaryJson: "{}",
    ...overrides,
  };
}

function makeObservation(overrides?: Partial<AgentObservation>): AgentObservation {
  return {
    observationId: "test-obs-1",
    sellerId: "plasticov",
    agentId: "unanswered-questions",
    sessionId: "test-session-1",
    kind: "risk",
    summary: "Reputation dropped",
    severity: "warning",
    metadataJson: "{}",
    ...overrides,
  };
}

function makeLesson(overrides?: Partial<AgentLesson>): AgentLesson {
  return {
    lessonId: "test-lesson-1",
    sellerId: "plasticov",
    agentId: "unanswered-questions",
    sessionId: "test-session-1",
    lesson: "Always respond within 24h",
    transferable: true,
    learnedAt: "2026-07-10T12:00:00Z",
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("agentWorkCortexBridge", () => {
  let db: Database.Database;
  let cortex: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    cortex = new GraphEngine(db);
  });

  describe("recordWorkSessionToCortex", () => {
    it("creates a WorkSession node scoped to seller", () => {
      const session = makeSession();
      recordWorkSessionToCortex(cortex, session, "plasticov");

      const nodes = cortex.getNodesBySeller("plasticov");
      const sessionNodes = nodes.filter((n) => n.label.startsWith("work_session:"));
      expect(sessionNodes.length).toBeGreaterThanOrEqual(1);
      expect(sessionNodes[0]!.label).toContain("test-session-1");
    });

    it("is idempotent — repeated calls do not duplicate nodes", () => {
      const session = makeSession();
      recordWorkSessionToCortex(cortex, session, "plasticov");
      recordWorkSessionToCortex(cortex, session, "plasticov");
      recordWorkSessionToCortex(cortex, session, "plasticov");

      const nodes = cortex.getNodesBySeller("plasticov");
      const sessionNodes = nodes.filter((n) => n.label === "work_session:test-session-1");
      expect(sessionNodes.length).toBe(1);
    });

    it("scopes per seller — no cross-contamination", () => {
      const plasticovSession = makeSession({ sessionId: "plasticov-s1", sellerId: "plasticov" });
      const maustianSession = makeSession({ sessionId: "maustian-s1", sellerId: "maustian" });

      recordWorkSessionToCortex(cortex, plasticovSession, "plasticov");
      recordWorkSessionToCortex(cortex, maustianSession, "maustian");

      const plasticovNodes = cortex.getNodesBySeller("plasticov");
      const maustianNodes = cortex.getNodesBySeller("maustian");

      expect(plasticovNodes.some((n) => n.label.includes("maustian-s1"))).toBe(false);
      expect(maustianNodes.some((n) => n.label.includes("plasticov-s1"))).toBe(false);
    });
  });

  describe("recordObservationToCortex", () => {
    it("creates an Observation node linked to the session node", () => {
      const session = makeSession();
      const obs = makeObservation();
      recordWorkSessionToCortex(cortex, session, "plasticov");
      recordObservationToCortex(cortex, obs, "plasticov");

      const nodes = cortex.getNodesBySeller("plasticov");
      const obsNodes = nodes.filter((n) => n.label.startsWith("observation:"));
      expect(obsNodes.length).toBe(1);
      expect(obsNodes[0]!.label).toBe("observation:test-obs-1");
    });
  });

  describe("recordLessonToCortex", () => {
    it("creates a Lesson node linked to the session", () => {
      const session = makeSession();
      const lesson = makeLesson();
      recordWorkSessionToCortex(cortex, session, "plasticov");
      recordLessonToCortex(cortex, lesson, "plasticov");

      const nodes = cortex.getNodesBySeller("plasticov");
      const lessonNodes = nodes.filter((n) => n.label.startsWith("lesson:"));
      expect(lessonNodes.length).toBe(1);
    });

    it("links transferable lessons to AccountAsset root for cross-agent discovery", () => {
      const session = makeSession();
      const lesson = makeLesson({ transferable: true });
      recordWorkSessionToCortex(cortex, session, "plasticov");
      recordLessonToCortex(cortex, lesson, "plasticov");

      const nodes = cortex.getNodesBySeller("plasticov");
      const accountNodes = nodes.filter((n) => n.label.startsWith("account_asset:"));
      const lessonNodes = nodes.filter((n) => n.label.startsWith("lesson:"));
      expect(accountNodes.length).toBeGreaterThanOrEqual(1);
      expect(lessonNodes.length).toBe(1);
    });
  });

  describe("connectSessionToProposal", () => {
    it("connects session and proposal nodes", () => {
      const session = makeSession();
      recordWorkSessionToCortex(cortex, session, "plasticov");
      connectSessionToProposal(cortex, "test-session-1", "proposal-1", "plasticov");

      // Should not throw — verifies nodes exist
      const nodes = cortex.getNodesBySeller("plasticov");
      const proposalNodes = nodes.filter((n) => n.label.includes("proposal-1"));
      expect(proposalNodes.length).toBe(1);
    });
  });

  describe("connectSessionToOutcome", () => {
    it("connects session and outcome nodes", () => {
      const session = makeSession();
      recordWorkSessionToCortex(cortex, session, "plasticov");
      connectSessionToOutcome(cortex, "test-session-1", "outcome:sale", "plasticov");

      const nodes = cortex.getNodesBySeller("plasticov");
      const outcomeNodes = nodes.filter((n) => n.label.includes("outcome:sale"));
      expect(outcomeNodes.length).toBe(1);
    });
  });
});
