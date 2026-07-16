import { describe, it, expect, vi } from "vitest";
import { creativeProductionDaemon } from "./creativeProductionDaemon.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";

// ── Helpers ────────────────────────────────────────────────────────

function makeClaim(payload: Record<string, unknown>): AgentMessage {
  return {
    id: 1,
    messageId: "msg-cp-1",
    senderAgentId: "system",
    receiverAgentId: "creative-production",
    messageType: "daemon-tick",
    payloadJson: JSON.stringify(payload),
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
    sellerId: null,
    learnedAt: null,
    outcomeScore: null,
    actionId: null,
  };
}

function makeBus() {
  return {
    enqueue: vi.fn((input: Record<string, unknown>) => ({
      messageId: `bus-${Math.random().toString(36).slice(2)}`,
    })),
    claimNext: vi.fn().mockReturnValue([]),
    resolve: vi.fn(),
    fail: vi.fn(),
    cancel: vi.fn(),
    lookupRecentByDedupePrefix: vi.fn().mockReturnValue([]),
    getFailedMessages: vi.fn().mockReturnValue([]),
    reenqueueFailed: vi.fn(),
    getProcessingStuck: vi.fn().mockReturnValue([]),
    getPendingCount: vi.fn().mockReturnValue(0),
    getMessagesByCorrelationId: vi.fn().mockReturnValue([]),
    getLearningHistory: vi.fn().mockReturnValue([]),
    recordOutcome: vi.fn(),
    getUnscoredMessages: vi.fn().mockReturnValue([]),
  };
}

function makeBaseCtx(claim: AgentMessage) {
  const bus = makeBus();
  return {
    claim,
    reader: { searchSnapshots: vi.fn().mockResolvedValue([]), getSnapshot: vi.fn().mockResolvedValue(null), close: vi.fn() } as never,
    cortex: { createNode: vi.fn(), getNode: vi.fn(), getOrCreateNode: vi.fn(), createEdge: vi.fn(), reinforceEdge: vi.fn(), penalizeEdge: vi.fn(), ensureAccountAssetNode: vi.fn(), getNodesBySeller: vi.fn().mockReturnValue([]) } as never,
    bus: bus as never,
    sellerIds: ["test-seller"],
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("creativeProductionDaemon", () => {
  describe("routing — qualityDecision → studioArtist", () => {
    it("routes to studioArtist when payload has qualityDecision", async () => {
      const claim = makeClaim({
        qualityDecision: "REGENERATE",
        imageUrl: "https://example.com/photo.jpg",
        referenceUrls: ["https://example.com/ref1.jpg"],
        productContext: { title: "Test Product" },
      });
      const ctx = makeBaseCtx(claim);

      const result = await creativeProductionDaemon(ctx);

      // StudioArtist always returns findings (even in stub mode)
      expect(result.findings.length).toBeGreaterThan(0);
      // Should reference the quality decision in findings
      const hasQuality = result.findings.some(
        (f) => f.summary.includes("Studio Artist") || f.summary.includes("REGENERATE") || f.summary.includes("USE_AS_REFERENCE"),
      );
      expect(hasQuality).toBe(true);
    });

    it("handles USE_AS_REFERENCE decision (skips MiniMax)", async () => {
      const claim = makeClaim({
        qualityDecision: "USE_AS_REFERENCE",
        imageUrl: "https://example.com/photo.jpg",
        referenceUrls: [],
        productContext: { title: "Test Product" },
      });
      const ctx = makeBaseCtx(claim);

      const result = await creativeProductionDaemon(ctx);

      // Should have findings about skipping MiniMax
      const skipFinding = result.findings.find(
        (f) => f.summary.includes("USE_AS_REFERENCE") || f.summary.includes("skipping"),
      );
      expect(skipFinding).toBeDefined();
    });
  });

  describe("routing — brand + searchTerms → imageScout", () => {
    it("routes to imageScout when payload has brand and searchTerms", async () => {
      const claim = makeClaim({
        brand: "Nike",
        model: "Air Max",
        searchTerms: ["Nike", "Air Max", "sneakers"],
      });
      const ctx = makeBaseCtx(claim);

      const result = await creativeProductionDaemon(ctx);

      // ImageScout returns findings about image search
      const imageFindings = result.findings.filter(
        (f) => f.summary.includes("Image Scout"),
      );
      expect(imageFindings.length).toBeGreaterThan(0);
    });
  });

  describe("routing — default → photoDirector", () => {
    it("routes to photoDirector for unknown payload shape", async () => {
      const claim = makeClaim({
        imageUrl: "https://example.com/product.jpg",
        productContext: { title: "Some Product" },
      });
      const ctx = makeBaseCtx(claim);

      const result = await creativeProductionDaemon(ctx);

      // PhotoDirector always returns findings (stub analysis)
      const photoFindings = result.findings.filter(
        (f) => f.summary.includes("Photo Director"),
      );
      expect(photoFindings.length).toBeGreaterThan(0);
    });

    it("routes to photoDirector for empty payload", async () => {
      const claim = makeClaim({});
      const ctx = makeBaseCtx(claim);

      const result = await creativeProductionDaemon(ctx);

      // PhotoDirector will report missing imageUrl
      const alertFindings = result.findings.filter(
        (f) => f.kind === "alert",
      );
      expect(alertFindings.length).toBeGreaterThan(0);
    });

    it("routes to photoDirector for unparseable payload", async () => {
      const claim: AgentMessage = {
        id: 1,
        messageId: "msg-cp-bad",
        senderAgentId: "system",
        receiverAgentId: "creative-production",
        messageType: "daemon-tick",
        payloadJson: "not-valid-json",
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
        sellerId: null,
        learnedAt: null,
        outcomeScore: null,
        actionId: null,
      };
      const ctx = makeBaseCtx(claim);

      const result = await creativeProductionDaemon(ctx);

      // PhotoDirector will report invalid payload
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings[0]!.kind).toBe("alert");
    });
  });
});
