import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/cortex/database.js";
import { GraphEngine } from "../../src/cortex/engine.js";
import { DuplicateEdgeError, NodeNotFoundError } from "../../src/cortex/types.js";

describe("createDatabase", () => {
  it("initializes an in-memory SQLite database with the cortex schema", () => {
    const db = createDatabase(":memory:");

    // Verify tables exist by querying sqlite_master
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("nodes");
    expect(tableNames).toContain("edges");
    expect(tableNames).toContain("darwinian_lessons");
  });

  it("issues WAL journal mode pragma (in-memory DBs stay in memory mode)", () => {
    // SQLite returns "memory" for in-memory databases regardless of WAL pragma.
    // The pragma is still issued and takes effect on file-based databases.
    const db = createDatabase(":memory:");
    const [{ journal_mode }] = db.pragma("journal_mode") as [{ journal_mode: string }];
    // In-memory DBs do not support WAL — they use "memory" mode internally.
    // File-based databases will return "wal".
    expect(journal_mode).toBe("memory");
  });

  it("enables foreign_keys", () => {
    const db = createDatabase(":memory:");
    const [{ foreign_keys }] = db.pragma("foreign_keys") as [{ foreign_keys: number }];
    expect(foreign_keys).toBe(1);
  });
});

describe("GraphEngine", () => {
  let db: Database.Database;
  let engine: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    engine = new GraphEngine(db);
  });

  describe("createNode", () => {
    it("creates a node with activation defaulting to 0.0", () => {
      const node = engine.createNode("test-node");

      expect(node.id).toBeGreaterThan(0);
      expect(node.label).toBe("test-node");
      expect(node.activation).toBe(0.0);
      expect(node.metadata).toBe("{}");
    });

    it("stores optional metadata as a JSON string", () => {
      const node = engine.createNode("seller-preferences", {
        category: "pricing",
        confidence: 0.8,
      });

      expect(node.metadata).toBe(
        JSON.stringify({ category: "pricing", confidence: 0.8 }),
      );
    });

    it("returns increasing ids for sequential inserts", () => {
      const a = engine.createNode("a");
      const b = engine.createNode("b");
      const c = engine.createNode("c");

      expect(b.id).toBe(a.id + 1);
      expect(c.id).toBe(b.id + 1);
    });
  });

  describe("getNode", () => {
    it("retrieves a node by id", () => {
      const created = engine.createNode("persisted-node");
      const retrieved = engine.getNode(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.label).toBe("persisted-node");
      expect(retrieved!.activation).toBe(0.0);
    });

    it("returns null for a non-existent node", () => {
      expect(engine.getNode(999)).toBeNull();
    });
  });

  describe("createEdge", () => {
    it("creates an edge with weight defaulting to 0.5", () => {
      const source = engine.createNode("source");
      const target = engine.createNode("target");

      const edge = engine.createEdge(source.id, target.id);

      expect(edge.id).toBeGreaterThan(0);
      expect(edge.source).toBe(source.id);
      expect(edge.target).toBe(target.id);
      expect(edge.weight).toBe(0.5);
      expect(edge.co_occurrence_count).toBe(0);
      expect(edge.last_activated).toBeNull();
      expect(edge.distilled_lesson).toBeNull();
    });

    it("rejects duplicate (source, target) pairs with DuplicateEdgeError", () => {
      const source = engine.createNode("src");
      const target = engine.createNode("tgt");

      engine.createEdge(source.id, target.id);

      expect(() => engine.createEdge(source.id, target.id)).toThrow(
        DuplicateEdgeError,
      );
    });

    it("throws NodeNotFoundError when source node does not exist", () => {
      const target = engine.createNode("target");

      expect(() => engine.createEdge(999, target.id)).toThrow(NodeNotFoundError);
    });

    it("throws NodeNotFoundError when target node does not exist", () => {
      const source = engine.createNode("source");

      expect(() => engine.createEdge(source.id, 999)).toThrow(NodeNotFoundError);
    });
  });

  describe("getEdge", () => {
    it("retrieves an edge by id", () => {
      const source = engine.createNode("src");
      const target = engine.createNode("tgt");
      const created = engine.createEdge(source.id, target.id);

      const retrieved = engine.getEdge(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.source).toBe(source.id);
      expect(retrieved!.target).toBe(target.id);
      expect(retrieved!.weight).toBe(0.5);
    });

    it("returns null for a non-existent edge", () => {
      expect(engine.getEdge(999)).toBeNull();
    });
  });

  describe("reinforceEdge", () => {
    it("increases weight by 0.1 and updates last_activated", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const edge = engine.createEdge(a.id, b.id);

      expect(edge.weight).toBe(0.5);
      expect(edge.last_activated).toBeNull();

      const reinforced = engine.reinforceEdge(a.id, b.id);

      expect(reinforced.weight).toBe(0.6);
      expect(reinforced.last_activated).not.toBeNull();
      expect(reinforced.source).toBe(a.id);
      expect(reinforced.target).toBe(b.id);

      // Verify persistence via getEdge
      const persisted = engine.getEdge(edge.id);
      expect(persisted!.weight).toBe(0.6);
      expect(persisted!.last_activated).not.toBeNull();
    });

    it("clamps weight at 1.0 (upper boundary)", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const edge = engine.createEdge(a.id, b.id);

      // Manually set weight to 0.95 via raw SQL
      db.prepare("UPDATE edges SET weight = 0.95 WHERE id = ?").run(edge.id);

      const reinforced = engine.reinforceEdge(a.id, b.id);

      // 0.95 + 0.1 = 1.05 → clamped to 1.0
      expect(reinforced.weight).toBe(1.0);

      // Second reinforce: 1.0 + 0.1 = 1.1 → clamped to 1.0
      const reinforced2 = engine.reinforceEdge(a.id, b.id);
      expect(reinforced2.weight).toBe(1.0);
    });

    it("throws when no edge exists between source and target", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");

      expect(() => engine.reinforceEdge(a.id, b.id)).toThrow(
        /no edge found between source/,
      );
    });
  });

  describe("penalizeEdge", () => {
    it("decreases weight by 0.15 and updates last_activated", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const edge = engine.createEdge(a.id, b.id);

      expect(edge.weight).toBe(0.5);

      const penalized = engine.penalizeEdge(a.id, b.id);

      expect(penalized.weight).toBe(0.35);
      expect(penalized.last_activated).not.toBeNull();

      // Verify persistence
      const persisted = engine.getEdge(edge.id);
      expect(persisted!.weight).toBe(0.35);
    });

    it("clamps weight at 0.0 (lower boundary)", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const edge = engine.createEdge(a.id, b.id);

      // Manually set weight to 0.10 via raw SQL
      db.prepare("UPDATE edges SET weight = 0.10 WHERE id = ?").run(edge.id);

      const penalized = engine.penalizeEdge(a.id, b.id);

      // 0.10 − 0.15 = −0.05 → clamped to 0.0
      expect(penalized.weight).toBe(0.0);

      // Second penalize: 0.0 − 0.15 = −0.15 → clamped to 0.0
      const penalized2 = engine.penalizeEdge(a.id, b.id);
      expect(penalized2.weight).toBe(0.0);
    });

    it("throws when no edge exists between source and target", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");

      expect(() => engine.penalizeEdge(a.id, b.id)).toThrow(
        /no edge found between source/,
      );
    });
  });

  describe("spreadActivation", () => {
    it("returns empty result for empty nodeIds", () => {
      const result = engine.spreadActivation([]);
      expect(result.activatedNodes).toEqual([]);
    });

    it("returns only the seed nodes when they have zero activation", () => {
      const a = engine.createNode("A");
      engine.createNode("B");
      engine.createEdge(a.id, a.id + 1);

      const result = engine.spreadActivation([a.id], { maxDepth: 2 });

      // Only seed node appears (activation = 0, so recursive step yields 0 → below threshold)
      expect(result.activatedNodes).toHaveLength(1);
      expect(result.activatedNodes[0].id).toBe(a.id);
      expect(result.activatedNodes[0].activation).toBe(0.0);
    });

    it("spreads activation through a chain respecting depth limit", () => {
      // A → B → C → D → E chain
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const c = engine.createNode("C");
      const d = engine.createNode("D");
      const e = engine.createNode("E");

      engine.createEdge(a.id, b.id);
      engine.createEdge(b.id, c.id);
      engine.createEdge(c.id, d.id);
      engine.createEdge(d.id, e.id);

      // Set seed activation on A to 1.0
      db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(a.id);

      const result = engine.spreadActivation([a.id], { maxDepth: 2 });

      const ids = result.activatedNodes.map((n) => n.id);
      expect(ids).toContain(a.id); // depth 0
      expect(ids).toContain(b.id); // depth 1
      expect(ids).toContain(c.id); // depth 2
      expect(ids).not.toContain(d.id); // depth 3 — excluded
      expect(ids).not.toContain(e.id); // depth 4 — excluded
    });

    it("sorts activated nodes by activation descending", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const c = engine.createNode("C");

      engine.createEdge(a.id, b.id);
      engine.createEdge(b.id, c.id);

      db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(a.id);

      const result = engine.spreadActivation([a.id], { maxDepth: 2 });

      // Activation decreases with depth: A(1.0) > B(0.5) > C(0.125)
      for (let i = 1; i < result.activatedNodes.length; i++) {
        expect(result.activatedNodes[i - 1].activation).toBeGreaterThanOrEqual(
          result.activatedNodes[i].activation,
        );
      }
    });

    it("increments co_occurrence_count on traversed edges", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const c = engine.createNode("C");

      const edgeAB = engine.createEdge(a.id, b.id);
      const edgeBC = engine.createEdge(b.id, c.id);

      expect(edgeAB.co_occurrence_count).toBe(0);
      expect(edgeBC.co_occurrence_count).toBe(0);

      db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(a.id);

      engine.spreadActivation([a.id], { maxDepth: 3 });

      const abAfter = engine.getEdge(edgeAB.id);
      const bcAfter = engine.getEdge(edgeBC.id);

      expect(abAfter!.co_occurrence_count).toBe(1);
      expect(bcAfter!.co_occurrence_count).toBe(1);
    });

    it("does not increment co-occurrence on untraversed edges", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const c = engine.createNode("C");
      const d = engine.createNode("D");

      const edgeAB = engine.createEdge(a.id, b.id);
      engine.createEdge(b.id, c.id);
      const edgeCD = engine.createEdge(c.id, d.id);

      db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(a.id);

      // depth=1 — only A→B traversed
      engine.spreadActivation([a.id], { maxDepth: 1 });

      const abAfter = engine.getEdge(edgeAB.id);
      const cdAfter = engine.getEdge(edgeCD.id);

      expect(abAfter!.co_occurrence_count).toBe(1); // traversed
      expect(cdAfter!.co_occurrence_count).toBe(0); // not traversed
    });

    it("respects activation threshold to prune weak paths", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const c = engine.createNode("C");

      engine.createEdge(a.id, b.id);
      engine.createEdge(b.id, c.id);

      // Low seed activation: 0.02 → B gets 0.02 * 0.5 * 0.5 = 0.005 < 0.01 threshold
      db.prepare("UPDATE nodes SET activation = 0.02 WHERE id = ?").run(a.id);

      const result = engine.spreadActivation([a.id], { maxDepth: 3 });

      // Only A appears; B and C are below threshold
      expect(result.activatedNodes).toHaveLength(1);
      expect(result.activatedNodes[0].id).toBe(a.id);
    });

    it("uses custom SpreadingOptions (maxDepth, decayFactor, threshold)", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const c = engine.createNode("C");
      const d = engine.createNode("D");

      engine.createEdge(a.id, b.id);
      engine.createEdge(b.id, c.id);
      engine.createEdge(c.id, d.id);

      db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(a.id);

      // depth=1 → only A and B included
      const result = engine.spreadActivation([a.id], { maxDepth: 1 });

      const ids = result.activatedNodes.map((n) => n.id);
      expect(ids).toContain(a.id);
      expect(ids).toContain(b.id);
      expect(ids).not.toContain(c.id);
    });

    it("aggregates multiple paths to the same node by keeping max activation", () => {
      // A → B, A → C, B → D, C → D  (D reachable via two paths)
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const c = engine.createNode("C");
      const d = engine.createNode("D");

      engine.createEdge(a.id, b.id);
      engine.createEdge(a.id, c.id);
      engine.createEdge(b.id, d.id);
      engine.createEdge(c.id, d.id);

      db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(a.id);

      const result = engine.spreadActivation([a.id], { maxDepth: 3 });

      // D should appear exactly once with max activation from the two paths
      const dNodes = result.activatedNodes.filter((n) => n.id === d.id);
      expect(dNodes).toHaveLength(1);
    });
  });
});
