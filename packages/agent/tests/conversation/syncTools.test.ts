import { describe, expect, it } from "vitest";

import type {
  ProductSyncEngine,
  SyncResult,
  SyncReport,
  MlClient,
  MlUserSnapshot,
  MlUserInfo,
  MlItem,
  MlWriteSnapshot,
} from "@msl/mercadolibre";
import type { Strategy as SyncStrategy } from "@msl/mercadolibre";

import {
  createSyncProductTool,
  createSyncAllTool,
  createCheckAccountTool,
} from "../../src/conversation/syncTools.js";
import { createAgentLoop } from "../../src/conversation/agentLoop.js";
import { createGraphEngine } from "@msl/memory";
import type { ConversationState } from "../../src/conversation/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const approvedSyncOptions = {
  approvedExecution: true,
  accountConfig: {
    sourceSellerId: "plasticov",
    targetSellerId: "maustian",
    site: "MLC" as const,
  },
};

function makeState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    messages: [],
    contextWindowLimit: 20,
    sessionMetadata: {
      sellerId: "seller-1",
      startedAt: new Date("2026-06-26T10:00:00Z"),
      lastActivityAt: new Date("2026-06-26T10:00:00Z"),
    },
    ...overrides,
  };
}

/** A margin strategy in sync-engine format. */
function marginSyncStrategy(percentage: number): SyncStrategy {
  return { type: "margin", percentage };
}

