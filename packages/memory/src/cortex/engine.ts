import Database from "better-sqlite3";

import type {
  ActivationSnapshot,
  ActorType,
  ConvergenceResult,
  GraphEdge,
  GraphNode,
  ProbeRecord,
  SimulationResult,
  SpreadingOptions,
  TraversalResult,
} from "./types.js";
import { DuplicateEdgeError, NodeNotFoundError } from "./types.js";

/**
 * Pure function: computes cosine similarity between two activation snapshots.
 *
 * Measures how similar two activation distributions are as vectors in node-space.
 * Dot product divided by product of L2 norms across union of node IDs.
 * Returns 0 when either vector has zero magnitude (including empty maps).
 */
export function cosineSimilarity(a: Map<number, number>, b: Map<number, number>): number {
  const allIds = new Set([...a.keys(), ...b.keys()]);

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const id of allIds) {
    const va = a.get(id) ?? 0;
    const vb = b.get(id) ?? 0;
    dotProduct += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class GraphEngine {
  readonly db: Database.Database;

  /** In-memory snapshot store for convergence detection. */
  private lastSnapshot: ActivationSnapshot | null = null;

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
    const nodeMap = new Map<
      number,
      { id: number; label: string; activation: number; depth: number }
    >();
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

  /**
   * Darwinian pruning: archive edges with weight below 0.05 as lessons,
   * then delete them — all in a single atomic transaction.
   *
   * Strict less-than: edges at exactly 0.05 survive.
   * Idempotent: re-running on an already-pruned graph is a no-op.
   *
   * When `maxNodes` is set and the node count exceeds it, the oldest
   * inactive nodes (activation=0, no edges) are archived and removed.
   * Nodes with active edges or activation > 0 are preserved regardless
   * of age.
   *
   * @param options.maxNodes — maximum nodes before archival kicks in (default 10000).
   * @returns the number of edges pruned.
   */
  prune(options?: { maxNodes?: number }): { archivedCount: number } {
    const maxNodes = options?.maxNodes ?? 10000;

    const count = this.db.transaction(() => {
      // Distill lessons from edges about to be pruned
      this.db
        .prepare(
          `INSERT INTO darwinian_lessons (source_node, target_node, lesson, archived_at, reason)
           SELECT e.source, e.target,
                  COALESCE(e.distilled_lesson,
                           'connection between ' || sn.label || ' and ' || tn.label),
                  datetime('now'), 'weight_below_threshold'
           FROM edges e
           JOIN nodes sn ON sn.id = e.source
           JOIN nodes tn ON tn.id = e.target
           WHERE e.weight < 0.05`,
        )
        .run();

      // Delete the weak edges
      const info = this.db.prepare("DELETE FROM edges WHERE weight < 0.05").run();

      // ── Node cap: archive oldest inactive nodes when above maxNodes ──
      const nodeCount = (
        this.db.prepare("SELECT COUNT(*) as cnt FROM nodes").get() as { cnt: number }
      ).cnt;

      if (nodeCount > maxNodes) {
        // Archive nodes with activation=0 that have no incident edges
        // (both as source or target), keeping the newest ones.
        const toArchive = nodeCount - maxNodes;
        this.db
          .prepare(
            `INSERT INTO darwinian_lessons (source_node, target_node, lesson, archived_at, reason)
             SELECT n.id, 0,
                    'archived inactive node: ' || n.label,
                    datetime('now'), 'node_cap_exceeded'
             FROM nodes n
             WHERE n.activation = 0
               AND n.id NOT IN (SELECT DISTINCT source FROM edges)
               AND n.id NOT IN (SELECT DISTINCT target FROM edges)
             ORDER BY n.id ASC
             LIMIT ?`,
          )
          .run(toArchive);

        this.db
          .prepare(
            `DELETE FROM nodes
             WHERE id IN (
               SELECT id FROM nodes
               WHERE activation = 0
                 AND id NOT IN (SELECT DISTINCT source FROM edges)
                 AND id NOT IN (SELECT DISTINCT target FROM edges)
               ORDER BY id ASC
               LIMIT ?
             )`,
          )
          .run(toArchive);
      }

      return info.changes;
    })();

    return { archivedCount: count };
  }

  /**
   * Compare an activation snapshot against the previous one using cosine similarity.
   *
   * On the first call (no prior snapshot), returns
   * `{ converged: false, reason: "first-iteration" }` and stores the snapshot
   * for subsequent comparisons.
   *
   * Convergence is declared when cosine similarity exceeds the configured
   * threshold (default 0.95).
   */
  detectConvergence(
    snapshot: ActivationSnapshot,
    options?: { threshold?: number },
  ): ConvergenceResult {
    const threshold = options?.threshold ?? 0.95;

    if (this.lastSnapshot === null) {
      this.lastSnapshot = new Map(snapshot);
      return { converged: false, reason: "first-iteration" };
    }

    const similarity = cosineSimilarity(this.lastSnapshot, snapshot);
    this.lastSnapshot = new Map(snapshot);

    if (similarity > threshold) {
      return { converged: true, similarity };
    }
    return {
      converged: false,
      reason: `similarity ${similarity.toFixed(4)} below threshold ${threshold}`,
      similarity,
    };
  }

  /**
   * Traverse the entire graph returning activated nodes, traversed edges,
   * distilled lessons, and an LLM-injectable key-value context.
   *
   * Reads current state from the database — call after spreading activation
   * to capture the activated subgraph. Empty graph returns empty context
   * (all arrays empty, no error thrown).
   */
  traverse(): TraversalResult {
    const nodes = this.db.prepare("SELECT id, label, activation FROM nodes").all() as Array<{
      id: number;
      label: string;
      activation: number;
    }>;

    const edges = this.db
      .prepare("SELECT source, target, weight, co_occurrence_count FROM edges")
      .all() as Array<{
      source: number;
      target: number;
      weight: number;
      co_occurrence_count: number;
    }>;

    const lessons = this.db
      .prepare("SELECT source_node, target_node, lesson FROM darwinian_lessons")
      .all() as Array<{
      source_node: number;
      target_node: number;
      lesson: string;
    }>;

    const activatedNodes = nodes.map((n) => ({
      nodeId: n.id,
      label: n.label,
      activation: n.activation,
    }));

    const traversedEdges = edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      co_occurrence_count: e.co_occurrence_count,
    }));

    // Build flat key-value context for LLM prompt injection
    const context: Record<string, unknown> = {};

    if (activatedNodes.length > 0) {
      context["activated_nodes"] = activatedNodes
        .map((n) => `node_${n.nodeId}: ${n.label} (act:${n.activation.toFixed(3)})`)
        .join("; ");
      context["node_count"] = activatedNodes.length;
    }

    if (traversedEdges.length > 0) {
      context["edges"] = traversedEdges
        .map(
          (e) =>
            `edge_${e.source}_${e.target}: w:${e.weight.toFixed(3)}, co:${e.co_occurrence_count}`,
        )
        .join("; ");
      context["edge_count"] = traversedEdges.length;
    }

    if (lessons.length > 0) {
      context["lessons"] = lessons
        .map((l, i) => `lesson_${i + 1}_(${l.source_node}→${l.target_node}): ${l.lesson}`)
        .join("; ");
      context["lesson_count"] = lessons.length;
    }

    return {
      activatedNodes,
      traversedEdges,
      lessons,
      context,
    };
  }

  /**
   * Seed actor persona nodes in the Cortex graph.
   *
   * Creates or updates one node per actor type with activation 0.5 and
   * actor-profile metadata. Idempotent — re-seeding updates existing nodes
   * rather than duplicating them.
   *
   * @returns the node IDs (created or existing).
   */
  seedActorNodes(
    profiles: Array<{ actorType: ActorType; traits: Record<string, unknown> }>,
  ): number[] {
    const ids: number[] = [];

    for (const profile of profiles) {
      const metadata = JSON.stringify({
        type: "actor_profile",
        persona: profile.actorType,
        traits: profile.traits,
      });

      // Look for an existing actor node by persona tag in metadata
      const existing = this.db
        .prepare("SELECT id FROM nodes WHERE metadata LIKE ?")
        .get(`%"persona":"${profile.actorType}"%`) as { id: number } | undefined;

      if (existing) {
        this.db
          .prepare("UPDATE nodes SET activation = 0.5, metadata = ? WHERE id = ?")
          .run(metadata, existing.id);
        ids.push(existing.id);
      } else {
        const result = this.db
          .prepare("INSERT INTO nodes (label, activation, metadata) VALUES (?, 0.5, ?)")
          .run(`actor_${profile.actorType}`, metadata);
        ids.push(Number(result.lastInsertRowid));
      }
    }

    return ids;
  }

  /**
   * Retrieve an actor persona node by type.
   */
  getActorNode(actorType: ActorType): GraphNode | null {
    const row = this.db
      .prepare("SELECT id, label, activation, metadata FROM nodes WHERE metadata LIKE ?")
      .get(`%"persona":"${actorType}"%`) as GraphNode | undefined;
    return row ?? null;
  }

  /**
   * Hebbian reinforcement or penalization on all edges sourced from
   * the actor node.
   *
   * @param actorType — which actor persona to adjust.
   * @param success — true strengthens edges (+0.1), false weakens them (−0.15).
   */
  reinforceActorOutcome(actorType: ActorType, success: boolean): void {
    const actorNode = this.getActorNode(actorType);
    if (!actorNode) return;

    const delta = success ? 0.1 : -0.15;
    this.db
      .prepare(
        `UPDATE edges SET weight = MAX(0.0, MIN(1.0, weight + ?)),
                          last_activated = datetime('now')
         WHERE source = ?`,
      )
      .run(delta, actorNode.id);
  }

  /**
   * Persist a simulation consultation into the actor_simulations table.
   *
   * @returns the inserted row ID.
   */
  recordSimulation(actorType: ActorType, query: string, result: SimulationResult): number {
    const stmt = this.db.prepare(
      "INSERT INTO actor_simulations (actor_type, query, result) VALUES (?, ?, ?)",
    );
    const info = stmt.run(actorType, query, JSON.stringify(result));
    return Number(info.lastInsertRowid);
  }

  /**
   * Idempotent concept node lookup by label.
   *
   * Returns an existing node if a row with the given label already exists.
   * Otherwise creates a new node with activation 0.0 and the provided metadata.
   *
   * @param label — Unique concept label (e.g., "strategy_margin").
   * @param metadata — Optional metadata merged into the node on creation.
   * @returns The existing or newly created graph node.
   */
  findOrCreateConceptNode(label: string, metadata: Record<string, unknown> = {}): GraphNode {
    const existing = this.db
      .prepare("SELECT id, label, activation, metadata FROM nodes WHERE label = ?")
      .get(label) as GraphNode | undefined;

    if (existing) return existing;

    return this.createNode(label, metadata);
  }

  /**
   * Persist a honey-pot probe result.
   *
   * Creates a probe_results row, a Cortex node tagged `probe: true`,
   * and applies Hebbian reinforcement (success → +0.1) or penalization
   * (failure → −0.15) on the edge between the probe node and the
   * competidor actor node.
   *
   * @returns the inserted probe node ID.
   */
  storeProbeResult(proposal: ProbeRecord): number {
    // 1. Insert into probe_results table
    const outcomeJson = JSON.stringify(proposal.outcome);
    this.db
      .prepare("INSERT INTO probe_results (proposal_id, probe_type, outcome) VALUES (?, ?, ?)")
      .run(proposal.proposalId, proposal.probeType, outcomeJson);

    // 2. Create Cortex node for this probe result
    const node = this.createNode(`probe_${proposal.proposalId}`, {
      probe: true,
      proposalId: proposal.proposalId,
      probeType: proposal.probeType,
      description: proposal.description,
    });

    // 3. Hebbian learning on probe → competidor actor edges
    const competidorNode = this.getActorNode("competidor");
    if (competidorNode) {
      // Check if an edge already exists between the probe node and the competidor
      const existing = this.db
        .prepare(
          "SELECT id, source, target, weight, last_activated, co_occurrence_count, distilled_lesson FROM edges WHERE source = ? AND target = ?",
        )
        .get(node.id, competidorNode.id) as GraphEdge | undefined;

      if (existing) {
        // Edge exists — reinforce or penalize
        if (proposal.outcome.success) {
          this.reinforceEdge(node.id, competidorNode.id);
        } else {
          this.penalizeEdge(node.id, competidorNode.id);
        }
      } else {
        // Create the edge first, then reinforce or penalize
        this.createEdge(node.id, competidorNode.id);
        if (proposal.outcome.success) {
          this.reinforceEdge(node.id, competidorNode.id);
        } else {
          this.penalizeEdge(node.id, competidorNode.id);
        }
      }
    }

    return node.id;
  }
}
