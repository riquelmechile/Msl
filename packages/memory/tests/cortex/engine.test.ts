import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { createDatabase, migrate } from "../../src/cortex/database.js";
import { cosineSimilarity, GraphEngine } from "../../src/cortex/engine.js";
import { DuplicateEdgeError, NodeNotFoundError, type ProbeRecord } from "../../src/cortex/types.js";

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
    expect(tableNames).toContain("actor_simulations");
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

  it("creates the probe_results table", () => {
    const db = createDatabase(":memory:");

    // Verify the table exists
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='probe_results'")
      .get() as { name: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.name).toBe("probe_results");

    // Verify column structure
    const columns = db.prepare("PRAGMA table_info('probe_results')").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("proposal_id");
    expect(colNames).toContain("probe_type");
    expect(colNames).toContain("outcome");
    expect(colNames).toContain("created_at");
  });

  it("schema_version table exists after creation", () => {
    const db = createDatabase(":memory:");
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
      .get() as { name: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.name).toBe("schema_version");
  });
});

describe("migrate", () => {
  it("applies baseline migration version 1", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    // Run the schema + migrations
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL
      );
    `);

    const result = migrate(db);
    expect(result.applied).toBeGreaterThanOrEqual(1);

    // The version 1 row should exist
    const row = db.prepare("SELECT version FROM schema_version WHERE version = 1").get() as
      { version: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.version).toBe(1);

    db.close();
  });

  it("is idempotent — re-running returns skipped for applied versions", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL
      );
    `);

    // First run
    const first = migrate(db);
    expect(first.applied).toBeGreaterThanOrEqual(1);

    // Second run — idempotent
    const second = migrate(db);
    // Already-applied versions are skipped; no new versions are applied.
    expect(second.applied).toBe(0);

    db.close();
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

      expect(node.metadata).toBe(JSON.stringify({ category: "pricing", confidence: 0.8 }));
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

  describe("findOrCreateConceptNode", () => {
    it("creates a new node when the label does not exist", () => {
      const node = engine.findOrCreateConceptNode("strategy_margin", { domain: "pricing" });

      expect(node.id).toBeGreaterThan(0);
      expect(node.label).toBe("strategy_margin");
      expect(node.activation).toBe(0.0);
      expect(node.metadata).toBe(JSON.stringify({ domain: "pricing" }));
    });

    it("returns the existing node when the label already exists (idempotent)", () => {
      const first = engine.findOrCreateConceptNode("strategy_stock");
      const second = engine.findOrCreateConceptNode("strategy_stock", { extra: true });

      expect(second.id).toBe(first.id);
      expect(second.label).toBe("strategy_stock");
      // Metadata is not updated on existing nodes.
      expect(second.metadata).toBe("{}");
    });

    it("distinguishes different labels as separate nodes", () => {
      const a = engine.findOrCreateConceptNode("CEO_decision");
      const b = engine.findOrCreateConceptNode("guardrail_rejection");

      expect(b.id).toBeGreaterThan(a.id);
      expect(a.label).toBe("CEO_decision");
      expect(b.label).toBe("guardrail_rejection");
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

      expect(() => engine.createEdge(source.id, target.id)).toThrow(DuplicateEdgeError);
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

      expect(() => engine.reinforceEdge(a.id, b.id)).toThrow(/no edge found between source/);
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

      expect(() => engine.penalizeEdge(a.id, b.id)).toThrow(/no edge found between source/);
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
      expect(result.activatedNodes[0]!.id).toBe(a.id);
      expect(result.activatedNodes[0]!.activation).toBe(0.0);
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
        expect(result.activatedNodes[i - 1]!.activation).toBeGreaterThanOrEqual(
          result.activatedNodes[i]!.activation,
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
      expect(result.activatedNodes[0]!.id).toBe(a.id);
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

  describe("cosineSimilarity", () => {
    it("returns 1.0 for identical vectors", () => {
      const a = new Map([
        [1, 0.5],
        [2, 0.3],
      ]);
      const b = new Map([
        [1, 0.5],
        [2, 0.3],
      ]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    it("returns 0.0 for orthogonal vectors", () => {
      const a = new Map([
        [1, 1.0],
        [2, 0.0],
      ]);
      const b = new Map([
        [1, 0.0],
        [2, 1.0],
      ]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
    });

    it("returns 0.0 when one vector is all zeros", () => {
      const a = new Map([
        [1, 0.0],
        [2, 0.0],
      ]);
      const b = new Map([
        [1, 0.5],
        [2, 0.3],
      ]);
      expect(cosineSimilarity(a, b)).toBe(0.0);
    });

    it("returns 0.0 when both vectors are empty", () => {
      expect(cosineSimilarity(new Map(), new Map())).toBe(0.0);
    });

    it("handles vectors with different key sets (union-based)", () => {
      // a only has node 1, b only has node 2 → dot = 0
      const a = new Map([[1, 1.0]]);
      const b = new Map([[2, 1.0]]);
      expect(cosineSimilarity(a, b)).toBe(0.0);
    });

    it("handles overlapping keys with non-zero similarity", () => {
      // a = [0.6, 0.8], b = [0.3, 0.4] → same direction, different magnitude → 1.0
      const a = new Map([
        [1, 0.6],
        [2, 0.8],
      ]);
      const b = new Map([
        [1, 0.3],
        [2, 0.4],
      ]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });
  });

  describe("prune", () => {
    it("archives edges with weight < 0.05 and keeps edges at threshold", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const c = engine.createNode("C");
      const d = engine.createNode("D");

      const weakEdge = engine.createEdge(a.id, b.id);
      const thresholdEdge = engine.createEdge(b.id, c.id);
      const strongEdge = engine.createEdge(c.id, d.id);

      // Set weights: 0.04 (below), 0.05 (at threshold), 0.06 (above)
      db.prepare("UPDATE edges SET weight = 0.04 WHERE id = ?").run(weakEdge.id);
      db.prepare("UPDATE edges SET weight = 0.05 WHERE id = ?").run(thresholdEdge.id);
      db.prepare("UPDATE edges SET weight = 0.06 WHERE id = ?").run(strongEdge.id);

      const result = engine.prune();

      // Only the 0.04-weight edge should be archived
      expect(result.archivedCount).toBe(1);

      // Weak edge is gone
      expect(engine.getEdge(weakEdge.id)).toBeNull();

      // Threshold edge (0.05) survives — strict less-than
      expect(engine.getEdge(thresholdEdge.id)).not.toBeNull();
      expect(engine.getEdge(thresholdEdge.id)!.weight).toBe(0.05);

      // Strong edge (0.06) survives
      expect(engine.getEdge(strongEdge.id)).not.toBeNull();
      expect(engine.getEdge(strongEdge.id)!.weight).toBe(0.06);

      // Darwinian lesson was created for the weak edge
      const lessons = db.prepare("SELECT * FROM darwinian_lessons").all() as Array<{
        source_node: number;
        target_node: number;
        lesson: string;
        reason: string;
      }>;
      expect(lessons).toHaveLength(1);
      expect(lessons[0]!.source_node).toBe(a.id);
      expect(lessons[0]!.target_node).toBe(b.id);
      expect(lessons[0]!.lesson).toBe("connection between A and B");
      expect(lessons[0]!.reason).toBe("weight_below_threshold");
    });

    it("is idempotent — re-run returns 0 after pruning", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");

      const edge = engine.createEdge(a.id, b.id);
      db.prepare("UPDATE edges SET weight = 0.03 WHERE id = ?").run(edge.id);

      // First prune — should archive 1
      const first = engine.prune();
      expect(first.archivedCount).toBe(1);

      // Second prune — should be a no-op
      const second = engine.prune();
      expect(second.archivedCount).toBe(0);

      // Still only 1 lesson (no duplicates)
      const count = (
        db.prepare("SELECT COUNT(*) as cnt FROM darwinian_lessons").get() as {
          cnt: number;
        }
      ).cnt;
      expect(count).toBe(1);
    });

    it("uses distilled_lesson when present on the edge", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");

      const edge = engine.createEdge(a.id, b.id);
      db.prepare("UPDATE edges SET weight = 0.02, distilled_lesson = ? WHERE id = ?").run(
        "custom distilled insight",
        edge.id,
      );

      engine.prune();

      const lesson = db
        .prepare("SELECT lesson FROM darwinian_lessons WHERE source_node = ?")
        .get(a.id) as { lesson: string };
      expect(lesson.lesson).toBe("custom distilled insight");
    });

    it("is atomic — both INSERT and DELETE happen or neither does", () => {
      // This test verifies the transaction wrapper exists and operates.
      // We test indirectly: after prune, the archivedCount matches the
      // number of deleted edges, and lessons count equals that number.
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const c = engine.createNode("C");

      engine.createEdge(a.id, b.id);
      engine.createEdge(b.id, c.id);

      db.prepare("UPDATE edges SET weight = 0.01 WHERE source = ?").run(a.id);
      db.prepare("UPDATE edges SET weight = 0.02 WHERE source = ?").run(b.id);

      const result = engine.prune();

      expect(result.archivedCount).toBe(2);

      const lessonCount = (
        db.prepare("SELECT COUNT(*) as cnt FROM darwinian_lessons").get() as {
          cnt: number;
        }
      ).cnt;
      expect(lessonCount).toBe(2);
    });

    it("enforces max_nodes cap — archives oldest inactive nodes above threshold", () => {
      // Create more nodes than the low cap to trigger archival.
      for (let i = 0; i < 15; i++) {
        engine.createNode(`inactive_${i}`);
      }
      // All nodes have activation=0 and no edges — they are candidates.
      // Set a tiny cap so the engine must archive some.
      const result = engine.prune({ maxNodes: 10 });
      // No edges to prune (all weights are 0.5), but nodes above cap
      // should be archived as lessons.
      expect(result.archivedCount).toBe(0); // no edge pruning

      // Verify at most maxNodes remain
      const remaining = (db.prepare("SELECT COUNT(*) as cnt FROM nodes").get() as { cnt: number })
        .cnt;
      expect(remaining).toBeLessThanOrEqual(10);

      // Lessons should exist for the archived nodes
      const lessonCount = (
        db
          .prepare(
            "SELECT COUNT(*) as cnt FROM darwinian_lessons WHERE reason = 'node_cap_exceeded'",
          )
          .get() as { cnt: number }
      ).cnt;
      expect(lessonCount).toBeGreaterThanOrEqual(1);
    });

    it("does not archive nodes above max_nodes if they have edges or activation", () => {
      // Create two nodes with an edge between them — they should survive.
      const a = engine.createNode("active-A");
      const b = engine.createNode("active-B");
      engine.createEdge(a.id, b.id);
      // Also create a node with activation > 0.
      const c = engine.createNode("active-C");
      db.prepare("UPDATE nodes SET activation = 0.5 WHERE id = ?").run(c.id);

      // Create 12 inactive nodes to trigger cap at 10
      for (let i = 0; i < 12; i++) {
        engine.createNode(`pad_${i}`);
      }

      engine.prune({ maxNodes: 10 });

      // Active nodes (with edges or activation) should still exist
      expect(engine.getNode(a.id)).not.toBeNull();
      expect(engine.getNode(b.id)).not.toBeNull();
      expect(engine.getNode(c.id)).not.toBeNull();
    });
  });

  describe("detectConvergence", () => {
    it("returns first-iteration on the initial call", () => {
      const snapshot = new Map([[1, 0.5]]);
      const result = engine.detectConvergence(snapshot);

      expect(result.converged).toBe(false);
      if (!result.converged) {
        expect(result.reason).toBe("first-iteration");
      }
    });

    it("detects convergence when similarity exceeds threshold", () => {
      // Same snapshot twice should yield cosine similarity 1.0 > 0.95
      const snapshot = new Map([
        [1, 0.5],
        [2, 0.3],
      ]);

      // First call — stores snapshot
      engine.detectConvergence(snapshot);

      // Second call — compares against stored, should converge
      const result = engine.detectConvergence(snapshot);

      expect(result.converged).toBe(true);
      if (result.converged) {
        expect(result.similarity).toBeCloseTo(1.0, 5);
      }
    });

    it("returns not-converged when similarity is below threshold", () => {
      // First snapshot
      const first = new Map([
        [1, 1.0],
        [2, 0.0],
      ]);
      engine.detectConvergence(first);

      // Second snapshot — orthogonal
      const second = new Map([
        [1, 0.0],
        [2, 1.0],
      ]);
      const result = engine.detectConvergence(second);

      expect(result.converged).toBe(false);
      if (!result.converged) {
        expect(result.similarity).toBeCloseTo(0.0, 5);
      }
    });

    it("respects a custom threshold", () => {
      // First snapshot
      engine.detectConvergence(new Map([[1, 0.5]]));

      // Second snapshot — similarity 1.0, but threshold is 1.01 (impossible)
      const result = engine.detectConvergence(new Map([[1, 0.5]]), {
        threshold: 1.01,
      });

      expect(result.converged).toBe(false);
    });

    it("handles zero-activation vectors without error", () => {
      const zero = new Map([
        [1, 0.0],
        [2, 0.0],
      ]);

      // First call with zeros — stored, returns first-iteration
      const first = engine.detectConvergence(zero);
      expect(first.converged).toBe(false);

      // Second call with zeros — cosine=0 (norm=0), below threshold
      const second = engine.detectConvergence(zero);
      expect(second.converged).toBe(false);
    });
  });

  describe("traverse", () => {
    it("returns empty context for an empty graph", () => {
      const result = engine.traverse();

      expect(result.activatedNodes).toEqual([]);
      expect(result.traversedEdges).toEqual([]);
      expect(result.lessons).toEqual([]);
      expect(result.context).toEqual({});
    });

    it("returns activated nodes with scores for a populated graph", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");

      db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(a.id);
      db.prepare("UPDATE nodes SET activation = 0.5 WHERE id = ?").run(b.id);

      const result = engine.traverse();

      expect(result.activatedNodes).toHaveLength(2);
      expect(result.activatedNodes[0]).toMatchObject({
        nodeId: a.id,
        label: "A",
        activation: 1.0,
      });
      expect(result.activatedNodes[1]).toMatchObject({
        nodeId: b.id,
        label: "B",
        activation: 0.5,
      });

      // Context should contain the LLM-injectable key-value pairs
      expect(result.context.activated_nodes).toBeDefined();
      expect(result.context.node_count).toBe(2);
    });

    it("returns traversed edges with weights and co-occurrence counts", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const c = engine.createNode("C");

      engine.createEdge(a.id, b.id);
      engine.createEdge(b.id, c.id);

      // Simulate co-occurrence
      db.prepare("UPDATE edges SET co_occurrence_count = 3 WHERE source = ? AND target = ?").run(
        a.id,
        b.id,
      );

      const result = engine.traverse();

      expect(result.traversedEdges).toHaveLength(2);
      expect(result.traversedEdges[0]).toMatchObject({
        source: a.id,
        target: b.id,
        co_occurrence_count: 3,
      });

      expect(result.context.edges).toBeDefined();
      expect(result.context.edge_count).toBe(2);
    });

    it("includes distilled lessons from darwinian_lessons table", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");

      const edge = engine.createEdge(a.id, b.id);
      db.prepare("UPDATE edges SET weight = 0.01 WHERE id = ?").run(edge.id);

      engine.prune();

      const result = engine.traverse();

      // Lessons from the prune step
      expect(result.lessons).toHaveLength(1);
      expect(result.lessons[0]).toMatchObject({
        source_node: a.id,
        target_node: b.id,
      });
      expect(typeof result.lessons[0]!.lesson).toBe("string");

      // Context includes lesson data
      expect(result.context.lessons).toBeDefined();
      expect(result.context.lesson_count).toBe(1);
    });

    it("builds full LLM-injectable context after spreading and pruning", () => {
      const a = engine.createNode("A");
      const b = engine.createNode("B");
      const c = engine.createNode("C");
      const d = engine.createNode("D");

      engine.createEdge(a.id, b.id);
      engine.createEdge(b.id, c.id);
      engine.createEdge(c.id, d.id);

      // Set activation and run spreading
      db.prepare("UPDATE nodes SET activation = 1.0 WHERE id = ?").run(a.id);
      engine.spreadActivation([a.id], { maxDepth: 3 });

      // Prune weak edges (should archive none since all weights are 0.5)
      engine.prune();

      const result = engine.traverse();

      // Nodes should be present with activation values
      expect(result.activatedNodes.length).toBeGreaterThan(0);

      // Edges should have co-occurrence counts updated by spreading
      const abEdge = result.traversedEdges.find((e) => e.source === a.id && e.target === b.id);
      expect(abEdge).toBeDefined();
      expect(abEdge!.co_occurrence_count).toBeGreaterThan(0);

      // Context is a flat key-value record for LLM injection
      expect(result.context).toHaveProperty("activated_nodes");
      expect(result.context).toHaveProperty("edges");
      expect(result.context).toHaveProperty("node_count");
      expect(result.context).toHaveProperty("edge_count");
    });
  });
});

describe("GraphEngine — storeProbeResult", () => {
  let db: Database.Database;
  let engine: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    engine = new GraphEngine(db);
  });

  const successProbe: ProbeRecord = {
    proposalId: "decoy-001",
    probeType: "price_probe",
    description: "Listing señuelo en electrónica con precio 15% menor",
    outcome: {
      success: true,
      competitorReaction: "Competidor bajó precio en 5%",
      learnedAt: "2026-06-26T14:00:00Z",
    },
  };

  const failedProbe: ProbeRecord = {
    proposalId: "decoy-002",
    probeType: "stock_signal",
    description: "Señal de stock bajo en juguetes",
    outcome: {
      success: false,
      learnedAt: "2026-06-26T15:00:00Z",
    },
  };

  it("inserts a row into probe_results table", () => {
    engine.storeProbeResult(successProbe);

    const rows = db
      .prepare("SELECT * FROM probe_results WHERE proposal_id = ?")
      .all("decoy-001") as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.proposal_id).toBe("decoy-001");
    expect(rows[0]!.probe_type).toBe("price_probe");

    const outcome = JSON.parse(rows[0]!.outcome as string) as {
      success: boolean;
      competitorReaction: string;
      learnedAt: string;
    };
    expect(outcome.success).toBe(true);
    expect(outcome.competitorReaction).toBe("Competidor bajó precio en 5%");
    expect(outcome.learnedAt).toBe("2026-06-26T14:00:00Z");
  });

  it("creates a Cortex node tagged probe: true", () => {
    const nodeId = engine.storeProbeResult(successProbe);

    const node = engine.getNode(nodeId);
    expect(node).not.toBeNull();
    expect(node!.label).toBe("probe_decoy-001");

    const metadata = JSON.parse(node!.metadata) as {
      probe: boolean;
      proposalId: string;
      probeType: string;
      description: string;
    };
    expect(metadata.probe).toBe(true);
    expect(metadata.proposalId).toBe("decoy-001");
    expect(metadata.probeType).toBe("price_probe");
    expect(metadata.description).toBe(successProbe.description);
  });

  it("returns the created node ID", () => {
    const id1 = engine.storeProbeResult(successProbe);
    const id2 = engine.storeProbeResult(failedProbe);

    expect(id1).toBeGreaterThan(0);
    expect(id2).toBe(id1 + 1);
  });

  describe("with competidor actor node seeded", () => {
    beforeEach(() => {
      engine.seedActorNodes([
        {
          actorType: "competidor",
          traits: { aggressiveness: 0.7, priceSensitivity: 0.6 },
        },
      ]);
    });

    it("creates an edge between probe node and competidor actor", () => {
      const nodeId = engine.storeProbeResult(successProbe);
      const competidorNode = engine.getActorNode("competidor");

      expect(competidorNode).not.toBeNull();

      const edge = db
        .prepare("SELECT * FROM edges WHERE source = ? AND target = ?")
        .get(nodeId, competidorNode!.id) as { weight: number } | undefined;

      expect(edge).toBeDefined();
    });

    it("reinforces edge on successful probe (+0.1 on top of base 0.5)", () => {
      const nodeId = engine.storeProbeResult(successProbe);
      const competidorNode = engine.getActorNode("competidor")!;

      const edge = db
        .prepare("SELECT * FROM edges WHERE source = ? AND target = ?")
        .get(nodeId, competidorNode.id) as { weight: number };

      // Base weight 0.5 + reinforcement 0.1 = 0.6
      expect(edge.weight).toBe(0.6);
    });

    it("penalizes edge on failed probe (−0.15 on top of base 0.5)", () => {
      const nodeId = engine.storeProbeResult(failedProbe);
      const competidorNode = engine.getActorNode("competidor")!;

      const edge = db
        .prepare("SELECT * FROM edges WHERE source = ? AND target = ?")
        .get(nodeId, competidorNode.id) as { weight: number };

      // Base weight 0.5 − penalty 0.15 = 0.35
      expect(edge.weight).toBe(0.35);
    });

    it("reinforces existing edge on repeated successful probes", () => {
      // First probe creates and reinforces
      const firstId = engine.storeProbeResult(successProbe);
      const competidorNode = engine.getActorNode("competidor")!;

      // Mock a second probe with different ID but same type
      const secondProbe: ProbeRecord = {
        proposalId: "decoy-003",
        probeType: "price_probe",
        description: "Segundo listing señuelo en electrónica",
        outcome: {
          success: true,
          competitorReaction: "Mismo competidor reaccionó otra vez",
          learnedAt: "2026-06-26T16:00:00Z",
        },
      };
      const secondId = engine.storeProbeResult(secondProbe);

      // Different probe nodes
      expect(secondId).not.toBe(firstId);

      const firstEdge = db
        .prepare("SELECT * FROM edges WHERE source = ? AND target = ?")
        .get(firstId, competidorNode.id) as { weight: number };
      const secondEdge = db
        .prepare("SELECT * FROM edges WHERE source = ? AND target = ?")
        .get(secondId, competidorNode.id) as { weight: number };

      expect(firstEdge.weight).toBe(0.6);
      expect(secondEdge.weight).toBe(0.6);
    });

    it("increments probe_results row count when recording multiple probes", () => {
      engine.storeProbeResult(successProbe);
      engine.storeProbeResult(failedProbe);

      const count = (
        db.prepare("SELECT COUNT(*) as cnt FROM probe_results").get() as {
          cnt: number;
        }
      ).cnt;
      expect(count).toBe(2);
    });
  });
});
