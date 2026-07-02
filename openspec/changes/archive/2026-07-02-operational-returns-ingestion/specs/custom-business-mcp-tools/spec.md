# Delta for custom-business-mcp-tools

## ADDED Requirements

### Requirement: Return Read MCP Tools

The MCP surface MUST expose project-owned, auth-gated read tools for claim return detail, return reviews, and return cost. These tools SHALL require MCP API-key auth, resolve seller OAuth, preserve seller scope, return source/freshness/confidence/site-support metadata, and disclose `noMutationExecuted: true` and `requiresApproval: false`. They MUST NOT create approval requests, upload attachments, post return reviews, execute refunds, open disputes, or mutate seller state.

#### Scenario: Authenticated return detail tool returns evidence

- GIVEN MCP API-key auth is valid and seller OAuth is connected
- WHEN the return detail read tool is called with seller and claim identifiers
- THEN it MUST return the typed return detail snapshot from project-owned direct API tooling
- AND it MUST disclose `noMutationExecuted: true`

#### Scenario: Authenticated return review tool remains read-only

- GIVEN MCP API-key auth is valid and a return ID is provided
- WHEN the return reviews read tool is called
- THEN it MUST return typed review evidence or an empty complete result
- AND it MUST NOT call return-review POST or attachment endpoints

#### Scenario: Authenticated return-cost tool returns scoped cost evidence

- GIVEN MCP API-key auth is valid and seller OAuth is connected
- WHEN the return-cost read tool is called for a claim
- THEN it MUST return scoped cost evidence with freshness and confidence metadata
- AND it MUST NOT execute refund, dispute, charge, or approval behavior

#### Scenario: Unauthenticated request is blocked

- GIVEN MCP API-key auth is missing or invalid
- WHEN any return read tool is called
- THEN the tool MUST reject before resolving seller OAuth or calling MercadoLibre
- AND it MUST NOT disclose return, claim, seller, or storage existence

#### Scenario: OAuth or MLC support is degraded

- GIVEN MCP auth is valid but OAuth is expired or upstream return support is unavailable
- WHEN a return read tool is called
- THEN the response MUST be controlled and degraded with reconnect or MLC-to-confirm metadata
- AND no approval or mutation MUST be created
