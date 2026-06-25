# Delta for custom-business-mcp-tools

## ADDED Requirements

### Requirement: Concrete Read Tool Surface

The system MUST expose project-owned read tools for listings, orders, messages, and reputation snapshots. Read tools MUST be authorized, scoped to the connected seller, and MUST return source, freshness, and confidence metadata with their business data.

#### Scenario: Authorized read returns business snapshot

- GIVEN a connected MLC seller with valid access
- WHEN the agent requests listings, orders, messages, or reputation through a read tool
- THEN the tool MUST return the requested snapshot with source, freshness, and confidence metadata
- AND the data MUST come from project-owned direct API tooling

#### Scenario: Partial evidence is available

- GIVEN an authorized read has incomplete or conservative evidence
- WHEN the tool returns a snapshot
- THEN the result MUST indicate partial or low-confidence metadata instead of hiding uncertainty

### Requirement: Read-Only Approval Bypass

Read tools MUST NOT create approval requests because they do not mutate seller state or publish public-facing actions. Risky write and publication behavior MUST remain governed by approval controls.

#### Scenario: Read tool executes without approval

- GIVEN valid seller access exists
- WHEN a read tool fetches a business snapshot
- THEN the tool MUST complete without creating a prepared approval request

#### Scenario: Official MCP remains documentation-only

- GIVEN the read tool needs seller operational data
- WHEN selecting an execution path
- THEN it MUST NOT use official MercadoLibre MCP as an executor
- AND official MCP MAY be used only for documentation lookup
