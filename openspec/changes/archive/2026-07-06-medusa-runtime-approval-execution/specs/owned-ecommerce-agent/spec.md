# Delta for Owned Ecommerce Agent

## ADDED Requirements

### Requirement: Backend-Only Medusa Runtime Execution

The system MUST execute owned ecommerce publish or checkout operations only from a backend runtime after approval and readiness are revalidated. LLM-facing CEO tools and public request paths MUST remain preparation-only and MUST NOT receive runtime credentials or execute Medusa mutations.

#### Scenario: Approved backend execution

- GIVEN a stored storefront projection and action have exact valid approval and fresh eligible readiness
- WHEN backend runtime execution is requested for the approved target
- THEN the system MUST execute through the controlled Medusa write boundary
- AND it MUST return execution status with redacted audit and rollback references.

#### Scenario: LLM tool cannot execute

- GIVEN the CEO-facing owned ecommerce tool prepares a publish or checkout action
- WHEN the user confirms from conversation
- THEN the tool MUST keep `noMutationExecuted: true`
- AND it MUST NOT accept approval claims as execution proof.

#### Scenario: Unsafe runtime request blocked

- GIVEN approval is missing, expired, mismatched, readiness is stale, or projection guardrails fail
- WHEN runtime execution is requested
- THEN the system MUST return a controlled blocked result with redacted reason codes
- AND it MUST NOT call the Medusa write boundary.

### Requirement: Public Publish and Checkout Activation Gates

The system MUST gate public publishing separately from checkout/payment activation. Each gate MUST require exact approval, configured non-LLM credentials, fresh readiness, safe public claims, and a rollback trail before activation.

#### Scenario: Public publish without checkout

- GIVEN publish approval exists but checkout/payment activation approval is absent
- WHEN backend runtime execution runs
- THEN the system MAY publish the approved public surface
- AND it MUST keep checkout and payments inactive.

#### Scenario: Checkout activation approved

- GIVEN publish and checkout/payment approvals both bind to the same safe fresh projection target
- WHEN backend runtime execution runs
- THEN the system MAY activate checkout/payment for the approved target
- AND it MUST expose only redacted execution evidence.

#### Scenario: Credentials unavailable

- GIVEN runtime credentials are missing or unavailable from environment/config
- WHEN publish or checkout activation is requested
- THEN the system MUST fail closed with a controlled blocked result
- AND it MUST NOT ask LLM or user-facing tools for credentials.
