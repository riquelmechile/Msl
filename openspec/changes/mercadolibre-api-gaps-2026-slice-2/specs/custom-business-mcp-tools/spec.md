# Delta for custom-business-mcp-tools

## ADDED Requirements

### Requirement: Slice 1 Read-Only MCP Tools

The MCP tool surface MUST expose project-owned read tools for Slice 1 capabilities: `read_moderation_status` (moderation check per item) and `read_notices` (seller communications). Each tool SHALL require MCP API-key authentication, resolve seller OAuth, call the corresponding `MlcApiClient` method, and return a typed snapshot with source, freshness, confidence, and `noMutationExecuted: true`.

#### Scenario: Moderation status tool returns snapshot

- GIVEN MCP API-key auth is valid and a connected MLC seller
- WHEN `read_moderation_status` is called with `{ sellerId, itemId }`
- THEN the tool MUST call `mlcClient.getModerationStatus(sellerId, itemId)`
- AND MUST return the typed `MlcModerationStatusSnapshot` with seller scope

#### Scenario: Notices tool returns paginated snapshot

- GIVEN MCP API-key auth is valid and a connected MLC seller
- WHEN `read_notices` is called with `{ sellerId, limit?, offset? }`
- THEN the tool MUST call `mlcClient.getNotices(sellerId, options)`
- AND MUST return the typed `MlcNoticesSnapshot` with pagination metadata

#### Scenario: Unauthenticated request is blocked

- GIVEN MCP API-key auth is missing or invalid
- WHEN any Slice 1 read tool is called
- THEN the tool MUST reject before resolving OAuth and SHALL NOT call the ML API

#### Scenario: OAuth token is missing or expired

- GIVEN valid MCP API-key auth but seller OAuth is expired
- WHEN a read tool is called
- THEN the response MUST indicate `ReconnectRequired` and SHALL NOT attempt the API call

### Requirement: Prepare-Only Answer Tool

The MCP tool surface MUST expose `prepare_answer` as a prepare-only tool. It SHALL validate API key, accept `{ sellerId, questionId, text }`, call `mlcClient.prepareAnswer()`, and return a pending `MlcAnswerSnapshot` with `requiresApproval: true` and `noMutationExecuted: true`. It SHALL NOT call the ML API to post an answer.

#### Scenario: Answer preparation returns pending snapshot

- GIVEN MCP API-key auth is valid
- WHEN `prepare_answer` is called with valid questionId and text
- THEN the tool MUST call `mlcClient.prepareAnswer(sellerId, input)`
- AND MUST return `status: "pending"`, `requiresApproval: true`, `noMutationExecuted: true`
- AND SHALL NOT execute the answer POST

#### Scenario: Empty question or text is blocked

- GIVEN MCP API-key auth is valid
- WHEN `prepare_answer` is called with empty questionId or text
- THEN the tool MUST return a degraded snapshot with empty questionId and textLength: 0

#### Scenario: Unauthenticated request is blocked

- GIVEN MCP API-key auth is missing or invalid
- WHEN `prepare_answer` is called
- THEN the tool MUST reject before any preparation occurs

### Requirement: MCP Tool Registration Pattern

The 3 new MCP tools SHALL be registered using `server.registerTool()` (custom registration pattern, not `registerMlcReadTool`). Each tool MUST validate `msl_api_key`, resolve OAuth via the client, and return `jsonResult()` with typed output. Input schemas SHALL use `z.string()` and `z.number()` validators from the existing Zod convention.

#### Scenario: Custom registration follows existing pattern

- GIVEN the MCP server is created with `mlcClient` configured
- WHEN the 3 new tools are registered
- THEN each MUST follow the `server.registerTool()` pattern used by `read_product_ads_insights`
- AND input schemas MUST validate required fields before client calls
