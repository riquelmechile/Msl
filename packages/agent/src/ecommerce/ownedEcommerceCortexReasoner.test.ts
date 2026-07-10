import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { GraphEngine } from "@msl/memory";
import { OwnedEcommerceCortexReasoner } from "./ownedEcommerceCortexReasoner.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createTestEngine(): { engine: GraphEngine; close: () => void } {
  const db = new Database(":memory:");
  // Create minimal Cortex schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      activation REAL NOT NULL DEFAULT 0.0,
      metadata TEXT NOT NULL DEFAULT '{}',
      seller_id TEXT
    );
    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source INTEGER NOT NULL,
      target INTEGER NOT NULL,
      weight REAL NOT NULL DEFAULT 0.5,
      last_activated TEXT,
      co_occurrence_count INTEGER NOT NULL DEFAULT 0,
      distilled_lesson TEXT,
      seller_id TEXT,
      UNIQUE(source, target)
    );
    CREATE TABLE IF NOT EXISTS darwinian_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_node INTEGER NOT NULL,
      target_node INTEGER NOT NULL,
      lesson TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      seller_id TEXT
    );
  `);
  const engine = new GraphEngine(db);
  return { engine, close: () => db.close() };
}

type SeedSupplierItemOptions = {
  supplierId?: string;
  supplierItemId?: string;
  sellerId?: string;
  label?: string;
  metadata?: Record<string, unknown>;
};

function seedSupplierItemNodes(
  engine: GraphEngine,
  opts: SeedSupplierItemOptions = {},
): { supplierNodeId: number; supplierItemNodeId: number } {
  const supplierId = opts.supplierId ?? "jinpeng";
  const supplierItemId = opts.supplierItemId ?? "SKU-001";
  const label = opts.label ?? `supplier_item:${supplierItemId}`;
  const sellerId = opts.sellerId;

  // Create supplier node
  const supplierNode = engine.createNode(
    `supplier:${supplierId}`,
    { type: "supplier", supplierId },
    sellerId,
  );

  // Create supplier item node
  const itemNode = engine.createNode(
    label,
    { type: "supplier_item", itemId: supplierItemId, supplierId },
    sellerId,
  );

  // Set activation on seed nodes so spreadActivation can traverse
  engine.db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(itemNode.id);

  // Create edge between supplier and item
  engine.createEdge(supplierNode.id, itemNode.id);

  // Create context nodes connected to the item
  const priceNode = engine.createNode(
    `price:${supplierItemId}`,
    { type: "pricing", price: 15000, currency: "CLP", itemId: supplierItemId },
    sellerId,
  );
  engine.createEdge(itemNode.id, priceNode.id);

  const stockNode = engine.createNode(
    `stock:${supplierItemId}`,
    { type: "stock", quantity: 50, status: "in-stock", itemId: supplierItemId },
    sellerId,
  );
  engine.createEdge(itemNode.id, stockNode.id);

  const categoryNode = engine.createNode(
    `category:electronics`,
    { type: "category", categoryId: "MLC12345" },
    sellerId,
  );
  engine.createEdge(itemNode.id, categoryNode.id);

  return { supplierNodeId: supplierNode.id, supplierItemNodeId: itemNode.id };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("OwnedEcommerceCortexReasoner", () => {
  const reasoner = new OwnedEcommerceCortexReasoner();

  describe("findSupplierProductContext", () => {
    it("finds supplier item nodes by metadata", () => {
      const { engine, close } = createTestEngine();
      try {
        const { supplierItemNodeId } = seedSupplierItemNodes(engine, {
          supplierItemId: "SKU-001",
        });

        const context = reasoner.findSupplierProductContext(engine, "jinpeng", "SKU-001");

        expect(context.supplierItemNodes.length).toBeGreaterThanOrEqual(1);
        expect(context.supplierItemNodes.some((n) => n.id === supplierItemNodeId)).toBe(true);
      } finally {
        close();
      }
    });

    it("spreads activation to discover connected context nodes", () => {
      const { engine, close } = createTestEngine();
      try {
        seedSupplierItemNodes(engine, { supplierItemId: "SKU-001" });

        const context = reasoner.findSupplierProductContext(engine, "jinpeng", "SKU-001");

        // Should have activated more than just the supplier item nodes
        expect(context.activatedNodes.length).toBeGreaterThan(1);

        // Should include the pricing node
        const priceNodes = context.activatedNodes.filter((n) => n.label.includes("price"));
        expect(priceNodes.length).toBeGreaterThanOrEqual(1);

        // Should include the stock node
        const stockNodes = context.activatedNodes.filter((n) => n.label.includes("stock"));
        expect(stockNodes.length).toBeGreaterThanOrEqual(1);
      } finally {
        close();
      }
    });

    it("returns populated supplierId and supplierItemId in context", () => {
      const { engine, close } = createTestEngine();
      try {
        seedSupplierItemNodes(engine, {
          supplierId: "jinpeng",
          supplierItemId: "SKU-999",
        });

        const context = reasoner.findSupplierProductContext(engine, "jinpeng", "SKU-999");

        expect(context.supplierId).toBe("jinpeng");
        expect(context.supplierItemId).toBe("SKU-999");
      } finally {
        close();
      }
    });

    it("returns empty activatedNodes when no supplier item found", () => {
      const { engine, close } = createTestEngine();
      try {
        seedSupplierItemNodes(engine, { supplierItemId: "SKU-001" });

        const context = reasoner.findSupplierProductContext(engine, "jinpeng", "NONEXISTENT");

        expect(context.supplierItemNodes).toHaveLength(0);
        expect(context.activatedNodes).toHaveLength(0);
      } finally {
        close();
      }
    });

    it("seller isolation: different sellers get different results", () => {
      const { engine, close } = createTestEngine();
      try {
        // Seed plasticov items
        seedSupplierItemNodes(engine, {
          supplierItemId: "SKU-PLAST",
          sellerId: "plasticov",
        });
        // Seed maustian items
        seedSupplierItemNodes(engine, {
          supplierItemId: "SKU-MAUST",
          sellerId: "maustian",
        });

        // Query with plasticov scope
        const plasticovContext = reasoner.findSupplierProductContext(
          engine,
          "jinpeng",
          "SKU-PLAST",
          "plasticov",
        );

        // Query with maustian scope
        const maustianContext = reasoner.findSupplierProductContext(
          engine,
          "jinpeng",
          "SKU-MAUST",
          "maustian",
        );

        // Each context should only see its own items
        expect(plasticovContext.supplierItemNodes.length).toBeGreaterThanOrEqual(1);
        expect(maustianContext.supplierItemNodes.length).toBeGreaterThanOrEqual(1);

        // Plasticov context should NOT contain maustian item node
        const plasticovLabels = plasticovContext.activatedNodes.map((n) => n.label);
        expect(plasticovLabels.every((l) => !l.includes("SKU-MAUST"))).toBe(true);

        // Maustian context should NOT contain plasticov item node
        const maustianLabels = maustianContext.activatedNodes.map((n) => n.label);
        expect(maustianLabels.every((l) => !l.includes("SKU-PLAST"))).toBe(true);
      } finally {
        close();
      }
    });

    it("sellerId is preserved in the returned context", () => {
      const { engine, close } = createTestEngine();
      try {
        seedSupplierItemNodes(engine, {
          supplierItemId: "SKU-001",
          sellerId: "plasticov",
        });

        const context = reasoner.findSupplierProductContext(
          engine,
          "jinpeng",
          "SKU-001",
          "plasticov",
        );

        expect(context.sellerId).toBe("plasticov");
      } finally {
        close();
      }
    });
  });

  describe("spreadFromSupplierItem", () => {
    it("spreads activation from a single node", () => {
      const { engine, close } = createTestEngine();
      try {
        const { supplierItemNodeId } = seedSupplierItemNodes(engine, {
          supplierItemId: "SKU-001",
        });

        const result = reasoner.spreadFromSupplierItem(engine, supplierItemNodeId);

        expect(result.activatedNodes.length).toBeGreaterThan(0);
        // The seed node itself should appear in results
        const hasSeedNode = result.activatedNodes.some((n) => n.id === supplierItemNodeId);
        expect(hasSeedNode).toBe(true);
      } finally {
        close();
      }
    });
  });

  describe("buildCandidateProvenance", () => {
    it("assembles provenance with cortexNodeIds and evidenceIds", () => {
      const { engine, close } = createTestEngine();
      try {
        const { supplierItemNodeId } = seedSupplierItemNodes(engine, {
          supplierItemId: "SKU-001",
        });

        const context = reasoner.findSupplierProductContext(engine, "jinpeng", "SKU-001");

        const provenance = reasoner.buildCandidateProvenance(context);

        expect(provenance.source).toBe("supplier-web-signal");
        expect(provenance.sourceId).toContain("jinpeng");
        expect(provenance.sourceId).toContain("SKU-001");
        expect(provenance.supplierId).toBe("jinpeng");
        expect(provenance.cortexNodeIds).toBeDefined();
        expect(provenance.cortexNodeIds!.length).toBeGreaterThan(1);
        expect(provenance.cortexNodeIds).toContain(String(supplierItemNodeId));
        expect(provenance.evidenceIds.length).toBeGreaterThan(0);
        // Evidence IDs should be deduplicated
        const uniqueEvIds = new Set(provenance.evidenceIds);
        expect(uniqueEvIds.size).toBe(provenance.evidenceIds.length);
      } finally {
        close();
      }
    });

    it("contains cortexNodeIds from both item nodes and activated nodes", () => {
      const { engine, close } = createTestEngine();
      try {
        seedSupplierItemNodes(engine, { supplierItemId: "SKU-001" });

        const context = reasoner.findSupplierProductContext(engine, "jinpeng", "SKU-001");

        const provenance = reasoner.buildCandidateProvenance(context);

        // Should include at least the item node ID
        const itemNodeIds = context.supplierItemNodes.map((n) => String(n.id));
        for (const id of itemNodeIds) {
          expect(provenance.cortexNodeIds).toContain(id);
        }
      } finally {
        close();
      }
    });
  });
});
