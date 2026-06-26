import Database from "better-sqlite3";

import type { GraphEdge, GraphNode } from "./types.js";
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
}
