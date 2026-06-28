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

### Requirement: Protected Direct API Reads

The system MUST protect listings, orders, messages, and reputation reads with the current MercadoLibre access state. Protected reads MUST use authorized direct APIs through project-owned tools and MUST NOT use official MCP as a seller-operation executor.

#### Scenario: Access allows protected read

- GIVEN the seller has valid MLC access matching the requested account
- WHEN protected listing, order, message, or reputation data is requested
- THEN the system MUST allow the read through authorized direct API tooling
- AND the result MUST identify the seller data source

#### Scenario: Access is revoked

- GIVEN seller access is revoked or authorization failed
- WHEN protected data is requested
- THEN the system MUST block the read
- AND it MUST return a reconnect-oriented result

#### Scenario: Access belongs to a different account

- GIVEN valid access exists for a different seller account than the requested one
- WHEN protected data is requested
- THEN the system MUST block the read as mismatched access
- AND it MUST NOT return seller business data

### Requirement: Documentation-Only MCP During Reads

The system MAY consult official MercadoLibre MCP or docs for API reference, but protected seller reads MUST be executed only by project-owned direct API tooling.

#### Scenario: API behavior needs verification

- GIVEN implementation guidance is needed for a protected read
- WHEN documentation is consulted
- THEN official MercadoLibre MCP MAY be used as reference only
- AND it MUST NOT receive or execute seller operational requests

### Requirement: MLC Account-Safe Capability Reads

The system MUST preserve fail-closed OAuth, configured allowed seller IDs, MLC seller scope, and account mismatch blocking for every read-first MercadoLibre capability, including listing quality, category attributes/specs, pictures, shipping, visits/metrics, reputation, questions, and messages. Unknown MLC support MUST remain unsupported or low confidence and MUST NOT bypass account protections.

#### Scenario: Allowed MLC seller requests capability evidence

- GIVEN a valid OAuth token belongs to the requested allowed `MLC` seller
- WHEN capability evidence is read through project-owned direct API tooling
- THEN the system MUST scope the read to that seller and `MLC`
- AND it MUST return seller identity, site, source, freshness, and confidence metadata

#### Scenario: Read access is unsafe

- GIVEN OAuth access is missing, revoked, mismatched, not allowed, non-`MLC`, or unsupported for `MLC`
- WHEN capability evidence is requested
- THEN the system MUST block the read or mark the evidence unsupported with low confidence
- AND it MUST NOT return another seller's operational data

### Requirement: MLC Plasticov-to-Maustian Sync Preparation Boundary

MCP product sync preparation MUST enforce configured `MLC` seller roles where Plasticov is the source and Maustian is the target. The system MUST reject reversed, arbitrary, non-`MLC`, missing, or mismatched seller roles with controlled blocked responses.

#### Scenario: Configured role direction is accepted

- GIVEN valid MCP auth and configured `MLC` roles identify Plasticov as source and Maustian as target
- WHEN a single-product sync proposal targets Maustian from Plasticov
- THEN the system MUST allow proposal preparation
- AND it MUST include source seller, target seller, and site metadata

#### Scenario: Reversed direction is requested

- GIVEN configured `MLC` roles identify Plasticov as source and Maustian as target
- WHEN a request tries Maustian-to-Plasticov sync preparation
- THEN the system MUST block the request as unsafe direction
- AND it MUST NOT create a prepared proposal

#### Scenario: Seller role or site is unsafe

- GIVEN seller roles are missing, mismatched, arbitrary, or not `MLC`
- WHEN `sync_product` preparation is requested
- THEN the system MUST return a controlled blocked response
- AND it MUST NOT expose another seller's operational data or prepare a sync proposal
