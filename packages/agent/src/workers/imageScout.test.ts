import { describe, it, expect, vi, beforeEach } from "vitest";
import { imageScout } from "./imageScout.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeClaim(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    id: 1,
    messageId: "msg-scout-1",
    senderAgentId: "system",
    receiverAgentId: "creative-production",
    messageType: "daemon-tick",
    payloadJson: JSON.stringify({
      brand: "Apple",
      model: "Watch Ultra 2",
      searchTerms: ["smartwatch", "titanium"],
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
    enqueue: vi.fn((input: {
      senderAgentId: string;
      receiverAgentId: string;
      messageType: string;
      payloadJson: string;
      dedupeKey?: string;
    }) => {
      enqueued.push(input);
      return { messageId: `bus-msg-${enqueued.length}` };
    }),
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

describe("imageScout", () => {
  beforeEach(() => {
    delete (process.env as Record<string, string | undefined>).SERPAPI_API_KEY;
  });

  describe("stub mode (no SERPAPI_API_KEY)", () => {
    it("returns stub image URLs when no API key is set", async () => {
      const bus = makeBus();
      const result = await imageScout({
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
      expect(finding.summary).toContain("Apple");
      expect(finding.summary).toContain("Watch Ultra 2");

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const result_ = payload.imageScoutResult as Record<string, unknown>;
      const imageUrls = result_.imageUrls as Array<Record<string, unknown>>;
      expect(imageUrls.length).toBeGreaterThanOrEqual(1);
      expect(imageUrls[0]!.source).toBeDefined();
      expect(imageUrls[0]!.url).toContain("apple-watch-ultra-2");
    });

    it("returns multiple stub URLs from different sources", async () => {
      const bus = makeBus();
      await imageScout({
        claim: makeClaim({
          payloadJson: JSON.stringify({
            brand: "Sony",
            model: "WH-1000XM5",
            searchTerms: ["headphones", "noise-cancelling"],
          }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const result_ = payload.imageScoutResult as Record<string, unknown>;
      const imageUrls = result_.imageUrls as Array<Record<string, unknown>>;
      expect(imageUrls.length).toBe(4);
      const sources = imageUrls.map((u) => u.source);
      expect(sources).toContain("mercadolibre.com");
      expect(sources).toContain("amazon.com");
    });
  });

  describe("input validation", () => {
    it("returns alert for invalid JSON payload", async () => {
      const bus = makeBus();
      const result = await imageScout({
        claim: makeClaim({ payloadJson: "not-json" }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings.length).toBe(1);
      const finding = result.findings[0]!;
      expect(finding.severity).toBe("warning");
      expect(finding.summary).toContain("invalid payload");
    });

    it("returns alert when brand is missing", async () => {
      const bus = makeBus();
      const result = await imageScout({
        claim: makeClaim({
          payloadJson: JSON.stringify({ model: "Pro", searchTerms: ["test"] }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(false);
      const f = result.findings[0]!;
      expect(f.summary).toContain("missing brand or model");
    });

    it("returns alert when model is missing", async () => {
      const bus = makeBus();
      const result = await imageScout({
        claim: makeClaim({
          payloadJson: JSON.stringify({ brand: "Apple", searchTerms: ["test"] }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(false);
      const f = result.findings[0]!;
      expect(f.summary).toContain("missing brand or model");
    });
  });

  describe("real SerpApi mode (with SERPAPI_API_KEY)", () => {
    it("returns parsed results from SerpApi Google Lens", async () => {
      process.env.SERPAPI_API_KEY = "test-key";

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          visual_matches: [
            {
              thumbnail: "https://example.com/thumb1.jpg",
              original: "https://example.com/original1.jpg",
              source: "mercadolibre.com",
              original_width: 1200,
              original_height: 1200,
            },
            {
              thumbnail: "https://example.com/thumb2.jpg",
              link: "https://amazon.com/product2.jpg",
              source: "amazon.com",
              width: 800,
              height: 800,
            },
            {
              thumbnail: "https://example.com/thumb3.jpg",
              original: "https://example.com/original3.jpg",
              source: "retailer.com",
            },
          ],
        }),
      }) as never;

      const bus = makeBus();
      await imageScout({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const result_ = payload.imageScoutResult as Record<string, unknown>;
      const imageUrls = result_.imageUrls as Array<Record<string, unknown>>;
      expect(imageUrls.length).toBe(3);
      expect(imageUrls[0]!.width).toBe(1200);
      expect(imageUrls[0]!.height).toBe(1200);
      expect(imageUrls[1]!.width).toBe(800);
      expect(imageUrls[2]!.width).toBeUndefined();

      globalThis.fetch = originalFetch;
    });

    it("deduplicates results by URL", async () => {
      process.env.SERPAPI_API_KEY = "test-key";

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          visual_matches: [
            { original: "https://example.com/same.jpg", source: "site-a.com" },
            { original: "https://example.com/same.jpg", source: "site-b.com" },
            { original: "https://example.com/diff.jpg", source: "site-c.com" },
          ],
        }),
      }) as never;

      const bus = makeBus();
      await imageScout({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const result_ = payload.imageScoutResult as Record<string, unknown>;
      const imageUrls = result_.imageUrls as Array<Record<string, unknown>>;
      expect(imageUrls.length).toBe(2);

      globalThis.fetch = originalFetch;
    });

    it("returns alert on SerpApi failure (non-stub error)", async () => {
      process.env.SERPAPI_API_KEY = "test-key";

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused")) as never;

      const bus = makeBus();
      const result = await imageScout({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings[0]!.summary).toContain("Connection refused");

      globalThis.fetch = originalFetch;
    });
  });
});
