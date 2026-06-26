export { createDatabase, migrate } from "./database.js";
export { cosineSimilarity, GraphEngine } from "./engine.js";
export { DuplicateEdgeError, NodeNotFoundError } from "./types.js";
export type {
  ActivationSnapshot,
  ActorProfileNode,
  ActorType,
  ConvergenceResult,
  DarwinianLesson,
  GraphEdge,
  GraphNode,
  SimulationResult,
  SpreadingOptions,
  TraversalResult,
} from "./types.js";

import { createDatabase } from "./database.js";
import { GraphEngine } from "./engine.js";

/**
 * One-shot factory: creates a Database, wires the engine, and returns it.
 *
 * @param path — SQLite file path; defaults to in-memory (`:memory:`).
 */
export function createGraphEngine(path?: string): GraphEngine {
  const db = createDatabase(path);
  return new GraphEngine(db);
}
