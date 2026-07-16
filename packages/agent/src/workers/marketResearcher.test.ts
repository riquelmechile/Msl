import { describe, it, expect, vi, beforeEach } from "vitest";
import { marketResearcher } from "./marketResearcher.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeClaim(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    id: 1,
    messageId: "msg-market-1",
    senderAgentId: "product-recognition",
    receiverAgentId: "product-research",
    messageType: "finding",
    payloadJson: JSON.stringify({
      brand: "Apple",
      model: "Watch Ultra 2",
      searchTerms: ["Apple Watch", "Ultra 2", "smartwatch", "titanium"],
      sellerId: "test-seller",
    }),
    status: "pending",
    priority: 0,
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
    sellerId: "test-seller",
    learnedAt: null,
    outcomeScore: null,
    actionId: null,
    ...overrides,
  };
}

function makeBus() {
  const enqueued: Array<{
    senderAgentId: string;
    receiverAgentId: string;
    messageType: string;
    payloadJson: string;
    dedupeKey?: string;
  }> = [];
  return {
    enqueue: vi.fn(
      (input: {
        senderAgentId: string;
        receiverAgentId: string;
        messageType: string;
        payloadJson: string;
        dedupeKey?: string;
      }) => {
        enqueued.push(input);
        return { messageId: `bus-msg-${enqueued.length}` };
      },
    ),
    enqueued,
    claimNext: vi.fn().mockReturnValue([]),
    resolve: vi.fn(),
    fail: vi.fn(),
    cancel: vi.fn(),
    lookupRecentByDedupePrefix: vi.fn().mockReturnValue([]),
    getFailedMessages: vi.fn().mockReturnValue([]),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("marketResearcher", () => {
  beforeEach(() => {
    delete (process.env as Record<string, string | undefined>).DEEPSEEK_API_KEY;
  });

  describe("stub mode (no DEEPSEEK_API_KEY)", () => {
    it("returns stub market research when no API key is set", async () => {
      const bus = makeBus();
      const result = await marketResearcher({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.findings.length).toBe(1);
      const finding = result.findings[0]!;
      expect(finding.kind).toBe("opportunity");
      expect(finding.summary).toContain("stub");
      expect(finding.summary).toContain("Apple");
      expect(finding.summary).toContain("Watch Ultra 2");

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const mr = payload.marketResearch as Record<string, unknown>;
      expect(mr.suggestedPrice).toBeGreaterThan(0);
      expect(Array.isArray(mr.competitorPrices)).toBe(true);
      const prices = mr.competitorPrices as Array<Record<string, unknown>>;
      expect(prices.length).toBe(3);
      expect(typeof mr.specs).toBe("string");
      expect(typeof mr.description).toBe("string");
    });

    it("enqueues results to CEO lane", async () => {
      const bus = makeBus();
      await marketResearcher({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(bus.enqueued.length).toBe(1);
      const enqueued = bus.enqueued[0]!;
      expect(enqueued.receiverAgentId).toBe("ceo");
      expect(enqueued.messageType).toBe("market-research");
    });
  });

  describe("input validation", () => {
    it("returns alert for invalid JSON payload", async () => {
      const bus = makeBus();
      const result = await marketResearcher({
        claim: makeClaim({ payloadJson: "not-json" }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings.length).toBe(1);
      expect(result.findings[0]!.severity).toBe("warning");
    });

    it("returns alert when brand is missing", async () => {
      const bus = makeBus();
      const result = await marketResearcher({
        claim: makeClaim({
          payloadJson: JSON.stringify({ model: "Test", searchTerms: [] }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings[0]!.summary).toContain("missing brand");
    });

    it("returns alert when model is missing", async () => {
      const bus = makeBus();
      const result = await marketResearcher({
        claim: makeClaim({
          payloadJson: JSON.stringify({ brand: "Test", searchTerms: [] }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings[0]!.summary).toContain("missing brand or model");
    });
  });

  describe("stub data shape", () => {
    it("returns competitor prices in CLP", async () => {
      const bus = makeBus();
      await marketResearcher({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const mr = payload.marketResearch as Record<string, unknown>;
      const prices = mr.competitorPrices as Array<Record<string, unknown>>;
      for (const price of prices) {
        expect(price.currency).toBe("CLP");
        expect(typeof price.price).toBe("number");
        expect(typeof price.source).toBe("string");
      }
    });
  });
});
