import { describe, it, expect, vi } from "vitest";
import type { DaemonHandler } from "./daemonTypes.js";
import { productLaunchCoordinator } from "./productLaunchCoordinator.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";

// ── Helpers ────────────────────────────────────────────────────────

function makeClaim(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    id: 1,
    messageId: "msg-coord-1",
    senderAgentId: "system",
    receiverAgentId: "product-launch",
    messageType: "launch_request",
    payloadJson: JSON.stringify({
      launchId: "launch-test-1",
      productId: "prod-test-1",
      sellerId: "test-seller",
      imageUrls: ["https://example.com/product.jpg"],
      caption: "smartwatch",
      chatId: 123456,
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

function makeClaimFromStage(
  stage: string,
  payloadOverrides?: Record<string, unknown>,
): AgentMessage {
  const basePayload = {
    launchId: "launch-test-1",
    sellerId: "test-seller",
    chatId: 123456,
    imageUrls: ["https://example.com/product.jpg"],
    ...payloadOverrides,
  };
  return makeClaim({
    messageId: `msg-coord-${stage}`,
    messageType: "finding",
    payloadJson: JSON.stringify({ ...basePayload, completedStage: stage }),
  });
}

function makeBus() {
  const enqueued: Array<{
    senderAgentId: string;
    receiverAgentId: string;
    messageType: string;
    payloadJson: string;
    dedupeKey?: string;
    correlationId?: string;
    sellerId?: string;
  }> = [];
  const b = {
    enqueue: vi.fn(
      (input: {
        senderAgentId: string;
        receiverAgentId: string;
        messageType: string;
        payloadJson: string;
        dedupeKey?: string;
        correlationId?: string;
        sellerId?: string;
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
    reenqueueFailed: vi.fn(),
    getProcessingStuck: vi.fn().mockReturnValue([]),
    getPendingCount: vi.fn().mockReturnValue(0),
    getMessagesByCorrelationId: vi.fn().mockReturnValue([]),
    getLearningHistory: vi.fn().mockReturnValue([]),
    recordOutcome: vi.fn(),
    getUnscoredMessages: vi.fn().mockReturnValue([]),
  };
  return b;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("productLaunchCoordinator", () => {
  describe("message parsing", () => {
    it("returns alert finding for invalid payload", async () => {
      const bus = makeBus();
      const result = await productLaunchCoordinator({
        claim: makeClaim({ payloadJson: "not-json" }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.kind).toBe("alert");
      expect(result.findings[0]!.severity).toBe("warning");
    });

    it("returns alert finding for missing launchId", async () => {
      const bus = makeBus();
      const result = await productLaunchCoordinator({
        claim: makeClaim({ payloadJson: JSON.stringify({ chatId: 123 }) }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.kind).toBe("alert");
    });
  });

  describe("pipeline routing — photo_received → recognizing", () => {
    it("delegates to product-recognition lane on launch_request", async () => {
      const bus = makeBus();
      const result = await productLaunchCoordinator({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const recognitionMsg = bus.enqueued.find(
        (m: { receiverAgentId: string }) => m.receiverAgentId === "product-recognition",
      );
      expect(recognitionMsg).toBeDefined();
      expect(recognitionMsg!.senderAgentId).toBe("product-launch");

      const progressMsg = bus.enqueued.find(
        (m: { receiverAgentId: string; messageType: string }) =>
          m.receiverAgentId === "ceo" && m.messageType === "progress",
      );
      expect(progressMsg).toBeDefined();

      expect(result.proposalEnqueued).toBe(true);
      expect(result.messageIds.length).toBeGreaterThan(0);
    });

    it("includes launch context in delegated payload", async () => {
      const bus = makeBus();
      await productLaunchCoordinator({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const recognitionMsg = bus.enqueued.find(
        (m: { receiverAgentId: string }) => m.receiverAgentId === "product-recognition",
      );
      expect(recognitionMsg).toBeDefined();
      const payload = JSON.parse(recognitionMsg!.payloadJson) as Record<string, unknown>;
      expect(payload.launchId).toBe("launch-test-1");
      expect(payload.imageUrl).toBe("https://example.com/product.jpg");
    });
  });

  describe("pipeline routing — recognizing → researching", () => {
    it("delegates to product-research lane with recognition results", async () => {
      const bus = makeBus();
      const claim = makeClaimFromStage("recognizing", {
        brand: "Nike",
        model: "Air Max",
        searchTerms: ["Nike", "Air Max"],
        completedStage: "recognizing",
      });

      await productLaunchCoordinator({
        claim,
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const researchMsg = bus.enqueued.find(
        (m: { receiverAgentId: string }) => m.receiverAgentId === "product-research",
      );
      expect(researchMsg).toBeDefined();
      const payload = JSON.parse(researchMsg!.payloadJson) as Record<string, unknown>;
      expect(payload.brand).toBe("Nike");
      expect(payload.model).toBe("Air Max");
    });
  });

  describe("pipeline routing — composing → awaiting_approval", () => {
    it("enqueues CEO proposal when composition completes", async () => {
      const bus = makeBus();
      const claim = makeClaimFromStage("composing", {
        brand: "Nike",
        model: "Air Max",
        listingTitle: "Zapatillas Nike Air Max 270",
        listingDescription: "Descripción del producto...",
        suggestedPrice: 89000,
        completedStage: "composing",
      });

      const result = await productLaunchCoordinator({
        claim,
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const ceoProposal = bus.enqueued.find(
        (m: { receiverAgentId: string; messageType: string }) =>
          m.receiverAgentId === "ceo" && m.messageType === "proposal",
      );
      expect(ceoProposal).toBeDefined();
      const payload = JSON.parse(ceoProposal!.payloadJson) as Record<string, unknown>;
      expect(payload.launchId).toBe("launch-test-1");
      expect(payload.title).toContain("Nike Air Max");
      expect(payload.stage).toBe("awaiting_approval");
      expect(payload.noMutationExecuted).toBe(true);

      expect(result.proposalEnqueued).toBe(true);
    });
  });

  describe("pipeline routing — approved → ready_to_publish", () => {
    it("processes approval and sends completion message", async () => {
      const bus = makeBus();
      const claim = makeClaim({
        messageType: "launch_approved",
        payloadJson: JSON.stringify({
          launchId: "launch-test-1",
          sellerId: "test-seller",
          chatId: 123456,
          brand: "Nike",
          model: "Air Max",
          listingTitle: "Zapatillas Nike Air Max 270",
          notes: "Approved by CEO",
        }),
      });

      const result = await productLaunchCoordinator({
        claim,
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const progressMsg = bus.enqueued.find(
        (m: { receiverAgentId: string; messageType: string }) =>
          m.receiverAgentId === "ceo" && m.messageType === "progress",
      );
      expect(progressMsg).toBeDefined();
      const payload = JSON.parse(progressMsg!.payloadJson) as Record<string, unknown>;
      expect(payload.text).toContain("aprobada");
      expect(result.proposalEnqueued).toBe(true);
    });
  });

  describe("Telegram progress messages", () => {
    it("sends progress via Telegram when ceoContext is provided", async () => {
      const bus = makeBus();
      const sendProactiveMessage = vi.fn().mockResolvedValue(undefined);
      const ceoContext = { sendProactiveMessage };

      await productLaunchCoordinator({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
        ceoContext,
      });

      expect(sendProactiveMessage).toHaveBeenCalledWith(
        123456,
        expect.stringContaining("Iniciando identificación"),
      );
    });

    it("handles Telegram failure gracefully", async () => {
      const bus = makeBus();
      const sendProactiveMessage = vi.fn().mockRejectedValue(new Error("Telegram down"));
      const ceoContext = { sendProactiveMessage };

      const result = await productLaunchCoordinator({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
        ceoContext,
      });

      expect(result.proposalEnqueued).toBe(true);
    });
  });

  describe("deduplication", () => {
    it("uses consistent dedupe keys for same stage+launch", async () => {
      const bus = makeBus();
      await productLaunchCoordinator({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      const recognitionMsg = bus.enqueued.find(
        (m: { receiverAgentId: string; dedupeKey?: string }) =>
          m.receiverAgentId === "product-recognition",
      );
      expect(recognitionMsg?.dedupeKey).toContain("coord-recognize");
      expect(recognitionMsg?.dedupeKey).toContain("launch-test-1");
    });
  });

  describe("cost tracking", () => {
    it("records Google Lens cost on photo_received stage", async () => {
      const bus = makeBus();
      // First call starts tracking
      await productLaunchCoordinator({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      // Second call accumulates
      const bus2 = makeBus();
      const result = await productLaunchCoordinator({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus2 as never,
        sellerIds: ["test-seller"],
      });

      const anyMention = result.findings.some(
        (f) => f.summary.includes("cost") || f.summary.includes("USD"),
      );
      expect(anyMention).toBe(true);
    });
  });
});
