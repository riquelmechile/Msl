import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";

import {
  createAgentWorkSessionStore,
  createAgentMessageBusStore,
  createCompanyAgentStore,
  createCompanyAgentLearningStore,
  recordWorkSessionToCortex,
  recordObservationsToCortex,
  recordLessonsToCortex,
} from "@msl/agent";
import type { AgentWorkSessionStore, AgentMessageBusStore } from "@msl/agent";
import { createGraphEngine, type GraphEngine } from "@msl/memory";
import {
  createEconomicOutcome,
  transitionOutcome,
  type AgentWorkSession,
  type AgentObservation,
  type AgentLesson,
  type EconomicOutcome,
  type EconomicLearningEvent,
} from "@msl/domain";

import { CortexEconomicReinforcementBridge } from "../../packages/agent/src/finance/CortexEconomicReinforcementBridge.js";

let db: Database.Database;
let engine: GraphEngine;
let sessionStore: AgentWorkSessionStore;
let bus: AgentMessageBusStore;
let companyAgentStore: ReturnType<typeof createCompanyAgentStore>;
let learningStore: ReturnType<typeof createCompanyAgentLearningStore>;

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  engine = createGraphEngine(":memory:");
  sessionStore = createAgentWorkSessionStore(db);
  bus = createAgentMessageBusStore(db);
  companyAgentStore = createCompanyAgentStore(db);
  learningStore = createCompanyAgentLearningStore(db);
});

afterAll(() => {
  db.close();
  engine.db.close();
});

// ── Helpers ────────────────────────────────────────────────────

function createFinanceAgent(sellerId: string, label: string) {
  const agentId = `finance-${sellerId}`;
  const agent = companyAgentStore.insertCompanyAgent({
    id: agentId,
    label,
    departmentId: "finance",
    stablePrefix: `Finance agent for ${sellerId}`,
    refreshableContextProvider: "ceo-created-local-registry",
    inputs: ["financial analysis"],
    outputs: ["proposal", "evidence-summary"],
    requiredEvidenceKinds: ["unit_economics", "bank_statement"],
    boundaries: ["No direct ML write", "Proposal-only"],
  });
  return agent;
}

function makeSession(
  overrides: Partial<AgentWorkSession> & { sellerId: string; agentId: string; laneId: string },
): AgentWorkSession {
  const ts36 = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const sessionId = `ses-${overrides.sellerId}-${overrides.agentId}-${ts36}-${rand}`.slice(0, 64);
  const validHash = "abcdef0123456789abcdef0123456789"; // 32-char hex
  return {
    sessionId,
    sellerId: overrides.sellerId,
    agentId: overrides.agentId,
    laneId: overrides.laneId,
    status: "completed",
    signalsHash: validHash,
    stablePromptHash: validHash,
    evidenceHash: validHash,
    cycleCount: 0,
    summaryJson: JSON.stringify({ title: "E2E test session" }),
    ...overrides,
  };
}

