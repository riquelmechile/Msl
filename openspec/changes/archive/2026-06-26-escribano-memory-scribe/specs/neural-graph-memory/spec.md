# Delta for neural-graph-memory

## ADDED Requirements

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
