# Delta for action-approval-safety

## ADDED Requirements

### Requirement: Budget Warnings in Block C Context
The system SHALL include non-blocking budget warnings in Block C context when agent or department costs exceed configurable thresholds. Budget warnings SHALL be advisory only and SHALL NOT block any operation.

#### Scenario: Agent exceeds budget hint
- GIVEN an agent's daily accumulated cost exceeds the configured budget hint
- WHEN `buildBlockCContext` assembles context for a lane
- THEN a warning line SHALL appear in Block C indicating the agent's budget status

#### Scenario: Department exceeds budget hint
- GIVEN a department's aggregate daily cost exceeds the configured threshold
- WHEN cost context is injected into Block C
- THEN a per-department warning SHALL appear alongside agent-level warnings

#### Scenario: Costs are within budget
- GIVEN all agent and department costs are below configured thresholds
- WHEN context is assembled
- THEN no budget warning SHALL be emitted

#### Scenario: Budget warning never blocks operations
- GIVEN a budget warning is present in Block C context
- WHEN the agent proposes an action
- THEN the proposal SHALL proceed through normal approval and safety gates without blockade
