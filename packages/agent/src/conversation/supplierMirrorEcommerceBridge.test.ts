import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  createSqliteSupplierMirrorStore,
  createGraphEngine,
  ingestSupplierToCortex,
} from "@msl/memory";
import type { SupplierMirrorStore } from "@msl/memory";
import { buildEcommerceCandidatesFromSupplierMirror } from "./supplierMirrorEcommerceBridge.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createTestStore(): { store: SupplierMirrorStore; close: () => void } {
  const db = new Database(":memory:");
  const store = createSqliteSupplierMirrorStore(db);
  return { store, close: () => db.close() };
}

async function seedSupplier(store: SupplierMirrorStore): Promise<void> {
  await store.upsertSupplier({
    id: "jinpeng",
    name: "Jinpeng Test",
    enabled: true,
    primarySource: "mercadolibre-api",
    metadata: {},
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  });
}

async function seedItem(
  store: SupplierMirrorStore,
  overrides: Partial<{
    supplierItemId: string;
    title: string;
    evidenceId: string;
    confidence: string;
  }> = {},
): Promise<void> {
  await store.upsertSupplierItemSnapshot({
    supplierId: "jinpeng",
    supplierItemId: overrides.supplierItemId ?? "SKU-001",
    title: overrides.title ?? "Test Widget",
    snapshot: {},
    source: "mercadolibre-api",
    confidence: (overrides.confidence ?? "high") as "high" | "medium" | "low",
    freshness: "fresh",
    evidenceId: overrides.evidenceId ?? "evt-item-001",
    capturedAt: "2026-07-01T12:00:00.000Z",
  });
}

async function seedStock(
  store: SupplierMirrorStore,
  overrides: Partial<{
    supplierItemId: string;
    status: string;
    quantity: number;
    evidenceId: string;
  }> = {},
): Promise<void> {
  await store.recordStockObservation({
    id: `stock-${overrides.supplierItemId ?? "SKU-001"}`,
    supplierId: "jinpeng",
    supplierItemId: overrides.supplierItemId ?? "SKU-001",
    source: "mercadolibre-api",
    authority: "stock-authoritative",
    quantity: overrides.quantity ?? 50,
    status: (overrides.status ?? "in-stock") as
      "in-stock" | "low-stock" | "out-of-stock" | "unknown",
    confidence: "high",
    evidenceId: overrides.evidenceId ?? "evt-stock-001",
    capturedAt: "2026-07-01T13:00:00.000Z",
  });
}