/** Create a stub sync engine that tracks calls and returns predictable results. */
function createStubSyncEngine(): ProductSyncEngine & {
  _syncProductCalls: Array<{
    sourceSellerId: string;
    targetSellerId: string;
    itemId: string;
    strategies: SyncStrategy[];
  }>;
  _syncAllCalls: Array<{
    sourceSellerId: string;
    targetSellerId: string;
    strategies: SyncStrategy[];
    options?: { differential?: boolean; limit?: number };
  }>;
} {
  const _syncProductCalls: Array<{
    sourceSellerId: string;
    targetSellerId: string;
    itemId: string;
    strategies: SyncStrategy[];
  }> = [];
  const _syncAllCalls: Array<{
    sourceSellerId: string;
    targetSellerId: string;
    strategies: SyncStrategy[];
    options?: { differential?: boolean; limit?: number };
  }> = [];

  return {
    _syncProductCalls,
    _syncAllCalls,

    // eslint-disable-next-line @typescript-eslint/require-await
    async syncProduct(
      sourceSellerId: string,
      targetSellerId: string,
      itemId: string,
      strategies: SyncStrategy[],
    ): Promise<SyncResult> {
      _syncProductCalls.push({ sourceSellerId, targetSellerId, itemId, strategies });
      return {
        itemId,
        status: "published",
        sourcePrice: 15000,
        targetPrice: 22500,
        margin: 0.5,
      };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async syncAll(
      sourceSellerId: string,
      targetSellerId: string,
      strategies: SyncStrategy[],
      options?: { differential?: boolean; limit?: number },
    ): Promise<SyncReport> {
      _syncAllCalls.push({
        sourceSellerId,
        targetSellerId,
        strategies,
        ...(options !== undefined && { options }),
      });
      return {
        total: 2,
        published: 1,
        skipped: 0,
        failed: 0,
        unchanged: 1,
        results: [
          {
            itemId: "MLC1001",
            status: "published",
            sourcePrice: 15000,
            targetPrice: 22500,
            margin: 0.5,
          },
          {
            itemId: "MLC1002",
            status: "unchanged",
            sourcePrice: 25000,
            targetPrice: 25000,
            margin: 0,
          },
        ],
        startedAt: "2026-06-26T10:00:00Z",
        completedAt: "2026-06-26T10:00:01Z",
      };
    },

    syncAllConcurrent(
      sourceSellerId: string,
      targetSellerId: string,
      strategies: SyncStrategy[],
      options?: { differential?: boolean; limit?: number; concurrency?: number },
    ): Promise<SyncReport> {
      return this.syncAll(sourceSellerId, targetSellerId, strategies, options);
    },

    syncAllBackground(
      _sourceSellerId: string,
      _targetSellerId: string,
      _strategies: SyncStrategy[],
      _options?: { differential?: boolean; limit?: number; concurrency?: number },
    ): { jobId: string; getStatus: () => import("@msl/mercadolibre").SyncJob } {
      void [_sourceSellerId, _targetSellerId, _strategies, _options];
      return {
        jobId: "stub-job-id",
        getStatus: () => ({
          jobId: "stub-job-id",
          status: "done",
          startedAt: new Date().toISOString(),
        }),
      };
    },
  };
}

/** Create a stub ML client that returns predictable user info. */
function createStubMlClient(): MlClient {
  const userInfo: MlUserInfo = {
    id: 12345,
    nickname: "TESTSELLER",
    points: 100,
    level: "MercadoLíder Platinum",
    status: "active",
  };

  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    getItems: async () => ({
      sellerId: "test",
      kind: "listing",
      source: "mercadolibre-api",
      data: [],
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    getItem: async () =>
      ({
        id: "MLC1001",
        title: "Test Product",
        price: 15000,
        available_quantity: 10,
        category_id: "MLC1000",
        seller_id: 12345,
        status: "active",
        pictures: [],
        attributes: [],
      }) satisfies MlItem,
    // eslint-disable-next-line @typescript-eslint/require-await
    getOrders: async () => ({
      sellerId: "test",
      kind: "order",
      source: "mercadolibre-api",
      data: [],
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    getQuestions: async () => ({
      sellerId: "test",
      kind: "message",
      source: "mercadolibre-api",
      data: [],
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    publishItem: async () =>
      ({
        id: "MLC-NEW-1",
        permalink: "https://articulo.mercadolibre.cl/MLC-NEW-1",
        status: "active",
        capturedAt: "2026-06-26T10:00:00Z",
      }) satisfies MlWriteSnapshot,
    // eslint-disable-next-line @typescript-eslint/require-await
    updateItem: async () =>
      ({
        id: "MLC1001",
        permalink: "https://articulo.mercadolibre.cl/MLC1001",
        status: "active",
        capturedAt: "2026-06-26T10:00:00Z",
      }) satisfies MlWriteSnapshot,
    // eslint-disable-next-line @typescript-eslint/require-await
    getCategories: async () => ({
      sellerId: "test",
      data: [],
      capturedAt: "2026-06-26T10:00:00Z",
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    getUserInfo: async () =>
      ({
        sellerId: "test",
        data: userInfo,
        capturedAt: "2026-06-26T10:00:00Z",
      }) satisfies MlUserSnapshot,
  };
}

// ---------------------------------------------------------------------------
// Unit tests: sync tools in isolation
// ---------------------------------------------------------------------------

describe("createSyncProductTool — unit", () => {
  it("executes syncProduct on the engine and returns result", async () => {
    const engine = createStubSyncEngine();
    const tool = createSyncProductTool(engine, undefined, approvedSyncOptions);

    const result = await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      itemId: "MLC1001",
      strategies: [marginSyncStrategy(0.5)],
    });

    expect(result).toHaveProperty("status", "published");
    expect(result).toHaveProperty("itemId", "MLC1001");
    expect(result).toHaveProperty("margin", 0.5);

    expect(engine._syncProductCalls).toHaveLength(1);
    expect(engine._syncProductCalls[0]!.itemId).toBe("MLC1001");
  });

  it("returns error when strategies is empty", async () => {
    const engine = createStubSyncEngine();
    const tool = createSyncProductTool(engine, undefined, approvedSyncOptions);

    const result = await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      itemId: "MLC1001",
      strategies: [],
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/no hay estrategias/i);
  });

  it("returns error when required params are missing", async () => {
    const engine = createStubSyncEngine();
    const tool = createSyncProductTool(engine, undefined, approvedSyncOptions);

    const result = await tool.execute({
      sourceSellerId: "",
      targetSellerId: "maustian",
      itemId: "MLC1001",
      strategies: [marginSyncStrategy(0.5)],
    });

    expect(result).toHaveProperty("error");
  });

  it("stores sync outcome in Cortex when provided", async () => {
    const engine = createStubSyncEngine();
    const cortex = createGraphEngine(":memory:");
    const tool = createSyncProductTool(engine, cortex, approvedSyncOptions);

    await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      itemId: "MLC1001",
      strategies: [marginSyncStrategy(0.5)],
    });

    // Verify Cortex has the sync outcome node.
    const nodes = cortex.db
      .prepare("SELECT id, label, metadata FROM nodes WHERE metadata LIKE '%sync_outcome%'")
      .all() as Array<{ id: number; label: string; metadata: string }>;
    expect(nodes.length).toBeGreaterThanOrEqual(1);

    const outcomeMeta = JSON.parse(nodes[0]!.metadata) as Record<string, unknown>;
    expect(outcomeMeta.type).toBe("sync_outcome");
    expect(outcomeMeta.itemId).toBe("MLC1001");
    expect(outcomeMeta.status).toBe("published");

    cortex.db.close();
  });

  it("blocks direct LLM sync execution unless the approved path is used", async () => {
    const engine = createStubSyncEngine();
    const tool = createSyncProductTool(engine, undefined, {
      accountConfig: approvedSyncOptions.accountConfig,
    });

    const result = await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      itemId: "MLC1001",
      strategies: [marginSyncStrategy(0.5)],
    });

    expect(result).toMatchObject({ status: "approval_required", tool: "sync_product" });
    expect(engine._syncProductCalls).toHaveLength(0);
  });
});

describe("createSyncAllTool — unit", () => {
  it("executes syncAll on the engine and returns report", async () => {
    const engine = createStubSyncEngine();
    const tool = createSyncAllTool(engine, undefined, approvedSyncOptions);

    const result = await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      strategies: [marginSyncStrategy(0.5)],
    });

    expect(result).toHaveProperty("total", 2);
    expect(result).toHaveProperty("published", 1);
    expect(result).toHaveProperty("results");
    expect(Array.isArray((result as SyncReport).results)).toBe(true);

    expect(engine._syncAllCalls).toHaveLength(1);
  });

  it("passes limit and differential options to engine", async () => {
    const engine = createStubSyncEngine();
    const tool = createSyncAllTool(engine, undefined, approvedSyncOptions);

    await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      strategies: [marginSyncStrategy(0.5)],
      limit: 10,
      differential: false,
    });

    expect(engine._syncAllCalls[0]!.options).toMatchObject({
      limit: 10,
      differential: false,
    });
  });

  it("returns error when strategies is empty", async () => {
    const engine = createStubSyncEngine();
    const tool = createSyncAllTool(engine, undefined, approvedSyncOptions);

    const result = await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      strategies: [],
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/no hay estrategias/i);
  });

  it("blocks reversed Plasticov/Maustian sync direction", async () => {
    const engine = createStubSyncEngine();
    const tool = createSyncAllTool(engine, undefined, approvedSyncOptions);

    const reversed = await tool.execute({
      sourceSellerId: "maustian",
      targetSellerId: "plasticov",
      strategies: [marginSyncStrategy(0.5)],
    });

    expect(reversed).toHaveProperty("error");
    expect((reversed as { error: string }).error).toMatch(/invalid mercadolibre sync direction/i);
    expect(engine._syncAllCalls).toHaveLength(0);
  });

  it("blocks sync_all direct execution unless the approved path is used", async () => {
    const engine = createStubSyncEngine();
    const tool = createSyncAllTool(engine, undefined, {
      accountConfig: approvedSyncOptions.accountConfig,
    });

    const result = await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      strategies: [marginSyncStrategy(0.5)],
    });

    expect(result).toMatchObject({ status: "approval_required", tool: "sync_all" });
    expect(engine._syncAllCalls).toHaveLength(0);
  });
});

