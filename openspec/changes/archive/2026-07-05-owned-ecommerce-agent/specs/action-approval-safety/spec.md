# Delta for Action Approval Safety

## ADDED Requirements

### Requirement: Owned Ecommerce Deterministic Guardrails

The system MUST deterministically guard owned ecommerce previews and operations for stock authority, margin/freshness, secrets, checkout/payment activation, public publishing, price/stock mutation, and risky claims. DeepSeek outputs MUST NOT override these guardrails.

#### Scenario: Unsafe storefront operation blocked

- GIVEN an owned ecommerce proposal includes stale stock, weak margin, secrets, checkout activation, public publish, or price/stock mutation
- WHEN safety validation runs
- THEN the system MUST block or require explicit CEO approval according to risk
- AND it MUST record redacted reason codes.

#### Scenario: DeepSeek recommends unsafe action

- GIVEN DeepSeek recommends copy, ranking, or an operation that violates deterministic constraints
- WHEN the proposal is validated
- THEN deterministic guardrails MUST reject the unsafe portion
- AND the CEO-facing output MUST show the safe alternative or missing evidence.

### Requirement: Owned Ecommerce Publish and Checkout Boundary

Owned ecommerce storefront generation MUST remain preview/projection-only unless public publishing and checkout/payment activation have exact CEO approval, configured credentials, redacted audit records, and passing readiness checks.

#### Scenario: Preview projection allowed

- GIVEN Medusa-ready catalog and content projection data is available
- WHEN no publish or checkout approval exists
- THEN the system MAY create a non-public preview
- AND it MUST NOT activate checkout, payments, or public publishing.

#### Scenario: Publish requested without approval

- GIVEN a storefront projection exists
- WHEN public publishing or checkout/payment activation is attempted without exact approval
- THEN the system MUST block execution and ask the CEO Agent to request approval through Telegram.

### Requirement: Owned Ecommerce Evidence-Backed Public Claims

Public storefront copy, schema, metadata, and SEO/GEO content MUST only include claims backed by current evidence and MUST exclude unsupported health, legal, origin, availability, price, delivery, or superiority claims.

#### Scenario: Evidence-backed content passes

- GIVEN copy references availability, price, category, or product benefits supported by evidence
- WHEN content validation runs
- THEN the system MAY include the claim with evidence provenance.

#### Scenario: Unsupported risky claim blocked

- GIVEN generated content includes an unsupported risky claim
- WHEN content validation runs
- THEN the system MUST remove or rewrite the claim before projection or publish.
