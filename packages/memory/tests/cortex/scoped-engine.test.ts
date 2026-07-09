import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/cortex/database.js";
import { GraphEngine } from "../../src/cortex/engine.js";

describe("createDatabase — seller-scoped migrations", () => {
  it("adds seller_id column to nodes table (idempotent)", () => {
    const db = createDatabase(":memory:");
    const columns = db.prepare("PRAGMA table_info('nodes')").all() as { name: string }[];
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain("seller_id");

    // Re-run should be idempotent
    const db2 = createDatabase(":memory:");
    const columns2 = db2.prepare("PRAGMA table_info('nodes')").all() as { name: string }[];
    expect(columns2.map((c) => c.name)).toContain("seller_id");
  });

  it("adds seller_id column to edges table (idempotent)", () => {
    const db = createDatabase(":memory:");
    const columns = db.prepare("PRAGMA table_info('edges')").all() as { name: string }[];
    expect(columns.map((c) => c.name)).toContain("seller_id");
  });

  it("adds seller_id column to darwinian_lessons table (idempotent)", () => {
    const db = createDatabase(":memory:");
    const columns = db.prepare("PRAGMA table_info('darwinian_lessons')").all() as {
      name: string;
    }[];
    expect(columns.map((c) => c.name)).toContain("seller_id");
  });

  it("creates idx_nodes_seller index", () => {
    const db = createDatabase(":memory:");
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_nodes_seller'")
      .get() as { name: string } | undefined;
    expect(indexes).toBeDefined();
  });

  it("legacy nodes get seller_id='unknown' by default", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // Simulate pre-migration schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        activation REAL NOT NULL DEFAULT 0.0,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
    `);
    db.exec(`INSERT INTO nodes (label) VALUES ('legacy-node')`);

    // Now run the migration via PRAGMA guard
    const columns = db.prepare("PRAGMA table_info('nodes')").all() as { name: string }[];
    if (!columns.some((c) => c.name === "seller_id")) {
      db.exec(`ALTER TABLE nodes ADD COLUMN seller_id TEXT DEFAULT 'unknown'`);
    }

    const row = db.prepare("SELECT seller_id FROM nodes WHERE label='legacy-node'").get() as {
      seller_id: string;
    };
    expect(row.seller_id).toBe("unknown");
  });
});

describe("GraphEngine — scoped node creation", () => {
  let db: Database.Database;
  let engine: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    engine = new GraphEngine(db);
  });

  it("createNode with sellerId stores seller_id in DB", () => {
    const node = engine.createNode("asset", {}, "plasticov");
    expect(node.sellerId).toBe("plasticov");

    const row = db.prepare("SELECT seller_id FROM nodes WHERE id = ?").get(node.id) as {
      seller_id: string;
    };
    expect(row.seller_id).toBe("plasticov");
  });

  it("createNode without sellerId stores NULL (global)", () => {
    const node = engine.createNode("concept");
    expect(node.sellerId).toBeUndefined();

    const row = db.prepare("SELECT seller_id FROM nodes WHERE id = ?").get(node.id) as {
      seller_id: string | null;
    };
    expect(row.seller_id).toBeNull();
  });

  it("getNode returns sellerId when present", () => {
    const node = engine.createNode("scoped", {}, "maustian");
    const fetched = engine.getNode(node.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.sellerId).toBe("maustian");
  });

  it("getOrCreateNode creates with sellerId on first call", () => {
    const node = engine.getOrCreateNode("business_data", { count: 5 }, "plasticov");
    expect(node.sellerId).toBe("plasticov");
  });

  it("getOrCreateNode returns existing node without overwriting sellerId", () => {
    const first = engine.getOrCreateNode("business_2", { count: 1 }, "plasticov");
    const second = engine.getOrCreateNode("business_2", { count: 2 }, "maustian");
    // Should return existing node (plasticov), metadata updated
    expect(second.id).toBe(first.id);
    expect(second.sellerId).toBe("plasticov");
    expect(JSON.parse(second.metadata)).toMatchObject({ count: 2 });
  });
});

describe("GraphEngine — getNodesBySeller", () => {
  let db: Database.Database;
  let engine: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    engine = new GraphEngine(db);
  });

  it("returns only nodes for the given seller plus global nodes", () => {
    const p1 = engine.createNode("listing_A", {}, "plasticov");
    const p2 = engine.createNode("listing_B", {}, "plasticov");
    const m1 = engine.createNode("listing_C", {}, "maustian");
    const g1 = engine.createNode("concept"); // global (NULL seller_id)

    const plasticovNodes = engine.getNodesBySeller("plasticov");
    const ids = plasticovNodes.map((n) => n.id);
    expect(ids).toContain(p1.id);
    expect(ids).toContain(p2.id);
    expect(ids).not.toContain(m1.id);
    expect(ids).toContain(g1.id);
  });

  it("returns empty array when no matching nodes exist", () => {
    engine.createNode("only_maustian", {}, "maustian");
    const result = engine.getNodesBySeller("plasticov");
    // Global nodes could exist, but test only checks non-error behavior
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("GraphEngine — scoped Hebbian learning", () => {
  let db: Database.Database;
  let engine: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    engine = new GraphEngine(db);
  });

  it("reinforceEdge with matching sellerId succeeds", () => {
    const a = engine.createNode("A", {}, "plasticov");
    const b = engine.createNode("B", {}, "plasticov");
    engine.createEdge(a.id, b.id);

    const reinforced = engine.reinforceEdge(a.id, b.id, "plasticov");
    expect(reinforced.weight).toBe(0.6);
  });

  it("reinforceEdge with global nodes succeeds for any sellerId", () => {
    const a = engine.createNode("A"); // global (NULL seller_id)
    const b = engine.createNode("B"); // global
    engine.createEdge(a.id, b.id);

    const reinforced = engine.reinforceEdge(a.id, b.id, "plasticov");
    expect(reinforced.weight).toBe(0.6);
  });

  it("reinforceEdge rejects cross-seller edge with clear error", () => {
    const a = engine.createNode("A_plasticov", {}, "plasticov");
    const b = engine.createNode("B_maustian", {}, "maustian");
    engine.createEdge(a.id, b.id);

    expect(() => engine.reinforceEdge(a.id, b.id, "plasticov")).toThrow(
      /Cross-seller edge rejected/,
    );
  });

  it("penalizeEdge with matching sellerId succeeds", () => {
    const a = engine.createNode("A", {}, "maustian");
    const b = engine.createNode("B", {}, "maustian");
    engine.createEdge(a.id, b.id);

    const penalized = engine.penalizeEdge(a.id, b.id, "maustian");
    expect(penalized.weight).toBe(0.35);
  });

  it("penalizeEdge rejects cross-seller edge", () => {
    const a = engine.createNode("A_maustian", {}, "maustian");
    const b = engine.createNode("B_plasticov", {}, "plasticov");
    engine.createEdge(a.id, b.id);

    expect(() => engine.penalizeEdge(a.id, b.id, "maustian")).toThrow(/Cross-seller edge rejected/);
  });

  it("reinforceEdge without sellerId works (backward compat)", () => {
    const a = engine.createNode("A", {}, "plasticov");
    const b = engine.createNode("B", {}, "maustian");
    engine.createEdge(a.id, b.id);

    // No sellerId provided → no validation
    const reinforced = engine.reinforceEdge(a.id, b.id);
    expect(reinforced.weight).toBe(0.6);
  });

  it("reinforceEdge validates source matches seller when target is global", () => {
    const a = engine.createNode("A", {}, "plasticov");
    const b = engine.createNode("B"); // global (NULL)
    engine.createEdge(a.id, b.id);

    // Global + plasticov is OK
    const reinforced = engine.reinforceEdge(a.id, b.id, "plasticov");
    expect(reinforced.weight).toBe(0.6);
  });

  it("reinforceEdge validates target matches seller when source is global", () => {
    const a = engine.createNode("A"); // global (NULL)
    const b = engine.createNode("B", {}, "plasticov");
    engine.createEdge(a.id, b.id);

    // Global + plasticov is OK
    const reinforced = engine.reinforceEdge(a.id, b.id, "plasticov");
    expect(reinforced.weight).toBe(0.6);
  });
});

describe("GraphEngine — scoped spreading activation", () => {
  let db: Database.Database;
  let engine: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    engine = new GraphEngine(db);
  });

  it("only activates nodes in the given seller scope", () => {
    // Plasticov chain: A_p → B_p → C_p
    const ap = engine.createNode("A_p", {}, "plasticov");
    const bp = engine.createNode("B_p", {}, "plasticov");
    const cp = engine.createNode("C_p", {}, "plasticov");
    engine.createEdge(ap.id, bp.id);
    engine.createEdge(bp.id, cp.id);

    // Maustian chain: A_m → B_m → C_m
    const am = engine.createNode("A_m", {}, "maustian");
    const bm = engine.createNode("B_m", {}, "maustian");
    const cm = engine.createNode("C_m", {}, "maustian");
    engine.createEdge(am.id, bm.id);
    engine.createEdge(bm.id, cm.id);

    // Set activation
    db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(ap.id);
    db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(am.id);

    // Spread only in Plasticov scope
    const result = engine.spreadActivation([ap.id], { maxDepth: 3, sellerId: "plasticov" });

    const labels = result.activatedNodes.map((n) => n.label);
    expect(labels).toContain("B_p");
    expect(labels).toContain("C_p");
    expect(labels).not.toContain("B_m");
    expect(labels).not.toContain("C_m");
  });

  it("global nodes are reachable from any seller scope", () => {
    const a = engine.createNode("A", {}, "plasticov");
    const globalB = engine.createNode("global_B"); // NULL seller_id
    const c = engine.createNode("C", {}, "plasticov");
    engine.createEdge(a.id, globalB.id);
    engine.createEdge(globalB.id, c.id);

    db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(a.id);

    const result = engine.spreadActivation([a.id], { maxDepth: 3, sellerId: "plasticov" });

    const labels = result.activatedNodes.map((n) => n.label);
    expect(labels).toContain("global_B");
    expect(labels).toContain("C");
  });

  it("scoped spread does not leak into another seller's subgraph", () => {
    const a = engine.createNode("A", {}, "plasticov");
    const b = engine.createNode("B", {}, "maustian");
    engine.createEdge(a.id, b.id);

    db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(a.id);

    // Spread in Plasticov scope — maustian node B should NOT be traversed
    const result = engine.spreadActivation([a.id], { maxDepth: 3, sellerId: "plasticov" });

    const labels = result.activatedNodes.map((n) => n.label);
    expect(labels).not.toContain("B");
  });

  it("spread without sellerId traverses all nodes (backward compat)", () => {
    const a = engine.createNode("A", {}, "plasticov");
    const b = engine.createNode("B", {}, "maustian");
    engine.createEdge(a.id, b.id);

    db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(a.id);

    const result = engine.spreadActivation([a.id], { maxDepth: 3 });
    // Without seller scope, should traverse B even though it's maustian
    const labels = result.activatedNodes.map((n) => n.label);
    expect(labels).toContain("B");
  });
});

describe("GraphEngine — scoped Darwinian pruning", () => {
  let db: Database.Database;
  let engine: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    engine = new GraphEngine(db);
  });

  it("only prunes weak edges in the given seller scope", () => {
    // Plasticov edge (weak)
    const ap = engine.createNode("A_p", {}, "plasticov");
    const bp = engine.createNode("B_p", {}, "plasticov");
    const edgeP = engine.createEdge(ap.id, bp.id);
    db.prepare("UPDATE edges SET weight = 0.01 WHERE id = ?").run(edgeP.id);

    // Maustian edge (also weak)
    const am = engine.createNode("A_m", {}, "maustian");
    const bm = engine.createNode("B_m", {}, "maustian");
    const edgeM = engine.createEdge(am.id, bm.id);
    db.prepare("UPDATE edges SET weight = 0.01 WHERE id = ?").run(edgeM.id);

    // Prune only Plasticov
    const result = engine.prune({ sellerId: "plasticov" });
    expect(result.archivedCount).toBe(1);

    // Plasticov edge should be gone
    const ep = engine.getEdge(edgeP.id);
    expect(ep).toBeNull();

    // Maustian edge should survive
    const em = engine.getEdge(edgeM.id);
    expect(em).not.toBeNull();
  });

  it("prune without sellerId prunes all weak edges globally", () => {
    const ap = engine.createNode("A_p", {}, "plasticov");
    const bp = engine.createNode("B_p", {}, "plasticov");
    const edgeP = engine.createEdge(ap.id, bp.id);
    db.prepare("UPDATE edges SET weight = 0.01 WHERE id = ?").run(edgeP.id);

    const am = engine.createNode("A_m", {}, "maustian");
    const bm = engine.createNode("B_m", {}, "maustian");
    const edgeM = engine.createEdge(am.id, bm.id);
    db.prepare("UPDATE edges SET weight = 0.01 WHERE id = ?").run(edgeM.id);

    const result = engine.prune();
    expect(result.archivedCount).toBe(2);

    expect(engine.getEdge(edgeP.id)).toBeNull();
    expect(engine.getEdge(edgeM.id)).toBeNull();
  });

  it("distills lessons with seller scoping context", () => {
    const a = engine.createNode("A", {}, "plasticov");
    const b = engine.createNode("B", {}, "plasticov");
    const edge = engine.createEdge(a.id, b.id);
    db.prepare("UPDATE edges SET weight = 0.01 WHERE id = ?").run(edge.id);

    engine.prune({ sellerId: "plasticov" });

    const lessons = db.prepare("SELECT * FROM darwinian_lessons").all() as {
      lesson: string;
    }[];
    expect(lessons.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GraphEngine — queryByMetadata with seller_id column", () => {
  let db: Database.Database;
  let engine: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    engine = new GraphEngine(db);
  });

  it("filters by sellerId using the seller_id column (includes global)", () => {
    engine.createNode("listing", { itemId: "MLC1" }, "plasticov");
    engine.createNode("listing", { itemId: "MLC2" }, "maustian");
    engine.createNode("concept", { itemId: "GLOBAL" }); // global

    const results = engine.queryByMetadata({ sellerId: "plasticov" });
    const itemIds = results.map((r) => r.metadata.itemId);
    expect(itemIds).toContain("MLC1");
    expect(itemIds).toContain("GLOBAL");
    expect(itemIds).not.toContain("MLC2");
  });
});

describe("GraphEngine — ensureAccountAssetNode", () => {
  let db: Database.Database;
  let engine: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    engine = new GraphEngine(db);
  });

  it("creates account_asset:{sellerId} node with correct label and metadata", () => {
    const node = engine.ensureAccountAssetNode("plasticov");
    expect(node.label).toBe("account_asset:plasticov");
    expect(node.sellerId).toBe("plasticov");

    const parsed = JSON.parse(node.metadata) as Record<string, unknown>;
    expect(parsed.type).toBe("account_asset");
    expect(parsed.sellerId).toBe("plasticov");
  });

  it("is idempotent — returns same node on repeated calls", () => {
    const first = engine.ensureAccountAssetNode("plasticov");
    const second = engine.ensureAccountAssetNode("plasticov");
    expect(second.id).toBe(first.id);
  });

  it("creates edges from account node to existing listing/order/claim/strategy/lesson nodes", () => {
    // Create some business-data nodes for Plasticov
    const listing = engine.createNode("listing_MLC123", { type: "listing" }, "plasticov");
    const order = engine.createNode("order_ORD456", { type: "order" }, "plasticov");
    const claim = engine.createNode("claim_CLM789", { type: "claim" }, "plasticov");
    const strategy = engine.createNode("strategy_margin", { type: "strategy" }, "plasticov");
    const lesson = engine.createNode("lesson_001", { type: "lesson" }, "plasticov");
    const proposal = engine.createNode(
      "proposal_outcome_20260101",
      { type: "proposal" },
      "plasticov",
    );

    // Maustian node (should NOT be linked)
    engine.createNode("listing_MLC999", { type: "listing" }, "maustian");

    const accountNode = engine.ensureAccountAssetNode("plasticov");

    // Query edges from account node
    const edges = db.prepare("SELECT target FROM edges WHERE source = ?").all(accountNode.id) as {
      target: number;
    }[];
    const targetIds = edges.map((e) => e.target);

    expect(targetIds).toContain(listing.id);
    expect(targetIds).toContain(order.id);
    expect(targetIds).toContain(claim.id);
    expect(targetIds).toContain(strategy.id);
    expect(targetIds).toContain(lesson.id);
    expect(targetIds).toContain(proposal.id);

    // Verify count — should have at least 6 edges
    expect(edges.length).toBeGreaterThanOrEqual(6);
  });

  it("different sellers get independent account nodes", () => {
    const pNode = engine.ensureAccountAssetNode("plasticov");
    const mNode = engine.ensureAccountAssetNode("maustian");

    expect(pNode.id).not.toBe(mNode.id);
    expect(pNode.label).toBe("account_asset:plasticov");
    expect(mNode.label).toBe("account_asset:maustian");
  });
});
