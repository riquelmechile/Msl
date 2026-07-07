# Agent Consensus Specification

## Purpose

Multi-agent peer review layer for high-risk proposals. Agents submit structured verdicts on proposals from other agents. The CEO flow presents consensus summaries before human confirmation.

## Requirements

### Requirement: Agent Review Persistence

The system MUST persist agent reviews in an `agent_reviews` table with columns: `id` (INTEGER PK), `proposal_id` (TEXT NOT NULL), `reviewer_agent_id` (TEXT NOT NULL), `verdict` (TEXT NOT NULL), `rationale` (TEXT NOT NULL), `confidence` (REAL NOT NULL), `created_at` (TEXT NOT NULL DEFAULT datetime('now')). The migration MUST be idempotent (`CREATE TABLE IF NOT EXISTS`).

#### Scenario: Migration is idempotent

- GIVEN the `agent_reviews` table already exists
- WHEN `createAgentConsensusStore` runs
- THEN no error is thrown and existing rows are preserved

#### Scenario: Review is inserted

- GIVEN a valid review input (proposalId, reviewerAgentId, verdict, rationale, confidence)
- WHEN `submitReview` is called
- THEN a row is persisted with an auto-incremented id and current timestamp

### Requirement: Verdict Validation

`submitReview` MUST reject invalid verdicts. Accepted verdicts SHALL be `approve`, `reject`, `needs_more_evidence`, and `risk_warning`. Confidence MUST be a float between 0.0 and 1.0 inclusive. Missing or empty `rationale` MUST be rejected.

#### Scenario: Valid verdict accepted

- GIVEN verdict = "approve", confidence = 0.85, rationale is non-empty
- WHEN `submitReview` is called
- THEN the review is persisted successfully

#### Scenario: Invalid verdict rejected

- GIVEN verdict = "maybe"
- WHEN `submitReview` is called
- THEN an error is thrown and no row is inserted

#### Scenario: Confidence out of range

- GIVEN confidence = 1.5
- WHEN `submitReview` is called
- THEN an error is thrown

#### Scenario: Empty rationale rejected

- GIVEN rationale = "" (empty string or whitespace)
- WHEN `submitReview` is called
- THEN an error is thrown

### Requirement: Consensus Aggregation

`getConsensus(proposalId)` MUST return all reviews for a given proposal, ordered by `created_at ASC`. When no reviews exist, it MUST return an empty array (not null or error).

#### Scenario: Multiple reviews returned

- GIVEN 3 reviews exist for proposal "prop-1"
- WHEN `getConsensus("prop-1")` is called
- THEN all 3 reviews are returned in chronological order

#### Scenario: No reviews returns empty

- GIVEN no reviews exist for proposal "prop-2"
- WHEN `getConsensus("prop-2")` is called
- THEN an empty array is returned

### Requirement: Risk Classification

`requiresConsensus(proposalKind, riskDelta?)` MUST return `true` for high-risk proposal kinds and `false` for low-risk ones. High-risk kinds SHALL include: `price-change` with delta >20%, `publish-product`, `pause-listing`, `close-listing`, `product-ads-budget`, `sync-product`, `claim-response`. Low-risk kinds SHALL include: `info-report`, `catalog-health`, `restock-signal`.

#### Scenario: 25% price change triggers consensus

- GIVEN proposalKind = "price-change", riskDelta = 0.25
- WHEN `requiresConsensus` is called
- THEN it returns true

#### Scenario: 10% price change does not trigger

- GIVEN proposalKind = "price-change", riskDelta = 0.10
- WHEN `requiresConsensus` is called
- THEN it returns false

#### Scenario: Info report never triggers

- GIVEN proposalKind = "info-report"
- WHEN `requiresConsensus` is called
- THEN it returns false regardless of riskDelta

### Requirement: CEO Flow Integration Contract

When the CEO lane presents a proposal whose `requiresConsensus()` returns `true`, the presentation MUST include a consensus summary section showing: count of reviews per verdict, reviewer agent IDs, and aggregate confidence range. Low-risk proposals SHALL NOT display consensus information.

#### Scenario: High-risk proposal shows consensus summary

- GIVEN a publish-product proposal has 2 reviews (1 approve at 0.9, 1 risk_warning at 0.7)
- WHEN the CEO flow formats the proposal for display
- THEN the display includes: "Consenso: 1 aprobado (0.90), 1 advertencia (0.70)"

#### Scenario: Low-risk proposal hides consensus

- GIVEN an info-report proposal
- WHEN the CEO flow formats the proposal for display
- THEN no consensus section appears

### Requirement: Store Factory Contract

`createAgentConsensusStore(db)` MUST accept a `better-sqlite3` Database instance, run the idempotent schema migration, prepare all statements, and return an object implementing the `AgentConsensusStore` interface with `submitReview`, `getConsensus`, and `requiresConsensus` methods.

#### Scenario: Factory returns valid store

- GIVEN a `:memory:` Database instance
- WHEN `createAgentConsensusStore(db)` is called
- THEN a non-null store object is returned with all three methods

#### Scenario: Existing tables unaffected

- GIVEN the database contains `agent_message_bus` table
- WHEN `createAgentConsensusStore(db)` runs
- THEN `agent_message_bus` rows are unchanged
