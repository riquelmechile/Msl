import { describe, it, expect, vi, beforeEach } from "vitest";
import { visionAnalyst } from "./visionAnalyst.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeClaim(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    id: 1,
    messageId: "msg-vision-1",
    senderAgentId: "system",
    receiverAgentId: "product-recognition",
    messageType: "daemon-tick",
    payloadJson: JSON.stringify({
      imageUrl: "https://example.com/product.jpg",
      caption: "smartwatch",
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

describe("visionAnalyst", () => {
  beforeEach(() => {
    delete (process.env as Record<string, string | undefined>).SERPAPI_API_KEY;
  });

  describe("stub mode (no SERPAPI_API_KEY)", () => {
    it("returns stub recognition when no API key is set", async () => {
      const bus = makeBus();
      const result = await visionAnalyst({
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
      expect(finding.summary).toContain("GenericBrand");
      expect(finding.summary).toContain("Pro2024");

      // Verify enqueued message goes to product-research
      expect(bus.enqueued.length).toBe(1);
      const enqueued = bus.enqueued[0]!;
      expect(enqueued.receiverAgentId).toBe("product-research");
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const recognition = payload.recognition as Record<string, unknown>;
      expect(recognition.brand).toBe("GenericBrand");
      expect(recognition.model).toBe("Pro2024");
      expect(recognition.confidence).toBeGreaterThan(0.5);
    });

    it("uses caption in stub title when provided", async () => {
      const bus = makeBus();
      await visionAnalyst({
        claim: makeClaim({
          payloadJson: JSON.stringify({
            imageUrl: "https://example.com/photo.png",
            caption: "iPhone 15 Pro",
          }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const recognition = payload.recognition as Record<string, unknown>;
      expect(recognition.productTitle).toContain("iPhone 15 Pro");
    });
  });

  describe("low confidence handling", () => {
    it("enqueues CEO proposal requesting more photos when confidence < 0.5", async () => {
      // Set the env but mock fetch to return low-confidence data
      process.env.SERPAPI_API_KEY = "test-key";

      // Mock global fetch to return very few visual matches (low confidence)
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({
          visual_matches: [{ title: "Unknown Item", link: "https://example.com/1" }],
          knowledge_graph: {},
          search_information: {},
        }),
      }) as never;

      const bus = makeBus();
      const result = await visionAnalyst({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(bus.enqueued.length).toBe(1);
      const enqueued = bus.enqueued[0]!;
      expect(enqueued.receiverAgentId).toBe("ceo"); // low confidence → CEO
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      expect(payload.nextAction).toBe("request_more_photos");

      globalThis.fetch = originalFetch;
    });
  });

  describe("input validation", () => {
    it("returns alert for invalid JSON payload", async () => {
      const bus = makeBus();
      const result = await visionAnalyst({
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

    it("returns alert when imageUrl is missing", async () => {
      const bus = makeBus();
      const result = await visionAnalyst({
        claim: makeClaim({
          payloadJson: JSON.stringify({ caption: "no image" }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings.length).toBe(1);
      const f = result.findings[0]!;
      expect(f.summary).toContain("missing imageUrl");
    });
  });

  describe("success path (with API key mock)", () => {
    it("enqueues success message to product-research when confidence is high", async () => {
      process.env.SERPAPI_API_KEY = "test-key";

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({
          visual_matches: [
            { title: "Apple Watch Ultra 2", link: "https://example.com/1", source: "example.com" },
            {
              title: "Apple Watch Ultra 2 GPS",
              link: "https://example.com/2",
              source: "retailer.com",
            },
            { title: "Smart Watch Sale", link: "https://example.com/3", source: "shop.com" },
          ],
          knowledge_graph: {
            title: "Apple Watch Ultra 2",
            brand: "Apple",
            type: ["Wearable", "Smartwatch"],
            color: "Titanium",
          },
          search_information: {},
        }),
      }) as never;

      const bus = makeBus();
      const result = await visionAnalyst({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.messageIds.length).toBe(1);
      const enqueued = bus.enqueued[0]!;
      expect(enqueued.receiverAgentId).toBe("product-research");

      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const recognition = payload.recognition as Record<string, unknown>;
      expect(recognition.brand).toBe("Apple");
      expect(recognition.color).toBe("Titanium");
      expect(recognition.confidence).toBeGreaterThan(0.8);

      globalThis.fetch = originalFetch;
    });
  });
});
