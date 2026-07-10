# Delta for neural-graph-memory

## ADDED Requirements

### Requirement: Session Node Recording

`recordWorkSessionToCortex(session, sellerId)` MUST create a `WorkSession` node in Cortex scoped to `sellerId`, linked to the account's `AccountAsset` root node. Each session recorded once; idempotent via `getOrCreateNode`.

#### Scenario: Session node created

- GIVEN a completed `AgentWorkSession` for Plasticov
- WHEN `recordWorkSessionToCortex(session, "plasticov")` called
- THEN node created with label `work_session:{sessionId}`, scoped to `seller_id = "plasticov"`

### Requirement: Observation Recording

`recordObservationToCortex(observation, sellerId)` MUST create an `Observation` node and edge from the session node. Edge weight starts at 0.5.

#### Scenario: Observation linked to session

- GIVEN a session node exists
- WHEN observation with `kind = "risk"` recorded
- THEN observation node created, edge from session → observation with weight 0.5

### Requirement: Lesson Recording to Cortex

`recordLessonToCortex(lesson, sellerId)` MUST create a `Lesson` node linked to session node. Transferable lessons SHALL also link to the `AccountAsset` root node for cross-agent discovery.

#### Scenario: Transferable lesson links to account root

- GIVEN lesson with `transferable: true` recorded
- WHEN `recordLessonToCortex()` called
- THEN edge created from session → lesson AND from `AccountAsset` → lesson

### Requirement: Session-Proposal Connection

`connectSessionToProposal(sessionId, proposalId, sellerId)` MUST create an edge between a work session node and a proposal node in Cortex. Weight initialized at 0.5.

### Requirement: Session-Outcome Connection

`connectSessionToOutcome(sessionId, outcomeNodeId, sellerId)` MUST create an edge between session and outcome, enabling Hebbian learning (`reinforceEdge` +0.1 on positive outcome).

### Requirement: Graph Model Integrity

Graph model: `AccountAsset → Agent → WorkSession → Observation → Proposal → Approval → Action → Outcome → Lesson`. All scoped by `sellerId`. Global only when explicitly needed.

#### Scenario: No Plasticov/Maustian contamination

- GIVEN Plasticov session A, Maustian session B
- WHEN Cortex queried for Plasticov sessions
- THEN only session A and related nodes returned

### Requirement: No ML API Writes

Cortex session recording SHALL NOT trigger any ML API mutations. All writes local to SQLite.

## MODIFIED Requirements

_None. All additions are new Cortex bridge functions extending existing `createNode`, `reinforceEdge`, and seller-scoped primitives._

## REMOVED Requirements

_None._
