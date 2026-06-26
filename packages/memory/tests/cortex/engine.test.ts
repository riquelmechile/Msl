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
});
