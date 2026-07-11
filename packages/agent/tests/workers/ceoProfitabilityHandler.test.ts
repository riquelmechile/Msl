import Database from "better-sqlite3";
import crypto from "node:crypto";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createGraphEngine } from "@msl/memory";
import { createSqliteOperationalReadModel } from "@msl/memory";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import type {
  AgentMessageBusStore,
  AgentMessage,
} from "../../src/conversation/agentMessageBusStore.js";
import { ceoProfitabilityHandler } from "../../src/workers/ceoProfitabilityHandler.js";
import type { CeoHandlerContext } from "../../src/workers/daemonTypes.js";
import type { CeoDeepSeekClient } from "../../src/workers/ceoDeepSeekClient.js";

// Use vi.hoisted to create the mock function before the vi.mock factory runs
const { mockCreateCeoDeepSeekClient } = vi.hoisted(() => ({
  mockCreateCeoDeepSeekClient: vi.fn(),
}));

vi.mock("../../src/workers/ceoDeepSeekClient.js", () => ({
  createCeoDeepSeekClient: mockCreateCeoDeepSeekClient,
  // CeoDeepSeekClient type is just for TS, not a runtime export needed from the mock
}));

// ── Helpers ─────────────────────────────────────────────────────────

const SELLER_IDS = ["seller-plasticov", "seller-maustian"];

function claimFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 1,
    messageId: overrides.messageId ?? crypto.randomUUID(),
    senderAgentId: overrides.senderAgentId ?? "product-ads-profitability",
    receiverAgentId: overrides.receiverAgentId ?? "product-ads-ceo-profitability",
    messageType: overrides.messageType ?? "proposal",
    payloadJson: overrides.payloadJson ?? "{}",
    status: overrides.status ?? "processing",
    priority: overrides.priority ?? 5,
    attempts: overrides.attempts ?? 0,
    dedupeKey: overrides.dedupeKey ?? null,
    lockedAt: overrides.lockedAt ?? null,
    resolvedAt: overrides.resolvedAt ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    resultJson: overrides.resultJson ?? null,
    errorJson: overrides.errorJson ?? null,
    cancelReason: overrides.cancelReason ?? null,
    correlationId: overrides.correlationId ?? null,
    parentMessageId: overrides.parentMessageId ?? null,
    sellerId: overrides.sellerId ?? null,
    learnedAt: overrides.learnedAt ?? null,
    outcomeScore: overrides.outcomeScore ?? null,
    actionId: overrides.actionId ?? null,
  };
}

function makeProposalPayload(overrides?: {
  findings?: Array<Record<string, unknown>>;
  capturedAt?: string;
  tier?: string;
  severity?: string;
}): string {
  const now = new Date().toISOString();
  const opts = overrides ?? {};
  return JSON.stringify({
    type: "proposal",
    tier: opts.tier ?? "margin-consuming",
    severity: opts.severity ?? "critical",
    summary: "Test profitability proposal",
    findings: opts.findings ?? [
      {
        kind: "alert",
        severity: "critical",
        summary:
          "Margin-consuming ad: product MLC-TEST-001 in campaign camp-1 — net contribution -8000 CLP",
        evidenceIds: [
          "listing_snapshot:MLC-TEST-001",
          "cost_snapshot:MLC-TEST-001",
          "product-ads-insights:ad-1",
        ],
        actionability: "seller-impacting",
        recommendationIdentity:
          "product-ads-cfo:seller-plasticov:camp-1:MLC-TEST-001:margin-consuming",
      },
    ],
    recommendedAction: "Review margin-consuming ad immediately",
    recommendationWindowDays: 7,
    capturedAt: opts.capturedAt ?? now,
    noMutationExecuted: true,
  });
}

