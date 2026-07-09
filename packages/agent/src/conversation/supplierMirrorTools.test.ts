import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import {
  createGraphEngine,
  createSqliteSupplierMirrorStore,
  ingestSupplierToCortex,
} from "@msl/memory";
import type { SupplierMirrorStore } from "@msl/memory";
import { createSupplierMirrorTools } from "./supplierMirrorTools.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createTestStore(): { store: SupplierMirrorStore; close: () => void } {
  const db = new Database(":memory:");
  const store = createSqliteSupplierMirrorStore(db);
  return { store, close: () => db.close() };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("supplierMirrorTools", () => {
  describe("query_supplier_cortex_patterns", () => {
    it("returns blocked response when engine is undefined", async () => {
      const { store, close } = createTestStore();
      const tools = createSupplierMirrorTools(store);
      const tool = tools.find((t) => t.name === "query_supplier_cortex_patterns")!;

      const result = await tool.execute({ supplierId: "jinpeng" });

      expect(result).toMatchObject({
        status: "blocked",
        reason: expect.stringContaining("not wired"),
        noMutationExecuted: true,
      });

      close();
    });

    it("returns blocked response when supplierId is missing", async () => {
      const { store, close } = createTestStore();
      const engine = createGraphEngine(":memory:");
      const tools = createSupplierMirrorTools(store, undefined, engine);
      const tool = tools.find((t) => t.name === "query_supplier_cortex_patterns")!;

      const result = await tool.execute({});

      expect(result).toMatchObject({
        status: "blocked",
        missingInputs: ["supplierId"],
        noMutationExecuted: true,
      });

      engine.db.close();
      close();
    });

    it("returns pattern results when engine and supplierId are valid", async () => {
      const { store, close } = createTestStore();
      const engine = createGraphEngine(":memory:");

      // Seed supplier in store and ingest into Cortex
      await store.upsertSupplier({
        id: "jinpeng",
        name: "Jinpeng Test",
        enabled: true,
        primarySource: "mercadolibre-api" as const,
        metadata: {},
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      });
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
        confidence: "high" as const,
        freshness: "fresh" as const,
        evidenceId: "evt-item-001",
        capturedAt: "2026-07-01T12:00:00.000Z",
      });
      await store.recordStockObservation({
        id: "stock-001",
        supplierId: "jinpeng",
        supplierItemId: "SKU-001",
        source: "mercadolibre-api",
        authority: "stock-authoritative",
        quantity: 50,
        status: "in-stock" as const,
        confidence: "high" as const,
        evidenceId: "evt-stock-001",
        capturedAt: "2026-07-01T13:00:00.000Z",
      });
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
        state: "approved" as const,
        approvedAt: "2026-07-01T14:00:00.000Z",
        evidenceIds: ["evt-map-001"],
      });

      // Ingest supplier into Cortex so nodes exist
      await ingestSupplierToCortex(store, engine, "jinpeng");

      const tools = createSupplierMirrorTools(store, undefined, engine);
      const tool = tools.find((t) => t.name === "query_supplier_cortex_patterns")!;

      const result = await tool.execute({ supplierId: "jinpeng" });

      // Tool should return query results without a status field
      expect(result).toMatchObject({
        supplierId: "jinpeng",
        queryType: "all",
        noMutationExecuted: true,
        workerSelectionExposed: false,
      });
      // Ensure all query result fields are present
      expect(result).toHaveProperty("profileNodes");
      expect(result).toHaveProperty("itemNodes");
      expect(result).toHaveProperty("mappingNodes");
      expect(result).toHaveProperty("spreadActivation");

      engine.db.close();
      close();
    });
  });

  describe("record_supplier_mirror_fallback_lesson Cortex wiring", () => {
    it("ingests fallback lesson to Cortex when engine is provided", async () => {
      const { store, close } = createTestStore();
      const engine = createGraphEngine(":memory:");

      await store.upsertSupplier({
        id: "jinpeng",
        name: "Jinpeng Test",
        enabled: true,
        primarySource: "mercadolibre-api" as const,
        metadata: {},
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      });

      const tools = createSupplierMirrorTools(store, undefined, engine);
      const tool = tools.find((t) => t.name === "record_supplier_mirror_fallback_lesson")!;

      const result = await tool.execute({
        lessonType: "pricing",
        supplierId: "jinpeng",
        decisionText: "Use x2.5 multiplier",
        evidenceIds: [],
      });

      expect(result).toMatchObject({
        status: "recorded",
        noMutationExecuted: true,
      });

      // Verify lesson node was actually created in Cortex via ingestFallbackLessonToCortex
      const lessonNode = engine.db
        .prepare("SELECT id, label FROM nodes WHERE label LIKE 'supplier_lesson_jinpeng_%'")
        .get() as { id: number; label: string } | undefined;
      expect(lessonNode).toBeDefined();
      expect(lessonNode!.label).toContain("supplier_lesson_jinpeng_");

      engine.db.close();
      close();
    });

    it("skips Cortex ingestion silently when engine is undefined", async () => {
      const { store, close } = createTestStore();

      const tools = createSupplierMirrorTools(store);
      const tool = tools.find((t) => t.name === "record_supplier_mirror_fallback_lesson")!;

      // Should not throw despite no engine — Cortex block is skipped
      const result = await tool.execute({
        lessonType: "notification",
        supplierId: "jinpeng",
        decisionText: "Do not notify me about this anymore",
        suppressNotifications: true,
        evidenceIds: [],
      });

      expect(result).toMatchObject({
        status: "recorded",
        noMutationExecuted: true,
      });

      close();
    });

    it("catches ingestFallbackLessonToCortex errors and continues (non-blocking)", async () => {
      const { store, close } = createTestStore();
      const engine = createGraphEngine(":memory:");

      await store.upsertSupplier({
        id: "jinpeng",
        name: "Jinpeng Test",
        enabled: true,
        primarySource: "mercadolibre-api" as const,
        metadata: {},
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      });

      const tools = createSupplierMirrorTools(store, undefined, engine);
      const tool = tools.find((t) => t.name === "record_supplier_mirror_fallback_lesson")!;

      // Close the engine DB so ingestFallbackLessonToCortex throws
      engine.db.close();

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Should NOT throw — error is caught and logged
      const result = await tool.execute({
        lessonType: "pricing",
        supplierId: "jinpeng",
        decisionText: "Use x2.5 multiplier",
        evidenceIds: [],
      });

      expect(result).toMatchObject({
        status: "recorded",
        noMutationExecuted: true,
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to ingest fallback lesson to Cortex:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
      close();
    });
  });
});
