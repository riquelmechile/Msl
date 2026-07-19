import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import {
  createAgentMessageBusStore,
  createProductCatalogStore,
  startDaemonScheduler,
} from "@msl/agent";
import { LaunchCostTracker } from "../../packages/agent/src/economics/launchCostTracker.js";
import { productLaunchCoordinator } from "../../packages/agent/src/workers/productLaunchCoordinator.js";
import { visionAnalyst } from "../../packages/agent/src/workers/visionAnalyst.js";
import { productResearchDaemon } from "../../packages/agent/src/workers/productResearchDaemon.js";
import { creativeProductionDaemon } from "../../packages/agent/src/workers/creativeProductionDaemon.js";
import { listingCompositionDaemon } from "../../packages/agent/src/workers/listingCompositionDaemon.js";
import type {
  AgentMessage,
  AgentMessageBusStore,
  EnqueueAgentMessageInput,
} from "../../packages/agent/src/conversation/agentMessageBusStore.js";

type Enqueued = {
  senderAgentId: string;
  receiverAgentId: string;
  messageType: string;
  payloadJson: string;
  sellerId?: string;
  correlationId?: string;
  dedupeKey?: string;
};

function message(input: Enqueued, index: number): AgentMessage {
  return {
    id: index,
    messageId: `message-${index}`,
    ...input,
    status: "pending",
    priority: 0,
    attempts: 0,
    dedupeKey: input.dedupeKey ?? null,
    lockedAt: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resultJson: null,
    errorJson: null,
    cancelReason: null,
    correlationId: input.correlationId ?? null,
    parentMessageId: null,
    sellerId: input.sellerId ?? null,
    learnedAt: null,
    outcomeScore: null,
    actionId: null,
  };
}

function busFixture(): AgentMessageBusStore & { enqueued: Enqueued[] } {
  const enqueued: Enqueued[] = [];
  return {
    enqueued,
    enqueue: vi.fn((input: EnqueueAgentMessageInput) => {
      enqueued.push(input);
      return message(input, enqueued.length);
    }),
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
    defer: vi.fn(),
    resumeDeferred: vi.fn(),
    settle: vi.fn(),
    getExpiredDeferrals: vi.fn(),
  };
}

describe("product launch pipeline integration", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createProductCatalogStore>;
  let bus: ReturnType<typeof busFixture>;
  let cursor: number;

  beforeEach(() => {
    vi.stubEnv("SERPAPI_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("MSL_CREATIVE_STUDIO_ENABLED", "false");
    db = new Database(":memory:");
    store = createProductCatalogStore(db);
    bus = busFixture();
    cursor = 0;
    store.upsertProduct({ productId: "product-1" });
    store.createLaunch({
      launchId: "launch-1",
      productId: "product-1",
      sellerId: "seller-target",
      status: "photo_received",
      createdAt: new Date().toISOString(),
    });
  });

  function next(receiverAgentId: string, messageType: string): AgentMessage {
    while (cursor < bus.enqueued.length) {
      const entry = bus.enqueued[cursor]!;
      cursor += 1;
      if (entry.receiverAgentId === receiverAgentId && entry.messageType === messageType) {
        return message(entry, cursor);
      }
    }
    throw new Error(`No ${messageType} message for ${receiverAgentId}`);
  }

  function context(claim: AgentMessage) {
    return {
      claim,
      bus,
      productCatalogStore: store,
      launchCostTracker: new LaunchCostTracker({ catalogStore: store }),
      reader: {} as never,
      cortex: {} as never,
      sellerIds: ["seller-source", "seller-target"],
    };
  }

  it("reaches awaiting_approval through real worker envelopes and persisted transitions", async () => {
    await productLaunchCoordinator(
      context(
        message(
          {
            senderAgentId: "telegram-bot",
            receiverAgentId: "product-launch",
            messageType: "launch_request",
            payloadJson: JSON.stringify({
              launchId: "launch-1",
              productId: "product-1",
              sellerId: "seller-target",
              imageUrls: ["file:///product.jpg"],
            }),
            sellerId: "seller-target",
          },
          1,
        ),
      ),
    );
    expect(store.getLaunch("launch-1")?.status).toBe("recognizing");

    await visionAnalyst(context(next("product-recognition", "launch_stage_work")));
    await productLaunchCoordinator(context(next("product-launch", "launch_stage_complete")));
    expect(store.getLaunch("launch-1")?.status).toBe("researching");

    await productResearchDaemon(context(next("product-research", "launch_stage_work")));
    await productLaunchCoordinator(context(next("product-launch", "launch_stage_complete")));
    await productResearchDaemon(context(next("product-research", "launch_stage_work")));
    await productLaunchCoordinator(context(next("product-launch", "launch_stage_complete")));
    expect(store.getLaunch("launch-1")?.status).toBe("generating_creative");

    await creativeProductionDaemon(context(next("creative-production", "launch_stage_work")));
    await productLaunchCoordinator(context(next("product-launch", "launch_stage_complete")));
    await creativeProductionDaemon(context(next("creative-production", "launch_stage_work")));
    await productLaunchCoordinator(context(next("product-launch", "launch_stage_complete")));
    expect(store.getLaunch("launch-1")?.status).toBe("composing");

    await listingCompositionDaemon(context(next("listing-composition", "launch_stage_work")));
    await productLaunchCoordinator(context(next("product-launch", "launch_stage_complete")));
    await listingCompositionDaemon(context(next("listing-composition", "launch_stage_work")));
    await productLaunchCoordinator(context(next("product-launch", "launch_stage_complete")));
    await listingCompositionDaemon(context(next("listing-composition", "launch_stage_work")));
    await productLaunchCoordinator(context(next("product-launch", "launch_stage_complete")));

    const launch = store.getLaunchForSeller("launch-1", "seller-target");
    expect(launch?.status).toBe("awaiting_approval");
    expect(launch?.title).toContain("GenericBrand");
    expect(
      bus.enqueued.some(
        (entry) => entry.receiverAgentId === "ceo" && entry.messageType === "proposal",
      ),
    ).toBe(true);
    expect(
      bus.enqueued
        .filter((entry) => entry.messageType === "launch_stage_work")
        .every((entry) => entry.sellerId === "seller-target"),
    ).toBe(true);
  });

  it("drains event-only launch stages within one scheduler cycle", async () => {
    const realBus = createAgentMessageBusStore(db);
    realBus.enqueue({
      senderAgentId: "telegram-bot",
      receiverAgentId: "product-launch",
      messageType: "launch_request",
      payloadJson: JSON.stringify({
        launchId: "launch-1",
        productId: "product-1",
        sellerId: "seller-target",
        imageUrls: ["file:///product.jpg"],
      }),
      sellerId: "seller-target",
    });
    const scheduler = startDaemonScheduler({
      bus: realBus,
      reader: {} as never,
      cortex: {} as never,
      sellerIds: [],
      intervalMs: 60_000,
      productCatalogStore: store,
      launchCostTracker: new LaunchCostTracker({ catalogStore: store }),
    });

    try {
      await vi.waitFor(
        () => expect(store.getLaunch("launch-1")?.status).toBe("awaiting_approval"),
        { timeout: 2_000, interval: 20 },
      );
    } finally {
      scheduler.stop();
    }
  });
});
