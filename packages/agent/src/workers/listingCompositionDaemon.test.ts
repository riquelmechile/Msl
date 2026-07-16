import { describe, it, expect, vi } from "vitest";
import { listingCompositionDaemon } from "./listingCompositionDaemon.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";

// ── Helpers ────────────────────────────────────────────────────────

function makeClaim(payload: Record<string, unknown>): AgentMessage {
  return {
    id: 1,
    messageId: "msg-lc-1",
    senderAgentId: "system",
    receiverAgentId: "listing-composition",
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
    reader: {
      searchSnapshots: vi.fn().mockResolvedValue([]),
      getSnapshot: vi.fn().mockResolvedValue(null),
      close: vi.fn(),
    } as never,
    cortex: {
      createNode: vi.fn(),
      getNode: vi.fn(),
      getOrCreateNode: vi.fn(),
      createEdge: vi.fn(),
      reinforceEdge: vi.fn(),
      penalizeEdge: vi.fn(),
      ensureAccountAssetNode: vi.fn(),
      getNodesBySeller: vi.fn().mockReturnValue([]),
    } as never,
    bus: bus as never,
    sellerIds: ["test-seller"],
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("listingCompositionDaemon", () => {
  describe("routing — sellerId + specs → copywriter", () => {
    it("routes to copywriter when payload has sellerId and specs", async () => {
      const claim = makeClaim({
        sellerId: "plasticov",
        brand: "Nike",
        model: "Air Max",
        specs: "Talle 42, color negro, material sintético",
        category: "Calzado",
        competitorPrices: [],
      });
      const ctx = makeBaseCtx(claim);

      const result = await listingCompositionDaemon(ctx);

      // Copywriter returns findings with listing copy
      const copyFindings = result.findings.filter((f) => f.summary.includes("Copywriter"));
      expect(copyFindings.length).toBeGreaterThan(0);
    });

    it("routes to copywriter for Plasticov seller (mid-market tone)", async () => {
      const claim = makeClaim({
        sellerId: "plasticov",
        brand: "GenericBrand",
        model: "Pro2024",
        specs: "Basic specs here",
        category: "Electrónica",
        competitorPrices: [{ source: "competitor-1", price: 50000 }],
      });
      const ctx = makeBaseCtx(claim);

      const result = await listingCompositionDaemon(ctx);

      // Should return findings (stub copy)
      expect(result.findings.length).toBeGreaterThan(0);
      const hasCopy = result.findings.some((f) => f.summary.includes("Copywriter"));
      expect(hasCopy).toBe(true);
    });
  });

  describe("routing — categoryId → specTechnician", () => {
    it("routes to specTechnician when payload has categoryId", async () => {
      const claim = makeClaim({
        categoryId: "MLC12345",
        brand: "Nike",
        model: "Air Max",
        color: "negro",
        sellerId: "plasticov",
      });
      const ctx = makeBaseCtx(claim);

      const result = await listingCompositionDaemon(ctx);

      // SpecTechnician returns findings (stub mode when no mlcClient)
      const specFindings = result.findings.filter((f) => f.summary.includes("Spec Technician"));
      expect(specFindings.length).toBeGreaterThan(0);
    });
  });

  describe("routing — title + images → qualityInspector", () => {
    it("routes to qualityInspector when payload has title and images array", async () => {
      const claim = makeClaim({
        title: "Zapatillas Nike Air Max 270",
        images: [
          { url: "https://example.com/img1.jpg" },
          { url: "https://example.com/img2.jpg" },
          { url: "https://example.com/img3.jpg" },
        ],
        attributesJson: JSON.stringify({ brand: "Nike", model: "Air Max" }),
        gtin: "1234567890123",
        hasFreeShipping: true,
      });
      const ctx = makeBaseCtx(claim);

      const result = await listingCompositionDaemon(ctx);

      // QualityInspector returns findings
      const qualityFindings = result.findings.filter((f) =>
        f.summary.includes("Quality Inspector"),
      );
      expect(qualityFindings.length).toBeGreaterThan(0);
    });
  });

  describe("routing — default → copywriter", () => {
    it("routes to copywriter for unknown payload shape", async () => {
      const claim = makeClaim({
        sellerId: "maustian",
        brand: "PremiumBrand",
        model: "Elite",
      });
      const ctx = makeBaseCtx(claim);

      const result = await listingCompositionDaemon(ctx);

      // Copywriter will report missing specs but still generate content
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it("routes to copywriter for unparseable payload", async () => {
      const claim: AgentMessage = {
        id: 1,
        messageId: "msg-lc-bad",
        senderAgentId: "system",
        receiverAgentId: "listing-composition",
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

      const result = await listingCompositionDaemon(ctx);

      // Copywriter will report invalid payload
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings[0]!.kind).toBe("alert");
    });
  });
});
