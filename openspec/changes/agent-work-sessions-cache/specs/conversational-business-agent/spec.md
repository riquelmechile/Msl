# Delta for conversational-business-agent

## ADDED Requirements

### Requirement: get_agent_work_status Tool

The agent loop MUST register `get_agent_work_status` as an internal workforce MCP tool. It SHALL query `AgentWorkSessionStore` and return structured status per seller.

#### Scenario: Query all agents today

- GIVEN 3 agents ran sessions for Plasticov today
- WHEN CEO calls `get_agent_work_status({ sellerId: "plasticov" })`
- THEN returns: agents worked, per-account, latest observations, pending proposals, failed sessions, estimated cost, cache efficiency, next steps

#### Scenario: Account scoped

- GIVEN Plasticov has sessions, Maustian has sessions
- WHEN tool called with `sellerId: "plasticov"`
- THEN only Plasticov data returned

#### Scenario: Include lessons

- GIVEN `includeLessons: true` parameter
- WHEN tool queried
- THEN response includes recent transferable lessons per agent

### Requirement: Write Prohibition

`get_agent_work_status` SHALL NOT execute any mutations. Response MUST include `noMutationExecuted: true`.

#### Scenario: Read-only guarantee

- GIVEN tool invoked multiple times
- WHEN response inspected
- THEN `noMutationExecuted: true` always present, no ML API writes triggered

### Requirement: Backend Only

Tool output is machine-readable JSON. No dashboard UI or human-facing rendering created.

## MODIFIED Requirements

### Requirement: DeepSeek LLM Integration

The system MUST use DeepSeek v4 Flash. Tool list extended to include `get_agent_work_status` alongside existing 40+ tools.
(Previously: tool list did not include agent work status introspection.)

## REMOVED Requirements

_None._
