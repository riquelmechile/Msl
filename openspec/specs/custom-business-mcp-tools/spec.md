# Custom Business MCP Tools Specification

## Purpose

Define the project's custom tool layer that exposes safe business capabilities to the agent. Official MercadoLibre MCP is documentation lookup only and MUST NOT be treated as an operations executor.

## Requirements

### Requirement: Documentation-Only Official MCP Boundary

The system MUST use the official MercadoLibre MCP only for updated API documentation lookup and MUST NOT imply it executes seller operations.

#### Scenario: Agent needs API guidance

- GIVEN a tool needs current MercadoLibre API behavior
- WHEN documentation is required
- THEN the system MAY query official MCP documentation tools

#### Scenario: Seller operation is requested

- GIVEN the agent needs seller data or wants to perform a seller operation
- WHEN choosing an execution path
- THEN it MUST use project-owned tools backed by direct APIs, not official MCP execution

#### Scenario: Capability matrix needs updated documentation

- GIVEN the system needs current MercadoLibre endpoint behavior or site support evidence
- WHEN official MercadoLibre MCP is available
- THEN it MAY be used only to retrieve documentation
- AND the resulting classification MUST be stored in project-owned specs or code before any runtime tool can rely on it
- AND official MercadoLibre MCP MUST NOT be exposed as a seller-data read or mutation executor.

### Requirement: Safe Business Tool Surface

The system MUST expose custom tools for authorized reads, prepared writes, local memory/cache access, business insights, creative drafts, and audit review.

#### Scenario: Tool reads business state

- GIVEN OAuth access and fresh-enough local data or APIs are available
- WHEN the agent requests listings, orders, messages, reputation, pricing, or insights
- THEN the custom tool MUST return scoped business data with freshness metadata

#### Scenario: Tool prepares a risky action

- GIVEN a tool can affect price, stock, messages, cancellations, refunds, listing content, or creative publication
- WHEN the agent requests execution
- THEN the tool MUST prepare an approval request instead of executing silently

### Requirement: Approval and Audit Controls

The system MUST enforce approval, risk labeling, and audit records for every write or public-facing action initiated through custom tools.

#### Scenario: Seller approves prepared action

- GIVEN a prepared action includes exact changes, rationale, and risk
- WHEN the seller approves it explicitly
- THEN the tool MAY execute through direct MercadoLibre APIs and MUST store the audit result

#### Scenario: Approval is missing or expired

- GIVEN no valid approval exists
- WHEN execution is attempted
- THEN the tool MUST block execution and explain the missing approval

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

### Requirement: Project-Owned Capability Runtime Boundary

The system MUST map MercadoLibre capability classifications to runtime behavior only through project-owned tools. `docs-only` capabilities MUST have no tool surface, `safe-read` capabilities MAY be implemented as read tools after direct API support is confirmed, `prepare-only` capabilities MUST produce approval-bound proposals without execution, and `future-execute-with-approval` capabilities MUST remain blocked until a later approved implementation slice adds explicit execution, approval, and audit controls.

#### Scenario: Capability is safe-read

- GIVEN a capability matrix entry is classified as `safe-read`
- WHEN the custom tool layer exposes that capability
- THEN the tool MUST use project-owned direct API clients
- AND it MUST include source, freshness, confidence, seller scope, and site support metadata.

#### Scenario: Capability is low-confidence or unknown for MLC

- GIVEN a capability has `siteSupport` set to `unknown` or confidence set to low
- WHEN the custom tool layer evaluates runtime exposure
- THEN it MUST NOT expose executable mutation behavior
- AND it MUST either block the request or return prepared, non-executing guidance with the uncertainty disclosed.

### Requirement: Prepare-Only Product Sync Tool

The `sync_product` MCP tool MUST create an approval-required prepared business-operation proposal for one Plasticov-to-Maustian product sync intent and MUST NOT report fake execution success. When durable proposal storage is configured, responses MUST disclose storage durability metadata; otherwise the tool MUST preserve default in-memory behavior.

#### Scenario: Valid product sync intent is prepared

- GIVEN MCP API-key auth is valid and the request targets one supported product sync intent
- WHEN `sync_product` is requested with target, rationale, risk, expiry, and `requiresApproval: true`
- THEN the tool MUST return a pending prepared proposal with proposal metadata
- AND it MUST disclose that no MercadoLibre mutation has executed

#### Scenario: Durable metadata is reported when configured

- GIVEN MCP API-key auth is valid and durable proposal storage is configured
- WHEN `sync_product` prepares a valid proposal
- THEN the response MUST indicate durable proposal storage is active
- AND the metadata MUST NOT expose database paths, credentials, or raw error details

#### Scenario: Durable storage startup is unavailable

- GIVEN durable proposal storage is configured but cannot be opened during MCP startup
- WHEN `sync_product` prepares a valid proposal
- THEN the runtime MUST continue with controlled degraded in-memory proposal storage metadata
- AND the metadata MUST NOT falsely report persistent storage
- AND the response MUST NOT expose database paths, credentials, or raw storage errors

#### Scenario: Default in-memory behavior remains

- GIVEN MCP API-key auth is valid and durable proposal storage is not configured
- WHEN `sync_product` prepares a valid proposal
- THEN the response MUST indicate non-durable in-memory proposal storage
- AND it MUST NOT require deployment-specific persistence configuration

#### Scenario: Required proposal metadata is missing

- GIVEN MCP API-key auth is valid
- WHEN `sync_product` is requested without target, rationale, risk, expiry, or `requiresApproval: true`
- THEN the tool MUST return a controlled blocked response
- AND it MUST NOT create an executable success response

#### Scenario: Unsupported bulk sync is requested

- GIVEN MCP API-key auth is valid
- WHEN a request asks for `sync_all` or multi-product sync execution
- THEN the tool MUST block the request as out of scope
- AND it MUST limit guidance to preparing a single-product proposal

#### Scenario: Approval execution tools remain absent

- GIVEN durable proposal storage is active
- WHEN the MCP tool surface is listed or invoked
- THEN it MUST NOT expose approval execution tools, `sync_all`, mutation execution, or sync preview tools
- AND `sync_product` MUST remain prepare-only

#### Scenario: Generic prepared writes reject credential-like payloads

- GIVEN MCP API-key auth is valid and the generic `prepare_mercadolibre_write` tool is available
- WHEN the request target, exact changes, or rationale includes API keys, OAuth tokens, client secrets, raw credential material, or database paths
- THEN the tool MUST return a controlled blocked response before repository save
- AND it MUST NOT persist the credential-like payload in memory or durable storage
- AND the response MUST NOT echo the credential-like content

#### Scenario: Generic prepared write storage save fails

- GIVEN MCP API-key auth is valid and the generic `prepare_mercadolibre_write` tool is available
- WHEN approval storage fails while saving the prepared proposal
- THEN the tool MUST return a controlled blocked response with redacted error details
- AND it MUST NOT expose database paths, credentials, or raw storage errors
