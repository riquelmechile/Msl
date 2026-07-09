import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createGraphEngine } from "./cortex/index.js";
import { createSqliteSupplierMirrorStore } from "./supplierMirrorStore.js";
import type { SupplierMirrorStore } from "./supplierMirrorStore.js";
import type { GraphEngine } from "./cortex/engine.js";
import {
  ingestSupplierToCortex,
  ingestFallbackLessonToCortex,
  getCortexNodeIdsForSupplierCandidate,
  ingestAllSuppliersToCortex,
} from "./supplierMirrorCortexBridge.js";
import type { SupplierLearnedFallbackPolicy } from "@msl/domain";

// ── Helpers ──────────────────────────────────────────────────────────

function createTestStore(): { store: SupplierMirrorStore; close: () => void } {
  const db = new Database(":memory:");
  const store = createSqliteSupplierMirrorStore(db);
  return { store, close: () => db.close() };
}

function createTestEngine(): GraphEngine {
  return createGraphEngine(":memory:");
}

function seedTestSupplier(store: SupplierMirrorStore): Promise<void> {
  return store.upsertSupplier({
    id: "jinpeng",
    name: "Jinpeng Test",
    enabled: true,
    primarySource: "mercadolibre-api" as const,
    metadata: {},
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  });
}

async function seedTestItem(store: SupplierMirrorStore): Promise<void> {
  await store.upsertSupplierItemSnapshot({
    supplierId: "jinpeng",
    supplierItemId: "SKU-001",
    title: "Test Widget",
    sku: "TST-001",
    categoryId: "CAT-123",
    price: 10000,
    currency: "CLP",
    snapshot: { source: "api" },
    source: "mercadolibre-api",
    confidence: "high",
    freshness: "fresh",
    evidenceId: "evt-item-001",
    capturedAt: "2026-07-01T12:00:00.000Z",
  });
}

async function seedTestStock(store: SupplierMirrorStore): Promise<void> {
  await store.recordStockObservation({
    id: "stock-001",
    supplierId: "jinpeng",
    supplierItemId: "SKU-001",
    source: "mercadolibre-api",
    authority: "stock-authoritative",
    quantity: 50,
    status: "in-stock",
    confidence: "high",
    evidenceId: "evt-stock-001",
    capturedAt: "2026-07-01T13:00:00.000Z",
  });
}

async function seedTestMapping(store: SupplierMirrorStore): Promise<void> {
  await store.upsertTargetMapping({
    supplierId: "jinpeng",
    supplierItemId: "SKU-001",
    targetSellerId: "plasticov",
    targetItemId: "MLC123",
    policyRef: {
      scopeType: "item",
      scopeId: "SKU-001",
      supplierId: "jinpeng",
    },
    state: "approved",
    approvedAt: "2026-07-01T14:00:00.000Z",
    evidenceIds: ["evt-map-001"],
  });
}

async function seedFullSupplier(store: SupplierMirrorStore): Promise<void> {
  await seedTestSupplier(store);
  await seedTestItem(store);
  await seedTestStock(store);
  await seedTestMapping(store);
}

// ── Tests ────────────────────────────────────────────────────────────

