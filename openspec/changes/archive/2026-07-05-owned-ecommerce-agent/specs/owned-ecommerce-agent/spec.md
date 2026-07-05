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
