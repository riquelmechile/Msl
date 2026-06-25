# MercadoLibre Account Integration Specification

## Purpose

Define account connection behavior for MercadoLibre Chile using official APIs, OAuth, and strict documentation-only MCP boundaries.

## Requirements

### Requirement: OAuth Account Connection

The system MUST connect seller accounts through MercadoLibre OAuth with only the scopes needed for the enabled capabilities.

#### Scenario: Seller connects account

- GIVEN the seller starts account connection
- WHEN OAuth authorization succeeds
- THEN the system MUST store access state and identify the account as `MLC`

#### Scenario: Authorization fails or is revoked

- GIVEN OAuth authorization fails or access is revoked
- WHEN protected data is requested
- THEN the system MUST block access and ask the seller to reconnect

### Requirement: Direct API and Official MCP Boundary

The system MUST use direct MercadoLibre APIs for seller data and actions. The official MercadoLibre MCP MUST be treated only as updated API documentation lookup and MUST NOT be represented as an executor of seller operations.

#### Scenario: Agent needs seller data

- GIVEN the agent needs listings, orders, messages, or reputation data
- WHEN it retrieves operational data
- THEN it MUST use authorized MercadoLibre APIs, not MCP documentation tools

#### Scenario: API behavior is unclear

- GIVEN implementation guidance is needed
- WHEN the agent consults documentation
- THEN it MAY use official MercadoLibre MCP/docs as reference only

#### Scenario: Seller operation is requested

- GIVEN a seller operation requires data retrieval or mutation
- WHEN the system selects an execution path
- THEN it MUST route through authorized project-owned tools backed by direct MercadoLibre APIs
