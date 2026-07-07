# Delta for custom-business-mcp-tools

## ADDED Requirements

### Requirement: Workforce Admin MCP Tools
The MCP surface SHALL expose workforce admin tools: `list_company_agents`, `declare_skill`, `list_agent_skills`, `list_workforce_ledger`, and `list_agent_lessons`. Tools SHALL be registered in `mcp/src/index.ts` using the existing `server.registerTool()` pattern.

#### Scenario: MCP client lists company agents
- GIVEN MCP API-key auth is valid and `companyAgentAdminAuthorized` is set
- WHEN `list_company_agents` is called
- THEN all registered company agents SHALL be returned with status, model, and metadata

#### Scenario: MCP client lists workforce ledger
- GIVEN MCP API-key auth is valid and `companyAgentAdminAuthorized` is set
- WHEN `list_workforce_ledger` is called with optional `{ agent_id, from, to }` filters
- THEN cost ledger entries matching the filters SHALL be returned

#### Scenario: MCP client lists agent lessons
- GIVEN MCP API-key auth is valid and `companyAgentAdminAuthorized` is set
- WHEN `list_agent_lessons` is called with optional `agent_id` filter
- THEN recorded lessons SHALL be returned

### Requirement: Admin Authorization Gating for Workforce MCP Tools
All workforce MCP tools SHALL be gated behind `companyAgentAdminAuthorized`. Unauthorized requests SHALL be rejected before any store access.

#### Scenario: Authorized admin accesses workforce tools
- GIVEN MCP API-key auth is valid and `companyAgentAdminAuthorized` is set
- WHEN any workforce admin tool is called
- THEN the tool SHALL execute normally

#### Scenario: Unauthorized request is rejected
- GIVEN MCP API-key auth is valid but `companyAgentAdminAuthorized` is not set
- WHEN any workforce admin tool is called
- THEN the tool SHALL reject with a controlled authorization error

### Requirement: Mutation Tools Require Admin
Workforce tools that mutate state (`declare_skill`, skill updates, agent updates) SHALL require admin authorization. Read-only list tools SHALL be accessible to the agent without admin privilege, provided MCP API-key auth is valid.

#### Scenario: Read-only tool accessible without admin
- GIVEN MCP API-key auth is valid but `companyAgentAdminAuthorized` is not set
- WHEN `list_agent_lessons` or `list_agent_skills` is called
- THEN the read-only response SHALL be returned

#### Scenario: Mutation tool blocked without admin
- GIVEN MCP API-key auth is valid but `companyAgentAdminAuthorized` is not set
- WHEN `declare_skill` is called
- THEN the tool SHALL reject with an authorization error
