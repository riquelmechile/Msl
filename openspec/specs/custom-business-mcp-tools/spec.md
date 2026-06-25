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
