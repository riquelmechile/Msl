# Delta for neural-graph-memory

## ADDED Requirements

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

Cortex MUST store durable learned judgment, relationships, and distilled lessons; it MUST NOT become the authoritative full catalog, pagination, freshness, or business snapshot store.

#### Scenario: Full catalog needed

- GIVEN a lane needs complete catalog or freshness metadata
- WHEN it requests evidence
- THEN it MUST read from the operational read model, not Cortex graph traversal

#### Scenario: Learned judgment needed

- GIVEN the CEO lane needs seller preference or prior decision context
- WHEN it requests reasoning context
- THEN it MAY use Cortex lessons and activated concepts
