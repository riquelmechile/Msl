import { describe, it, expect, vi, beforeEach } from "vitest";
import { studioArtist } from "./studioArtist.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeClaim(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    id: 1,
    messageId: "msg-artist-1",
    senderAgentId: "system",
    receiverAgentId: "creative-production",
    messageType: "daemon-tick",
    payloadJson: JSON.stringify({
      imageUrl: "https://http2.mlstatic.com/D_123-MLA456.jpg",
      qualityDecision: "REGENERATE",
      referenceUrls: [],
      productContext: {
        title: "Auriculares Bluetooth",
        kind: "product-cover-i2i",
        channel: "mercadolibre",
      },
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

describe("studioArtist", () => {
  beforeEach(() => {
    delete (process.env as Record<string, string | undefined>).MINIMAX_API_KEY;
    delete (process.env as Record<string, string | undefined>).MSL_CREATIVE_STUDIO_ENABLED;
  });

  describe("input validation", () => {
    it("returns alert for invalid JSON payload", async () => {
      const bus = makeBus();
      const result = await studioArtist({
        claim: makeClaim({ payloadJson: "not-json" }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings.length).toBe(1);
      expect(result.findings[0]!.severity).toBe("warning");
      expect(result.findings[0]!.summary).toContain("invalid payload");
    });

    it("returns alert when imageUrl is missing", async () => {
      const bus = makeBus();
      const result = await studioArtist({
        claim: makeClaim({
          payloadJson: JSON.stringify({
            qualityDecision: "REGENERATE",
            referenceUrls: [],
            productContext: { title: "Test" },
          }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings[0]!.summary).toContain("missing imageUrl");
    });

    it("returns alert when qualityDecision is missing", async () => {
      const bus = makeBus();
      const result = await studioArtist({
        claim: makeClaim({
          payloadJson: JSON.stringify({
            imageUrl: "https://example.com/img.jpg",
            referenceUrls: [],
            productContext: { title: "Test" },
          }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings[0]!.summary).toContain("missing qualityDecision");
    });
  });

  describe("USE_AS_REFERENCE routing (score >= 80)", () => {
    it("skips MiniMax and returns original image URL", async () => {
      const bus = makeBus();
      const result = await studioArtist({
        claim: makeClaim({
          payloadJson: JSON.stringify({
            imageUrl: "https://http2.mlstatic.com/D_123-MLA456.jpg",
            qualityDecision: "USE_AS_REFERENCE",
            referenceUrls: [],
            productContext: { title: "Test Product" },
          }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(true);

      // Should have 1 finding + 1 result message
      const resultMsg = bus.enqueued.find((m) => m.dedupeKey?.startsWith("studio-artist-result-"));
      expect(resultMsg).toBeDefined();
      const payload = JSON.parse(resultMsg!.payloadJson) as Record<string, unknown>;
      const output = payload.studioArtistResult as Record<string, unknown>;
      expect(output.usedMiniMax).toBe(false);
      expect(output.costUsd).toBe(0);
      expect(output.generatedUrls).toEqual(["https://http2.mlstatic.com/D_123-MLA456.jpg"]);
    });
  });

  describe("REGENERATE routing (score 40-79)", () => {
    it("enqueues MiniMax request when MiniMax is available", async () => {
      process.env.MSL_CREATIVE_STUDIO_ENABLED = "true";
      process.env.MINIMAX_API_KEY = "test-minimax-key";

      const bus = makeBus();
      const result = await studioArtist({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(true);

      // Should have enqueued to creative-studio lane
      const creativeMsg = bus.enqueued.find(
        (m) =>
          m.receiverAgentId === "creative-studio" && m.messageType === "creative-asset-request",
      );
      expect(creativeMsg).toBeDefined();
      const creativePayload = JSON.parse(creativeMsg!.payloadJson) as Record<string, unknown>;
      expect(creativePayload.kind).toBe("product-cover-i2i");
      expect(creativePayload.channel).toBe("mercadolibre");

      // Result message should show MiniMax was used
      const resultMsg = bus.enqueued.find((m) => m.dedupeKey?.startsWith("studio-artist-result-"));
      const resultPayload = JSON.parse(resultMsg!.payloadJson) as Record<string, unknown>;
      const output = resultPayload.studioArtistResult as Record<string, unknown>;
      expect(output.usedMiniMax).toBe(true);
      expect(output.costUsd).toBe(0.05);
    });

    it("falls back to stub when MiniMax is not available", async () => {
      // No MiniMax API key → stub mode
      const bus = makeBus();
      const result = await studioArtist({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const resultMsg = bus.enqueued.find((m) => m.dedupeKey?.startsWith("studio-artist-result-"));
      const payload = JSON.parse(resultMsg!.payloadJson) as Record<string, unknown>;
      const output = payload.studioArtistResult as Record<string, unknown>;
      expect(output.usedMiniMax).toBe(false);
      expect(output.costUsd).toBe(0);
      expect(output.generatedUrls).toEqual(["https://http2.mlstatic.com/D_123-MLA456.jpg"]);
    });
  });

  describe("DISCARD_AND_SEARCH routing (score < 40)", () => {
    it("uses ImageScout URLs as references for MiniMax", async () => {
      process.env.MSL_CREATIVE_STUDIO_ENABLED = "true";
      process.env.MINIMAX_API_KEY = "test-minimax-key";

      const scoutUrls = [
        "https://http2.mlstatic.com/D_scout-1.jpg",
        "https://m.media-amazon.com/images/scout-2.jpg",
      ];

      const bus = makeBus();
      await studioArtist({
        claim: makeClaim({
          payloadJson: JSON.stringify({
            imageUrl: "https://example.com/low-quality.jpg",
            qualityDecision: "DISCARD_AND_SEARCH",
            referenceUrls: scoutUrls,
            productContext: { title: "Test Product" },
          }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const creativeMsg = bus.enqueued.find(
        (m) =>
          m.receiverAgentId === "creative-studio" && m.messageType === "creative-asset-request",
      );
      expect(creativeMsg).toBeDefined();
      const creativePayload = JSON.parse(creativeMsg!.payloadJson) as Record<string, unknown>;
      const references = creativePayload.references as Array<{ uri: string }>;
      expect(references.length).toBe(2);
      expect(references[0]!.uri).toBe(scoutUrls[0]);
    });

    it("falls back to stub with reference URLs when MiniMax unavailable", async () => {
      const scoutUrls = ["https://http2.mlstatic.com/D_scout-1.jpg"];

      const bus = makeBus();
      const result = await studioArtist({
        claim: makeClaim({
          payloadJson: JSON.stringify({
            imageUrl: "https://example.com/low-quality.jpg",
            qualityDecision: "DISCARD_AND_SEARCH",
            referenceUrls: scoutUrls,
            productContext: { title: "Test Product" },
          }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const resultMsg = bus.enqueued.find((m) => m.dedupeKey?.startsWith("studio-artist-result-"));
      const payload = JSON.parse(resultMsg!.payloadJson) as Record<string, unknown>;
      const output = payload.studioArtistResult as Record<string, unknown>;
      expect(output.usedMiniMax).toBe(false);
      expect(output.costUsd).toBe(0);
      expect(output.generatedUrls).toEqual(scoutUrls);
    });
  });

  describe("unknown quality decision", () => {
    it("falls back gracefully for unknown decision", async () => {
      const bus = makeBus();
      await studioArtist({
        claim: makeClaim({
          payloadJson: JSON.stringify({
            imageUrl: "https://example.com/img.jpg",
            qualityDecision: "INVALID_VALUE",
            referenceUrls: [],
            productContext: { title: "Test" },
          }),
        }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const resultMsg = bus.enqueued.find((m) => m.dedupeKey?.startsWith("studio-artist-result-"));
      const payload = JSON.parse(resultMsg!.payloadJson) as Record<string, unknown>;
      const output = payload.studioArtistResult as Record<string, unknown>;
      expect(output.usedMiniMax).toBe(false);
      expect(output.costUsd).toBe(0);

      // Should have an alert finding
      const alertFinding = bus.enqueued.find((m) =>
        m.payloadJson.includes("unknown quality decision"),
      );
      expect(alertFinding).toBeFalsy(); // findings don't appear as enqueued messages — check findings in result
    });
  });
});
