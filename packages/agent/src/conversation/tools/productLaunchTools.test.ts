import { describe, it, expect, vi } from "vitest";
import {
  createLaunchProductTool,
  createQueryLaunchStatusTool,
  createApproveLaunchTool,
  createProductLaunchTools,
} from "./productLaunchTools.js";
import type { ProductCatalogStore } from "@msl/domain";

// ── Helpers ────────────────────────────────────────────────────────

/** Safely unwrap ToolDefinition.execute() return type (all our tools are synchronous). */
function r(
  result: Record<string, unknown> | Promise<Record<string, unknown>>,
): Record<string, unknown> {
  return result as Record<string, unknown>;
}

function makeStore(overrides?: Partial<ProductCatalogStore>): ProductCatalogStore {
  return {
    upsertProduct: vi.fn().mockReturnValue({ productId: "prod-1" }),
    getProduct: vi.fn().mockReturnValue(undefined),
    upsertImage: vi.fn().mockReturnValue({
      imageId: "img-1",
      productId: "prod-1",
      url: "",
      source: "ceo_telegram",
      createdAt: "",
    }),
    getImages: vi.fn().mockReturnValue([]),
    createLaunch: vi.fn().mockReturnValue({
      launchId: "launch-1",
      productId: "prod-1",
      sellerId: "test-seller",
      status: "photo_received",
      createdAt: new Date().toISOString(),
    }),
    getLaunch: vi.fn().mockReturnValue(undefined),
    updateLaunchStatus: vi.fn().mockReturnValue({
      launchId: "launch-1",
      productId: "prod-1",
      sellerId: "test-seller",
      status: "approved",
      createdAt: new Date().toISOString(),
    }),
    getLaunchesByProduct: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

function makeBus() {
  return {
    enqueue: vi.fn().mockReturnValue({ messageId: "msg-1" }),
    claimNext: vi.fn().mockReturnValue([]),
    resolve: vi.fn(),
    fail: vi.fn(),
    cancel: vi.fn(),
    lookupRecentByDedupePrefix: vi.fn().mockReturnValue([]),
    getFailedMessages: vi.fn().mockReturnValue([]),
    getPendingCount: vi.fn().mockReturnValue(0),
    getMessagesByCorrelationId: vi.fn().mockReturnValue([]),
    getLearningHistory: vi.fn().mockReturnValue([]),
    recordOutcome: vi.fn(),
    getUnscoredMessages: vi.fn().mockReturnValue([]),
    reenqueueFailed: vi.fn(),
    getProcessingStuck: vi.fn().mockReturnValue([]),
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("productLaunchTools", () => {
  describe("createLaunchProductTool", () => {
    it("returns stub result when no store provided", () => {
      const tool = createLaunchProductTool();
      const result = r(tool.execute({ sellerId: "test-seller" }));
      expect(result.noMutationExecuted).toBe(true);
      expect(result.status).toBe("photo_received");
      expect(typeof result.launchId).toBe("string");
      expect((result as { launchId: string }).launchId).toContain("stub");
    });

    it("creates a launch with store and returns launchId", () => {
      const store = makeStore();
      const bus = makeBus();
      const tool = createLaunchProductTool({ catalogStore: store, bus });
      const result = r(
        tool.execute({
          sellerId: "test-seller",
          imageUrl: "https://example.com/photo.jpg",
          caption: "Test product",
          chatId: 123456,
        }),
      );

      expect(result.noMutationExecuted).toBe(true);
      expect(result.status).toBe("photo_received");
      expect(result.launchId).toBe("launch-1");
      expect(store.upsertProduct).toHaveBeenCalled();
      expect(store.createLaunch).toHaveBeenCalled();
      expect(bus.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          receiverAgentId: "product-launch",
          messageType: "launch_request",
        }),
      );
    });

    it("handles store errors gracefully", () => {
      const store = makeStore({
        createLaunch: vi.fn().mockImplementation(() => {
          throw new Error("DB error");
        }),
      });
      const tool = createLaunchProductTool({ catalogStore: store });
      const result = r(tool.execute({ sellerId: "test-seller" }));

      expect(result.noMutationExecuted).toBe(true);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("DB error");
    });
  });

  describe("createQueryLaunchStatusTool", () => {
    it("returns stub result when no store provided", () => {
      const tool = createQueryLaunchStatusTool();
      const result = r(tool.execute({ launchId: "any" }));
      expect(result.noMutationExecuted).toBe(true);
      expect(result.status).toBe("photo_received");
    });

    it("returns launch status with pipeline progress", () => {
      const store = makeStore({
        getLaunch: vi.fn().mockReturnValue({
          launchId: "launch-1",
          productId: "prod-1",
          sellerId: "test-seller",
          status: "researching",
          createdAt: new Date().toISOString(),
        }),
      });
      const tool = createQueryLaunchStatusTool({ catalogStore: store });
      const result = r(tool.execute({ launchId: "launch-1" }));

      expect(result.noMutationExecuted).toBe(true);
      expect(result.status).toBe("researching");
      expect(result.pipeline).toBeDefined();
      const pipeline = result.pipeline as Record<string, string>;
      expect(pipeline.photo_received).toBe("completed");
      expect(pipeline.recognizing).toBe("completed");
      expect(pipeline.researching).toBe("in_progress");
      expect(pipeline.generating_creative).toBe("pending");
    });

    it("returns not_found for unknown launch", () => {
      const store = makeStore({
        getLaunch: vi.fn().mockReturnValue(undefined),
      });
      const tool = createQueryLaunchStatusTool({ catalogStore: store });
      const result = r(tool.execute({ launchId: "nonexistent" }));

      expect(result.status).toBe("not_found");
    });

    it("handles store errors gracefully", () => {
      const store = makeStore({
        getLaunch: vi.fn().mockImplementation(() => {
          throw new Error("Query failed");
        }),
      });
      const tool = createQueryLaunchStatusTool({ catalogStore: store });
      const result = r(tool.execute({ launchId: "launch-1" }));

      expect(result.status).toBe("error");
      expect(result.error).toContain("Query failed");
    });
  });

  describe("createApproveLaunchTool", () => {
    it("returns stub when no store provided", () => {
      const tool = createApproveLaunchTool();
      const result = r(tool.execute({ launchId: "any" }));
      expect(result.noMutationExecuted).toBe(true);
      expect(result.approved).toBe(false);
    });

    it("rejects approval when launch not in awaiting_approval", () => {
      const store = makeStore({
        getLaunch: vi.fn().mockReturnValue({
          launchId: "launch-1",
          productId: "prod-1",
          sellerId: "test-seller",
          status: "recognizing",
          createdAt: new Date().toISOString(),
        }),
      });
      const tool = createApproveLaunchTool({ catalogStore: store });
      const result = r(tool.execute({ launchId: "launch-1" }));

      expect(result.approved).toBe(false);
      expect(result.currentStatus).toBe("recognizing");
    });

    it("approves when launch is awaiting_approval", () => {
      const store = makeStore({
        getLaunch: vi.fn().mockReturnValue({
          launchId: "launch-1",
          productId: "prod-1",
          sellerId: "test-seller",
          status: "awaiting_approval",
          createdAt: new Date().toISOString(),
        }),
      });
      const bus = makeBus();
      const tool = createApproveLaunchTool({ catalogStore: store, bus });
      const result = r(tool.execute({ launchId: "launch-1", notes: "Looks good" }));

      expect(result.approved).toBe(true);
      expect(result.newStatus).toBe("approved");
      expect(store.updateLaunchStatus).toHaveBeenCalledWith("launch-1", "approved");
      expect(bus.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          receiverAgentId: "product-launch",
          messageType: "launch_approved",
        }),
      );
    });

    it("returns not_found for unknown launch", () => {
      const store = makeStore({
        getLaunch: vi.fn().mockReturnValue(undefined),
      });
      const tool = createApproveLaunchTool({ catalogStore: store });
      const result = r(tool.execute({ launchId: "nonexistent" }));

      expect(result.approved).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("handles store errors gracefully", () => {
      const store = makeStore({
        getLaunch: vi.fn().mockImplementation(() => {
          throw new Error("Store error");
        }),
      });
      const tool = createApproveLaunchTool({ catalogStore: store });
      const result = r(tool.execute({ launchId: "launch-1" }));

      expect(result.approved).toBe(false);
      expect(result.error).toContain("Store error");
    });
  });

  describe("createProductLaunchTools factory", () => {
    it("returns all three tools", () => {
      const tools = createProductLaunchTools();
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual([
        "launch_product",
        "query_launch_status",
        "approve_launch",
      ]);
    });

    it("all tools have noMutationExecuted guard", () => {
      const store = makeStore();
      const tools = createProductLaunchTools({ catalogStore: store });

      // launch_product
      const launchResult = r(tools[0]!.execute({ sellerId: "test" }));
      expect(launchResult.noMutationExecuted).toBe(true);

      // query_launch_status
      const queryResult = r(tools[1]!.execute({ launchId: "test" }));
      expect(queryResult.noMutationExecuted).toBe(true);

      // approve_launch
      const approveResult = r(tools[2]!.execute({ launchId: "test" }));
      expect(approveResult.noMutationExecuted).toBe(true);
    });

    it("all tools have name and description", () => {
      const tools = createProductLaunchTools();
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.execute).toBe("function");
      }
    });
  });
});
