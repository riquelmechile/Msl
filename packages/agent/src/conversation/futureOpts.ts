// ─────────────────────────────────────────────────────────────────────
// Future optimisation stubs (LOW-priority bottlenecks)
// ─────────────────────────────────────────────────────────────────────
//
// This module collects configuration stubs, interfaces, and helpers
// for the LOW-priority expansion items identified in the bottleneck
// analysis.  They are intentionally non-functional — the stubs serve as
// architecture documentation and future anchor points so that when the
// team is ready to invest in a given item, the contract already exists.

// ── Recursive CTE cap (bottleneck 1.3) ──────────────────────────────

/** Maximum number of nodes the recursive CTE may activate in one call.
 *  Set in {@link SpreadingOptions.maxNodes} (default 200). */
export const CAPPED_CTE_MAX_NODES = 200;

// ── Cortex query cache (bottleneck 2.3) ─────────────────────────────

/** Stub interface for an LRU cache of Cortex traversal results.
 *  TTL cache keys on (seedNodeIds, depth); entries expire after `ttl`. */
export type CortexCache = {
  get(key: string): string | null;
  set(key: string, value: string, ttlMs: number): void;
  clear(): void;
};

/** Default TTL for Cortex cache entries (60 seconds). */
export const CORTEX_CACHE_TTL_MS = 60_000;

// ── LIKE injection sanitizer (bottleneck 3.5) ───────────────────────

/** Escape SQL LIKE wildcards in user-provided search terms.
 *  Prevents an attacker from injecting `%` or `_` to match
 *  all rows, which could load the entire Cortex graph.
 *
 *  @param input — raw user-supplied string used in `LIKE '%input%'`.
 *  @returns escaped string with `%` and `_` prefixed by `\`.
 */
export function sanitizeQuery(input: string): string {
  return input.replace(/[%_]/g, "\\$&");
}

// ── Escribano batch writes (bottleneck 1.6) ────────────────────────

/** Maximum number of Escribano observations to accumulate before flushing
 *  a single batch transaction to the Cortex database. */
export const ESCRIBANO_BATCH_SIZE = 10;

// ── Multi-seller isolation (bottleneck 4.1) ─────────────────────────

/** Interface stub for per-seller data partitioning.
 *  When implemented, all Cortex tables, strategies, sync state,
 *  and autonomy levels will carry a `seller_id` column. */
export type MultiSellerIsolation = {
  /** The seller context for the current operation. */
  sellerId: string;
  /** Partition a query to only return rows for this seller. */
  partition(table: string): string; // SQL WHERE clause
};

// ── Worker threads (bottleneck 1.5) ─────────────────────────────────

/** Configuration comment describing the worker-thread backlog strategy.
 *
 *  When sync/CPU-intensive work blocks the main event loop, offload to
 *  workers via `worker_threads` or a separate Node.js process.
 *  The `@msl/workers` package has stubs for this; wiring to agent loop
 *  tools is tracked as a LARGE effort item.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _workerThreadConfig = {
  /** Max worker threads to spawn for parallel sync operations. */
  maxWorkers: 4,
  /** Timeout in ms before a worker is considered stalled. */
  stallTimeoutMs: 120_000,
};

// ── CI checklist (bottleneck 4.4) ───────────────────────────────────

/** Test configuration for the CI/CD pipeline.
 *
 *  GitHub Actions workflow should run:
 *  1. `npm install`
 *  2. `npm run typecheck`
 *  3. `npm run lint`
 *  4. `npm run format:check`
 *  5. `npm test`
 *  6. `npm run build`
 */
export const CI_CHECKLIST = [
  "npm install",
  "npm run typecheck",
  "npm run lint",
  "npm run format:check",
  "npm test",
  "npm run build",
] as const;
