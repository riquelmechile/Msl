# Proposal: Cortex Neural Graph Memory

## Intent

The Msl agent learns seller preferences through corrections but has no structural memory — it forgets everything between sessions. Each interaction is isolated; patterns across conversations are lost. Cortex adds a neural graph memory that learns from every interaction: strengthens useful connections, forgets irrelevant ones, and provides rich context for LLM prompt injection.

## Scope

### In Scope
- SQLite-backed graph: nodes, edges, Darwinian lessons tables
- Hebbian learning: strengthen/weaken edge weights (+0.1 success, −0.15 failure)
- Recursive CTE spreading activation from seed nodes (depth-limited)
- Darwinian pruning: archive weak edges (weight < 0.05) with lesson distillation
- Convergence detection via cosine similarity of activation snapshots
- Graph traversal API for LLM context injection
- Unit tests for all operations

### Out of Scope
- Vector embeddings, pgvector, DeepSeek API, real ML data extraction
- Conversational agent integration (standalone engine)
- Multi-agent memory sharing or cloud sync

## Capabilities

### New Capabilities
- `neural-graph-memory`: Hebbian learning engine with spreading activation, Darwinian pruning, convergence detection, and graph traversal

### Modified Capabilities
None — additive under `packages/memory/src/cortex/`. Existing types and `business-memory-cache` spec unchanged.

## Approach

better-sqlite3 with recursive CTEs. Three tables: `nodes` (id, label, activation, metadata), `edges` (source, target, weight, last_activated, co_occurrence_count, distilled_lesson), `darwinian_lessons` (id, source_node, target_node, lesson, archived_at, reason). Hebbian updates via SQL arithmetic. Spreading activation through recursive CTEs with depth/activation guards. Convergence via cosine similarity between snapshots. Darwinian pruning archives edges below threshold with distilled lesson. ~400 lines.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/memory/src/cortex/` | New | Graph engine with all operations |
| `packages/memory/package.json` | Modified | Add better-sqlite3 |
| `packages/memory/tests/cortex/` | New | Unit tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| better-sqlite3 build failures | Low | Prebuilt binaries for linux-x64 on Node ≥22 |
| Recursive CTE perf at scale | Low | Depth limit (3) bounds traversal; target ~1K nodes |
| Convergence false positives | Med | Tunable cosine threshold; tested with known cases |

## Rollback Plan

Fully additive — no existing types, exports, or specs modified. Revert: delete `packages/memory/src/cortex/`, remove better-sqlite3 from package.json.

## Dependencies

- better-sqlite3 + @types/better-sqlite3 (dev)

## Success Criteria

- [x] All graph ops pass unit tests (create, Hebbian, spreading activation, prune, convergence)
- [x] Recursive CTE returns correct paths within depth limit
- [x] Darwinian pruning archives edges with distilled lessons
- [x] Convergence detected at cosine similarity > 0.95
- [x] Existing 71 tests continue passing (120 total: 71 existing + 49 Cortex)
