# Delta for ml-api-integration

## ADDED Requirements

### Requirement: MercadoLibre Capability Classification Matrix

The system MUST classify documented MercadoLibre API areas as `docs-only`, `safe-read`, `prepare-only`, or `future-execute-with-approval`. The first slice MUST define classification and read-first evidence only, and MUST NOT add runtime mutation execution paths.

#### Scenario: API area is classified

- GIVEN documented API evidence exists for listing quality, category attributes/specs, pictures, shipping, visits/metrics, reputation, questions, or messages
- WHEN the capability matrix is produced
- THEN each area MUST have one classification and evidence reference
- AND safe reads MUST include freshness and confidence expectations

#### Scenario: Endpoint support is uncertain for MLC

- GIVEN MercadoLibre documentation does not clearly prove MLC support for an API area
- WHEN the area is classified
- THEN the matrix MUST mark support as partial or unknown with lower confidence
- AND it MUST NOT promote the area to executable mutation behavior

## Post-Archive Review-Fix Addendum — 2026-06-28

This addendum records review fixes completed after the archive. It preserves the original delta above rather than rewriting the historical change.

### Requirement: MLC-Only Safe Read Guardrails

Category attribute and category technical spec runtime reads MUST remain limited to MLC-confirmed category/domain identifiers. Unknown-support API areas MUST remain non-executable, and safe-read evidence MUST preserve `siteSupport` metadata.

#### Scenario: Category or domain identifier is not valid for MLC

- GIVEN a category attribute or category technical specs read is requested
- WHEN the category or domain identifier is not valid for MLC
- THEN the system MUST return a controlled degraded read response
- AND it MUST NOT perform an unknown-support read or expose mutation execution
