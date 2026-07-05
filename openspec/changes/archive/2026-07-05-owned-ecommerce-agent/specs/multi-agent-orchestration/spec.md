# Delta for Multi-Agent Orchestration

## ADDED Requirements

### Requirement: Owned Ecommerce Specialist Lane

The system MUST add an Owned Ecommerce Specialist under CEO orchestration to prepare Medusa-first storefront candidates, projections, SEO/GEO positioning, and readiness evidence as proposal-only outputs.

#### Scenario: Specialist prepares owned ecommerce proposal

- GIVEN the CEO lane requests owned ecommerce work
- WHEN the specialist evaluates catalog and supplier evidence
- THEN it MUST return ranked storefront recommendations with evidence, risks, and approval needs.

#### Scenario: Specialist attempts direct user interaction

- GIVEN the specialist needs a business decision
- WHEN the decision is outside available evidence
- THEN it MUST ask the CEO lane to question the human CEO through Telegram.

## MODIFIED Requirements

### Requirement: Extension Path, Not MVP Automation

The system MUST treat multi-agent expansion as an evidence-governed extension path. It MAY create a specialized agent when an approved SDD change defines scope, boundaries, and safety controls; otherwise repeated tasks remain future candidates.
(Previously: Multi-agent expansion was future-only and not a core MVP automation path.)

#### Scenario: Approved change defines a specialist

- GIVEN an approved SDD change defines specialist scope and safety boundaries
- WHEN the principal agent activates the specialization
- THEN it MAY create or enable the specialist within those boundaries.

#### Scenario: User requests immediate sub-agent creation

- GIVEN learning evidence and safe boundaries are incomplete
- WHEN the seller requests a specialized agent
- THEN the system MUST explain the missing prerequisites and require more context first.

### Requirement: CEO-Only Supplier Mirror Coordination

The CEO lane MUST coordinate Supplier Mirror and Owned Ecommerce work while hiding internal supplier/ecommerce workers from Telegram UX. Supplier and ecommerce lanes MAY investigate, enrich, classify, rank, and propose, but MUST return evidence-backed outputs to the CEO rather than messaging the user directly.
(Previously: The CEO lane coordinated Supplier Mirror work only.)

#### Scenario: Supplier lane completes analysis
- GIVEN a supplier worker analyzes stock, enrichment, or pricing evidence
- WHEN it finishes
- THEN it MUST return bounded evidence and recommendation to the CEO lane
- AND the user MUST receive only the CEO synthesis.

#### Scenario: User requests worker selection
- GIVEN the user asks Telegram to choose a supplier or ecommerce worker directly
- WHEN orchestration resolves the request
- THEN the CEO MUST retain coordination and explain available business decision instead.
