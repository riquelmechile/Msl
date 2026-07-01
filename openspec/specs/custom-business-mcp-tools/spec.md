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

The system MUST expose project-owned read tools for listings, orders, messages, reputation snapshots, and Product Ads insights. Read tools MUST be authorized, scoped to the connected seller, and MUST return source, freshness, and confidence metadata with their business data.

#### Scenario: Authorized read returns business snapshot

- GIVEN a connected MLC seller with valid access
- WHEN the agent requests listings, orders, messages, reputation, or Product Ads insights through a read tool
- THEN the tool MUST return the requested snapshot with source, freshness, and confidence metadata
- AND the data MUST come from project-owned direct API tooling

#### Scenario: Partial evidence is available

- GIVEN an authorized read has incomplete or conservative evidence
- WHEN the tool returns a snapshot
- THEN the result MUST indicate partial or low-confidence metadata instead of hiding uncertainty

#### Scenario: Product Ads insights are read-only

- GIVEN MCP API-key auth is valid and a connected MLC seller is requested
- WHEN `read_product_ads_insights` is called with optional date, item, campaign, or status filters
- THEN the tool MUST return Product Ads advertiser, campaign, ad, and metric evidence with seller scope
- AND it MUST disclose `noMutationExecuted: true` and `requiresApproval: false`
- AND it MUST NOT expose campaign/ad mutation tools, use legacy Product Ads endpoints, or prepare budget/status changes in this read operation.

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

The `sync_product` MCP tool MUST create an approval-required proposal for one Plasticov-to-Maustian product sync intent and MUST NOT report fake execution success. It MAY include safe read-only preview metadata on the same pending proposal when available. Preview source item evidence MUST pass the shared MercadoLibre item completeness boundary before strategy calculation; validation failure MUST degrade to preview-unavailable metadata instead of execution. When durable proposal storage is configured, responses MUST disclose durability metadata; otherwise the tool MUST preserve default in-memory behavior.

#### Scenario: Valid product sync intent is prepared

- GIVEN MCP API-key auth is valid and the request targets one supported product sync intent
- WHEN `sync_product` is requested with target, rationale, risk, expiry, and `requiresApproval: true`
- THEN the tool MUST return a pending prepared proposal with proposal metadata
- AND it MUST disclose that no MercadoLibre mutation has executed

#### Scenario: Safe preview metadata is available

- GIVEN the valid request has complete source item evidence and strategies
- WHEN `sync_product` prepares the proposal
- THEN the response MAY include proposed field-change preview evidence
- AND it MUST keep `approvalStatus: "pending"`, `requiresApproval: true`, and `noMutationExecuted: true`

#### Scenario: Incomplete source item evidence degrades preview

- GIVEN source item evidence fails shared MercadoLibre completeness validation
- WHEN `sync_product` prepares the proposal
- THEN the response MUST include preview-unavailable metadata with reason `source-read-failed`
- AND it MUST NOT execute mutation, expose raw validation details, or claim completion

#### Scenario: Preview metadata is unavailable

- GIVEN source reads or strategies are unavailable
- WHEN `sync_product` prepares the proposal
- THEN the response MUST still return a pending proposal with preview-unavailable metadata
- AND it MUST NOT execute mutation or claim completion

#### Scenario: Durable metadata is reported when configured

- GIVEN MCP API-key auth is valid and durable proposal storage is configured
- WHEN `sync_product` prepares a valid proposal
- THEN the response MUST indicate durable proposal storage is active
- AND the metadata MUST NOT expose database paths, credentials, or raw error details

#### Scenario: Durable storage startup is unavailable

- GIVEN durable proposal storage is configured but cannot be opened during MCP startup
- WHEN `sync_product` prepares a valid proposal
- THEN the runtime MUST continue with controlled degraded in-memory proposal storage metadata
- AND the metadata MUST NOT falsely report persistent storage or expose sensitive details

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
- THEN it MUST NOT expose approval execution tools, `sync_all`, mutation execution, or separate sync preview tools
- AND `sync_product` MUST remain prepare-only

#### Scenario: Generic prepared writes reject credential-like payloads

- GIVEN MCP API-key auth is valid and `prepare_mercadolibre_write` is available
- WHEN the request target, exact changes, or rationale includes API keys, OAuth tokens, client secrets, raw credential material, or database paths
- THEN the tool MUST return a controlled blocked response before repository save
- AND it MUST NOT persist or echo the credential-like payload

#### Scenario: Generic prepared write storage save fails

- GIVEN MCP API-key auth is valid and `prepare_mercadolibre_write` is available
- WHEN approval storage fails while saving the prepared proposal
- THEN the tool MUST return a controlled blocked response with redacted error details
- AND it MUST NOT expose database paths, credentials, or raw storage errors

### Requirement: Read-Only Product Sync Proposal Status Tool

The MCP tool surface MUST expose a read-only status operation for stored `sync_product` proposals. The operation MUST require MCP API-key authentication, accept only one exact action ID, return non-enumerating redacted responses, and MUST NOT approve, execute, replay, mutate, call `ProductSyncEngine`, expose `sync_all`, perform multi-product sync, or add separate preview-only tools.

#### Scenario: Stored product sync proposal is inspected

