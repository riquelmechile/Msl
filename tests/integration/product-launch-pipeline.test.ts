/**
 * Integration test: Full Product Launch pipeline with in-memory SQLite and stub transports.
 *
 * Tests the coordinator-driven pipeline from photo_received through ready_to_publish,
 * validating each stage transition and the final store state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createProductCatalogStore, createAgentMessageBusStore } from "@msl/agent";
import type { ProductCatalogStore, AgentMessageBusStore, AgentMessage } from "@msl/agent";
import { productLaunchCoordinator } from "../../packages/agent/src/workers/productLaunchCoordinator.js";
import type { DaemonHandler } from "../../packages/agent/src/workers/daemonTypes.js";

// ── Helpers ────────────────────────────────────────────────────────

type EnqueuedEntry = {
  senderAgentId: string;
  receiverAgentId: string;
  messageType: string;
  payloadJson: string;
  dedupeKey?: string;
  correlationId?: string;
  sellerId?: string;
};

function makeBus(): AgentMessageBusStore & { enqueued: EnqueuedEntry[] } {
  const enqueued: EnqueuedEntry[] = [];
  let nextMsgId = 0;

  return {
    enqueued,
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
        nextMsgId++;
        enqueued.push(input);
        return { messageId: `bus-msg-${nextMsgId}` };
      },
    ),
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
  } as unknown as AgentMessageBusStore & { enqueued: EnqueuedEntry[] };
}

function makeClaim(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    id: 1,
    messageId: "msg-1",
    senderAgentId: "system",
    receiverAgentId: "product-launch",
    messageType: "launch_request",
    payloadJson: JSON.stringify({
      launchId: "launch-int-1",
      productId: "prod-int-1",
      sellerId: "seller-int-1",
      imageUrls: ["file:///tmp/test-product.jpg"],
      caption: "Zapatillas Deportivas",
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
    correlationId: "launch-int-1",
    parentMessageId: null,
    sellerId: "seller-int-1",
    learnedAt: null,
    outcomeScore: null,
    actionId: null,
    ...overrides,
  };
}

function makeStageClaim(stage: string, payloadOverrides?: Record<string, unknown>): AgentMessage {
  const basePayload = {
    launchId: "launch-int-1",
    sellerId: "seller-int-1",
    chatId: 123456,
    imageUrls: ["file:///tmp/test-product.jpg"],
    completedStage: stage,
    ...payloadOverrides,
  };
  return makeClaim({
    messageId: `msg-stage-${stage}`,
    messageType: "finding",
    payloadJson: JSON.stringify(basePayload),
  });
}

// ── Tests ──────────────────────────────────────────────────────────

describe("product launch pipeline (integration)", () => {
  let db: Database.Database;
  let store: ProductCatalogStore;
  let bus: ReturnType<typeof makeBus>;

  function runCoordinator(claim: AgentMessage) {
    return productLaunchCoordinator({
      claim,
      reader: {} as never,
      cortex: {} as never,
      bus: bus as never,
      sellerIds: ["seller-int-1"],
    });
  }

  beforeEach(() => {
    db = new Database(":memory:");
    store = createProductCatalogStore(db);
    bus = makeBus();

    // Seed initial catalog entry via the real store
    store.upsertProduct({ productId: "prod-int-1" });
    store.createLaunch({
      launchId: "launch-int-1",
      productId: "prod-int-1",
      sellerId: "seller-int-1",
      status: "photo_received",
      title: "Zapatillas Deportivas",
      createdAt: new Date().toISOString(),
    });
  });

  describe("full pipeline (photo_received → ready_to_publish)", () => {
    it("completes the full pipeline with stub transports", async () => {
      // ── Stage 1: photo_received → recognizing ──────────────
      const result1 = await runCoordinator(makeClaim());
      expect(result1.proposalEnqueued).toBe(true);

      // Should delegate to product-recognition lane
      const recognitionMsg = bus.enqueued.find((m) => m.receiverAgentId === "product-recognition");
      expect(recognitionMsg).toBeDefined();
      expect(recognitionMsg!.senderAgentId).toBe("product-launch");

      // Update store state
      store.updateLaunchStatus("launch-int-1", "recognizing");

      // ── Stage 2: recognizing → researching (stub results) ─
      bus.enqueued.length = 0; // Clear previous enqueued
      const result2 = await runCoordinator(
        makeStageClaim("recognizing", {
          brand: "Nike",
          model: "Air Max Plus",
          searchTerms: ["Nike", "Air Max", "Zapatillas"],
          completedStage: "recognizing",
        }),
      );
      expect(result2.proposalEnqueued).toBe(true);

      // Should delegate to product-research lane
      const researchMsg = bus.enqueued.find((m) => m.receiverAgentId === "product-research");
      expect(researchMsg).toBeDefined();
      expect(JSON.parse(researchMsg!.payloadJson)).toMatchObject({
        brand: "Nike",
        model: "Air Max Plus",
        stage: "researching",
      });

      store.updateLaunchStatus("launch-int-1", "researching");

      // ── Stage 3: researching → generating_creative ─────────
      bus.enqueued.length = 0;
      const result3 = await runCoordinator(
        makeStageClaim("researching", {
          brand: "Nike",
          model: "Air Max Plus",
          specs: "Talle 42, color negro, puntera reforzada",
          suggestedPrice: 89000,
          completedStage: "researching",
        }),
      );
      expect(result3.proposalEnqueued).toBe(true);

      // Should delegate to creative-production lane
      const creativeMsg = bus.enqueued.find((m) => m.receiverAgentId === "creative-production");
      expect(creativeMsg).toBeDefined();
      expect(JSON.parse(creativeMsg!.payloadJson)).toMatchObject({
        stage: "generating_creative",
      });

      store.updateLaunchStatus("launch-int-1", "generating_creative");

      // ── Stage 4: generating_creative → composing ──────────
      bus.enqueued.length = 0;
      const result4 = await runCoordinator(
        makeStageClaim("generating_creative", {
          brand: "Nike",
          model: "Air Max Plus",
          qualityScore: 65,
          images: ["https://minimax.example.com/generated-1.jpg"],
          completedStage: "generating_creative",
        }),
      );
      expect(result4.proposalEnqueued).toBe(true);

      // Should delegate to listing-composition lane
      const composeMsg = bus.enqueued.find((m) => m.receiverAgentId === "listing-composition");
      expect(composeMsg).toBeDefined();
      expect(JSON.parse(composeMsg!.payloadJson)).toMatchObject({
        stage: "composing",
      });

      store.updateLaunchStatus("launch-int-1", "composing");

      // ── Stage 5: composing → awaiting_approval ────────────
      bus.enqueued.length = 0;
      const result5 = await runCoordinator(
        makeStageClaim("composing", {
          brand: "Nike",
          model: "Air Max Plus",
          listingTitle: "Zapatillas Nike Air Max Plus - Negro",
          listingDescription: "Zapatillas deportivas en excelente estado",
          suggestedPrice: 89000,
          qualityScore: 78,
          completedStage: "composing",
        }),
      );
      expect(result5.proposalEnqueued).toBe(true);

      // Should enqueue to CEO for approval
      const ceoProposal = bus.enqueued.find(
        (m) => m.receiverAgentId === "ceo" && m.messageType === "proposal",
      );
      expect(ceoProposal).toBeDefined();
      const proposalPayload = JSON.parse(ceoProposal!.payloadJson) as Record<string, unknown>;
      expect(proposalPayload.launchId).toBe("launch-int-1");
      expect(proposalPayload.title).toContain("Nike Air Max");
      expect(proposalPayload.stage).toBe("awaiting_approval");
      expect(proposalPayload.noMutationExecuted).toBe(true);

      store.updateLaunchStatus("launch-int-1", "awaiting_approval");

      // ── Stage 6: awaiting_approval → approved ─────────────
      // (CEO approves via tool — simulated by direct transition)
      store.updateLaunchStatus("launch-int-1", "approved");

      // ── Stage 7: approved → ready_to_publish ──────────────
      bus.enqueued.length = 0;
      const result7 = await runCoordinator(
        makeClaim({
          messageType: "launch_approved",
          payloadJson: JSON.stringify({
            launchId: "launch-int-1",
            sellerId: "seller-int-1",
            listingTitle: "Zapatillas Nike Air Max Plus - Negro",
          }),
        }),
      );
      expect(result7.proposalEnqueued).toBe(true); // Sends progress notification on approved → ready_to_publish

      store.updateLaunchStatus("launch-int-1", "ready_to_publish");

      // ── Final assertion ───────────────────────────────────
      const finalLaunch = store.getLaunch("launch-int-1");
      expect(finalLaunch).toBeDefined();
      expect(finalLaunch!.status).toBe("ready_to_publish");
    });

    it("writes the correct state to ProductCatalogStore at each stage", async () => {
      // photo_received → recognizing
      await runCoordinator(makeClaim());
      store.updateLaunchStatus("launch-int-1", "recognizing");
      expect(store.getLaunch("launch-int-1")!.status).toBe("recognizing");

      // recognizing → researching
      await runCoordinator(makeStageClaim("recognizing", { brand: "Nike", model: "AF1" }));
      store.updateLaunchStatus("launch-int-1", "researching");
      expect(store.getLaunch("launch-int-1")!.status).toBe("researching");

      // researching → generating_creative
      await runCoordinator(makeStageClaim("researching", { suggestedPrice: 99000 }));
      store.updateLaunchStatus("launch-int-1", "generating_creative");
      expect(store.getLaunch("launch-int-1")!.status).toBe("generating_creative");

      // generating_creative → composing
      await runCoordinator(makeStageClaim("generating_creative", { qualityScore: 70 }));
      store.updateLaunchStatus("launch-int-1", "composing");
      expect(store.getLaunch("launch-int-1")!.status).toBe("composing");

      // composing → awaiting_approval
      await runCoordinator(
        makeStageClaim("composing", {
          listingTitle: "Product Test",
          listingDescription: "Desc",
          suggestedPrice: 50000,
        }),
      );
      store.updateLaunchStatus("launch-int-1", "awaiting_approval");
      expect(store.getLaunch("launch-int-1")!.status).toBe("awaiting_approval");

      // awaiting_approval → approved → ready_to_publish
      store.updateLaunchStatus("launch-int-1", "approved");
      store.updateLaunchStatus("launch-int-1", "ready_to_publish");
      const final = store.getLaunch("launch-int-1")!;
      expect(final.status).toBe("ready_to_publish");
      expect(final.completedAt).toBeDefined();
    });

    it("records launch completion timestamp when transitioning to ready_to_publish", () => {
      store.updateLaunchStatus("launch-int-1", "recognizing");
      store.updateLaunchStatus("launch-int-1", "researching");
      store.updateLaunchStatus("launch-int-1", "generating_creative");
      store.updateLaunchStatus("launch-int-1", "composing");
      store.updateLaunchStatus("launch-int-1", "awaiting_approval");
      store.updateLaunchStatus("launch-int-1", "approved");

      const preFinal = store.getLaunch("launch-int-1")!;
      expect(preFinal.completedAt).toBeUndefined();

      store.updateLaunchStatus("launch-int-1", "ready_to_publish");

      const final = store.getLaunch("launch-int-1")!;
      expect(final.completedAt).toBeDefined();
    });

    it("enqueues progress messages to CEO at each stage", async () => {
      // Stage 1
      await runCoordinator(makeClaim());
      const stage1Progress = bus.enqueued.find(
        (m) => m.receiverAgentId === "ceo" && m.messageType === "progress",
      );
      expect(stage1Progress).toBeDefined();
      const p1 = JSON.parse(stage1Progress!.payloadJson) as Record<string, unknown>;
      expect(p1.stage).toBe("photo_received");

      // Stage 2
      bus.enqueued.length = 0;
      await runCoordinator(makeStageClaim("recognizing", { brand: "Adidas", model: "Ultraboost" }));
      const stage2Progress = bus.enqueued.find(
        (m) => m.receiverAgentId === "ceo" && m.messageType === "progress",
      );
      expect(stage2Progress).toBeDefined();
    });
  });

  describe("Store creates and reads through pipeline", () => {
    it("stores product catalog entry and images", () => {
      const product = store.getProduct("prod-int-1");
      expect(product).toBeDefined();
      expect(product!.productId).toBe("prod-int-1");

      store.upsertImage({
        imageId: "img-test-1",
        productId: "prod-int-1",
        url: "file:///tmp/photo.jpg",
        source: "ceo_telegram",
      });

      const images = store.getImages("prod-int-1");
      expect(images).toHaveLength(1);
      expect(images[0]!.source).toBe("ceo_telegram");
    });

    it("lists launches by product", () => {
      store.createLaunch({
        launchId: "launch-int-2",
        productId: "prod-int-1",
        sellerId: "seller-int-1",
        status: "photo_received",
        createdAt: new Date().toISOString(),
      });

      const launches = store.getLaunchesByProduct("prod-int-1");
      expect(launches.length).toBeGreaterThanOrEqual(2);
      expect(launches.map((l) => l.launchId)).toContain("launch-int-1");
      expect(launches.map((l) => l.launchId)).toContain("launch-int-2");
    });
  });
});
