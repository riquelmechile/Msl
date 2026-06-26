# Tasks: Cortex Neural Graph Memory

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~600 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Foundation (~160 lines) → PR 2: Hebbian + Spreading (~230 lines) → PR 3: Pruning + Traversal (~210 lines) |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main |

Decision needed before apply: Resolved
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Types, DB schema, CRUD | PR 1 | Standalone; base: main |
| 2 | Hebbian ops, spreading activation, co-occurrence | PR 2 | Depends on PR 1 |
| 3 | Darwinian pruning, convergence, traversal, barrel export | PR 3 | Depends on PR 2 |

## Phase 1: Foundation (types + schema + CRUD)

- [x] 1.1 Add `better-sqlite3` and `@types/better-sqlite3` to `packages/memory/package.json`
- [x] 1.2 Create `packages/memory/src/cortex/types.ts` — define `GraphNode`, `GraphEdge`, `DarwinianLesson`, `ActivationSnapshot`, `TraversalResult`, `ConvergenceResult`, `SpreadingOptions`
- [x] 1.3 Create `packages/memory/src/cortex/database.ts` — `createDatabase(path?)` with schema DDL (nodes, edges with UNIQUE(source,target), darwinian_lessons) + WAL/foreign_keys pragmas
- [x] 1.4 Create `packages/memory/src/cortex/engine.ts` — `GraphEngine` class skeleton with `createNode`, `createEdge`, `getNode`, `getEdge` methods; catch constraint violations as `DuplicateEdgeError` / `NodeNotFoundError`
- [x] 1.5 Create `packages/memory/tests/cortex/engine.test.ts` — tests for node creation (activation=0), edge creation (weight=0.5), duplicate edge rejection, DB init

## Phase 2: Hebbian Learning + Spreading Activation

- [ ] 2.1 Add `reinforceEdge` and `penalizeEdge` to `GraphEngine` — UPDATE weight clamped [0,1] via SQL MAX/MIN, +0.1/−0.15 deltas, update `last_activated`
- [ ] 2.2 Add `spreadActivation` to `GraphEngine` — recursive CTE with depth guard (default 3) and activation threshold, track visited pairs and increment `co_occurrence_count` on traversed edges
- [ ] 2.3 Add engine tests — reinforce (+0.1), penalize (−0.15), boundary clamp at 0 and 1, depth limit excludes node 4 in A→B→C→D→E chain, co-occurrence count increments

## Phase 3: Pruning + Convergence + Traversal

- [ ] 3.1 Add `prune` to `GraphEngine` — single transaction: INSERT darwinian_lessons for edges with weight < 0.05 (distill lesson), DELETE those edges; strict less-than (0.05 survives); idempotent re-run
- [ ] 3.2 Add `detectConvergence` and `cosineSimilarity` pure function — compare activation snapshots; converged when > 0.95; first iteration returns `{ converged: false, reason: "first-iteration" }`; zero vectors return 0
- [ ] 3.3 Add `traverse` to `GraphEngine` — return activated nodes with scores, traversed edges, distilled lessons formatted as LLM-injectable key-value context; empty graph returns empty context (not error)
- [ ] 3.4 Create `packages/memory/src/cortex/index.ts` — barrel export of all types + `createGraphEngine(path?)` factory
- [ ] 3.5 Add remaining engine tests — pruning atomicity (0.04 archived, 0.06 kept), idempotent re-run, convergence (>0.95=true, <0.95=false), first iteration, full LLM context traversal, empty graph returns empty context

## Phase 4: Verification

- [ ] 4.1 Run `npm test` from workspace root — all existing tests pass + new cortex tests pass
- [ ] 4.2 Run `npm run typecheck --workspace @msl/memory` — no type errors
