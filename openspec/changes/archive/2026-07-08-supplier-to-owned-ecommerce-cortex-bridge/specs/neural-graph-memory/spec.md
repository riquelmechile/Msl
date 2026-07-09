# Delta for neural-graph-memory

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Spreading Activation

The system MUST propagate activation from seed nodes via recursive CTE, bounded by depth (default 3) and activation threshold. When seed nodes are supplier-typed, spreading activation SHALL discover niche patterns by traversing edges between supplier concepts and storefront or category concepts.

(Previously: Spreading activation had no supplier-specific behavior.)

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

## REMOVED Requirements

(None)

## RENAMED Requirements

(None)
