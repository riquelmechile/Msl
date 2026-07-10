# agent-work-session-model Specification

## Purpose

Domain types for agent session lifecycle, observations, and lessons. All types carry `sellerId`, scoped to one account — Plasticov and Maustian SHALL never mix within a session.

## Requirements

### Requirement: AgentWorkSession Lifecycle

`AgentWorkSession` MUST carry `sessionId`, `sellerId`, `agentId`, `laneId`, `status`, `signalsHash`, and timestamps. Status lifecycle: `planned → running → completed | skipped | failed`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Session starts | New session created with status `planned` | `startSession()` called | Status becomes `running`, `startedAt` set |
| Session completes | Session `running`, no errors | `completeSession()` called | Status becomes `completed`, `endedAt` set |
| Session skipped | Session `planned`, wake policy says no | `skipSession()` called | Status becomes `skipped`, reason recorded |
| Session fails | Session `running`, error thrown | `failSession(error)` called | Status becomes `failed`, `errorJson` recorded |

### Requirement: AgentObservation

`AgentObservation` MUST include `sellerId`, `agentId`, `sessionId`, `kind`, `summary`, and `severity`. Kind values: `new_signal`, `risk`, `opportunity`, `missing_data`, `repeated_pattern`, `no_change`.

#### Scenario: Observation scoped to seller

- GIVEN a session for `sellerId = "plasticov"`
- WHEN an observation is created
- THEN `observation.sellerId` MUST be `"plasticov"`

### Requirement: AgentLesson

`AgentLesson` MUST include `sellerId`, `agentId`, `sessionId`, `lesson`, and `transferable` flag. Transferable lessons MAY be applied cross-agent within same seller.

#### Scenario: Transferable lesson

- GIVEN operations-manager discovers a pricing pattern
- WHEN lesson is recorded with `transferable: true`
- THEN product-ads-profitability MAY consume it within same `sellerId`

### Requirement: Cross-Seller Isolation

No type SHALL allow `sellerId` mixing. A session for Plasticov MUST NOT reference Maustian data. Observations and lessons scoped per seller.
