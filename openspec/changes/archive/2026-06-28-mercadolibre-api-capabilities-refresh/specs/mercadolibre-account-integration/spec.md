# Delta for mercadolibre-account-integration

## ADDED Requirements

### Requirement: MLC Account-Safe Read Evidence

The system MUST preserve fail-closed OAuth, allowed seller IDs, and account mismatch protections for all read-first MercadoLibre capability evidence. MLC support MUST be explicit and confidence-rated before evidence is used for recommendations.

#### Scenario: Allowed seller read evidence is requested

- GIVEN a valid OAuth token belongs to an allowed MLC seller
- WHEN read-first evidence is requested for that seller
- THEN the system MUST allow only scoped direct API reads
- AND it MUST return seller identity, site, source, freshness, and confidence metadata

#### Scenario: Seller or site support is unsafe

- GIVEN access is missing, revoked, mismatched, not allowed, or MLC support is unknown
- WHEN read-first evidence is requested
- THEN the system MUST fail closed or mark the evidence unsupported/low confidence
- AND it MUST NOT return another seller's operational data

## Post-Archive Review-Fix Addendum — 2026-06-28

This addendum records review fixes completed after the archive. It preserves the original delta above rather than rewriting the historical change.

### Requirement: Centralized MLC Scope Validation

MLC category and domain validation MUST be centralized and reused by category attributes and category technical specs reads before calling MercadoLibre runtime dependencies.

#### Scenario: Invalid MLC scope is requested

- GIVEN a read request includes a category or domain identifier outside the accepted MLC scope
- WHEN the account-safe read path validates the request
- THEN it MUST block or degrade the response before dependency execution
- AND it MUST retain seller identity, `sellerScope`, `siteSupport`, source, freshness, and confidence metadata
