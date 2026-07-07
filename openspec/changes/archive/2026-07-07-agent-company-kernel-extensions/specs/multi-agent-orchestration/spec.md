# Delta for multi-agent-orchestration

## ADDED Requirements

### Requirement: Suspended Agent Lifecycle State
The system SHALL support a `"suspended"` agent status between `"active"` and `"archived"` in the `company_agents` table CHECK constraint. Suspended agents SHALL NOT receive evidence requests, be targeted for lessons, or participate in workforce orchestration.

#### Scenario: Agent is suspended
- GIVEN an agent with status `"suspended"`
- WHEN the workforce orchestration evaluates active agents
- THEN the suspended agent SHALL be excluded from lane assignments and evidence requests

#### Scenario: Suspended agent can be reactivated
- GIVEN an agent with status `"suspended"`
- WHEN `updateCompanyAgent` sets status to `"active"`
- THEN the agent SHALL resume receiving assignments and context

#### Scenario: Suspended agent cannot be targeted for lessons
- GIVEN an agent with status `"suspended"`
- WHEN a lesson is recorded for the workforce
- THEN the suspended agent SHALL NOT be a lesson target

### Requirement: Update Company Agent
The system SHALL provide `updateCompanyAgent` in `CompanyAgentStore` with a corresponding tool `update_company_agent` gated behind admin authorization. Updatable fields SHALL include profile fields and status.

#### Scenario: Admin updates agent status
- GIVEN admin authorization is valid
- WHEN `update_company_agent` is called with `{ agent_id, status: "suspended" }`
- THEN the agent's status SHALL be updated in the store

#### Scenario: Unauthorized update blocked
- GIVEN the caller lacks admin authorization
- WHEN `update_company_agent` is called
- THEN the system SHALL reject with an authorization error

#### Scenario: Update non-existent agent
- GIVEN no agent exists with the given `agent_id`
- WHEN `update_company_agent` is called
- THEN the system SHALL return a controlled error

### Requirement: Skill-Aware Context in Orchestration
The system SHALL include agent skill summaries in Block C context during workforce orchestration. Skills SHALL be read from `agent_skills` for the active agent and injected alongside existing lesson and cost context.

#### Scenario: Active agent has skills during orchestration
- GIVEN the CEO or specialist lane is being assembled
- WHEN `buildBlockCContext` builds workforce context
- THEN the active agent's declared skills SHALL appear alongside lesson and cost summaries

#### Scenario: Agent has no skills
- GIVEN the active agent has zero registered skills
- WHEN workforce context is assembled
- THEN the skill section SHALL be omitted without error
