import { describe, it, expect, vi } from "vitest";
import { copywriter } from "./copywriter.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeClaim(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    id: 1,
    messageId: "msg-copy-1",
    senderAgentId: "product-research",
    receiverAgentId: "listing-composition",
    messageType: "finding",
    payloadJson: JSON.stringify({
      sellerId: "plasticov",
      brand: "Apple",
      model: "Watch Ultra 2",
      specs: "49mm Titanium Case, GPS + Cellular, 36h battery, IP6X, WR100",
      category: "Smartwatches",
      competitorPrices: [
        { source: "MercadoLibre", price: 649990 },
        { source: "Falabella", price: 699990 },
      ],
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
    sellerId: "plasticov",
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

describe("copywriter", () => {
  describe("stub mode (no DeepSeek API key)", () => {
    it("generates placeholder copy for Plasticov (mid-market/value tone)", async () => {
      const bus = makeBus();
      const result = await copywriter({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.findings.length).toBe(1);

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const listingCopy = payload.listingCopy as Record<string, unknown>;
      expect(listingCopy.accountTone).toBe("mid-market/value");
      expect(listingCopy.title).toBeDefined();
      expect(listingCopy.description).toBeDefined();
      expect(result.findings[0]!.summary).toContain("Mid-Market/Value");
    });

    it("generates placeholder copy for Maustian (premium/professional tone)", async () => {
      const bus = makeBus();
      const claim = makeClaim({
        payloadJson: JSON.stringify({
          sellerId: "maustian",
          brand: "Samsung",
          model: "Galaxy Watch 7",
          specs: "44mm, Super AMOLED, BioActive Sensor, 5ATM + IP68",
          category: "Smartwatches",
          competitorPrices: [{ source: "MercadoLibre", price: 399990 }],
        }),
        sellerId: "maustian",
      });

      const result = await copywriter({
        claim,
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["maustian"],
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const listingCopy = payload.listingCopy as Record<string, unknown>;
      expect(listingCopy.accountTone).toBe("premium/professional");
      expect(result.findings[0]!.summary).toContain("Premium/Professional");
    });

    it("defaults to mid-market/value tone for non-Plasticov/non-Maustian sellers", async () => {
      const bus = makeBus();
      const claim = makeClaim({
        payloadJson: JSON.stringify({
          sellerId: "unknown-seller",
          brand: "Xiaomi",
          model: "Band 8",
          specs: "1.62 AMOLED, 16 days battery",
          category: "Wearables",
          competitorPrices: [],
        }),
        sellerId: "unknown-seller",
      });

      const result = await copywriter({
        claim,
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["unknown-seller"],
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const listingCopy = payload.listingCopy as Record<string, unknown>;
      expect(listingCopy.accountTone).toBe("mid-market/value");
    });
  });

  describe("input validation", () => {
    it("returns alert for invalid JSON payload", async () => {
      const bus = makeBus();
      const result = await copywriter({
        claim: makeClaim({ payloadJson: "not-json" }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings.length).toBe(1);
      expect(result.findings[0]!.summary).toContain("invalid payload");
    });

    it("returns alert for missing brand", async () => {
      const bus = makeBus();
      const claim = makeClaim({
        payloadJson: JSON.stringify({
          sellerId: "plasticov",
          brand: "",
          model: "",
          specs: "",
          category: "",
          competitorPrices: [],
        }),
      });

      const result = await copywriter({
        claim,
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings[0]!.summary).toContain("missing");
    });
  });

  describe("title length enforcement", () => {
    it("truncates titles exceeding 60 characters in stub mode", async () => {
      const bus = makeBus();
      const claim = makeClaim({
        payloadJson: JSON.stringify({
          sellerId: "plasticov",
          brand: "Apple",
          model: "Watch Ultra 2 with Titanium Case and Alpine Loop Band Special Edition 2024",
          specs: "49mm",
          category: "Smartwatches",
          competitorPrices: [],
        }),
      });

      await copywriter({
        claim,
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const listingCopy = payload.listingCopy as Record<string, unknown>;
      expect(typeof listingCopy.title).toBe("string");
      expect((listingCopy.title as string).length).toBeLessThanOrEqual(60);
    });
  });
});
