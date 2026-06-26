# Design: Cortex Neural Graph Memory

## Technical Approach

Embedded SQLite (better-sqlite3) with recursive CTEs. Hebbian via SQL arithmetic, spreading activation through depth-limited CTEs, Darwinian pruning with atomic edge deletion plus lesson insertion. Additive under `packages/memory/src/cortex/` — zero changes to existing exports.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Storage engine | better-sqlite3 (sync) | Neo4j, graphology, sqlite-vec | Prebuilt binaries, no server, no WASM. Blocking OK for sub-1K nodes at MVP. |
| Spreading activation | SQL recursive CTE | In-memory BFS | DB does heavy lifting. Depth limit (3) + activation guard prevent runaway recursion. |
| Engine shape | `GraphEngine` class wrapping `Database` | Standalone functions | Matches project boundary patterns (PgvectorMemoryStore, RepositoryBoundary). |
| Error model | Catch constraint violations → typed errors | Raw SQL errors | Clean `DuplicateEdgeError`, `NodeNotFoundError`. Empty graphs return empty results. |

## Module Structure

```
packages/memory/src/cortex/
├── types.ts        — GraphNode, GraphEdge, DarwinianLesson, ActivationSnapshot,
│                     TraversalResult, ConvergenceResult, SpreadingOptions
├── database.ts     — createDatabase(path?): Database, schema DDL
├── engine.ts       — GraphEngine class + cosineSimilarity() pure function
└── index.ts        — barrel export + createGraphEngine(path?) factory
```

## Database Schema

```
nodes(id INTEGER PK, label TEXT, activation REAL DEFAULT 0.0, metadata TEXT DEFAULT '{}')
edges(id INTEGER PK, source INTEGER FK, target INTEGER FK, weight REAL DEFAULT 0.5,
      last_activated TEXT, co_occurrence_count INTEGER DEFAULT 0, distilled_lesson TEXT,
      UNIQUE(source, target))
darwinian_lessons(id INTEGER PK, source_node INTEGER, target_node INTEGER,
                  lesson TEXT, archived_at TEXT, reason TEXT)
```

Pragmas: `journal_mode=WAL`, `foreign_keys=ON`. Default `:memory:`.

## Key Operations

### Hebbian Update

```sql
UPDATE edges SET weight = MAX(0.0, MIN(1.0, weight + ?)),
                 last_activated = datetime('now')
WHERE source = ? AND target = ?
```

Delta: +0.1 (reinforce), −0.15 (penalize). SQL MAX/MIN enforces clamp.

### Spreading Activation (Recursive CTE)

```sql
WITH RECURSIVE spread(id, label, activation_value, depth) AS (
    SELECT n.id, n.label, n.activation, 0 FROM nodes n WHERE n.id IN (?, ?, ?)
    UNION ALL
    SELECT n.id, n.label,
           s.activation_value * e.weight * 0.5, s.depth + 1
    FROM spread s JOIN edges e ON e.source = s.id JOIN nodes n ON n.id = e.target
    WHERE s.depth < 3 AND s.activation_value * e.weight * 0.5 > 0.01
)
SELECT DISTINCT id, label, MAX(activation_value), MIN(depth)
FROM spread GROUP BY id ORDER BY activation_value DESC
```

Post-CTE: `UPDATE edges SET co_occurrence_count = co_occurrence_count + 1` for traversed pairs (tracked via temp table from CTE results).

### Darwinian Pruning (Single Transaction)

```sql
INSERT INTO darwinian_lessons (source_node, target_node, lesson, archived_at, reason)
SELECT e.source, e.target,
       COALESCE(e.distilled_lesson, 'connection between ' || sn.label || ' and ' || tn.label),
       datetime('now'), 'weight_below_threshold'
FROM edges e JOIN nodes sn ON sn.id=e.source JOIN nodes tn ON tn.id=e.target
WHERE e.weight < 0.05;

DELETE FROM edges WHERE weight < 0.05;
```

Strict less-than: weight 0.05 survives. Idempotent on re-run.

### Convergence Detection

Pure function `cosineSimilarity(a: Map<number, number>, b: Map<number, number>): number`. Dot product divided by product of L2 norms across union of node IDs. Returns 0 on zero vectors. Converged when > 0.95 (configurable). First iteration returns `{ converged: false, reason: "first-iteration" }`.

## Data Flow

```
create/edge ──→ INSERT
reinforce/penalize ──→ UPDATE weight (clamped)
spreadActivation ──→ RECURSIVE CTE → UPDATE activations, co-occurrence
prune ──→ TRANSACTION { INSERT lessons + DELETE edges }
traverse ──→ SELECT → format LLM context
detectConvergence ──→ snapshot → cosine → threshold
```

## Error Handling

| Error | Trigger | Response |
|-------|---------|----------|
| `DuplicateEdgeError` | UNIQUE(source,target) violation | Catch SQLITE_CONSTRAINT |
| `NodeNotFoundError` | FK violation / invalid id | Catch, throw typed error |
| Empty graph | No nodes exist | Return empty `TraversalResult` (spec: not an error) |
| No prior snapshot | First convergence check | `{ converged: false, reason: "first-iteration" }` |

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/memory/src/cortex/types.ts` | Create | All type definitions |
| `packages/memory/src/cortex/database.ts` | Create | DB init, schema DDL |
| `packages/memory/src/cortex/engine.ts` | Create | GraphEngine + cosineSimilarity |
| `packages/memory/src/cortex/index.ts` | Create | Barrel + factory |
| `packages/memory/package.json` | Modify | Add better-sqlite3 + @types |
| `packages/memory/tests/cortex/engine.test.ts` | Create | Vitest — in-memory SQLite |
| `packages/memory/src/index.ts` | **No change** | Additive |

## Testing Strategy

| Scope | Verification |
|-------|-------------|
| CRUD + Hebbian ops | In-memory SQLite, verify DB state |
| CTE depth bounds | 4-node chain, depth=2 → node 4 excluded |
| cosineSimilarity | Known vectors, zero vector, empty map |
| Pruning atomicity | Edges at 0.04/0.06 → one archived, one kept |
| Convergence | Same seed → >0.95; different seed → <0.95 |
| Empty graph traversal | Returns empty context |
| Duplicate edge | `DuplicateEdgeError` thrown |
| Existing tests | `npm test` — all 71 pass |
| Type coverage | `npm run typecheck` clean |

## Open Questions

None. All constraints resolved from exploration phase.
