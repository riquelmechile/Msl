# Delta for mercadolibre-account-integration

## ADDED Requirements

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