async function seedMapping(
  store: SupplierMirrorStore,
  overrides: Partial<{
    supplierItemId: string;
    targetSellerId: string;
    targetItemId: string;
  }> = {},
): Promise<void> {
  await store.upsertTargetMapping({
    supplierId: "jinpeng",
    supplierItemId: overrides.supplierItemId ?? "SKU-001",
    targetSellerId: overrides.targetSellerId ?? "plasticov",
    targetItemId: overrides.targetItemId ?? "MLC123",
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

// ── Tests ────────────────────────────────────────────────────────────

describe("supplierMirrorEcommerceBridge", () => {
  describe("buildEcommerceCandidatesFromSupplierMirror", () => {
    it("returns candidates for in-stock items (default filter)", async () => {
      const { store, close } = createTestStore();
      await seedSupplier(store);
      await seedItem(store);
      await seedStock(store);
      await seedMapping(store);

      const candidates = await buildEcommerceCandidatesFromSupplierMirror(store, {
        supplierId: "jinpeng",
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.itemRef).toBe("MLC123");
      expect(candidates[0]!.title).toBe("Test Widget");
      expect(candidates[0]!.stock.status).toBe("in-stock");

      close();
    });

    it("filters out items below minStockStatus", async () => {
      const { store, close } = createTestStore();
      await seedSupplier(store);

      // Two items: one in-stock, one low-stock
      await seedItem(store, { supplierItemId: "SKU-001", evidenceId: "evt-item-001" });
      await seedStock(store, { supplierItemId: "SKU-001", status: "in-stock" });
      await seedMapping(store, { supplierItemId: "SKU-001", targetItemId: "MLC001" });

      await seedItem(store, { supplierItemId: "SKU-002", evidenceId: "evt-item-002" });
      await seedStock(store, { supplierItemId: "SKU-002", status: "low-stock" });
      await seedMapping(store, { supplierItemId: "SKU-002", targetItemId: "MLC002" });

      const candidates = await buildEcommerceCandidatesFromSupplierMirror(store, {
        supplierId: "jinpeng",
        minStockStatus: "in-stock",
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.itemRef).toBe("MLC001");

      close();
    });

    it("includes low-stock items when minStockStatus is low-stock", async () => {
      const { store, close } = createTestStore();
      await seedSupplier(store);

      await seedItem(store, { supplierItemId: "SKU-001", evidenceId: "evt-item-001" });
      await seedStock(store, { supplierItemId: "SKU-001", status: "in-stock" });
      await seedMapping(store, { supplierItemId: "SKU-001", targetItemId: "MLC001" });

      await seedItem(store, { supplierItemId: "SKU-002", evidenceId: "evt-item-002" });
      await seedStock(store, { supplierItemId: "SKU-002", status: "low-stock" });
      await seedMapping(store, { supplierItemId: "SKU-002", targetItemId: "MLC002" });

      const candidates = await buildEcommerceCandidatesFromSupplierMirror(store, {
        supplierId: "jinpeng",
        minStockStatus: "low-stock",
      });

      expect(candidates).toHaveLength(2);

      close();
    });

    it("populates provenance fields correctly", async () => {
      const { store, close } = createTestStore();
      await seedSupplier(store);
      await seedItem(store);
      await seedStock(store);
      await seedMapping(store);

      const candidates = await buildEcommerceCandidatesFromSupplierMirror(store, {
        supplierId: "jinpeng",
      });

      expect(candidates).toHaveLength(1);
      const provenance = candidates[0]!.provenance;
      expect(provenance.source).toBe("supplier-mirror");
      expect(provenance.supplierId).toBe("jinpeng");
      expect(provenance.snapshotIds).toContain("evt-item-001");
      expect(provenance.evidenceIds).toContain("evt-item-001");
      expect(provenance.evidenceIds).toContain("evt-stock-001");
      expect(provenance.evidenceIds).toContain("evt-map-001");
      expect(provenance.sourceId).toBe("supplier-mirror:jinpeng:SKU-001");

      close();
    });

    it("returns empty array when supplier does not exist", async () => {
      const { store, close } = createTestStore();

      const candidates = await buildEcommerceCandidatesFromSupplierMirror(store, {
        supplierId: "nonexistent",
      });

      expect(candidates).toEqual([]);

      close();
    });

    it("returns empty array when no approved mappings exist", async () => {
      const { store, close } = createTestStore();
      await seedSupplier(store);
      await seedItem(store);
      await seedStock(store);
      // No mapping seeded

      const candidates = await buildEcommerceCandidatesFromSupplierMirror(store, {
        supplierId: "jinpeng",
      });

      expect(candidates).toEqual([]);

      close();
    });

    it("returns empty array when no stock observation exists", async () => {
      const { store, close } = createTestStore();
      await seedSupplier(store);
      await seedItem(store);
      await seedMapping(store);
      // No stock seeded

      const candidates = await buildEcommerceCandidatesFromSupplierMirror(store, {
        supplierId: "jinpeng",
      });

      expect(candidates).toEqual([]);

      close();
    });

    it("populates cortexNodeIds when cortex engine is provided", async () => {
      const { store, close } = createTestStore();
      const engine = createGraphEngine(":memory:");
      await seedSupplier(store);
      await seedItem(store);
      await seedStock(store);
      await seedMapping(store);

      // Ingest into Cortex
      await ingestSupplierToCortex(store, engine, "jinpeng");

      const candidates = await buildEcommerceCandidatesFromSupplierMirror(store, {
        supplierId: "jinpeng",
        cortex: engine,
      });

      expect(candidates).toHaveLength(1);
      const provenance = candidates[0]!.provenance;
      expect(provenance.cortexNodeIds).toBeDefined();
      expect(provenance.cortexNodeIds!.length).toBeGreaterThanOrEqual(3);

      close();
      engine.db.close();
    });
  });
});
