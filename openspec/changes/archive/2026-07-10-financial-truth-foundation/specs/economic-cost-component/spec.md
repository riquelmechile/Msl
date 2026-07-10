# Economic Cost Component Specification

## Purpose

Decompose costs with auditable provenance. Each component captures a single cost line (type, amount, currency) plus source evidence, verification status, and confidence.

## Requirements

### Requirement: Cost Type Enumeration

The system MUST support exactly 11 `CostComponentType` values: `cogs`, `marketplace_fee`, `shipping`, `advertising`, `discounts`, `refunds`, `taxes`, `financing`, `landed_cost`, `packaging`, `other`. Invalid types MUST be rejected at construction.

#### Scenario: Valid cost type accepted

- **GIVEN** a cost component with `type = "shipping"`
- **WHEN** the component is constructed
- **THEN** it MUST be accepted

#### Scenario: Invalid cost type rejected

- **GIVEN** a cost component with `type = "rent"`
- **WHEN** the component is constructed
- **THEN** validation MUST reject with a `CostComponentTypeError`

### Requirement: Cost Component Structure

Each component MUST carry: `type`, `amount` (Money), `currency`, `source`, `sourceRecordId`, `occurredAt`, `observedAt`, `verification`, and `confidence`. The `amount` field MUST use the `Money` type.

#### Scenario: Full component creation

- **GIVEN** type=shipping, amount=5000 CLP, source=Flex, sourceRecordId="shp-42", occurredAt/observedAt timestamps, verification=verified, confidence=0.95
- **WHEN** constructed
- **THEN** all fields MUST be present and valid

### Requirement: Metadata Safety

`source`, `sourceRecordId`, and any metadata fields MUST NOT contain secrets, tokens, or raw LLM response text. Only structured identifiers and bounded provenance data are permitted.

#### Scenario: Clean provenance

- **GIVEN** a source referencing "MercadoLibre API /orders/123"
- **WHEN** component is constructed
- **THEN** it MUST be accepted — no secret or raw prompt content present

#### Scenario: Raw LLM response rejected

- **GIVEN** metadata containing raw LLM completion text
- **WHEN** component is constructed
- **THEN** validation MUST reject it
