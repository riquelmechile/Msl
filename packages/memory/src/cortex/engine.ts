import Database from "better-sqlite3";

import type { GraphEdge, GraphNode, SpreadingOptions } from "./types.js";
import { DuplicateEdgeError, NodeNotFoundError } from "./types.js";

export class GraphEngine {
  readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createNode(label: string, metadata: Record<string, unknown> = {}): GraphNode {
    const metadataJson = JSON.stringify(metadata);
    const stmt = this.db.prepare(
      "INSERT INTO nodes (label, activation, metadata) VALUES (?, 0.0, ?)",
    );
    const result = stmt.run(label, metadataJson);
    return {
      id: Number(result.lastInsertRowid),
      label,
      activation: 0.0,
      metadata: metadataJson,
    };
  }

  getNode(id: number): GraphNode | null {
    const row = this.db
      .prepare("SELECT id, label, activation, metadata FROM nodes WHERE id = ?")
      .get(id) as GraphNode | undefined;
    return row ?? null;
  }

  getEdge(id: number): GraphEdge | null {
    const row = this.db
      .prepare(
        "SELECT id, source, target, weight, last_activated, co_occurrence_count, distilled_lesson FROM edges WHERE id = ?",
      )
      .get(id) as GraphEdge | undefined;
    return row ?? null;
  }

  createEdge(source: number, target: number): GraphEdge {
    // Verify both nodes exist before attempting the insert
    if (!this.getNode(source)) {
      throw new NodeNotFoundError(source);
    }
    if (!this.getNode(target)) {
      throw new NodeNotFoundError(target);
    }

    try {
      const stmt = this.db.prepare(
        "INSERT INTO edges (source, target, weight, co_occurrence_count) VALUES (?, ?, 0.5, 0)",
      );
      const result = stmt.run(source, target);
      return {
        id: Number(result.lastInsertRowid),
        source,
        target,
        weight: 0.5,
        last_activated: null,
        co_occurrence_count: 0,
        distilled_lesson: null,
      };
    } catch (err) {
      if (err instanceof Database.SqliteError && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new DuplicateEdgeError(source, target);
      }
      throw err;
    }
  }

  /** Hebbian reinforcement: +0.1 delta, clamped to [0, 1] via SQL MAX/MIN. */
  reinforceEdge(source: number, target: number): GraphEdge {
    const row = this.db
      .prepare(
        `UPDATE edges SET weight = MAX(0.0, MIN(1.0, weight + 0.1)),
                         last_activated = datetime('now')
         WHERE source = ? AND target = ?
         RETURNING id, source, target, weight, last_activated, co_occurrence_count, distilled_lesson`,
      )
      .get(source, target) as GraphEdge | undefined;

    if (!row) {
      throw new Error(
        `Cannot reinforce: no edge found between source ${source} and target ${target}`,
      );
    }
    return row;
  }

  /** Hebbian penalization: −0.15 delta, clamped to [0, 1] via SQL MAX/MIN. */
  penalizeEdge(source: number, target: number): GraphEdge {
    const row = this.db
      .prepare(
        `UPDATE edges SET weight = MAX(0.0, MIN(1.0, weight - 0.15)),
                         last_activated = datetime('now')
         WHERE source = ? AND target = ?
         RETURNING id, source, target, weight, last_activated, co_occurrence_count, distilled_lesson`,
      )
      .get(source, target) as GraphEdge | undefined;

    if (!row) {
      throw new Error(
        `Cannot penalize: no edge found between source ${source} and target ${target}`,
      );
    }
    return row;
  }

  /**
   * Spreading activation via recursive CTE.
   *
   * Traverses the graph outward from seed nodes, decaying activation at each hop.
   * Increments `co_occurrence_count` on every edge traversed during the spread.
   *
   * @returns activated nodes sorted by activation descending.
   */
  spreadActivation(
    nodeIds: number[],
    options: SpreadingOptions = {},
  ): { activatedNodes: Array<{ id: number; label: string; activation: number; depth: number }> } {
    const maxDepth = options.maxDepth ?? 3;
    const threshold = options.activationThreshold ?? 0.01;
    const decay = options.decayFactor ?? 0.5;

    if (nodeIds.length === 0) {
      return { activatedNodes: [] };
    }

    const placeholders = nodeIds.map(() => "?").join(", ");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = this.db
      .prepare(
        `WITH RECURSIVE spread(src, tgt, nid, label, act, depth) AS (
           SELECT NULL, NULL, n.id, n.label, n.activation, 0
           FROM nodes n WHERE n.id IN (${placeholders})
           UNION ALL
           SELECT e.source, e.target, n.id, n.label,
                  s.act * e.weight * ${decay}, s.depth + 1
           FROM spread s
           JOIN edges e ON e.source = s.nid
           JOIN nodes n ON n.id = e.target
           WHERE s.depth < ${maxDepth}
             AND s.act * e.weight * ${decay} > ${threshold}
         )
         SELECT src, tgt, nid, label, act, depth FROM spread`,
      )
      .all(...nodeIds) as Array<{
        src: number | null;
        tgt: number | null;
        nid: number;
        label: string;
        act: number;
        depth: number;
      }>;

    // Track distinct traversed edge pairs and increment co-occurrence
    const seenPairs = new Set<string>();
    const updateStmt = this.db.prepare(
      "UPDATE edges SET co_occurrence_count = co_occurrence_count + 1 WHERE source = ? AND target = ?",
    );

    for (const row of rows) {
      if (row.src !== null) {
        const key = `${row.src}|${row.tgt}`;
        if (!seenPairs.has(key)) {
          seenPairs.add(key);
          updateStmt.run(row.src, row.tgt);
        }
      }
    }

    // Aggregate: keep max activation per node; break ties with min depth
    const nodeMap = new Map<number, { id: number; label: string; activation: number; depth: number }>();
    for (const row of rows) {
      const existing = nodeMap.get(row.nid);
      if (
        !existing ||
        row.act > existing.activation ||
        (row.act === existing.activation && row.depth < existing.depth)
      ) {
        nodeMap.set(row.nid, {
          id: row.nid,
          label: row.label,
          activation: row.act,
          depth: row.depth,
        });
      }
    }

    return {
      activatedNodes: [...nodeMap.values()].sort((a, b) => b.activation - a.activation),
    };
  }
}