describe("supplierMirrorCortexBridge", () => {
  describe("ingestSupplierToCortex", () => {
    it("creates nodes for all supplier entity types", async () => {
      const { store, close } = createTestStore();
      const engine = createTestEngine();

      await seedFullSupplier(store);

      const result = await ingestSupplierToCortex(store, engine, "jinpeng");

      expect(result.supplierNodeId).toBeGreaterThan(0);
      expect(result.itemNodeIds).toHaveLength(1);
      expect(result.stockNodeIds).toHaveLength(1);
      expect(result.mappingNodeIds).toHaveLength(1);
      expect(result.edgesCreated).toBeGreaterThan(0);

      // Verify nodes exist in graph by label
      const supplierNode = engine.getNode(result.supplierNodeId);
      expect(supplierNode).not.toBeNull();
      expect(supplierNode!.label).toBe("supplier_jinpeng");

      const itemNode = engine.getNode(result.itemNodeIds[0]!);
      expect(itemNode).not.toBeNull();
      expect(itemNode!.label).toBe("supplier_item_jinpeng_SKU-001");

      const stockNode = engine.getNode(result.stockNodeIds[0]!);
      expect(stockNode).not.toBeNull();
      expect(stockNode!.label).toBe("supplier_stock_jinpeng_SKU-001");

      const mappingNode = engine.getNode(result.mappingNodeIds[0]!);
      expect(mappingNode).not.toBeNull();
      expect(mappingNode!.label).toBe("supplier_mapping_jinpeng_SKU-001_plasticov");

      close();
    });

    it("is idempotent on double ingestion — node count unchanged", async () => {
      const { store, close } = createTestStore();
      const engine = createTestEngine();

      await seedFullSupplier(store);

      const first = await ingestSupplierToCortex(store, engine, "jinpeng");
      const second = await ingestSupplierToCortex(store, engine, "jinpeng");

      expect(second.supplierNodeId).toBe(first.supplierNodeId);
      expect(second.itemNodeIds).toEqual(first.itemNodeIds);
      expect(second.stockNodeIds).toEqual(first.stockNodeIds);
      expect(second.mappingNodeIds).toEqual(first.mappingNodeIds);

      // edgesCreated should be 0 on re-ingestion (no new edges)
      expect(second.edgesCreated).toBe(0);

      close();
    });

    it("creates edges with correct weights", async () => {
      const { store, close } = createTestStore();
      const engine = createTestEngine();

      await seedFullSupplier(store);

      const result = await ingestSupplierToCortex(store, engine, "jinpeng");

      // supplier → item: 0.8
      const supItemEdge = engine.db
        .prepare("SELECT weight FROM edges WHERE source = ? AND target = ?")
        .get(result.supplierNodeId, result.itemNodeIds[0]!) as { weight: number } | undefined;
      expect(supItemEdge).toBeDefined();
      expect(supItemEdge!.weight).toBeCloseTo(0.8);

      // item → stock: 0.7
      const itemStockEdge = engine.db
        .prepare("SELECT weight FROM edges WHERE source = ? AND target = ?")
        .get(result.itemNodeIds[0]!, result.stockNodeIds[0]!) as { weight: number } | undefined;
      expect(itemStockEdge).toBeDefined();
      expect(itemStockEdge!.weight).toBeCloseTo(0.7);

      // item → mapping: 0.9
      const itemMappingEdge = engine.db
        .prepare("SELECT weight FROM edges WHERE source = ? AND target = ?")
        .get(result.itemNodeIds[0]!, result.mappingNodeIds[0]!) as { weight: number } | undefined;
      expect(itemMappingEdge).toBeDefined();
      expect(itemMappingEdge!.weight).toBeCloseTo(0.9);

      close();
    });

    it("returns empty result for unknown supplier", async () => {
      const { store, close } = createTestStore();
      const engine = createTestEngine();

      const result = await ingestSupplierToCortex(store, engine, "nonexistent");

      expect(result.supplierNodeId).toBe(0);
      expect(result.itemNodeIds).toHaveLength(0);
      expect(result.stockNodeIds).toHaveLength(0);
      expect(result.mappingNodeIds).toHaveLength(0);
      expect(result.edgesCreated).toBe(0);

      close();
    });

    it("handles missing stock observation gracefully", async () => {
      const { store, close } = createTestStore();
      const engine = createTestEngine();

      await seedTestSupplier(store);
      await seedTestItem(store);
      // No stock observation seeded

      const result = await ingestSupplierToCortex(store, engine, "jinpeng");

      expect(result.supplierNodeId).toBeGreaterThan(0);
      expect(result.itemNodeIds).toHaveLength(1);
      expect(result.stockNodeIds).toHaveLength(0);
      expect(result.edgesCreated).toBeGreaterThan(0);

      close();
    });
  });

  describe("ingestFallbackLessonToCortex", () => {
    it("creates a lesson node and returns its id", async () => {
      const engine = createTestEngine();

      const lesson: SupplierLearnedFallbackPolicy = {
        id: "lesson-001",
        policyType: "pricing",
        scope: {
          supplierId: "jinpeng",
          scopeType: "supplier",
          scopeId: "jinpeng",
        },
        decision: {
          decisionText: "Use x3 for Jinpeng items",
          recordedFrom: "ceo-workflow",
        },
        confidence: "medium",
        evidenceIds: ["evt-lesson-001"],
        status: "active",
      };

      const nodeId = await ingestFallbackLessonToCortex(engine, lesson);
      expect(nodeId).toBeGreaterThan(0);

      const node = engine.getNode(nodeId);
      expect(node).not.toBeNull();
      expect(node!.label).toBe("supplier_lesson_jinpeng_lesson-001");

      const metadata = JSON.parse(node!.metadata) as Record<string, unknown>;
      expect(metadata.type).toBe("supplier_lesson");
      expect(metadata.supplierId).toBe("jinpeng");
      expect(metadata.policyType).toBe("pricing");

      engine.db.close();
    });

    it("throws when scope.supplierId is missing", async () => {
      const engine = createTestEngine();

      const lesson: SupplierLearnedFallbackPolicy = {
        id: "bad-lesson",
        policyType: "notification",
        scope: {},
        decision: { decisionText: "test" },
        confidence: "low",
        evidenceIds: [],
        status: "proposed",
      };

      await expect(ingestFallbackLessonToCortex(engine, lesson)).rejects.toThrow(
        "scope.supplierId is missing",
      );

      engine.db.close();
    });
  });

  describe("getCortexNodeIdsForSupplierCandidate", () => {
    it("returns node IDs for item, stock, and mapping nodes", async () => {
      const { store, close } = createTestStore();
      const engine = createTestEngine();

      await seedFullSupplier(store);
      await ingestSupplierToCortex(store, engine, "jinpeng");

      const ids = getCortexNodeIdsForSupplierCandidate(engine, "jinpeng", "SKU-001");

      // Should have item + stock + mapping node IDs
      expect(ids.length).toBeGreaterThanOrEqual(3);

      // Verify actual node labels
      const labels = ids.map((id) => engine.getNode(id)?.label).filter(Boolean);
      expect(labels).toContain("supplier_item_jinpeng_SKU-001");
      expect(labels).toContain("supplier_stock_jinpeng_SKU-001");
      expect(labels).toContain("supplier_mapping_jinpeng_SKU-001_plasticov");

      close();
      engine.db.close();
    });

    it("returns empty array when cortex is undefined", () => {
      const ids = getCortexNodeIdsForSupplierCandidate(undefined, "jinpeng", "SKU-001");
      expect(ids).toEqual([]);
    });

    it("returns empty array for non-existent item", async () => {
      const { store, close } = createTestStore();
      const engine = createTestEngine();

      await seedFullSupplier(store);
      await ingestSupplierToCortex(store, engine, "jinpeng");

      const ids = getCortexNodeIdsForSupplierCandidate(engine, "jinpeng", "SKU-NONEXISTENT");

      expect(ids).toEqual([]);

      close();
    });
  });

  describe("ingestAllSuppliersToCortex", () => {
    it("handles per-supplier errors without aborting the batch", async () => {
      const { store, close } = createTestStore();
      const engine = createTestEngine();

      // Seed supplier A (will succeed)
      await store.upsertSupplier({
        id: "supplier-a",
        name: "Supplier A",
        enabled: true,
        primarySource: "mercadolibre-api" as const,
        metadata: {},
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      });
      await store.upsertSupplierItemSnapshot({
        supplierId: "supplier-a",
        supplierItemId: "SKU-A1",
        title: "Item A1",
        sku: "SKU-A1",
        categoryId: "CAT-1",
        price: 10000,
        currency: "CLP",
        snapshot: { source: "api" },
        source: "mercadolibre-api",
        confidence: "high" as const,
        freshness: "fresh" as const,
        evidenceId: "evt-a-001",
        capturedAt: "2026-07-01T12:00:00.000Z",
      });

      // Seed supplier B (will fail during item listing)
      await store.upsertSupplier({
        id: "supplier-b",
        name: "Supplier B",
        enabled: true,
        primarySource: "mercadolibre-api" as const,
        metadata: {},
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      });

      // Spy: listSupplierItemSnapshots throws for supplier-b
      const originalListItems = store.listSupplierItemSnapshots;
      const spy = vi.spyOn(store as any, "listSupplierItemSnapshots");
      spy.mockImplementation(async (supplierId: string) => {
        if (supplierId === "supplier-b") {
          throw new Error("Simulated DB failure for supplier-b");
        }
        return originalListItems(supplierId);
      });

      const results = await ingestAllSuppliersToCortex(store, engine);

      expect(results).toHaveLength(2);
      // supplier-a succeeded
      expect(results[0]!.supplierNodeId).toBeGreaterThan(0);
      expect(results[0]!.itemNodeIds).toHaveLength(1);
      // supplier-b failed gracefully
      expect(results[1]!.supplierNodeId).toBe(0);
      expect(results[1]!.itemNodeIds).toHaveLength(0);
      expect(results[1]!.stockNodeIds).toHaveLength(0);
      expect(results[1]!.mappingNodeIds).toHaveLength(0);
      expect(results[1]!.lessonNodeIds).toHaveLength(0);
      expect(results[1]!.edgesCreated).toBe(0);

      spy.mockRestore();
      engine.db.close();
      close();
    });
  });
});
