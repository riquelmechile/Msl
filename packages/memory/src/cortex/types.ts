export type GraphNode = {
  id: number;
  label: string;
  activation: number;
  metadata: string;
  /** Optional seller scoping — NULL means global visibility. */
  sellerId?: string;
};

export type GraphEdge = {
  id: number;
  source: number;
  target: number;
  weight: number;
  last_activated: string | null;
  co_occurrence_count: number;
  distilled_lesson: string | null;
  /** Optional seller scoping — NULL means global visibility. */
  sellerId?: string;
};

export type DarwinianLesson = {
  id: number;
  source_node: number;
  target_node: number;
  lesson: string;
  archived_at: string;
  reason: string;
  /** Optional seller scoping — NULL means global visibility. */
  sellerId?: string;
};

/** Node ID → activation value */
export type ActivationSnapshot = Map<number, number>;

export type TraversalResult = {
  /** Activated nodes with their final activation scores */
  activatedNodes: ReadonlyArray<{ nodeId: number; label: string; activation: number }>;
  /** Edges traversed during activation, with weights and co-occurrence counts */
  traversedEdges: ReadonlyArray<{
    source: number;
    target: number;
    weight: number;
    co_occurrence_count: number;
  }>;
  /** Distilled lessons from pruned edges */
  lessons: ReadonlyArray<Pick<DarwinianLesson, "source_node" | "target_node" | "lesson">>;
  /** Flat key-value context for LLM prompt injection */
  context: Record<string, unknown>;
};

export type ConvergenceResult =
  | { converged: true; similarity: number }
  | { converged: false; reason: string; similarity?: number };

export type SpreadingOptions = {
  /** Maximum depth for recursive CTE traversal (default 3) */
  maxDepth?: number;
  /** Minimum activation threshold to prune sub-threshold paths (default 0.01) */
  activationThreshold?: number;
  /** Per-hop decay factor applied to activation (default 0.5) */
  decayFactor?: number;
};

export class DuplicateEdgeError extends Error {
  constructor(source: number, target: number) {
    super(`Edge already exists between node ${source} and node ${target}`);
    this.name = "DuplicateEdgeError";
  }
}

export class NodeNotFoundError extends Error {
  constructor(id: number) {
    super(`Node with id ${id} not found`);
    this.name = "NodeNotFoundError";
  }
}

// ── Actor Models ──────────────────────────────────────────────────

export type ActorType = "comprador" | "proveedor" | "competidor";

export type SimulationResult = {
  actorType: ActorType;
  recommendation: string;
  confidence: number;
  rationale: string;
  simulationId: string;
};

/** Cortex graph node tagged as an actor persona profile. */
export type ActorProfileNode = GraphNode & {
  metadata: {
    type: "actor_profile";
    persona: ActorType;
    traits: Record<string, unknown>;
  };
};

// ── Honey-Pot Probing ─────────────────────────────────────────────

/** Minimal probe record passed to GraphEngine.storeProbeResult. */
export type ProbeRecord = {
  proposalId: string;
  probeType: string;
  description: string;
  outcome: {
    success: boolean;
    competitorReaction?: string;
    learnedAt: string;
  };
};
