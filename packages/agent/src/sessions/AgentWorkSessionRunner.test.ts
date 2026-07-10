import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";

import type {
  DeepSeekTransport,
  DeepSeekChatResponse,
  DeepSeekStreamChunk,
  DeepSeekModel,
  DeepSeekChatRequest,
} from "../../src/conversation/transports/deepseekTransport.js";
import type { GraphEngine } from "@msl/memory";
import { GraphEngine as GraphEngineClass, createDatabase } from "@msl/memory";
import { createAgentWorkSessionStore } from "../../src/sessions/AgentWorkSessionStore.js";
import { createAgentWorkSessionRunner } from "../../src/sessions/AgentWorkSessionRunner.js";
import { createCeoInboxStore } from "../../src/conversation/ceoInboxStore.js";
import type { CeoInboxStore } from "../../src/conversation/ceoInboxStore.js";
import type { AgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import type { AccountAssetStore } from "../../src/conversation/accountAssetStore.js";

// ── Fake Transport ──────────────────────────────────────────────────────────

function makeFakeTransport(responses: DeepSeekChatResponse[]): DeepSeekTransport {
  let idx = 0;
  return {
    listModels: (): Promise<DeepSeekModel[]> => Promise.resolve([]),
    createChatCompletion: (_req: DeepSeekChatRequest): Promise<DeepSeekChatResponse> => {
      void _req;
      const r = responses[idx % responses.length]!;
      idx = (idx + 1) % responses.length;
      return Promise.resolve(r);
    },
    streamChatCompletion(): AsyncIterable<DeepSeekStreamChunk> {
      const r = responses[0];
      const content = r?.choices[0]?.message.content ?? "";
      return {
        [Symbol.asyncIterator](): AsyncIterator<DeepSeekStreamChunk> {
          let done = false;
          return {
            next(): Promise<IteratorResult<DeepSeekStreamChunk>> {
              if (done) {
                return Promise.resolve({
                  value: { delta: "", done: true },
                  done: true,
                });
              }
              done = true;
              return Promise.resolve({
                value: { delta: content, done: true },
                done: false,
              });
            },
          };
        },
      } as AsyncIterable<DeepSeekStreamChunk>;
    },
  };
}

function makeSuccessResponse(content: string): DeepSeekChatResponse {
  return {
    id: "test-cmpl",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  };
}

function makeObservationsJson(): string {
  return JSON.stringify({
    observations: [
      { kind: "new_signal", summary: "3 unanswered questions detected", severity: "info" },
      { kind: "risk", summary: "Reputation score dropped 2 points", severity: "warning" },
    ],
    proposals: [
      {
        type: "price_adjustment",
        summary: "Lower listing 42 price by 5%",
        payload: { listingId: "MLC42", newPrice: 9500 },
        risk_level: "low",
      },
    ],
    lessons: [
      { lesson: "Reputation drops correlate with 48h unanswered questions", transferable: true },
    ],
    summary: "Routine monitoring complete",
    noMutationExecuted: true,
  });
}

// ── Fake stores ─────────────────────────────────────────────────────────────

function makeFakeAccountAssetStore(): AccountAssetStore {
  return {
    upsertAccountAsset: () => ({ sellerId: "test", name: "Test" }) as never,
    getAccountAsset: () => null,
    compareAccounts: () => [],
    upsertCapability: () => ({}) as never,
    getCapabilities: () => [],
    recordHealthSnapshot: () => ({}) as never,
    getHealthHistory: () => [],
    upsertProfitGoal: () => {},
    getProfitGoal: () => null,
    addStrategyNote: () => ({}) as never,
    getStrategyNotes: () => [],
    addRisk: () => ({}) as never,
    getRisks: () => [],
    addOpportunity: () => ({}) as never,
    getOpportunities: () => [],
    getRecentMemory: () => ({
      asset: null,
      capabilities: [],
      profitGoal: null,
      strategies: [],
      risks: [],
      opportunities: [],
    }),
    updateStatus: () => {},
    listActive: () => [],
    count: () => 0,
  };
}

function makeFakeMessageBus(): AgentMessageBusStore {
  return {
    enqueue: () => ({}) as never,
    claimNext: () => [] as never[],
    resolve: () => {},
    fail: () => {},
    cancel: () => {},
    lookupRecentByDedupePrefix: () => [],
    getFailedMessages: () => [],
    reenqueueFailed: () => {},
    getProcessingStuck: () => [],
    getPendingCount: () => 0,
    getMessagesByCorrelationId: () => [],
    getLearningHistory: () => [],
    recordOutcome: () => {},
    getUnscoredMessages: () => [],
  };
}

function makeFakeClock(fixedNow?: Date): { now: () => Date } {
  const fixed = fixedNow ?? new Date("2026-07-10T12:00:00Z");
  return { now: () => fixed };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("AgentWorkSessionRunner", () => {
  let db: Database.Database;
  let cortex: GraphEngine;
  let ceoInbox: CeoInboxStore;

  beforeEach(() => {
    db = createDatabase(":memory:");
    cortex = new GraphEngineClass(db);
    ceoInbox = createCeoInboxStore(db);
  });

  it("skips session when shouldWake returns false (no signals)", async () => {
    const store = createAgentWorkSessionStore(db);
    const runner = createAgentWorkSessionRunner({
      workSessionStore: store,
      accountAssetStore: makeFakeAccountAssetStore(),
      cortex,
      ceoInboxStore: ceoInbox,
      messageBus: makeFakeMessageBus(),
      deepSeekTransport: makeFakeTransport([]),
      clock: makeFakeClock(),
    });

    const session = await runner.runWorkSession({
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      laneId: "unanswered-questions",
      signals: [], // empty → no signals → shouldWake=false
      accountContext: "Plasticov account",
      evidence: "",
      openQuestions: "",
      outputSchema: "{}",
    });

    expect(session.status).toBe("skipped");
    // Verify it was persisted
    const lookup = store.getSession(session.sessionId, "plasticov");
    expect(lookup).toBeDefined();
    expect(lookup!.status).toBe("skipped");
  });

  it("completes session with observations when DeepSeek returns valid output", async () => {
    const store = createAgentWorkSessionStore(db);
    const transport = makeFakeTransport([makeSuccessResponse(makeObservationsJson())]);
    const runner = createAgentWorkSessionRunner({
      workSessionStore: store,
      accountAssetStore: makeFakeAccountAssetStore(),
      cortex,
      ceoInboxStore: ceoInbox,
      messageBus: makeFakeMessageBus(),
      deepSeekTransport: transport,
      clock: makeFakeClock(),
    });

    const session = await runner.runWorkSession({
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      laneId: "unanswered-questions",
      signals: [{ type: "unanswered_questions", count: 3, severity: "warning" }],
      accountContext: "Plasticov account — 30% margin target",
      evidence: "3 pending questions from buyers",
      openQuestions: "Question #1: shipping costs",
      outputSchema: '{"observations": [], "proposals": [], "lessons": []}',
    });

    expect(session.status).toBe("completed");
    expect(session.sessionId).toContain("aws-");
    expect(session.sellerId).toBe("plasticov");
  });

  it("fails session when DeepSeek transport throws", async () => {
    const store = createAgentWorkSessionStore(db);
    const throwingTransport: DeepSeekTransport = {
      listModels: () => Promise.resolve([]),
      createChatCompletion: () => {
        throw new Error("Network timeout");
      },
      streamChatCompletion(): AsyncIterable<DeepSeekStreamChunk> {
        return {
          [Symbol.asyncIterator](): AsyncIterator<DeepSeekStreamChunk> {
            return {
              next(): Promise<IteratorResult<DeepSeekStreamChunk>> {
                throw new Error("Network timeout");
              },
            };
          },
        } as AsyncIterable<DeepSeekStreamChunk>;
      },
    };

    const runner = createAgentWorkSessionRunner({
      workSessionStore: store,
      accountAssetStore: makeFakeAccountAssetStore(),
      cortex,
      ceoInboxStore: ceoInbox,
      messageBus: makeFakeMessageBus(),
      deepSeekTransport: throwingTransport,
      clock: makeFakeClock(),
    });

    const session = await runner.runWorkSession({
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      laneId: "unanswered-questions",
      signals: [{ type: "unanswered_questions", count: 1 }],
      accountContext: "Plasticov",
      evidence: "",
      openQuestions: "",
      outputSchema: "{}",
    });

    expect(session.status).toBe("failed");
    expect(session.errorJson).toBeDefined();
    expect(session.errorJson!).toContain("Network timeout");
  });

  it("records proposals to CEO inbox with session attribution", async () => {
    const store = createAgentWorkSessionStore(db);
    const transport = makeFakeTransport([makeSuccessResponse(makeObservationsJson())]);
    const msgBus = makeFakeMessageBus();
    const runner = createAgentWorkSessionRunner({
      workSessionStore: store,
      accountAssetStore: makeFakeAccountAssetStore(),
      cortex,
      ceoInboxStore: ceoInbox,
      messageBus: msgBus,
      deepSeekTransport: transport,
      clock: makeFakeClock(),
    });

    const session = await runner.runWorkSession({
      sellerId: "plasticov",
      agentId: "operations-manager",
      laneId: "operations-manager",
      signals: [{ type: "reputation_drop", severity: "warning" }],
      accountContext: "Plasticov",
      evidence: "Reputation dropped",
      openQuestions: "",
      outputSchema: "{}",
    });

    expect(session.status).toBe("completed");

    // Proposals should be in the inbox
    const proposals = ceoInbox.getBySellerId("plasticov");
    expect(proposals.length).toBe(1);
    expect(proposals[0]!.sender_agent_id).toBe("operations-manager");
    expect(proposals[0]!.seller_id).toBe("plasticov");
  });

  it("saves errorJson when DeepSeek returns invalid JSON", async () => {
    const store = createAgentWorkSessionStore(db);
    const invalidJsonResponse = makeSuccessResponse("not valid json {{{");
    const transport = makeFakeTransport([invalidJsonResponse]);
    const runner = createAgentWorkSessionRunner({
      workSessionStore: store,
      accountAssetStore: makeFakeAccountAssetStore(),
      cortex,
      ceoInboxStore: ceoInbox,
      messageBus: makeFakeMessageBus(),
      deepSeekTransport: transport,
      clock: makeFakeClock(),
    });

    const session = await runner.runWorkSession({
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      laneId: "unanswered-questions",
      signals: [{ type: "unanswered_questions", count: 1 }],
      accountContext: "Plasticov",
      evidence: "",
      openQuestions: "",
      outputSchema: "{}",
    });

    expect(session.status).toBe("failed");
    expect(session.errorJson).toContain("invalid json");
  });

  it("scopes sessions per seller — no Plasticov/Maustian mixing", async () => {
    const store = createAgentWorkSessionStore(db);
    const transport = makeFakeTransport([makeSuccessResponse(makeObservationsJson())]);
    const runner = createAgentWorkSessionRunner({
      workSessionStore: store,
      accountAssetStore: makeFakeAccountAssetStore(),
      cortex,
      ceoInboxStore: ceoInbox,
      messageBus: makeFakeMessageBus(),
      deepSeekTransport: transport,
      clock: makeFakeClock(),
    });

    const plasticovSession = await runner.runWorkSession({
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      laneId: "unanswered-questions",
      signals: [{ type: "unanswered_questions", count: 2 }],
      accountContext: "Plasticov",
      evidence: "",
      openQuestions: "",
      outputSchema: "{}",
    });

    const maustianSession = await runner.runWorkSession({
      sellerId: "maustian",
      agentId: "unanswered-questions",
      laneId: "unanswered-questions",
      signals: [{ type: "unanswered_questions", count: 1 }],
      accountContext: "Maustian",
      evidence: "",
      openQuestions: "",
      outputSchema: "{}",
    });

    expect(plasticovSession.sellerId).toBe("plasticov");
    expect(maustianSession.sellerId).toBe("maustian");

    // Plasticov data only visible to Plasticov
    const plasticovProposals = ceoInbox.getBySellerId("plasticov");
    const maustianProposals = ceoInbox.getBySellerId("maustian");

    for (const p of plasticovProposals) {
      expect(p.seller_id).toBe("plasticov");
    }
    for (const p of maustianProposals) {
      expect(p.seller_id).toBe("maustian");
    }
  });

  it("manual override forces wake even with cooldown", async () => {
    const store = createAgentWorkSessionStore(db);
    const transport = makeFakeTransport([
      makeSuccessResponse(makeObservationsJson()),
      makeSuccessResponse(makeObservationsJson()),
    ]);
    const runner = createAgentWorkSessionRunner({
      workSessionStore: store,
      accountAssetStore: makeFakeAccountAssetStore(),
      cortex,
      ceoInboxStore: ceoInbox,
      messageBus: makeFakeMessageBus(),
      deepSeekTransport: transport,
      clock: makeFakeClock(),
    });

    // Run first session
    const first = await runner.runWorkSession({
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      laneId: "unanswered-questions",
      signals: [{ type: "no_op" }],
      accountContext: "Plasticov",
      evidence: "",
      openQuestions: "",
      outputSchema: "{}",
    });

    expect(first.status).toBe("completed");

    // Run again with same signals but manual override
    const second = await runner.runWorkSession({
      sellerId: "plasticov",
      agentId: "unanswered-questions",
      laneId: "unanswered-questions",
      signals: [{ type: "no_op" }],
      accountContext: "Plasticov",
      evidence: "",
      openQuestions: "",
      outputSchema: "{}",
      manual: true,
    });

    // Should wake due to manual override
    expect(second.status).toBe("completed");
    expect(second.sessionId).not.toBe(first.sessionId);
  });
});