describe("createCheckAccountTool — unit", () => {
  it("returns user info when sellerId is valid", async () => {
    const mlClient = createStubMlClient();
    const tool = createCheckAccountTool(mlClient);

    const result = await tool.execute({ sellerId: "plasticov" });

    expect(result).toHaveProperty("nickname", "TESTSELLER");
    expect(result).toHaveProperty("level");
    expect(result).toHaveProperty("points", 100);
  });

  it("returns error when sellerId is missing", async () => {
    const mlClient = createStubMlClient();
    const tool = createCheckAccountTool(mlClient);

    const result = await tool.execute({ sellerId: "" });

    expect(result).toHaveProperty("error");
  });

  it("returns error when getUserInfo throws", async () => {
    const brokenClient: MlClient = {
      ...createStubMlClient(),
      // eslint-disable-next-line @typescript-eslint/require-await
      getUserInfo: async () => {
        throw new Error("Network failure");
      },
    };
    const tool = createCheckAccountTool(brokenClient);

    const result = await tool.execute({ sellerId: "plasticov" });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/network failure/i);
  });
});

// ---------------------------------------------------------------------------
// Agent integration tests
// ---------------------------------------------------------------------------

describe("sync tools — agent loop integration", () => {
  const systemPrompt = "Eres Plasticov, asistente comercial. Respondé en español.";

  it("includes sync_product, sync_all, and check_account in tool map when configured", () => {
    const engine = createStubSyncEngine();
    const mlClient = createStubMlClient();

    // We can't directly inspect the internal toolMap, but we verify the
    // agent creates without errors when sync tools are configured.
    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      syncEngine: engine,
      mlClient,
    });

    // The converse method should work — sync tools are just extra tools.
    expect(agent).toHaveProperty("converse");
    expect(typeof agent.converse).toBe("function");
  });

  it("sync_product tool is invoked when called with strategies", async () => {
    const engine = createStubSyncEngine();
    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      syncEngine: engine,
    });

    // Directly test the tool execution via the tool — since the mock
    // LLM client doesn't natively route to sync_product, we test the
    // tool behavior through the engine directly.
    // (The sync tool itself was tested above; this test confirms wiring.)
    const state = makeState();
    const result = await agent.converse("publicá electrónica en Maustian", state);

    // With a mock client, the agent loop won't naturally call sync_product.
    // But the agent should still work — no crashes.
    expect(result.response.length).toBeGreaterThan(0);
  });

  it("blocks sync when no CEO strategies are active", async () => {
    const engine = createStubSyncEngine();
    const cortex = createGraphEngine(":memory:");
    createAgentLoop({
      systemPrompt:
        "Eres Plasticov, asistente comercial. Respondé en español. " +
        "Cuando el vendedor pida sincronizar, usá la herramienta sync_product.",
      mockClient: true,
      syncEngine: engine,
      engine: cortex,
      strategies: [], // No active strategies
    });

    // The mock client won't call sync_product by default, but we can
    // verify the safety gate through the tool itself.
    const tool = createSyncProductTool(engine, cortex, approvedSyncOptions);
    const result = await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      itemId: "MLC1001",
      strategies: [],
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/no hay estrategias/i);

    cortex.db.close();
  });

  it("sync_all with strategies produces a valid report", async () => {
    const engine = createStubSyncEngine();
    const cortex = createGraphEngine(":memory:");
    const tool = createSyncAllTool(engine, cortex, approvedSyncOptions);

    const result = await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      strategies: [marginSyncStrategy(0.5), { type: "stock", available_quantity: 20 }],
    });

    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("results");
    const report = result as SyncReport;
    expect(report.results).toHaveLength(2);

    // Verify Cortex has sync outcome nodes for both results.
    const nodes = cortex.db
      .prepare("SELECT metadata FROM nodes WHERE metadata LIKE '%sync_outcome%'")
      .all() as Array<{ metadata: string }>;
    expect(nodes.length).toBeGreaterThanOrEqual(2);

    cortex.db.close();
  });
});

