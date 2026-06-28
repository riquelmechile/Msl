# Delta for custom-business-mcp-tools

## ADDED Requirements

### Requirement: Project-Owned Safe Capability Exposure

The system MUST expose seller capabilities only through project-owned custom tools. Official MercadoLibre MCP MUST remain documentation lookup only. Custom tools MAY expose safe reads and prepared actions, but MUST NOT execute seller-impacting mutations in this slice.

#### Scenario: Safe read is available

- GIVEN a connected allowed MLC seller has valid access
- WHEN the agent requests supported seller evidence
- THEN the custom tool MAY perform a safe read through project-owned direct API tooling
- AND the result MUST include source, freshness, confidence, and seller scope

#### Scenario: Mutation-like request is received

- GIVEN the agent requests listing edit, answer-question, catalog fix, promotion, sync, or another public action
- WHEN custom tools classify the request
- THEN the tool MUST prepare or defer the action without execution
- AND it MUST preserve approval and audit boundaries

## Post-Archive Review-Fix Addendum — 2026-06-28

This addendum records review fixes completed after the archive. It preserves the original delta above rather than rewriting the historical change.

### Requirement: Safe Read Metadata and Controlled Degradation

Project-owned MercadoLibre safe reads MUST preserve `siteSupport` and `sellerScope` metadata and MUST convert known blocked, unsupported, or invalid read paths into controlled degraded responses.

#### Scenario: A safe read cannot produce supported evidence

- GIVEN an allowed read request is blocked by site support, seller scope, or validation guardrails
- WHEN the tool returns a response
- THEN the response MUST disclose degraded confidence and scope metadata
- AND it MUST NOT register unknown-support reads, question answer/reply/mark-read tools, or mutation execution tools
