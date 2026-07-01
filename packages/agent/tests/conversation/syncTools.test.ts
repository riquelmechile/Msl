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
  MlcApiClient,
} from "@msl/mercadolibre";
import type { Strategy as SyncStrategy } from "@msl/mercadolibre";

import {
  createSyncProductTool,
  createSyncAllTool,
  createCheckAccountTool,
  createAuditAllQualityTool,
  createFindRelistOpportunitiesTool,
  createCheckPriceIntelligenceTool,
  createFindAutomatedPriceItemsTool,
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

function createStubMlcPriceClient(): MlcApiClient {
  return {
    getListings: async () => ({
      sellerId: "plasticov",
      kind: "listing",
      source: "mercadolibre-api",
      data: [],
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    getItem: async () => ({
      id: "MLC1001",
      title: "Test Product",
      price: 10990,
      available_quantity: 5,
      category_id: "MLC1000",
      seller_id: 12345,
      status: "active",
      pictures: [],
      attributes: [],
    }),
    getOrders: async () => ({
      sellerId: "plasticov",
      kind: "order",
      source: "mercadolibre-api",
      data: [],
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    getMessages: async () => ({
      sellerId: "plasticov",
      kind: "message",
      source: "mercadolibre-api",
      data: [],
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    getReputation: async () => ({
      sellerId: "plasticov",
      kind: "reputation",
      source: "mercadolibre-api",
      data: {},
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    getCategoryAttributes: async () => ({
      sellerId: "plasticov",
      kind: "listing",
      source: "mercadolibre-api",
      data: [],
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    getCategoryTechnicalSpecs: async () => ({
      sellerId: "plasticov",
      kind: "listing",
      source: "mercadolibre-api",
      data: [],
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    getItemSalePrice: async (_sellerId, itemId) => ({
      sellerId: "plasticov",
      kind: "listing",
      source: "mercadolibre-api",
      data: { itemId, amount: 10990, currencyId: "CLP" },
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    getItemPrices: async (_sellerId, itemId) => ({
      sellerId: "plasticov",
      kind: "listing",
      source: "mercadolibre-api",
      data: { itemId, prices: [{ type: "standard", amount: 10990, currencyId: "CLP" }] },
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    getItemPriceToWin: async (_sellerId, itemId) => ({
      sellerId: "plasticov",
      kind: "listing",
      source: "mercadolibre-api",
      data: { itemId, currentPrice: 10990, priceToWin: 9990, status: "competing", boosts: [] },
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    getPricingAutomation: async (_sellerId, itemId) => ({
      sellerId: "plasticov",
      kind: "listing",
      source: "mercadolibre-api",
      data: { itemId, active: true, status: "active", ruleId: "rule-1" },
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
    getPricingAutomationItems: async (sellerId) => ({
      sellerId,
      kind: "listing",
      source: "mercadolibre-api",
      data: {
        paging: { total: 1, offset: 0, limit: 50 },
        items: [{ itemId: "MLC1001", status: "active", ruleId: "rule-1" }],
      },
      completeness: "complete",
      freshness: {} as never,
      confidence: "high",
    }),
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

describe("price intelligence tools — unit", () => {
  it("aggregates read-only price intelligence and surfaces automation guard", async () => {
    const tool = createCheckPriceIntelligenceTool(createStubMlcPriceClient());

    const result = await tool.execute({ sellerId: "plasticov", itemId: "MLC1001" });

    expect(result).toMatchObject({
      sellerId: "plasticov",
      itemId: "MLC1001",
      kind: "price-intelligence",
      noMutationExecuted: true,
    });
    expect(result.salePrice).toMatchObject({ data: { amount: 10990 } });
    expect(result.priceToWin).toMatchObject({ data: { priceToWin: 9990, status: "competing" } });
    expect(result.automation).toMatchObject({ data: { active: true, ruleId: "rule-1" } });
    expect(result.automationGuard).toMatch(/automatización de precio activa/i);
  });

  it("returns partial errors when optional pricing endpoints are unavailable", async () => {
    const {
      getItemSalePrice: _getItemSalePrice,
      getItemPrices: _getItemPrices,
      getItemPriceToWin: _getItemPriceToWin,
      getPricingAutomation: _getPricingAutomation,
      getPricingAutomationItems: _getPricingAutomationItems,
      ...clientWithoutPricingEndpoints
    } = createStubMlcPriceClient();
    void [
      _getItemSalePrice,
      _getItemPrices,
      _getItemPriceToWin,
      _getPricingAutomation,
      _getPricingAutomationItems,
    ];
    const tool = createCheckPriceIntelligenceTool(clientWithoutPricingEndpoints);

    const result = await tool.execute({ sellerId: "plasticov", itemId: "MLC1001" });

    expect(result).toMatchObject({ noMutationExecuted: true });
    expect(result.partialErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ endpoint: "sale_price" }),
        expect.objectContaining({ endpoint: "prices" }),
        expect.objectContaining({ endpoint: "price_to_win" }),
        expect.objectContaining({ endpoint: "pricing_automation" }),
      ]),
    );
  });

  it("keeps available signals when an individual price endpoint fails", async () => {
    const tool = createCheckPriceIntelligenceTool({
      ...createStubMlcPriceClient(),
      getItemPriceToWin: async () => {
        throw new Error("price_to_win unavailable");
      },
    });

    const result = await tool.execute({ sellerId: "plasticov", itemId: "MLC1001" });

    expect(result.salePrice).toMatchObject({ data: { amount: 10990 } });
    expect(result.automation).toMatchObject({ data: { active: true } });
    expect(result.partialErrors).toEqual([
      { endpoint: "price_to_win", message: "price_to_win unavailable" },
    ]);
  });

  it("sanitizes upstream pricing endpoint failures before returning them", async () => {
    const tool = createCheckPriceIntelligenceTool({
      ...createStubMlcPriceClient(),
      getItemPriceToWin: async () => {
        throw new Error(
          `upstream failed Bearer secret-token-123 access_token=abc123 ` +
            `{"client_secret":"json-secret","password":"json-password","raw_secret":"raw-value"} ` +
            `postgres://user:db-password@localhost/db ` +
            `mongodb+srv://user:mongo-password@example.mongodb.net/db ${"x".repeat(900)}`,
        );
      },
    });

    const result = await tool.execute({ sellerId: "plasticov", itemId: "MLC1001" });

    expect(result.partialErrors).toEqual([
      {
        endpoint: "price_to_win",
        message: expect.stringContaining("Bearer [REDACTED]"),
      },
    ]);
    const partialError = (result.partialErrors as Array<{ message: string }>)[0]!;
    expect(partialError.message).toContain("access_token=[REDACTED]");
    expect(partialError.message).toContain('"client_secret":"[REDACTED]"');
    expect(partialError.message).toContain('"password":"[REDACTED]"');
    expect(partialError.message).toContain('"raw_secret":"[REDACTED]"');
    expect(partialError.message).toContain("postgres://[REDACTED]");
    expect(partialError.message).toContain("mongodb+srv://[REDACTED]");
    expect(partialError.message).not.toContain("secret-token-123");
    expect(partialError.message).not.toContain("abc123");
    expect(partialError.message).not.toContain("json-secret");
    expect(partialError.message).not.toContain("json-password");
    expect(partialError.message).not.toContain("raw-value");
    expect(partialError.message).not.toContain("db-password");
    expect(partialError.message).not.toContain("mongo-password");
    expect(partialError.message.length).toBeLessThanOrEqual(512);
  });

  it("sanitizes automated price item list failures before returning them", async () => {
    const tool = createFindAutomatedPriceItemsTool({
      ...createStubMlcPriceClient(),
      getPricingAutomationItems: async () => {
        throw new Error("boom client_secret=super-secret-token");
      },
    });

    const result = await tool.execute({ sellerId: "plasticov" });

    expect(result.error).toContain("client_secret=[REDACTED]");
    expect(result.error).not.toContain("super-secret-token");
  });

  it("lists automated price items without mutations", async () => {
    const tool = createFindAutomatedPriceItemsTool(createStubMlcPriceClient());

    const result = await tool.execute({ sellerId: "plasticov", limit: 100 });

    expect(result).toMatchObject({
      noMutationExecuted: true,
      data: { items: [{ itemId: "MLC1001", ruleId: "rule-1" }] },
    });
    expect(result.automationGuard).toMatch(/antes de editar un precio/i);
    expect(result.summary).toMatch(/1 publicaciones/i);
  });
});

describe("createAuditAllQualityTool — unit", () => {
  it("returns latest quality snapshot per item ranked from worst to best", async () => {
    const cortex = createGraphEngine(":memory:");
    const tool = createAuditAllQualityTool(cortex);

    cortex.createNode("quality_MLC1001_old", {
      type: "quality_snapshot",
      sellerId: "plasticov",
      itemId: "MLC1001",
      score: 82,
      levelWording: "Good",
      pendingOpportunities: 1,
      capturedAt: "2026-07-01T08:00:00Z",
    });
    cortex.createNode("quality_MLC1001_new", {
      type: "quality_snapshot",
      sellerId: "plasticov",
      itemId: "MLC1001",
      score: 55,
      levelWording: "Poor",
      pendingOpportunities: 4,
      capturedAt: "2026-07-01T12:00:00Z",
    });
    cortex.createNode("quality_MLC1002", {
      type: "quality_snapshot",
      sellerId: "plasticov",
      itemId: "MLC1002",
      score: 72,
      levelWording: "Good",
      pendingOpportunities: 0,
      capturedAt: "2026-07-01T11:00:00Z",
    });

    const result = await tool.execute({ sellerId: "plasticov" });
    const items = result.items as Array<Record<string, unknown>>;

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.itemId)).toEqual(["MLC1001", "MLC1002"]);
    expect(items[0]).toMatchObject({ score: 55, level: "Poor", pendingOpportunities: 4 });
    expect(result.metadata).toMatchObject({ avgScore: 64, totalItems: 2, lowScoreCount: 1 });
    expect(result.summary).toMatch(/2 publicaciones auditadas/i);

    cortex.db.close();
  });

  it("returns empty result when Cortex has no quality snapshots", async () => {
    const cortex = createGraphEngine(":memory:");
    const tool = createAuditAllQualityTool(cortex);

    const result = await tool.execute({ sellerId: "plasticov" });

    expect(result).toMatchObject({ items: [] });
    expect(result.summary).toMatch(/no hay datos de calidad/i);

    cortex.db.close();
  });
});

describe("createFindRelistOpportunitiesTool — unit", () => {
  it("returns relist opportunities with expiry dates and urgency metadata", async () => {
    const cortex = createGraphEngine(":memory:");
    const tool = createFindRelistOpportunitiesTool(cortex);

    cortex.createNode("relist_MLC2001", {
      type: "relist_opportunity",
      sellerId: "plasticov",
      itemId: "MLC2001",
      title: "Closed winner",
      daysSinceClose: 55,
      hadSalesHistory: true,
      suggestedPrice: 19990,
      closedAt: "2026-06-01T00:00:00Z",
    });
    cortex.createNode("relist_MLC2002", {
      type: "relist_opportunity",
      sellerId: "plasticov",
      itemId: "MLC2002",
      title: "Recent close",
      daysSinceClose: 12,
      hadSalesHistory: true,
      suggestedPrice: 9990,
      closedAt: "2026-06-20T00:00:00Z",
    });

    const result = await tool.execute({ sellerId: "plasticov" });
    const items = result.items as Array<Record<string, unknown>>;

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.itemId)).toEqual(
      expect.arrayContaining(["MLC2001", "MLC2002"]),
    );
    expect(items.find((item) => item.itemId === "MLC2001")).toMatchObject({
      expiresAt: "2026-07-31",
      suggestedPrice: 19990,
    });
    expect(result.metadata).toMatchObject({ total: 2, urgent: 1 });

    cortex.db.close();
  });

  it("filters relist opportunities to urgent items only", async () => {
    const cortex = createGraphEngine(":memory:");
    const tool = createFindRelistOpportunitiesTool(cortex);

    cortex.createNode("relist_urgent", {
      type: "relist_opportunity",
      sellerId: "maustian",
      itemId: "MLC3001",
      daysSinceClose: 58,
    });
    cortex.createNode("relist_regular", {
      type: "relist_opportunity",
      sellerId: "maustian",
      itemId: "MLC3002",
      daysSinceClose: 20,
    });

    const result = await tool.execute({ sellerId: "maustian", urgent: true });
    const items = result.items as Array<Record<string, unknown>>;

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ itemId: "MLC3001", daysSinceClose: 58 });
    expect(result.metadata).toMatchObject({ total: 1, urgent: 1 });

    cortex.db.close();
  });
});

// ---------------------------------------------------------------------------
// Agent integration tests
// ---------------------------------------------------------------------------

describe("sync tools — agent loop integration", () => {
  const systemPrompt = "Eres Plasticov, asistente comercial. Respondé en español.";

  it("includes sync_product, sync_all, account, and MLC read tools in tool map when configured", () => {
    const engine = createStubSyncEngine();
    const mlClient = createStubMlClient();
    const mlcClient = createStubMlcPriceClient();

    // We can't directly inspect the internal toolMap, but we verify the
    // agent creates without errors when sync tools are configured.
    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      syncEngine: engine,
      mlClient,
      mlcClient,
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