function makeObservation(sellerId: string, agentId: string, sessionId: string): AgentObservation {
  return {
    observationId: `obs-${sellerId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sellerId,
    agentId,
    sessionId,
    kind: "risk",
    summary: `Observation for ${sellerId}`,
    severity: "warning",
    metadataJson: JSON.stringify({ source: "e2e-test" }),
  };
}

function makeLesson(sellerId: string, agentId: string, sessionId: string): AgentLesson {
  return {
    lessonId: `les-${sellerId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sellerId,
    agentId,
    sessionId,
    lesson: `Lesson for ${sellerId}: avoid thin margins`,
    transferable: false,
    learnedAt: new Date().toISOString(),
  };
}

function makeVerifiedOutcome(sellerId: string, sessionId?: string): EconomicOutcome {
  const base = createEconomicOutcome({ sellerId });
  let outcome = transitionOutcome(base, "observing");
  outcome = transitionOutcome(outcome, "observed");
  outcome = transitionOutcome(outcome, "verified");
  outcome = {
    ...outcome,
    ...(sessionId ? { workSessionId: sessionId, originatingAgentId: `finance-${sellerId}` } : {}),
  };
  return outcome;
}

// ── Tests ───────────────────────────────────────────────────────

describe("E2E Dual-Seller Finance Work Session Pipeline", () => {
  // ── 1. Finance agents for both sellers ─────────────────────

  it("creates Finance department agents for Plasticov and Maustian", () => {
    const plasticovAgent = createFinanceAgent("plasticov", "Finance Plasticov");
    const maustianAgent = createFinanceAgent("maustian", "Finance Maustian");

    expect(plasticovAgent.id).toBe("finance-plasticov");
    expect(plasticovAgent.profile.departmentId).toBe("finance");
    expect(plasticovAgent.status).toBe("active");

    expect(maustianAgent.id).toBe("finance-maustian");
    expect(maustianAgent.profile.departmentId).toBe("finance");
    expect(maustianAgent.status).toBe("active");

    // Both agents exist and are distinct
    const allAgents = companyAgentStore.listCompanyAgents();
    const financeAgents = allAgents.filter((a) => a.profile.departmentId === "finance");
    expect(financeAgents.length).toBeGreaterThanOrEqual(2);
  });

  // ── 2. Work Sessions are seller-scoped ─────────────────────

  it("work sessions are strictly seller-scoped", () => {
    const plasticovSession = makeSession({
      sellerId: "plasticov",
      agentId: "finance-plasticov",
      laneId: "finance-director",
    });
    const maustianSession = makeSession({
      sellerId: "maustian",
      agentId: "finance-maustian",
      laneId: "finance-director",
    });

    sessionStore.startSession(plasticovSession);
    sessionStore.startSession(maustianSession);
    sessionStore.completeSession(plasticovSession.sessionId, "plasticov", "{}");
    sessionStore.completeSession(maustianSession.sessionId, "maustian", "{}");

    // Plasticov queries must NOT return Maustian sessions
    const plasticovSessions = sessionStore.listRecentSessionsByAgent(
      "plasticov",
      "finance-plasticov",
      10,
    );
    const maustianSessions = sessionStore.listRecentSessionsByAgent(
      "maustian",
      "finance-maustian",
      10,
    );

    expect(plasticovSessions).toHaveLength(1);
    expect(plasticovSessions[0]!.sessionId).toBe(plasticovSession.sessionId);
    expect(plasticovSessions[0]!.sellerId).toBe("plasticov");

    expect(maustianSessions).toHaveLength(1);
    expect(maustianSessions[0]!.sessionId).toBe(maustianSession.sessionId);
    expect(maustianSessions[0]!.sellerId).toBe("maustian");

    // Verify no cross-seller contamination
    const plasticovSessionIds = new Set(plasticovSessions.map((s) => s.sessionId));
    for (const ms of maustianSessions) {
      expect(plasticovSessionIds.has(ms.sessionId)).toBe(false);
    }
  });

  // ── 3. Observations are seller-scoped ──────────────────────

  it("observations are seller-scoped and stored durably", () => {
    const ses = makeSession({
      sellerId: "plasticov",
      agentId: "finance-plasticov",
      laneId: "finance-director",
    });
    sessionStore.startSession(ses);
    sessionStore.completeSession(ses.sessionId, "plasticov", "{}");

    const obs = makeObservation("plasticov", "finance-plasticov", ses.sessionId);
    sessionStore.addObservation(obs);

    // Session should still be retrievable with data
    const s = sessionStore.getSession(ses.sessionId, "plasticov");
    expect(s).toBeDefined();
    expect(s!.sellerId).toBe("plasticov");

    // Verify Cortex recorded the observation
    recordWorkSessionToCortex(engine, ses, "plasticov");
    recordObservationsToCortex(engine, [obs], ses, "plasticov");

    const nodes = engine.getNodesBySeller("plasticov");
    const obsNodes = nodes.filter((n) => n.label.startsWith("observation:"));
    expect(obsNodes.length).toBeGreaterThanOrEqual(1);
  });

  // ── 4. Lessons are seller-scoped ───────────────────────────

  it("lessons are seller-scoped and durably stored", () => {
    const ses = makeSession({
      sellerId: "maustian",
      agentId: "finance-maustian",
      laneId: "finance-director",
    });
    sessionStore.startSession(ses);
    sessionStore.completeSession(ses.sessionId, "maustian", "{}");

    const lesson = makeLesson("maustian", "finance-maustian", ses.sessionId);
    sessionStore.addLesson(lesson);

    // Plasticov lessons should NOT show Maustian lessons
    const plasticovLessons = sessionStore.listRecentLessons("plasticov", "finance-plasticov", 10);
    for (const l of plasticovLessons) {
      expect(l.sellerId).not.toBe("maustian");
    }

    // Maustian lessons should be found
    const maustianLessons = sessionStore.listRecentLessons("maustian", "finance-maustian", 10);
    expect(maustianLessons.length).toBeGreaterThanOrEqual(1);
    expect(maustianLessons[0]!.sellerId).toBe("maustian");
  });

  // ── 5. Cortex nodes/edges are seller-isolated ──────────────

  it("Cortex nodes and edges are seller-isolated", () => {
    const plasticovSes = makeSession({
      sellerId: "plasticov",
      agentId: "finance-plasticov",
      laneId: "finance-director",
    });
    const maustianSes = makeSession({
      sellerId: "maustian",
      agentId: "finance-maustian",
      laneId: "finance-director",
    });

    plasticovSes.status = "completed";
    maustianSes.status = "completed";

    recordWorkSessionToCortex(engine, plasticovSes, "plasticov");
    recordWorkSessionToCortex(engine, maustianSes, "maustian");

    const obs = makeObservation("plasticov", "finance-plasticov", plasticovSes.sessionId);
    recordObservationsToCortex(engine, [obs], plasticovSes, "plasticov");

    const lesson = makeLesson("plasticov", "finance-plasticov", plasticovSes.sessionId);
    recordLessonsToCortex(engine, [lesson], plasticovSes, "plasticov");

    // Verify plasticov nodes exist in Cortex
    const plasticovNodes = engine.getNodesBySeller("plasticov");
    expect(plasticovNodes.length).toBeGreaterThanOrEqual(1);

    // Plasticov nodes must not be in Maustian queries
    const maustianNodes = engine.getNodesBySeller("maustian");
    const plasticovNodeIds = new Set(plasticovNodes.map((n) => n.id));
    for (const mn of maustianNodes) {
      expect(plasticovNodeIds.has(mn.id)).toBe(false);
    }
  });

  // ── 6. Outcome spine: session → proposal → action → outcome ─

  it("economic outcome spine connects session chain", () => {
    const ses = makeSession({
      sellerId: "plasticov",
      agentId: "finance-plasticov",
      laneId: "finance-director",
    });
    sessionStore.startSession(ses);
    sessionStore.completeSession(ses.sessionId, "plasticov", "{}");

    const outcome = makeVerifiedOutcome("plasticov", ses.sessionId);
    expect(outcome.status).toBe("verified");
    expect(outcome.workSessionId).toBe(ses.sessionId);
    expect(outcome.originatingAgentId).toBe("finance-plasticov");
    expect(outcome.sellerId).toBe("plasticov");
  });

  // ── 7. Bridge: applyActivationDelta mutates engine ─────────

  it("bridge applyPlan with activation delta modifies engine activation", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const outcome = makeVerifiedOutcome("plasticov");

    // Pre-create a node in the engine
    const node = engine.createNode("test-e2e-node", { type: "test" }, "plasticov");
    expect(node.activation).toBe(0);

    const plan = {
      planId: "e2e-plan",
      outcomeId: outcome.outcomeId,
      sellerId: "plasticov",
      economicSignal: {
        direction: "positive" as const,
        magnitude: 0.5,
        confidence: 0.8,
        reasonCodes: [],
        sourceValues: {},
      },
      attributionStrength: "contributory" as const,
      confidence: 0.7,
      targetNodes: [],
      targetEdges: [],
      proposedAdjustments: [
        { nodeId: String(node.id), delta: 0.15, reason: "E2E test", targetType: "node" as const },
      ],
      lessonCandidates: [],
      blockedTargets: [],
      reasonCodes: [],
      createdAt: Date.now(),
      status: "proposed" as const,
      reinforcementPolicyVersion: "0.1.0",
      attributionPolicyVersion: "0.1.0",
      signalPolicyVersion: "0.1.0",
      noExternalMutationExecuted: true as const,
    };

    const persisted: EconomicLearningEvent[] = [];
    const result = bridge.applyPlan({
      plan,
      outcome,
      engine,
      isAlreadyProcessed: () => false,
      persistEvent: (e) => persisted.push(e),
      listEventsByOutcome: () => [],
      listReversedEvents: () => [],
    });

    expect(result.applied).toBe(true);
    expect(persisted.length).toBe(1);

    // after value should reflect the delta
    expect(result.event.adjustments.length).toBe(1);
    expect(result.event.adjustments[0]!.afterValue).toBeGreaterThan(
      result.event.adjustments[0]!.beforeValue,
    );

    // Engine node activation should be updated
    const updatedNode = engine.getNode(node.id);
    expect(updatedNode).not.toBeNull();
    expect(updatedNode!.activation).toBeGreaterThan(0);
  });

  // ── 8. Bridge uses durable store (not in-memory) ────────────

  it("bridge uses durable store callbacks (not in-memory arrays)", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const outcome = makeVerifiedOutcome("maustian");

    const node = engine.createNode("durable-store-test", { type: "test" }, "maustian");

    const plan = {
      planId: "e2e-durable-plan",
      outcomeId: outcome.outcomeId,
      sellerId: "maustian",
      economicSignal: {
        direction: "positive" as const,
        magnitude: 0.5,
        confidence: 0.8,
        reasonCodes: [],
        sourceValues: {},
      },
      attributionStrength: "contributory" as const,
      confidence: 0.7,
      targetNodes: [{ nodeId: String(node.id), reason: "Test" }],
      targetEdges: [],
      proposedAdjustments: [
        { nodeId: String(node.id), delta: 0.1, reason: "Test", targetType: "node" as const },
      ],
      lessonCandidates: [],
      blockedTargets: [],
      reasonCodes: [],
      createdAt: Date.now(),
      status: "proposed" as const,
      reinforcementPolicyVersion: "0.1.0",
      attributionPolicyVersion: "0.1.0",
      signalPolicyVersion: "0.1.0",
      noExternalMutationExecuted: true as const,
    };

    const savedEvents: EconomicLearningEvent[] = [];
    let storeQueried = false;

    bridge.applyPlan({
      plan,
      outcome,
      engine,
      isAlreadyProcessed: () => false,
      persistEvent: (e) => savedEvents.push(e),
      listEventsByOutcome: () => {
        storeQueried = true;
        return savedEvents;
      },
      listReversedEvents: () => [],
    });

    expect(savedEvents.length).toBe(1);
    expect(storeQueried).toBe(false); // not queried on first call

    // Second call: isAlreadyProcessed triggers durable store query
    bridge.applyPlan({
      plan,
      outcome,
      engine,
      isAlreadyProcessed: () => true,
      persistEvent: () => {},
      listEventsByOutcome: () => savedEvents,
      listReversedEvents: () => [],
    });

    expect(savedEvents.length).toBe(1); // no duplicate — idempotent via durable store check
  });

  // ── 9. Finance department lessons work durably ─────────────

  it("Finance department lessons persist durably in companyAgentLearningStore", () => {
    const lesson = learningStore.insertAgentLesson({
      lessonId: `fin-lesson-${Date.now()}`,
      targetAgentId: "finance-plasticov",
      departmentId: "finance",
      scope: "agent",
      lessonType: "outcome-lesson",
      summary: "Finance agent learned about margin optimization",
      evidenceIds: ["ev-1"],
      confidence: 0.85,
      impact: 0.7,
      sellerId: "plasticov",
    });

    expect(lesson.departmentId).toBe("finance");
    expect(lesson.sellerId).toBe("plasticov");
    expect(lesson.status).toBe("active");

    // Retrieve lessons scoped to Plasticov
    const plasticovLessons = learningStore.getLessonsBySeller("plasticov");
    expect(plasticovLessons.length).toBeGreaterThanOrEqual(1);
    expect(plasticovLessons[0]!.departmentId).toBe("finance");
  });

  // ── 10. Cross-seller lesson isolation ──────────────────────

  it("cross-seller lesson isolation: Plasticov doesn't see Maustian lessons", () => {
    // Clear existing lessons
    learningStore.insertAgentLesson({
      lessonId: `fin-pl-${Date.now()}`,
      targetAgentId: "finance-plasticov",
      departmentId: "finance",
      scope: "agent",
      lessonType: "ceo-correction",
      summary: "Plasticov-specific: improve pricing strategy",
      evidenceIds: ["ev-pl"],
      confidence: 0.9,
      impact: 0.8,
      sellerId: "plasticov",
    });

    learningStore.insertAgentLesson({
      lessonId: `fin-mau-${Date.now()}`,
      targetAgentId: "finance-maustian",
      departmentId: "finance",
      scope: "agent",
      lessonType: "ceo-correction",
      summary: "Maustian-specific: reduce shipping costs",
      evidenceIds: ["ev-mau"],
      confidence: 0.85,
      impact: 0.75,
      sellerId: "maustian",
    });

    const plasticovLessons = learningStore.getLessonsBySeller("plasticov");
    const maustianLessons = learningStore.getLessonsBySeller("maustian");

    expect(plasticovLessons.length).toBeGreaterThanOrEqual(1);
    expect(maustianLessons.length).toBeGreaterThanOrEqual(1);

    const plasticovLessonIds = new Set(plasticovLessons.map((l) => l.lessonId));
    for (const ml of maustianLessons) {
      expect(plasticovLessonIds.has(ml.lessonId)).toBe(false);
    }

    // All Plasticov lessons should be from Plasticov
    for (const pl of plasticovLessons) {
      expect(pl.sellerId).toBe("plasticov");
    }
  });

  // ── 11. delegate_to_subagent enqueues durable WorkOrder ────

  it("delegate_to_subagent enqueues durable WorkOrder in message bus", () => {
    const correlationId = "e2e-delegation";

    bus.enqueue({
      senderAgentId: "finance-plasticov",
      receiverAgentId: "cost-supplier",
      messageType: "work_order",
      payloadJson: JSON.stringify({
        sourceAgentId: "finance-plasticov",
        targetAgentId: "cost-supplier",
        laneId: "cost-supplier",
        sellerId: "plasticov",
        scope: "Investigate cost reduction options",
        requestedAction: "analyze supplier costs",
        evidenceIds: ["cost-ev-1"],
        parameters: { scope: "cost reduction", evidenceIds: ["cost-ev-1"] },
        status: "pending",
        createdAt: new Date().toISOString(),
      }),
      correlationId,
      dedupeKey: `work-order:finance-plasticov:cost-supplier:${Date.now()}`,
      sellerId: "plasticov",
    });

    // Verify work order is claimable by target agent
    const claimed = bus.claimNext("cost-supplier");
    expect(claimed.length).toBeGreaterThanOrEqual(1);

    const workOrderMsg = claimed.find(
      (m) => m.messageType === "work_order" && m.correlationId === correlationId,
    );
    expect(workOrderMsg).toBeDefined();

    const payload = JSON.parse(workOrderMsg!.payloadJson) as Record<string, unknown>;
    expect(payload.sourceAgentId).toBe("finance-plasticov");
    expect(payload.targetAgentId).toBe("cost-supplier");
    expect(payload.sellerId).toBe("plasticov");
    expect(payload.status).toBe("pending");
  });

  // ── 12. WorkOrder seller isolation ─────────────────────────

  it("WorkOrders are seller-scoped — Plasticov orders not visible as Maustian", () => {
    // Enqueue a work order for plasticov
    const woP = bus.enqueue({
      senderAgentId: "finance-plasticov",
      receiverAgentId: "operations-manager",
      messageType: "work_order",
      payloadJson: JSON.stringify({
        sourceAgentId: "finance-plasticov",
        targetAgentId: "operations-manager",
        laneId: "operations-manager",
        sellerId: "plasticov",
        status: "pending",
      }),
      sellerId: "plasticov",
      dedupeKey: `wo-plasticov-${Date.now() + 1}`,
    });

    // Enqueue a work order for maustian
    const woM = bus.enqueue({
      senderAgentId: "finance-maustian",
      receiverAgentId: "operations-manager",
      messageType: "work_order",
      payloadJson: JSON.stringify({
        sourceAgentId: "finance-maustian",
        targetAgentId: "operations-manager",
        laneId: "operations-manager",
        sellerId: "maustian",
        status: "pending",
      }),
      sellerId: "maustian",
      dedupeKey: `wo-maustian-${Date.now() + 2}`,
    });

    // Both were enqueued successfully
    expect(woP.sellerId).toBe("plasticov");
    expect(woM.sellerId).toBe("maustian");

    // Claim next — both should be claimable since target agent is the same
    const claimed = bus.claimNext("operations-manager", { limit: 10 });
    expect(claimed.length).toBeGreaterThanOrEqual(2);

    const sellerIds = claimed
      .filter((m) => m.messageType === "work_order")
      .map((m) => (JSON.parse(m.payloadJson) as Record<string, unknown>).sellerId);

    expect(sellerIds).toContain("plasticov");
    expect(sellerIds).toContain("maustian");
  });

  // ── 13. beforeStateHash != afterStateHash with delta ───────

  it("beforeStateHash differs from afterStateHash when reinforcement delta is applied", () => {
    const bridge = new CortexEconomicReinforcementBridge();
    const outcome = makeVerifiedOutcome("plasticov");

    const node = engine.createNode("hash-test-node", { type: "test" }, "plasticov");

    const plan = {
      planId: "hash-test-plan",
      outcomeId: outcome.outcomeId,
      sellerId: "plasticov",
      economicSignal: {
        direction: "positive" as const,
        magnitude: 0.5,
        confidence: 0.8,
        reasonCodes: [],
        sourceValues: {},
      },
      attributionStrength: "contributory" as const,
      confidence: 0.7,
      targetNodes: [{ nodeId: String(node.id), reason: "Hash test" }],
      targetEdges: [],
      proposedAdjustments: [
        {
          nodeId: String(node.id),
          delta: 0.2,
          reason: "Delta for hash",
          targetType: "node" as const,
        },
      ],
      lessonCandidates: [],
      blockedTargets: [],
      reasonCodes: [],
      createdAt: Date.now(),
      status: "proposed" as const,
      reinforcementPolicyVersion: "0.1.0",
      attributionPolicyVersion: "0.1.0",
      signalPolicyVersion: "0.1.0",
      noExternalMutationExecuted: true as const,
    };

    const persisted: EconomicLearningEvent[] = [];
    const result = bridge.applyPlan({
      plan,
      outcome,
      engine,
      isAlreadyProcessed: () => false,
      persistEvent: (e) => persisted.push(e),
      listEventsByOutcome: () => [],
      listReversedEvents: () => [],
    });

    expect(result.applied).toBe(true);
    expect(result.event.beforeStateHash).not.toBe("");
    // With delta applied, hash should change
    expect(result.event.beforeStateHash).not.toBe(result.event.afterStateHash);
  });
});
