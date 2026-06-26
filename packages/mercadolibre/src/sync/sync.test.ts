import { describe, expect, it } from "vitest";

import type { MlItem, NewItem, MlWriteSnapshot } from "../types.js";
import {
  applyStrategies,
  type MarginStrategy,
  type CategoryFilterStrategy,
  type StockStrategy,
  type PricingRuleStrategy,
  type Strategy,
} from "./strategyApplier.js";

import {
  diffListings,
  isOutOfSync,
} from "./diffEngine.js";

import {
  createSyncStore,
  type SyncState,
} from "./syncStore.js";

import {
  createProductSyncEngine,
} from "./syncEngine.js";

import type { SyncJob } from "./syncEngine.js";

import type { MlClient } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides?: Partial<MlItem>): MlItem {
  return {
    id: "MLC1001",
    title: "Producto de prueba",
    price: 10000,
    available_quantity: 10,
    category_id: "MLC1000",
    seller_id: 12345,
    status: "active",
    pictures: [{ url: "https://example.com/img.jpg" }],
    attributes: [{ id: "BRAND", value_name: "Genérica" }],
    ...overrides,
  };
}

function makeSyncState(overrides?: Partial<SyncState>): SyncState {
  return {
    sourceItemId: "MLC1001",
    sourceSellerId: "plasticov",
    targetItemId: "MLC-NEW-1",
    targetSellerId: "maustian",
    lastSyncedAt: "2026-06-26T10:00:00.000Z",
    syncStatus: "synced",
    sourceData: JSON.stringify(makeItem()),
    targetData: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Strategy Applier tests
// ---------------------------------------------------------------------------

describe("Strategy Applier", () => {
  it("applies margin strategy: price * (1 + percentage)", () => {
    const item = makeItem({ price: 10000 });
    const strategy: MarginStrategy = { type: "margin", percentage: 0.50 };
    const result = applyStrategies(item, [strategy]);

    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.item.price).toBe(15000); // 10000 * 1.50
    }
  });

  it("applies 100% margin doubles the price", () => {
    const item = makeItem({ price: 10000 });
    const strategy: MarginStrategy = { type: "margin", percentage: 1.0 };
    const result = applyStrategies(item, [strategy]);

    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.item.price).toBe(20000);
    }
  });

  it("applies 0% margin keeps original price", () => {
    const item = makeItem({ price: 10000 });
    const strategy: MarginStrategy = { type: "margin", percentage: 0 };
    const result = applyStrategies(item, [strategy]);

    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.item.price).toBe(10000);
    }
  });

  it("excludes items by category filter", () => {
    const item = makeItem({ category_id: "MLC2000" });
    const strategy: CategoryFilterStrategy = {
      type: "category_filter",
      excluded: ["MLC2000", "MLC3000"],
    };
    const result = applyStrategies(item, [strategy]);

    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("category_excluded");
    }
  });

  it("passes items not in excluded categories", () => {
    const item = makeItem({ category_id: "MLC1000" });
    const strategy: CategoryFilterStrategy = {
      type: "category_filter",
      excluded: ["MLC2000"],
    };
    const result = applyStrategies(item, [strategy]);

    expect(result.applied).toBe(true);
  });

  it("overrides available_quantity with stock strategy", () => {
    const item = makeItem({ available_quantity: 50 });
    const strategy: StockStrategy = {
      type: "stock",
      available_quantity: 10,
    };
    const result = applyStrategies(item, [strategy]);

    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.item.available_quantity).toBe(10);
    }
  });

  it("caps available_quantity with stock limit", () => {
    const item = makeItem({ available_quantity: 100 });
    const strategy: StockStrategy = {
      type: "stock",
      limit: 20,
    };
    const result = applyStrategies(item, [strategy]);

    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.item.available_quantity).toBe(20);
    }
  });

  it("enforces minimum price via pricing floor", () => {
    const item = makeItem({ price: 5000 });
    const strategy: PricingRuleStrategy = {
      type: "pricing_rule",
      floor: 10000,
    };
    const result = applyStrategies(item, [strategy]);

    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.item.price).toBe(10000);
    }
  });

  it("caps price via pricing cap", () => {
    const item = makeItem({ price: 50000 });
    const strategy: PricingRuleStrategy = {
      type: "pricing_rule",
      cap: 30000,
    };
    const result = applyStrategies(item, [strategy]);

    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.item.price).toBe(30000);
    }
  });

  it("applies multiple strategies in correct order", () => {
    const item = makeItem({ price: 10000, category_id: "MLC1000" });
    const strategies: Strategy[] = [
      { type: "margin", percentage: 0.50 },       // 10000 → 15000
      { type: "pricing_rule", cap: 12000 },         // cap at 12000
      { type: "stock", available_quantity: 5 },
    ];
    const result = applyStrategies(item, strategies);

    expect(result.applied).toBe(true);
    if (result.applied) {
      // Margin applied, then capped
      expect(result.item.price).toBe(12000);
      expect(result.item.available_quantity).toBe(5);
    }
  });

  it("preserves item metadata in transformed listing", () => {
    const item = makeItem();
    const result = applyStrategies(item, []);

    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.item.title).toBe("Producto de prueba");
      expect(result.item.category_id).toBe("MLC1000");
      expect(result.item.pictures).toEqual(["https://example.com/img.jpg"]);
      expect(result.item.attributes).toEqual([
        { id: "BRAND", value_name: "Genérica" },
      ]);
    }
  });

  it("produces valid NewItem structure", () => {
    const item = makeItem();
    const result = applyStrategies(item, []);

    expect(result.applied).toBe(true);
    if (result.applied) {
      const newItem: NewItem = result.item;
      expect(typeof newItem.title).toBe("string");
      expect(typeof newItem.category_id).toBe("string");
      expect(typeof newItem.price).toBe("number");
      expect(typeof newItem.available_quantity).toBe("number");
      expect(Array.isArray(newItem.pictures)).toBe(true);
      expect(Array.isArray(newItem.attributes)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Diff Engine tests
// ---------------------------------------------------------------------------

describe("Diff Engine", () => {
  it("detects changed items when price differs", () => {
    const item = makeItem({ price: 12000 });
    const state = makeSyncState({
      sourceData: JSON.stringify(makeItem({ price: 10000 })),
    });

    expect(isOutOfSync(item, state)).toBe(true);
  });

  it("detects unchanged items when all fields match", () => {
    const original = makeItem();
    const item = makeItem(); // same values
    const state = makeSyncState({
      sourceData: JSON.stringify(original),
    });

    expect(isOutOfSync(item, state)).toBe(false);
  });

  it("detects changed when available_quantity differs", () => {
    const item = makeItem({ available_quantity: 5 });
    const state = makeSyncState({
      sourceData: JSON.stringify(makeItem({ available_quantity: 10 })),
    });

    expect(isOutOfSync(item, state)).toBe(true);
  });

  it("detects changed when title differs", () => {
    const item = makeItem({ title: "Nuevo título" });
    const state = makeSyncState({
      sourceData: JSON.stringify(makeItem({ title: "Viejo título" })),
    });

    expect(isOutOfSync(item, state)).toBe(true);
  });

  it("detects changed when status differs", () => {
    const item = makeItem({ status: "paused" });
    const state = makeSyncState({
      sourceData: JSON.stringify(makeItem({ status: "active" })),
    });

    expect(isOutOfSync(item, state)).toBe(true);
  });

  it("marks pending items as out of sync", () => {
    const item = makeItem();
    const state = makeSyncState({
      syncStatus: "pending",
      sourceData: null,
    });

    expect(isOutOfSync(item, state)).toBe(true);
  });

  it("marks failed items as out of sync", () => {
    const item = makeItem();
    const state = makeSyncState({
      syncStatus: "failed",
      sourceData: null,
    });

    expect(isOutOfSync(item, state)).toBe(true);
  });

  it("returns true for corrupt sourceData", () => {
    const item = makeItem();
    const state = makeSyncState({
      sourceData: "{ not valid json }",
    });

    expect(isOutOfSync(item, state)).toBe(true);
  });

  it("classifies new, changed, unchanged, removed across a batch", () => {
    const items: MlItem[] = [
      makeItem({ id: "MLC-A", price: 12000 }),                   // changed
      makeItem({ id: "MLC-B", price: 10000 }),                   // unchanged
      makeItem({ id: "MLC-C", price: 50000 }),                   // new (no sync state)
    ];

    const states: SyncState[] = [
      makeSyncState({
        sourceItemId: "MLC-A",
        sourceData: JSON.stringify(makeItem({ id: "MLC-A", price: 10000 })),
      }),
      makeSyncState({
        sourceItemId: "MLC-B",
        sourceData: JSON.stringify(makeItem({ id: "MLC-B", price: 10000 })),
      }),
      makeSyncState({
        sourceItemId: "MLC-D",
        sourceData: JSON.stringify(makeItem({ id: "MLC-D" })),
      }), // removed
    ];

    const diff = diffListings(items, states);

    expect(diff.changed.map((i) => i.id)).toEqual(["MLC-A"]);
    expect(diff.unchanged.map((i) => i.id)).toEqual(["MLC-B"]);
    expect(diff.new.map((i) => i.id)).toEqual(["MLC-C"]);
    expect(diff.removed).toEqual(["MLC-D"]);
  });

  it("handles empty inputs gracefully", () => {
    const diff = diffListings([], []);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.new).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sync Store tests
// ---------------------------------------------------------------------------

describe("Sync Store", () => {
  it("marks item as synced and retrieves state", () => {
    const store = createSyncStore();
    const item = makeItem();
    const published: MlWriteSnapshot = {
      id: "MLC-MAUSTIAN-1",
      permalink: "https://articulo.mercadolibre.cl/MLC-MAUSTIAN-1",
      status: "active",
      capturedAt: "2026-06-26T10:30:00.000Z",
    };

    store.markSynced({
      sourceItemId: item.id,
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      targetItemId: published.id,
      sourceItem: item,
      publishedItem: published,
    });

    const state = store.getSyncState(item.id, "plasticov", "maustian");
    expect(state).toBeDefined();
    expect(state!.syncStatus).toBe("synced");
    expect(state!.targetItemId).toBe("MLC-MAUSTIAN-1");
    expect(state!.sourceData).toBeDefined();

    const parsed = JSON.parse(state!.sourceData!) as { price: number };
    expect(parsed.price).toBe(10000);

    store.close();
  });

  it("marks item as failed", () => {
    const store = createSyncStore();
    store.markFailed("MLC-FAIL", "plasticov", "maustian");

    const state = store.getSyncState("MLC-FAIL", "plasticov", "maustian");
    expect(state).toBeDefined();
    expect(state!.syncStatus).toBe("failed");

    store.close();
  });

  it("returns undefined for unknown sync state", () => {
    const store = createSyncStore();
    expect(store.getSyncState("nonexistent", "plasticov", "maustian")).toBeUndefined();
    store.close();
  });

  it("detects out of sync when item has changed", () => {
    const store = createSyncStore();
    const originalItem = makeItem({ price: 10000 });
    const published: MlWriteSnapshot = {
      id: "MLC-TARGET-1",
      permalink: "https://example.com/MLC-TARGET-1",
      status: "active",
      capturedAt: "2026-06-26T10:00:00.000Z",
    };

    store.markSynced({
      sourceItemId: originalItem.id,
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      targetItemId: published.id,
      sourceItem: originalItem,
      publishedItem: published,
    });

    const changedItem = makeItem({ price: 15000 });
    expect(store.isOutOfSync("MLC1001", "plasticov", "maustian", changedItem)).toBe(true);

    store.close();
  });

  it("detects in sync when item unchanged", () => {
    const store = createSyncStore();
    const item = makeItem({ price: 10000 });
    const published: MlWriteSnapshot = {
      id: "MLC-TARGET-1",
      permalink: "https://example.com/MLC-TARGET-1",
      status: "active",
      capturedAt: "2026-06-26T10:00:00.000Z",
    };

    store.markSynced({
      sourceItemId: item.id,
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      targetItemId: published.id,
      sourceItem: item,
      publishedItem: published,
    });

    const sameItem = makeItem({ price: 10000 });
    expect(store.isOutOfSync("MLC1001", "plasticov", "maustian", sameItem)).toBe(false);

    store.close();
  });

  it("lists synced items for a seller pair", () => {
    const store = createSyncStore();
    const published: MlWriteSnapshot = {
      id: "MLC-T-1",
      permalink: "https://example.com/MLC-T-1",
      status: "active",
      capturedAt: "2026-06-26T10:00:00.000Z",
    };

    store.markSynced({
      sourceItemId: "A",
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      targetItemId: published.id,
      sourceItem: makeItem({ id: "A" }),
      publishedItem: published,
    });
    store.markSynced({
      sourceItemId: "B",
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      targetItemId: "MLC-T-2",
      sourceItem: makeItem({ id: "B" }),
      publishedItem: { ...published, id: "MLC-T-2" },
    });

    const list = store.listSynced("plasticov", "maustian");
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.sourceItemId).sort()).toEqual(["A", "B"]);

    store.close();
  });

  it("isolates seller pairs — different target not listed", () => {
    const store = createSyncStore();
    const published: MlWriteSnapshot = {
      id: "MLC-T-1",
      permalink: "https://example.com/MLC-T-1",
      status: "active",
      capturedAt: "2026-06-26T10:00:00.000Z",
    };

    store.markSynced({
      sourceItemId: "X",
      sourceSellerId: "plasticov",
      targetSellerId: "maustian",
      targetItemId: published.id,
      sourceItem: makeItem({ id: "X" }),
      publishedItem: published,
    });
    store.markSynced({
      sourceItemId: "Y",
      sourceSellerId: "plasticov",
      targetSellerId: "other",
      targetItemId: "MLC-OTHER",
      sourceItem: makeItem({ id: "Y" }),
      publishedItem: { ...published, id: "MLC-OTHER" },
    });

    const maustianList = store.listSynced("plasticov", "maustian");
    expect(maustianList).toHaveLength(1);
    expect(maustianList[0]!.sourceItemId).toBe("X");

    const otherList = store.listSynced("plasticov", "other");
    expect(otherList).toHaveLength(1);
    expect(otherList[0]!.sourceItemId).toBe("Y");

    store.close();
  });
});

// ---------------------------------------------------------------------------
// Sync Engine tests (using stub MlClient)
// ---------------------------------------------------------------------------

describe("Product Sync Engine", () => {
  // Minimal stub MlClient for engine tests
  function stubMlClient(
    items: MlItem[],
    publishResults?: Map<string, MlWriteSnapshot>,
    getItemError?: string,
  ): MlClient {
    const results = publishResults ?? new Map<string, MlWriteSnapshot>();

    return {
      // eslint-disable-next-line @typescript-eslint/require-await
      getItems: async (_sellerId: string) => ({
        sellerId: _sellerId,
        kind: "listing",
        source: "mercadolibre-api",
        data: items.map((i) => ({
          id: i.id,
          title: i.title,
          status: i.status,
          availableQuantity: i.available_quantity,
          price: i.price,
        })),
        completeness: "complete",
        freshness: {
          source: "mercadolibre-api",
          signalKind: "listing",
          risk: "medium",
          capturedAt: new Date(),
          maxAgeMs: 3600000,
          status: "fresh",
        },
        confidence: "high",
      }),
      // eslint-disable-next-line @typescript-eslint/require-await
      getItem: async (_sellerId: string, itemId: string) => {
        if (getItemError) {
          throw new Error(getItemError);
        }
        const item = items.find((i) => i.id === itemId);
        if (!item) throw new Error(`Item ${itemId} not found`);
        return item;
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      getOrders: async () => ({
        sellerId: "",
        kind: "order",
        source: "mercadolibre-api",
        data: [],
        completeness: "complete",
        freshness: {
          source: "mercadolibre-api",
          signalKind: "order",
          risk: "critical",
          capturedAt: new Date(),
          maxAgeMs: 300000,
          status: "fresh",
        },
        confidence: "high",
      }),
      // eslint-disable-next-line @typescript-eslint/require-await
      getQuestions: async () => ({
        sellerId: "",
        kind: "message",
        source: "mercadolibre-api",
        data: [],
        completeness: "complete",
        freshness: {
          source: "mercadolibre-api",
          signalKind: "message",
          risk: "critical",
          capturedAt: new Date(),
          maxAgeMs: 300000,
          status: "fresh",
        },
        confidence: "high",
      }),
      // eslint-disable-next-line @typescript-eslint/require-await
      publishItem: async (_sellerId: string, _item: NewItem) => {
        const existing = results.get(_item.title);
        if (existing) return existing;

        const snapshot: MlWriteSnapshot = {
          id: `MLC-PUB-${Date.now()}`,
          permalink: `https://articulo.mercadolibre.cl/MLC-PUB-${Date.now()}`,
          status: "active",
          capturedAt: new Date().toISOString(),
        };
        results.set(_item.title, snapshot);
        return snapshot;
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      updateItem: async () => ({
        id: "MLC-UPD",
        permalink: "https://example.com",
        status: "active",
        capturedAt: new Date().toISOString(),
      }),
      // eslint-disable-next-line @typescript-eslint/require-await
      getCategories: async () => ({
        sellerId: "",
        data: [],
        capturedAt: new Date().toISOString(),
      }),
      // eslint-disable-next-line @typescript-eslint/require-await
      getUserInfo: async () => ({
        sellerId: "",
        data: { id: 0, nickname: "", points: 0, level: "", status: "" },
        capturedAt: new Date().toISOString(),
      }),
    };
  }

  it("syncProduct publishes a single item with margin applied", async () => {
    const items = [makeItem({ id: "MLC-1", price: 10000 })];
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const result = await engine.syncProduct("plasticov", "maustian", "MLC-1", [
      { type: "margin", percentage: 0.50 },
    ]);

    expect(result.status).toBe("published");
    expect(result.sourcePrice).toBe(10000);
    expect(result.targetPrice).toBe(15000);
    expect(result.margin).toBe(0.5);
  });

  it("syncProduct skips when category excluded", async () => {
    const items = [makeItem({ id: "MLC-1", category_id: "MLC9999" })];
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const result = await engine.syncProduct("plasticov", "maustian", "MLC-1", [
      { type: "category_filter", excluded: ["MLC9999"] },
    ]);

    expect(result.status).toBe("skipped");
  });

  it("syncProduct returns unchanged when already synced and unchanged", async () => {
    const items = [makeItem({ id: "MLC-1", price: 10000 })];
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const store = createSyncStore();
    const engine = createProductSyncEngine({ source, target, store });

    // First sync
    await engine.syncProduct("plasticov", "maustian", "MLC-1", [
      { type: "margin", percentage: 0.50 },
    ]);

    // Second sync — same item, should be unchanged
    const result = await engine.syncProduct("plasticov", "maustian", "MLC-1", [
      { type: "margin", percentage: 0.50 },
    ]);

    expect(result.status).toBe("unchanged");

    store.close();
  });

  it("syncProduct re-publishes when source item changed", async () => {
    const originalItem = makeItem({ id: "MLC-1", price: 10000 });
    const source = stubMlClient([originalItem]);
    const target = stubMlClient([originalItem]);
    const store = createSyncStore();
    const engine = createProductSyncEngine({ source, target, store });

    // First sync
    await engine.syncProduct("plasticov", "maustian", "MLC-1", [
      { type: "margin", percentage: 0.50 },
    ]);

    // Change price
    const changedItem = makeItem({ id: "MLC-1", price: 12000 });
    const source2 = stubMlClient([changedItem]);
    const engine2 = createProductSyncEngine({ source: source2, target, store });

    const result = await engine2.syncProduct("plasticov", "maustian", "MLC-1", [
      { type: "margin", percentage: 0.50 },
    ]);

    expect(result.status).toBe("published");
    expect(result.targetPrice).toBe(18000); // 12000 * 1.50

    store.close();
  });

  it("syncAll processes all items in batch", async () => {
    const items = [
      makeItem({ id: "MLC-A", price: 1000 }),
      makeItem({ id: "MLC-B", price: 2000 }),
      makeItem({ id: "MLC-C", price: 3000 }),
    ];
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const report = await engine.syncAll(
      "plasticov",
      "maustian",
      [{ type: "margin", percentage: 0.30 }],
      { differential: false },
    );

    expect(report.total).toBe(3);
    expect(report.published).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.results).toHaveLength(3);

    // Verify pricing
    const prices = report.results.map((r) => r.targetPrice);
    expect(prices).toEqual([1300, 2600, 3900]); // price * 1.30
  });

  it("syncAll skips category-excluded items", async () => {
    const items = [
      makeItem({ id: "MLC-A", category_id: "MLC1000" }),
      makeItem({ id: "MLC-B", category_id: "MLC9999" }),
      makeItem({ id: "MLC-C", category_id: "MLC1000" }),
    ];
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const report = await engine.syncAll(
      "plasticov",
      "maustian",
      [
        { type: "category_filter", excluded: ["MLC9999"] },
        { type: "margin", percentage: 0.50 },
      ],
      { differential: false },
    );

    expect(report.total).toBe(3);
    expect(report.published).toBe(2);
    expect(report.skipped).toBe(1);
  });

  it("syncAll is differential by default — skips unchanged", async () => {
    const items = [
      makeItem({ id: "MLC-A", price: 1000 }),
      makeItem({ id: "MLC-B", price: 2000 }),
    ];
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const store = createSyncStore();

    // First sync — publish both
    const engine1 = createProductSyncEngine({ source, target, store });
    const report1 = await engine1.syncAll(
      "plasticov",
      "maustian",
      [{ type: "margin", percentage: 0.50 }],
      { differential: false },
    );
    expect(report1.published).toBe(2);

    // Second sync — nothing changed
    const engine2 = createProductSyncEngine({ source, target, store });
    const report2 = await engine2.syncAll(
      "plasticov",
      "maustian",
      [{ type: "margin", percentage: 0.50 }],
    );
    expect(report2.unchanged).toBe(2);
    expect(report2.published).toBe(0);

    store.close();
  });

  it("syncAll respects limit option", async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `MLC-${i}`, price: 1000 }),
    );
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const report = await engine.syncAll(
      "plasticov",
      "maustian",
      [{ type: "margin", percentage: 0.50 }],
      { differential: false, limit: 3 },
    );

    expect(report.total).toBe(10);
    expect(report.results).toHaveLength(3);
  });

  it("handles fetch error gracefully", async () => {
    const items = [makeItem({ id: "MLC-1" })];
    const source = stubMlClient(items, undefined, "Network error");
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const result = await engine.syncProduct("plasticov", "maustian", "MLC-1", []);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Network error");
  });

  it("calculates margin correctly for 0% margin", async () => {
    const items = [makeItem({ id: "MLC-1", price: 10000 })];
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const result = await engine.syncProduct("plasticov", "maustian", "MLC-1", [
      { type: "margin", percentage: 0 },
    ]);

    expect(result.margin).toBe(0);
    expect(result.targetPrice).toBe(10000);
  });

  // ── Concurrent sync tests ──────────────────────────────────────────

  it("syncAllConcurrent processes all items with concurrency 3", async () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      makeItem({ id: `MLC-C${i}`, price: 1000 + i * 100 }),
    );
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const report = await engine.syncAllConcurrent(
      "plasticov",
      "maustian",
      [{ type: "margin", percentage: 0.50 }],
      { concurrency: 3, differential: false },
    );

    expect(report.total).toBe(9);
    expect(report.published).toBe(9);
    expect(report.failed).toBe(0);
    expect(report.results).toHaveLength(9);
  });

  it("syncAllConcurrent with concurrency 5", async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: `MLC-D${i}`, price: 1000 }),
    );
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const report = await engine.syncAllConcurrent(
      "plasticov",
      "maustian",
      [{ type: "margin", percentage: 0.50 }],
      { concurrency: 5, differential: false },
    );

    expect(report.total).toBe(10);
    expect(report.published).toBe(10);
  });

  it("syncAllConcurrent with concurrency 10", async () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      makeItem({ id: `MLC-E${i}`, price: 1000 }),
    );
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const report = await engine.syncAllConcurrent(
      "plasticov",
      "maustian",
      [{ type: "margin", percentage: 0.50 }],
      { concurrency: 10, differential: false },
    );

    expect(report.total).toBe(15);
    expect(report.published).toBe(15);
  });

  it("syncAllConcurrent respects limit option", async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeItem({ id: `MLC-F${i}`, price: 1000 }),
    );
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const report = await engine.syncAllConcurrent(
      "plasticov",
      "maustian",
      [{ type: "margin", percentage: 0.50 }],
      { concurrency: 3, differential: false, limit: 5 },
    );

    expect(report.results).toHaveLength(5);
  });

  it("syncAllConcurrent handles empty listings", async () => {
    const source = stubMlClient([]);
    const target = stubMlClient([]);
    const engine = createProductSyncEngine({ source, target });

    const report = await engine.syncAllConcurrent(
      "plasticov",
      "maustian",
      [{ type: "margin", percentage: 0.50 }],
    );

    expect(report.total).toBe(0);
    expect(report.results).toHaveLength(0);
  });

  // ── Background sync tests ─────────────────────────────────────────

  it("syncAllBackground returns job token immediately", async () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `MLC-BG${i}`, price: 1000 }),
    );
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const start = Date.now();
    const { jobId, getStatus } = engine.syncAllBackground(
      "plasticov",
      "maustian",
      [{ type: "margin", percentage: 0.50 }],
      { concurrency: 3, differential: false },
    );

    // Should return nearly instantly (under 50ms for a sync job start)
    expect(Date.now() - start).toBeLessThan(50);
    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe("string");
    expect(jobId.length).toBeGreaterThan(10);

    // Initial status should be "running"
    const initialStatus = getStatus();
    expect(initialStatus.status).toBe("running");
    expect(initialStatus.jobId).toBe(jobId);

    // Wait for the background job to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    const finalStatus = getStatus();
    expect(["done", "running"]).toContain(finalStatus.status);
  });

  it("syncAllBackground tracks progress", async () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({ id: `MLC-BG2-${i}`, price: 1000 }),
    );
    const source = stubMlClient(items);
    const target = stubMlClient(items);
    const engine = createProductSyncEngine({ source, target });

    const { getStatus } = engine.syncAllBackground(
      "plasticov",
      "maustian",
      [{ type: "margin", percentage: 0.50 }],
      { concurrency: 1, differential: false },
    );

    // Wait for completion
    await new Promise((resolve) => setTimeout(resolve, 100));

    const status = getStatus();
    expect(status.status).toBe("done");
    expect(status.progress).toBeDefined();
  });
});
