# Owned Ecommerce Agent Specification

## Purpose

Define the Medusa.js-first ecommerce builder/operator agent that creates and maintains fast owned storefront surfaces under CEO governance.

## Requirements

### Requirement: Evidence-Based Storefront Selection

The system MUST select products for owned ecommerce surfaces from Plasticov, Maustian, Supplier Mirror/Jinpeng, future suppliers, the operational read model, and Cortex context using evidence-linked inputs.

#### Scenario: Ranked storefront candidates

- GIVEN fresh product, stock, margin, supplier, read-model, and Cortex evidence exists
- WHEN the agent prepares owned storefront candidates
- THEN it MUST return ranked Medusa-ready candidates with evidence IDs
- AND it MUST identify source account or supplier provenance.

#### Scenario: Evidence is stale or incomplete

- GIVEN stock, margin, supplier, or freshness evidence is missing or stale
- WHEN candidate selection runs
- THEN the system MUST exclude or mark the candidate blocked with reason codes.

### Requirement: DeepSeek Merchandising Reasoning

The system MAY use DeepSeek non-deterministically for ranking, merchandising, SEO/GEO copy, product/category positioning, and tradeoff reasoning, but deterministic validation MUST decide whether outputs are usable.

#### Scenario: DeepSeek proposes positioning

- GIVEN eligible candidates and evidence-backed product context
- WHEN DeepSeek generates ranking or copy recommendations
- THEN the system MUST preserve rationale and source evidence references
- AND deterministic checks MUST validate claims before preview use.

#### Scenario: Risky or unsupported claim

- GIVEN generated copy includes a claim not supported by evidence
- WHEN validation runs
- THEN the system MUST block that claim from the storefront projection.

### Requirement: Static Medusa Storefront Projections

The system MUST produce Medusa-oriented storefront projections with catalog structure, optimized media, schema/metadata, SEO/GEO content, and performance readiness without request-time LLM reasoning.

#### Scenario: Projection is generated

- GIVEN approved candidate inputs exist
- WHEN a preview projection is built
- THEN it MUST include Medusa-ready catalog/content data, media references, schema, metadata, and readiness checks.

#### Scenario: Public request path

- GIVEN a generated storefront preview is served
- WHEN a public page request occurs
- THEN it MUST use static or precomputed data
- AND MUST NOT invoke LLM reasoning at request time.

### Requirement: CEO-Gated Owned Ecommerce Operations

The system MUST route business questions and approvals through the CEO Agent over Telegram while ecommerce workers remain internal and proposal-only.

#### Scenario: CEO approval needed

- GIVEN publishing, checkout/payment activation, price/stock mutation, or risky claims are proposed
- WHEN the operation is prepared
- THEN the CEO Agent MUST ask the human CEO in Telegram before execution.

#### Scenario: Worker completes analysis

- GIVEN an internal ecommerce worker finishes ranking, copy, or readiness analysis
- WHEN output is ready
- THEN it MUST return evidence-backed results to the CEO Agent
- AND MUST NOT message the human directly.

---

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