- GIVEN MCP API-key auth is valid and a stored `sync_product` proposal exists for the exact action ID
- WHEN the status operation is requested
- THEN it MUST return redacted status, expiry, risk, target, rationale, preview summary, and storage metadata
- AND it MUST disclose that no approval, execution, audit replay, or MercadoLibre mutation occurred

#### Scenario: Unknown or unauthorized ID is requested

- GIVEN MCP API-key auth is valid
- WHEN the status operation receives an unknown, unauthorized, malformed, or unsupported action ID
- THEN it MUST return a controlled non-enumerating response
- AND it MUST NOT reveal whether another seller, action kind, storage path, or raw record exists

#### Scenario: Status derivation remains read-only

- GIVEN a stored proposal is expired or degraded storage metadata applies
- WHEN the status operation derives the response status
- THEN it MUST derive status from stored metadata without mutating repository state
- AND it MUST redact database paths, credentials, raw errors, and validation details

#### Scenario: Unauthenticated request is blocked

- GIVEN MCP API-key auth is missing or invalid
- WHEN the status operation is requested
- THEN it MUST reject the request before repository lookup
- AND it MUST NOT disclose proposal existence or storage configuration

### Requirement: Sync Product Approval Recording Tool

The MCP tool surface MUST expose a narrow approval-recording operation for one exact stored `sync_product` proposal ID. The operation MUST authenticate before repository lookup, MUST accept only stored pending unexpired `sync_product` proposals, and MUST return redacted non-enumerating failures. It MUST NOT mutate MercadoLibre, execute sync, replay audit, call `ProductSyncEngine`, expose `sync_all`, perform multi-product sync, add a separate preview-only tool, or approve non-sync proposals.

#### Scenario: Pending sync proposal approval is recorded

- GIVEN MCP API-key auth is valid and an exact stored pending unexpired `sync_product` proposal exists
- WHEN the approval-recording operation is requested for that action ID
- THEN it MUST record approval state for that proposal only
- AND it MUST return sanitized metadata including `noMutationExecuted: true`

#### Scenario: Authentication fails before lookup

- GIVEN MCP API-key auth is missing or invalid
- WHEN the approval-recording operation is requested
- THEN it MUST reject before repository lookup
- AND it MUST NOT disclose proposal existence or storage configuration

#### Scenario: Unsupported proposal cannot be approved

- GIVEN MCP API-key auth is valid
- WHEN the requested action ID is missing, malformed, non-`sync_product`, unauthorized, expired, rejected, or already finalized
- THEN it MUST return a controlled non-enumerating unavailable response
- AND it MUST NOT reveal whether another record exists or why validation failed

#### Scenario: Approval recording cannot execute sync

- GIVEN a stored `sync_product` proposal is approved through the operation
- WHEN the response is produced
- THEN the tool MUST NOT call MercadoLibre mutation APIs, `ProductSyncEngine`, audit replay, `sync_all`, or multi-product behavior
- AND it MUST preserve the existing prepared proposal evidence for a future execution slice

---

### Requirement: Sync Product Execution Tool Contract

The MCP surface MUST define a future execution tool contract for approved `sync_product` proposals. The tool MUST sequence: readiness check → idempotency audit check → create/update resolution → ML API call → audit record. It MUST NOT execute bulk sync, call `ProductSyncEngine`, or bypass execution eligibility gates. The contract is specification-only until a future implementation slice adds runtime behavior.

#### Scenario: Execution tool contract defined

- GIVEN the MCP tool surface is evaluated
- WHEN the execution tool contract is referenced
- THEN it MUST declare the sequenced flow without implementing runtime mutations

### Requirement: Sync Product Execution Readiness Tool

The MCP surface MUST expose readiness-only evaluation for one exact approved, unexpired `sync_product` proposal and MUST return `status: "eligible" | "blocked" | "degraded"`, `noMutationExecuted: true`, stable idempotency candidate evidence when derivable, and redacted reason codes only: `approval-unavailable`, `approval-expired`, `approval-binding-mismatch`, `proposal-not-sync-product`, `source-read-failed`, `source-evidence-incomplete`, `preview-drift-detected`, `seller-scope-mismatch`, `target-account-unavailable`, `api-capability-evidence-missing`, `rollback-strategy-missing`, `rate-limited`, `upstream-temporary-failure`, `reconnect-required`, `storage-unavailable`. Readiness `eligible` MUST feed the execution eligibility gate defined in `sync-product-execution`.
(Previously: readiness was standalone; now `eligible` feeds execution eligibility contract.)

#### Scenario: Approved proposal is eligible

- GIVEN MCP auth is valid and an exact approved unexpired `sync_product` proposal passes read-only revalidation
- WHEN readiness is requested for that action ID
- THEN the response MUST be `eligible` with `noMutationExecuted: true`
- AND it MUST include only sanitized prerequisite evidence.

#### Scenario: Eligible status feeds execution contract

- GIVEN readiness returns `eligible` for an approved proposal
- WHEN the execution contract evaluates eligibility per `sync-product-execution`
- THEN `eligible` MUST be consumed as a required gate input

#### Scenario: Readiness cannot execute

- GIVEN any readiness request succeeds or fails
- WHEN the MCP operation completes
- THEN it MUST NOT call real MercadoLibre publish/update/status mutations, `ProductSyncEngine`, `sync_all`, execution replay, audit replay, rollback automation, or bulk sync
- AND it MUST always return `noMutationExecuted: true`.
