# neural-graph-memory Specification

SQLite-backed graph engine with Hebbian learning, recursive CTE spreading activation, Darwinian pruning, and convergence detection.

## Requirements

### Requirement: Graph Schema

The system MUST persist a directed weighted graph in SQLite with: `nodes` (id, label, activation, metadata), `edges` (source, target, weight, last_activated, co_occurrence_count, distilled_lesson), `darwinian_lessons` (id, source_node, target_node, lesson, archived_at, reason).

#### Scenario: Node creation

- GIVEN a label and optional metadata
- WHEN a node is created
- THEN activation MUST default to 0.0 and return the assigned id

#### Scenario: Edge creation

- GIVEN two existing node ids
- WHEN an edge is created
- THEN weight MUST default to 0.5 (co_occurrence_count 0)
- AND duplicate (source, target) pairs MUST be rejected

### Requirement: Hebbian Learning

The system MUST adjust edge weights: +0.1 on reinforcement, −0.15 on penalty, clamped to [0, 1].

#### Scenario: Weight adjustment

- GIVEN an edge with weight 0.5
- WHEN reinforced → weight MUST become 0.6
- WHEN penalized → weight MUST become 0.35
- AND last_activated MUST update on any change

#### Scenario: Boundary clamping

- GIVEN weight 0.95; WHEN reinforced → clamped to 1.0
- GIVEN weight 0.10; WHEN penalized → clamped to 0.0

### Requirement: Spreading Activation

The system MUST propagate activation from seed nodes via recursive CTE, bounded by depth (default 3) and activation threshold.

#### Scenario: Activation propagates to neighbors

- GIVEN node A (activation 1.0) connected to B (weight 0.5) and C (weight 0.3)
- WHEN spreading activation runs
- THEN B and C MUST receive activation ∝ weight × source activation with per-hop decay

#### Scenario: Depth and threshold bounds

- GIVEN chain A→B→C→D→E with depth limit 2
- WHEN spreading activation runs from A
- THEN nodes beyond depth 2 MUST NOT activate
- AND sub-threshold paths MUST be pruned

#### Scenario: Co-occurrence tracking

- GIVEN an edge traversed during activation
- WHEN the edge is visited
- THEN co_occurrence_count MUST increment by 1

### Requirement: Darwinian Pruning

The system MUST archive edges with weight < 0.05 and distill a lesson from each discarded connection.

#### Scenario: Weak edge archived with lesson

- GIVEN edge (weight 0.03) connecting two nodes
- WHEN pruning runs
- THEN the edge MUST be removed
- AND darwinian_lessons MUST receive a row with source_node, target_node, lesson, reason="weight_below_threshold"

#### Scenario: Threshold boundary and idempotency

- GIVEN weight exactly 0.05 → MUST NOT be removed
- GIVEN all weak edges already archived → no additional edges removed on re-run

### Requirement: Convergence Detection

The system MUST compute cosine similarity between successive activation snapshots. Converged when similarity > 0.95 (configurable).

#### Scenario: Converged vs divergent

- GIVEN snapshots with cosine similarity 0.97 → MUST report converged
- GIVEN snapshots with cosine similarity 0.72 → MUST report not converged
- GIVEN first iteration (no prior snapshot) → MUST report not converged (not error)

### Requirement: Graph Traversal API

The system MUST return activated nodes with scores, traversed edges with weights/co-occurrence counts, and distilled lessons — formatted as flat key-value context for LLM prompt injection.

#### Scenario: Full traversal

- GIVEN a graph with nodes, edges, and darwinian_lessons
- WHEN traversal is requested for a seed node
- THEN response MUST include nodes (activation scores), edges (weights), and lessons
- AND MUST be structured as injectable LLM context

#### Scenario: Empty graph

- GIVEN the graph has no nodes
- WHEN traversal is requested
- THEN response MUST return empty context (not an error)
