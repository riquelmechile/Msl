# neural-graph-memory Specification

SQLite-backed graph engine with Hebbian learning, recursive CTE spreading activation, Darwinian pruning, convergence detection, and autonomous Hebbian learning from conversation outcomes via the Escribano observer.

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

The system MUST propagate activation from seed nodes via recursive CTE, bounded by depth (default 3) and activation threshold. When seed nodes are supplier-typed, spreading activation SHALL discover niche patterns by traversing edges between supplier concepts and storefront or category concepts.

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

#### Scenario: Supplier node activation discovers niche patterns

- GIVEN a `supplier_item` seed node connected to category and margin concept nodes
- WHEN spreading activation runs with depth 3
- THEN activated nodes SHALL include category, margin, and strategy concepts reachable from the supplier node
- AND the agent MAY use these activated paths to reason about niche storefront opportunities

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

### Requirement: Concept Node Operations

The system MUST provide an idempotent concept node lookup: `findOrCreateConceptNode(label, metadata)` returns an existing node matching the label, or creates one with activation 0.0 if none exists.

#### Scenario: Existing concept node returned

- GIVEN a node with label "strategy_margin" exists
- WHEN `findOrCreateConceptNode("strategy_margin", {})` is called
- THEN the existing node id and label are returned
- AND no duplicate node is created

#### Scenario: New concept node created

- GIVEN no node with label "conversation_learning" exists
- WHEN `findOrCreateConceptNode("conversation_learning", {source: "escribano"})` is called
- THEN a new node is created with activation 0.0
- AND the metadata includes `{source: "escribano"}`
- AND the returned id is the new node's id

### Requirement: Supplier Concept Node Types

The graph SHALL support supplier-typed concept node labels with producer-prefix conventions: `supplier_profile`, `supplier_item`, `supplier_stock`, `supplier_mapping`, `supplier_policy`, and `supplier_lesson`. Node metadata MUST store type-specific fields (e.g., `supplierId`, `supplierItemId`, `targetListingId`, `confidence`). These node types SHALL use the existing `findOrCreateConceptNode()` primitive for idempotent creation.

#### Scenario: Supplier node types created

- GIVEN the supplier-cortex-integration bridge calls `findOrCreateConceptNode`
- WHEN label is `supplier_profile` or `supplier_item` or `supplier_stock` or `supplier_mapping` or `supplier_policy` or `supplier_lesson`
- THEN a node is created with activation 0.0 and the supplied metadata
- AND the node SHALL be queryable by its label

#### Scenario: Duplicate supplier node prevented

- GIVEN a `supplier_item` node exists with `supplierItemId: "SKU-123"` in metadata
- WHEN `findOrCreateConceptNode` is called with the same label and metadata key
- THEN the existing node MUST be returned without creating a duplicate

### Requirement: Supplier Metadata Query Support

The graph engine SHALL support `queryByMetadata(key, value)` returning all nodes whose `metadata` JSON contains the given key-value pair. This enables filtering nodes by `type = "supplier_item"`, `supplierId = "jinpeng"`, or any supplier-domain metadata field.

#### Scenario: Query all supplier_item nodes

- GIVEN supplier_item nodes exist in the graph with `metadata.type = "supplier_item"`
- WHEN `queryByMetadata("type", "supplier_item")` is called
- THEN all supplier_item nodes MUST be returned with their ids, labels, activation, and metadata

#### Scenario: Query by supplierId

- GIVEN nodes exist with `metadata.supplierId = "jinpeng"`
- WHEN `queryByMetadata("supplierId", "jinpeng")` is called
- THEN only nodes for that supplier MUST be returned

#### Scenario: No matching nodes

- GIVEN no nodes match the queried key-value pair
- WHEN `queryByMetadata("type", "nonexistent")` is called
- THEN an empty result set MUST be returned (not an error)

### Requirement: Automatic Hebbian Learning from Conversation Outcomes

The system MUST support external observers that apply Hebbian updates to Cortex edges based on conversation turn outcomes. The GraphEngine MUST expose `findOrCreateConceptNode`, `reinforceEdge`, `penalizeEdge`, `createEdge`, and `prune` as the primitive API for external observers.