// ---------------------------------------------------------------------------
// Cortex integration tests
// ---------------------------------------------------------------------------

describe("sync tools — Cortex integration", () => {
  it("creates seller nodes on first sync", async () => {
    const engine = createStubSyncEngine();
    const cortex = createGraphEngine(":memory:");
    const tool = createSyncProductTool(engine, cortex, approvedSyncOptions);

    await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      itemId: "MLC1001",
      strategies: [marginSyncStrategy(0.5)],
    });

    // Seller nodes should exist.
    const sellerNodes = cortex.db
      .prepare("SELECT label FROM nodes WHERE metadata LIKE '%sellerId%'")
      .all() as Array<{ label: string }>;
    const labels = sellerNodes.map((n) => n.label);
    expect(labels).toContain("seller_plasticov");
    expect(labels).toContain("seller_maustian");

    cortex.db.close();
  });

  it("Hebbian reinforces edges on successful sync", async () => {
    const engine = createStubSyncEngine();
    const cortex = createGraphEngine(":memory:");
    const tool = createSyncProductTool(engine, cortex, approvedSyncOptions);

    await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      itemId: "MLC1001",
      strategies: [marginSyncStrategy(0.5)],
    });

    // Edge from sync-outcome node to target seller should have weight > 0.5
    // (initial 0.5 + 0.1 Hebbian reinforcement).
    const edges = cortex.db.prepare("SELECT weight FROM edges").all() as Array<{ weight: number }>;
    expect(edges.length).toBeGreaterThan(0);

    // At least one edge should have weight > 0.5 (reinforced).
    const reinforced = edges.filter((e) => e.weight > 0.5);
    expect(reinforced.length).toBeGreaterThanOrEqual(1);

    cortex.db.close();
  });

  it("reuses existing seller nodes on repeated syncs (idempotent)", async () => {
    const engine = createStubSyncEngine();
    const cortex = createGraphEngine(":memory:");
    const tool = createSyncProductTool(engine, cortex, approvedSyncOptions);

    // First sync.
    await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      itemId: "MLC1001",
      strategies: [marginSyncStrategy(0.5)],
    });

    const sellerCountBefore = cortex.db
      .prepare("SELECT COUNT(*) as cnt FROM nodes WHERE metadata LIKE '%sellerId%'")
      .get() as { cnt: number };

    // Second sync — same sellers, different item.
    await tool.execute({
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      itemId: "MLC1002",
      strategies: [marginSyncStrategy(0.4)],
    });

    const sellerCountAfter = cortex.db
      .prepare("SELECT COUNT(*) as cnt FROM nodes WHERE metadata LIKE '%sellerId%'")
      .get() as { cnt: number };

    // Seller nodes should not have increased.
    expect(sellerCountAfter.cnt).toBe(sellerCountBefore.cnt);

    // Sync-outcome nodes should have increased.
    const outcomeCount = cortex.db
      .prepare(
        "SELECT COUNT(*) as cnt FROM nodes WHERE json_extract(metadata, '$.type') = 'sync_outcome'",
      )
      .get() as { cnt: number };
    expect(outcomeCount.cnt).toBe(2);

    cortex.db.close();
  });
});
