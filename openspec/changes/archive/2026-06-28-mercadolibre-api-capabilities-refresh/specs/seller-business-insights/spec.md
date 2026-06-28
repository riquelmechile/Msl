# Delta for seller-business-insights

## ADDED Requirements

### Requirement: Read-First Recommendation Evidence

The system MUST base refreshed seller recommendations on read-first evidence for listing quality, category attributes/specs, pictures, shipping, visits/metrics, reputation, questions, and messages when supported. Recommendations MUST disclose freshness, source, confidence, and partial coverage.

#### Scenario: Evidence supports recommendation

- GIVEN fresh or acceptable safe-read evidence exists for the relevant seller area
- WHEN the system explains an opportunity or risk
- THEN it MUST cite the evidence area and confidence level
- AND it MUST avoid implying unverified mutation capability

#### Scenario: Evidence is partial or stale

- GIVEN evidence is stale, missing, unsupported for MLC, or incomplete
- WHEN the system produces guidance
- THEN it MUST mark the recommendation as partial or low confidence
- AND it SHOULD request confirmation or more evidence before proposing action

## Post-Archive Review-Fix Addendum — 2026-06-28

This addendum records review fixes completed after the archive. It preserves the original delta above rather than rewriting the historical change.

### Requirement: Degraded and Valid-Empty Evidence Disclosure

Seller recommendations MUST distinguish controlled degraded reads from valid-empty technical spec evidence and MUST preserve source, freshness, confidence, `siteSupport`, and `sellerScope` metadata.

#### Scenario: Technical specs are valid but empty

- GIVEN MercadoLibre returns an explicit valid-empty technical specs response
- WHEN the system uses that evidence for recommendations
- THEN it MUST disclose the empty evidence as supported but empty
- AND it MUST NOT treat malformed, unsupported, or blocked responses as valid-empty evidence