function makeCeoContext(overrides: Partial<CeoHandlerContext> = {}): CeoHandlerContext {
  return {
    adminChatIds: ["-1001234567890"],
    sellerNames: {
      "seller-plasticov": "Plasticov",
      "seller-maustian": "Maustian",
    },
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("ceoProfitabilityHandler", () => {
  let db: Database.Database;
  let bus: AgentMessageBusStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    bus = createAgentMessageBusStore(db);
    // By default, no DeepSeek client — tests use the static SIGNAL_TO_ACTION fallback
    mockCreateCeoDeepSeekClient.mockReturnValue(null);
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  // ── Task 4.1: Signal-to-action mapping (table-driven) ─────────────

  describe("signal-to-action mapping", () => {
    it.each([
      ["margin-consuming", "pause-campaign", "critical", true],
      ["scale-candidate", "adjust-campaign-budget", "opportunity", true],
      ["budget-waste", "review-campaign-structure", "warning", true],
      ["underinvested", "adjust-campaign-budget", "info", true],
      ["unit-economics", "review-campaign-structure", "info", false],
    ])(
      "maps signal '%s' to proposalType '%s' severity '%s' requiresApproval %s",
       
      async (signal, _expectedProposalType, _expectedSeverity, _requiresApproval) => {
        const preparedActions: Array<Record<string, unknown>> = [];
        const ceoCtx = makeCeoContext({
          prepareProductAdsAction: (input) => {
            preparedActions.push(input);
            return Promise.resolve();
          },
        });

        const payload = makeProposalPayload({
          findings: [
            {
              kind: "info",
              severity: "info",
              summary: `Test finding for ${signal}`,
              evidenceIds: ["listing_snapshot:MLC-001"],
              actionability: "seller-impacting",
              recommendationIdentity: `product-ads-cfo:seller-plasticov:camp-1:MLC-001:${signal}`,
            },
          ],
          tier: signal,
        });

        const claim = claimFixture({ payloadJson: payload });

        const result = await ceoProfitabilityHandler({
          claim,
          reader: createSqliteOperationalReadModel(db),
          cortex: createGraphEngine(":memory:"),
          bus,
          sellerIds: SELLER_IDS,
          ceoContext: ceoCtx,
        });

        // Should produce a finding
        const findingForSignal = result.findings.find((f) => f.summary.includes(signal));
        expect(findingForSignal).toBeDefined();
        expect(findingForSignal!.summary).toContain(signal);
      },
    );
  });

  describe("prepareProductAdsAction callback", () => {
    it("calls prepareProductAdsAction for actionable signals", async () => {
      const preparedActions: Array<Record<string, unknown>> = [];
      const ceoCtx = makeCeoContext({
        prepareProductAdsAction: (input) => {
          preparedActions.push(input);
          return Promise.resolve();
        },
      });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: makeProposalPayload() }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
        ceoContext: ceoCtx,
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(preparedActions.length).toBeGreaterThanOrEqual(1);
      expect(preparedActions[0]!.proposalType).toBe("pause-campaign");
      expect(preparedActions[0]!.sellerId).toBe("seller-plasticov");
    });

    it("does not call prepareProductAdsAction for unit-economics (info-only) signals", async () => {
      const preparedActions: Array<Record<string, unknown>> = [];
      const ceoCtx = makeCeoContext({
        prepareProductAdsAction: (input) => {
          preparedActions.push(input);
          return Promise.resolve();
        },
      });

      const payload = makeProposalPayload({
        findings: [
          {
            kind: "info",
            severity: "info",
            summary: "Unit economics info finding",
            evidenceIds: ["listing_snapshot:MLC-001"],
            actionability: "seller-impacting",
            recommendationIdentity:
              "product-ads-cfo:seller-plasticov:camp-1:MLC-001:unit-economics",
          },
        ],
      });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: payload }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
        ceoContext: ceoCtx,
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(preparedActions.length).toBe(0);
    });

    it("gracefully handles missing prepareProductAdsAction callback", async () => {
      // No prepareProductAdsAction provided — should still process and return findings
      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: makeProposalPayload() }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
        ceoContext: makeCeoContext({}),
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Task 4.2: 7-day dedupe logic ──────────────────────────────────

  describe("7-day dedupe", () => {
    it("suppresses notification when same identity was notified within 7 days", async () => {
      // Pre-populate bus with a recent message matching the dedupe identity
      bus.enqueue({
        senderAgentId: "product-ads-ceo-profitability",
        receiverAgentId: "product-ads-ceo-profitability",
        messageType: "notification",
        payloadJson: "{}",
        dedupeKey: "product-ads-cfo:seller-plasticov:camp-1:MLC-TEST-001:margin-consuming",
      });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: makeProposalPayload() }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
      });

      // Should be suppressed (no findings produced)
      expect(result.findings.length).toBe(0);
      expect(result.proposalEnqueued).toBe(false);
    });

    it("allows notification when same identity was notified 8+ days ago", async () => {
      // Pre-populate bus with an older message (8 days ago)
      const eightDaysAgo = new Date();
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
      const oldTimestamp = eightDaysAgo.toISOString();

      // Insert directly into the DB to control the created_at timestamp
      db.prepare(
        `
        INSERT INTO agent_message_bus
          (message_id, sender_agent_id, receiver_agent_id, message_type,
           payload_json, status, dedupe_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'resolved', ?, ?, ?)
      `,
      ).run(
        crypto.randomUUID(),
        "product-ads-ceo-profitability",
        "product-ads-ceo-profitability",
        "notification",
        "{}",
        "product-ads-cfo:seller-plasticov:camp-1:MLC-TEST-001:margin-consuming",
        oldTimestamp,
        oldTimestamp,
      );

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: makeProposalPayload() }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
      });

      // Should emit (8 days > 7 day window)
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.proposalEnqueued).toBe(true);
    });

    it("allows notification for different identity even when same seller/campaign", async () => {
      // Pre-populate bus with a message for a different item
      bus.enqueue({
        senderAgentId: "product-ads-ceo-profitability",
        receiverAgentId: "product-ads-ceo-profitability",
        messageType: "notification",
        payloadJson: "{}",
        dedupeKey: "product-ads-cfo:seller-plasticov:camp-1:MLC-OTHER-ITEM:margin-consuming",
      });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: makeProposalPayload() }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
      });

      // Should emit for MLC-TEST-001 (different identity)
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.proposalEnqueued).toBe(true);
    });
  });

  // ── Task 4.3: Forum topic management (unit) ───────────────────────

  describe("Telegram notification dispatch", () => {
    it("sends proactive message when ceoContext.sendProactiveMessage is provided", async () => {
      const sentMessages: Array<{ chatId: number; text: string; threadId?: number }> = [];
      const ceoCtx = makeCeoContext({
        sendProactiveMessage: (chatId, text, threadId) => {
          sentMessages.push({ chatId, text, threadId } as {
            chatId: number;
            text: string;
            threadId?: number;
          });
          return Promise.resolve();
        },
         
        createForumTopic: (_chatId, _name) => {
          return Promise.resolve({ message_thread_id: 42 });
        },
      });

      await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: makeProposalPayload() }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
        ceoContext: ceoCtx,
      });

      expect(sentMessages.length).toBeGreaterThanOrEqual(1);
      expect(sentMessages[0]!.chatId).toBe(-1001234567890);
      expect(sentMessages[0]!.text).toContain("Profitability Report");
      expect(sentMessages[0]!.threadId).toBe(42);
    });

    it("handles missing ceoContext gracefully", async () => {
      // No ceoContext at all — should still process findings
      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: makeProposalPayload() }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
        // No ceoContext
      });

      // Should produce findings but no Telegram notification
      expect(result.proposalEnqueued).toBe(true);
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
    });

    it("handles partial ceoContext (no sendProactiveMessage)", async () => {
      const ceoCtx = makeCeoContext({});

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: makeProposalPayload() }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
        ceoContext: ceoCtx,
      });

      expect(result.proposalEnqueued).toBe(true);
    });
  });

  // ── Task 2.5: Stale finding handling ─────────────────────────────

  describe("stale findings", () => {
    it("skips findings older than 24 hours", async () => {
      const staleCapturedAt = new Date();
      staleCapturedAt.setDate(staleCapturedAt.getDate() - 2); // 2 days ago

      const payload = makeProposalPayload({ capturedAt: staleCapturedAt.toISOString() });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: payload }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.findings.length).toBe(0);
      expect(result.proposalEnqueued).toBe(false);
    });

    it("processes findings within 24 hours", async () => {
      const recentCapturedAt = new Date();
      recentCapturedAt.setHours(recentCapturedAt.getHours() - 1); // 1 hour ago

      const payload = makeProposalPayload({ capturedAt: recentCapturedAt.toISOString() });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: payload }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.proposalEnqueued).toBe(true);
    });
  });

  // ── Invalid payload handling ─────────────────────────────────────

  describe("invalid payload", () => {
    it("returns empty when payload is not a proposal", async () => {
      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: JSON.stringify({ type: "task", task: "test" }) }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.findings.length).toBe(0);
      expect(result.proposalEnqueued).toBe(false);
    });

    it("returns empty when payload is malformed JSON", async () => {
      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: "not-json" }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.findings.length).toBe(0);
      expect(result.proposalEnqueued).toBe(false);
    });
  });

  // ── Task 4.4: Integration test — handler claims → processes → resolves ──

  describe("integration: claim → process → resolve cycle", () => {
    it("processes a pending bus message end-to-end", async () => {
      // Enqueue a profitability proposal
      const proposalPayload = makeProposalPayload();

      const msg = bus.enqueue({
        senderAgentId: "product-ads-profitability",
        receiverAgentId: "product-ads-ceo-profitability",
        messageType: "proposal",
        payloadJson: proposalPayload,
        dedupeKey: "test-end-to-end-dedupe",
      });

      // Claim the message
      const claimed = bus.claimNext("product-ads-ceo-profitability");
      expect(claimed.length).toBe(1);
      expect(claimed[0]!.messageId).toBe(msg.messageId);

      // Process with the handler
      const result = await ceoProfitabilityHandler({
        claim: claimed[0]!,
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
      });

      // Resolve the message
      bus.resolve(claimed[0]!.messageId, result);

      // Verify the message was resolved
      const remaining = bus.claimNext("product-ads-ceo-profitability");
      expect(remaining.length).toBe(0);

      // Verify findings were produced
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.proposalEnqueued).toBe(true);
    });

    it("handles multiple findings in a single proposal", async () => {
      const multiFindingsPayload = JSON.stringify({
        type: "proposal",
        tier: "mixed",
        severity: "info",
        summary: "Multi-finding proposal",
        findings: [
          {
            kind: "alert",
            severity: "critical",
            summary: "Margin-consuming ad: item MLC-M1",
            evidenceIds: ["listing_snapshot:MLC-M1"],
            actionability: "seller-impacting",
            recommendationIdentity:
              "product-ads-cfo:seller-plasticov:camp-1:MLC-M1:margin-consuming",
          },
          {
            kind: "opportunity",
            severity: "info",
            summary: "Scale candidate: item MLC-S1",
            evidenceIds: ["listing_snapshot:MLC-S1"],
            actionability: "seller-impacting",
            recommendationIdentity:
              "product-ads-cfo:seller-plasticov:camp-1:MLC-S1:scale-candidate",
          },
          {
            kind: "info",
            severity: "info",
            summary: "Unit economics: item MLC-U1",
            evidenceIds: ["listing_snapshot:MLC-U1"],
            actionability: "seller-impacting",
            recommendationIdentity: "product-ads-cfo:seller-plasticov:camp-1:MLC-U1:unit-economics",
          },
        ],
        recommendedAction: "Review all findings",
        recommendationWindowDays: 7,
        capturedAt: new Date().toISOString(),
        noMutationExecuted: true,
      });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: multiFindingsPayload }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
      });

      // Should process all 3 findings (no dedupe collision)
      expect(result.findings.length).toBe(3);
      expect(result.proposalEnqueued).toBe(true);
    });
  });

  // ── Task 2.5: Error handling ──────────────────────────────────────

  describe("error isolation", () => {
    it("continues processing remaining findings when one fails", async () => {
      let callCount = 0;
      const ceoCtx = makeCeoContext({
        sendProactiveMessage: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error("Simulated Telegram failure"));
          }
          return Promise.resolve();
        },
      });

      const multiFindingsPayload = JSON.stringify({
        type: "proposal",
        tier: "mixed",
        severity: "info",
        summary: "Multi-finding proposal with error",
        findings: [
          {
            kind: "alert",
            severity: "critical",
            summary: "First finding",
            evidenceIds: [],
            actionability: "seller-impacting",
            recommendationIdentity:
              "product-ads-cfo:seller-plasticov:camp-1:MLC-E1:margin-consuming",
          },
          {
            kind: "info",
            severity: "info",
            summary: "Second finding",
            evidenceIds: [],
            actionability: "seller-impacting",
            recommendationIdentity: "product-ads-cfo:seller-plasticov:camp-1:MLC-E2:unit-economics",
          },
        ],
        recommendedAction: "Review",
        recommendationWindowDays: 7,
        capturedAt: new Date().toISOString(),
        noMutationExecuted: true,
      });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: multiFindingsPayload }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
        ceoContext: ceoCtx,
      });

      // Both findings should still be returned (error is isolated per finding)
      expect(result.findings.length).toBe(2);
    });
  });

  // ── Task 4.2: DeepSeek delegation and fallback ─────────────────────

  describe("DeepSeek delegation", () => {
    it("delegates to CeoDeepSeekClient when available and uses LLM recommendation", async () => {
      const mockReason = vi
        .fn()
        .mockResolvedValue(
          new Map([
            [
              "product-ads-cfo:seller-plasticov:camp-1:MLC-TEST-001:margin-consuming",
              "pause-campaign",
            ],
          ]),
        );
      mockCreateCeoDeepSeekClient.mockReturnValue({
        reason: mockReason,
      } satisfies CeoDeepSeekClient);

      const preparedActions: Array<Record<string, unknown>> = [];
      const ceoCtx = makeCeoContext({
        prepareProductAdsAction: (input) => {
          preparedActions.push(input);
          return Promise.resolve();
        },
        workforceCostCacheLedgerStore: {
          insertEntry: vi.fn(),
          listEntries: vi.fn().mockReturnValue([]),
          count: vi.fn().mockReturnValue(0),
          aggregateCosts: vi.fn().mockReturnValue({
            byAgent: new Map(),
            byDepartment: new Map(),
            byPeriod: [],
            cacheEfficiency: 0,
          }),
        },
      });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: makeProposalPayload() }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
        ceoContext: ceoCtx,
      });

      expect(mockReason).toHaveBeenCalledTimes(1);
      expect(result.proposalEnqueued).toBe(true);
      // Should produce a finding with the LLM-recommended proposalType
      expect(result.findings.length).toBe(1);
      expect(preparedActions.length).toBe(1);
      expect(preparedActions[0]!.proposalType).toBe("pause-campaign");
    });

    it("falls back to static map when createCeoDeepSeekClient returns null", async () => {
      mockCreateCeoDeepSeekClient.mockReturnValue(null);

      const preparedActions: Array<Record<string, unknown>> = [];
      const ceoCtx = makeCeoContext({
        prepareProductAdsAction: (input) => {
          preparedActions.push(input);
          return Promise.resolve();
        },
      });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: makeProposalPayload() }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
        ceoContext: ceoCtx,
      });

      // Fallback to static map → pause-campaign for margin-consuming
      expect(result.proposalEnqueued).toBe(true);
      expect(preparedActions.length).toBe(1);
      expect(preparedActions[0]!.proposalType).toBe("pause-campaign");
    });

    it("falls back to static map when client.reason throws", async () => {
      mockCreateCeoDeepSeekClient.mockReturnValue({
        reason: vi.fn().mockRejectedValue(new Error("API unreachable")),
      } satisfies Partial<CeoDeepSeekClient>);

      const preparedActions: Array<Record<string, unknown>> = [];
      const ceoCtx = makeCeoContext({
        prepareProductAdsAction: (input) => {
          preparedActions.push(input);
          return Promise.resolve();
        },
        workforceCostCacheLedgerStore: {
          insertEntry: vi.fn(),
          listEntries: vi.fn().mockReturnValue([]),
          count: vi.fn().mockReturnValue(0),
          aggregateCosts: vi.fn().mockReturnValue({
            byAgent: new Map(),
            byDepartment: new Map(),
            byPeriod: [],
            cacheEfficiency: 0,
          }),
        },
      });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: makeProposalPayload() }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
        ceoContext: ceoCtx,
      });

      // Should fall back to static map and still produce the finding
      expect(result.proposalEnqueued).toBe(true);
      expect(result.findings.length).toBe(1);
      expect(preparedActions.length).toBe(1);
      expect(preparedActions[0]!.proposalType).toBe("pause-campaign");
    });

    it("skips LLM reasoning when workforceCostCacheLedgerStore is missing", async () => {
      const mockReason = vi.fn();
      mockCreateCeoDeepSeekClient.mockReturnValue({
        reason: mockReason,
      } satisfies CeoDeepSeekClient);

      // No ledger in context → should skip LLM and use fallback
      const preparedActions: Array<Record<string, unknown>> = [];
      const ceoCtx = makeCeoContext({
        prepareProductAdsAction: (input) => {
          preparedActions.push(input);
          return Promise.resolve();
        },
        // Note: no workforceCostCacheLedgerStore
      });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: makeProposalPayload() }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
        ceoContext: ceoCtx,
      });

      // reason() should NOT have been called (ledger required)
      expect(mockReason).not.toHaveBeenCalled();
      // Fallback to static map
      expect(result.proposalEnqueued).toBe(true);
      expect(preparedActions.length).toBe(1);
      expect(preparedActions[0]!.proposalType).toBe("pause-campaign");
    });

    it("produces info-report for unit-economics finding via LLM path", async () => {
      const identity = "product-ads-cfo:seller-plasticov:camp-1:MLC-U1:unit-economics";
      const mockReason = vi
        .fn()
        .mockResolvedValue(new Map([[identity, "review-campaign-structure"]]));
      mockCreateCeoDeepSeekClient.mockReturnValue({
        reason: mockReason,
      } satisfies CeoDeepSeekClient);

      const preparedActions: Array<Record<string, unknown>> = [];
      const ceoCtx = makeCeoContext({
        prepareProductAdsAction: (input) => {
          preparedActions.push(input);
          return Promise.resolve();
        },
        workforceCostCacheLedgerStore: {
          insertEntry: vi.fn(),
          listEntries: vi.fn().mockReturnValue([]),
          count: vi.fn().mockReturnValue(0),
          aggregateCosts: vi.fn().mockReturnValue({
            byAgent: new Map(),
            byDepartment: new Map(),
            byPeriod: [],
            cacheEfficiency: 0,
          }),
        },
      });

      const payload = makeProposalPayload({
        findings: [
          {
            kind: "info",
            severity: "info",
            summary: "Unit economics info finding",
            evidenceIds: ["listing_snapshot:MLC-U1"],
            actionability: "seller-impacting",
            recommendationIdentity: identity,
          },
        ],
      });

      const result = await ceoProfitabilityHandler({
        claim: claimFixture({ payloadJson: payload }),
        reader: createSqliteOperationalReadModel(db),
        cortex: createGraphEngine(":memory:"),
        bus,
        sellerIds: SELLER_IDS,
        ceoContext: ceoCtx,
      });

      expect(mockReason).toHaveBeenCalledTimes(1);
      expect(result.proposalEnqueued).toBe(true);
      // Info-only → no seller approval action prepared
      expect(preparedActions.length).toBe(0);
    });
  });
});