The GraphEngine SHALL NOT contain conversation-specific logic — observers own pattern detection. The engine provides only graph primitives.

#### Scenario: Observer strengthens edge on confirmed proposal

- GIVEN an edge exists between concept nodes "proposal_price_change" (source) and "CEO_decision" (target) with weight 0.5
- WHEN an external observer calls `reinforceEdge(source, target)`
- THEN the edge weight MUST become 0.6
- AND `last_activated` MUST update

#### Scenario: Observer penalizes edge on guardrail rejection

- GIVEN an edge exists between concept nodes "proposal_risky_action" (source) and "safety_violation" (target) with weight 0.5
- WHEN an external observer calls `penalizeEdge(source, target)`
- THEN the edge weight MUST become 0.35
- AND `last_activated` MUST update

#### Scenario: Observer creates and strengthens new edge

- GIVEN two concept nodes exist but no edge between them
- WHEN an external observer calls `createEdge(source, target)` then `reinforceEdge(source, target)`
- THEN a new edge is created with weight 0.5
- AND after reinforcement the weight is 0.6
- AND `co_occurrence_count` starts at 0

#### Scenario: Observer triggers Darwinian pruning

- GIVEN edges exist with weight < 0.05
- WHEN an external observer calls `prune()`
- THEN weak edges MUST be archived as darwinian_lessons and removed
- AND the number of pruned edges is returned

### Requirement: Darwinian Business Outcome Reinforcement

Cortex MUST reinforce, penalize, or prune business reasoning patterns from seller approvals, rejections, corrections, and measured outcomes while remaining separate from the operational read model.

#### Scenario: Useful proposal confirmed

- GIVEN the seller confirms a CEO proposal and later outcome evidence is positive
- WHEN the observer records the outcome
- THEN Cortex MUST reinforce the related concepts and decision edges

#### Scenario: Proposal rejected or corrected

- GIVEN the seller rejects or corrects a recommendation
- WHEN the observer processes the feedback
- THEN Cortex MUST penalize the related reasoning edge or create a corrective lesson

#### Scenario: Weak pattern pruned

- GIVEN repeated outcomes weaken a reasoning pattern below pruning threshold
- WHEN Darwinian pruning runs
- THEN Cortex MUST archive the lesson and remove the weak edge

### Requirement: Cortex and Read Model Boundary

Cortex MUST store durable learned judgment, relationships, and distilled lessons; it MUST NOT persist listing snapshots, catalog data, or ingestion checkpoints. Operational evidence MUST reside in the `@msl/memory` SQLite read model. Full catalog reads (freshness, completeness, pagination) MUST route to the operational read model, never Cortex.

(Previously: Required separation but did not explicitly prohibit Cortex from storing listing/catalog operational snapshots.)

#### Scenario: Full catalog needed

- GIVEN a lane needs complete catalog or freshness metadata
- WHEN it requests evidence
- THEN it MUST read from the operational read model, not Cortex graph traversal

#### Scenario: Learned judgment needed

- GIVEN the CEO lane needs seller preference or prior decision context
- WHEN it requests reasoning context
- THEN it MAY use Cortex lessons and activated concepts

### Requirement: No Operational Snapshots in Cortex

Cortex MUST NOT store listing snapshots, catalog data, or ingestion checkpoints. Operational facts MUST live in the `@msl/memory` SQLite operational read model only. The ingestion pipeline MUST dual-write: operational snapshots to the read model, distilled signals to Cortex.

#### Scenario: Ingestion writes listing to operational store only
- GIVEN background ingestion processes a MercadoLibre listing
- WHEN the listing snapshot is captured
- THEN the full snapshot MUST be persisted to the operational read model
- AND only distilled signals (learned category preference, pricing pattern) MAY reach Cortex

#### Scenario: Cortex queried for catalog evidence
- GIVEN a lane queries Cortex for full catalog data
- WHEN Cortex traversal runs
- THEN it MUST return learned judgment and distilled lessons only
- AND MUST NOT return listing snapshots or catalog pages
