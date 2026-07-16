import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createProductCatalogStore } from "./productCatalogStore.js";
import { productLaunchCoordinator } from "./productLaunchCoordinator.js";
import type {
  AgentMessage,
  AgentMessageBusStore,
  EnqueueAgentMessageInput,
} from "../conversation/agentMessageBusStore.js";
import type { ProductLaunchEnvelope } from "./productLaunchEnvelope.js";

function claim(messageType: string, payload: unknown, sellerId = "seller-a"): AgentMessage {
  return {
    id: 1,
    messageId: `message-${messageType}`,
    senderAgentId: "test",
    receiverAgentId: "product-launch",
    messageType,
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
    correlationId: "launch-1",
    parentMessageId: null,
    sellerId,
    learnedAt: null,
    outcomeScore: null,
    actionId: null,
  };
}

function busFixture(): AgentMessageBusStore & { enqueued: Array<Record<string, unknown>> } {
  const enqueued: Array<Record<string, unknown>> = [];
  return {
    enqueued,
    enqueue: vi.fn((input: EnqueueAgentMessageInput) => {
      enqueued.push(input);
      return { messageId: `enqueued-${enqueued.length}` };
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
  } as unknown as AgentMessageBusStore & { enqueued: Array<Record<string, unknown>> };
}

describe("productLaunchCoordinator", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createProductCatalogStore>;
  let bus: ReturnType<typeof busFixture>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createProductCatalogStore(db);
    store.upsertProduct({ productId: "product-1" });
    store.createLaunch({
      launchId: "launch-1",
      productId: "product-1",
      sellerId: "seller-a",
      chatId: "123",
      status: "photo_received",
      createdAt: new Date().toISOString(),
    });
    bus = busFixture();
  });

  function run(input: AgentMessage) {
    return productLaunchCoordinator({
      claim: input,
      bus,
      productCatalogStore: store,
      reader: {} as never,
      cortex: {} as never,
      sellerIds: ["seller-a", "seller-b"],
    });
  }

  it("persists photo_received to recognizing and preserves seller identity", async () => {
    await run(
      claim("launch_request", {
        launchId: "launch-1",
        productId: "product-1",
        sellerId: "seller-a",
        imageUrls: ["file:///product.jpg"],
        chatId: 123,
      }),
    );

    expect(store.getLaunch("launch-1")?.status).toBe("recognizing");
    const work = bus.enqueued.find((message) => message.messageType === "launch_stage_work")!;
    expect(work).toMatchObject({
      receiverAgentId: "product-recognition",
      sellerId: "seller-a",
      correlationId: "launch-1",
    });
    expect(JSON.parse(work.payloadJson as string)).toMatchObject({
      launchId: "launch-1",
      sellerId: "seller-a",
      stage: "recognizing",
      task: "vision-analyst",
    });
  });

  it("makes the transition visible before enqueue and retries a missing work item", async () => {
    const observedStatuses: string[] = [];
    let interrupt = true;
    bus.enqueue = vi.fn((input: EnqueueAgentMessageInput) => {
      if (input.messageType === "launch_stage_work") {
        observedStatuses.push(store.getLaunch("launch-1")!.status);
        if (interrupt) {
          interrupt = false;
          throw new Error("interrupted after transition");
        }
      }
      return { messageId: `enqueued-${observedStatuses.length}` } as never;
    });
    const request = claim("launch_request", {
      launchId: "launch-1",
      sellerId: "seller-a",
      imageUrls: ["file:///product.jpg"],
    });

    await expect(run(request)).rejects.toThrow("interrupted after transition");
    expect(store.getLaunch("launch-1")?.status).toBe("recognizing");
    await expect(run(request)).resolves.toMatchObject({ proposalEnqueued: true });
    expect(observedStatuses).toEqual(["recognizing", "recognizing"]);
  });

  it("rejects duplicate, out-of-order, and cross-seller results", async () => {
    await run(
      claim("launch_request", {
        launchId: "launch-1",
        sellerId: "seller-a",
        imageUrls: ["file:///product.jpg"],
      }),
    );
    const envelope: ProductLaunchEnvelope = {
      launchId: "launch-1",
      sellerId: "seller-a",
      stage: "researching",
      task: "market-researcher",
      imageUrls: ["file:///product.jpg"],
    };

    const outOfOrder = await run(claim("launch_stage_complete", envelope));
    expect(outOfOrder.proposalEnqueued).toBe(false);
    expect(store.getLaunch("launch-1")?.status).toBe("recognizing");

    const crossSeller = await run(
      claim("launch_stage_complete", { ...envelope, sellerId: "seller-b" }, "seller-b"),
    );
    expect(crossSeller.proposalEnqueued).toBe(false);
  });

  it("handles a seller-scoped additional photo without losing its path", async () => {
    await run(
      claim("additional_photo", {
        launchId: "launch-1",
        sellerId: "seller-a",
        imageUrls: ["file:///additional.jpg"],
        chatId: 123,
      }),
    );

    expect(store.getLaunch("launch-1")?.status).toBe("recognizing");
    const work = bus.enqueued.find((message) => message.messageType === "launch_stage_work")!;
    expect(JSON.parse(work.payloadJson as string)).toMatchObject({
      sellerId: "seller-a",
      imageUrls: ["file:///additional.jpg"],
      task: "vision-analyst",
    });
  });

  it("moves an approved launch to ready_to_publish without publishing", async () => {
    for (const status of [
      "recognizing",
      "researching",
      "generating_creative",
      "composing",
      "awaiting_approval",
      "approved",
    ] as const) {
      store.updateLaunchStatus("launch-1", status);
    }

    await run(
      claim("launch_approved", {
        launchId: "launch-1",
        sellerId: "seller-a",
        chatId: 123,
      }),
    );

    expect(store.getLaunch("launch-1")?.status).toBe("ready_to_publish");
    expect(bus.enqueued.some((message) => message.messageType === "progress")).toBe(true);
  });
});
