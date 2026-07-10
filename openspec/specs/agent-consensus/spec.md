# Agent Consensus Specification

## Purpose

Multi-agent peer review layer for high-risk proposals. Agents submit structured verdicts on proposals from other agents. The CEO flow presents consensus summaries before human confirmation. Reviews are now scoped per `seller_id` for account isolation.

## Requirements

### Requirement: Agent Review Persistence

The system MUST persist agent reviews in an `agent_reviews` table with columns: `id` (INTEGER PK), `proposal_id` (TEXT NOT NULL), `reviewer_agent_id` (TEXT NOT NULL), `verdict` (TEXT NOT NULL), `rationale` (TEXT NOT NULL), `confidence` (REAL NOT NULL), `seller_id` (TEXT), `created_at` (TEXT NOT NULL DEFAULT datetime('now')). The migration MUST be idempotent (`CREATE TABLE IF NOT EXISTS`; `ALTER TABLE ADD COLUMN seller_id TEXT` guarded by `PRAGMA table_info`).

(Previously: `agent_reviews` table had no `seller_id` column.)

#### Scenario: Migration is idempotent

- GIVEN the `agent_reviews` table already exists
- WHEN `createAgentConsensusStore` runs
- THEN no error is thrown and existing rows are preserved

#### Scenario: Review is inserted with seller scope

- GIVEN a valid review input (proposalId, reviewerAgentId, verdict, rationale, confidence, **sellerId**)
- WHEN `submitReview` is called
- THEN a row is persisted with an auto-incremented id, current timestamp, and the provided `seller_id`

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

`getConsensus(proposalId, sellerId?)` MUST return all reviews for a given proposal **optionally filtered by seller**. When `sellerId` is provided, only reviews with matching or NULL `seller_id` SHALL be returned. `getConsensusBySeller(sellerId)` MUST return all reviews for a specific account.

(Previously: `getConsensus` was not seller-scoped.)

#### Scenario: Multiple reviews returned

- GIVEN 3 reviews exist for proposal "prop-1"
- WHEN `getConsensus("prop-1")` is called
- THEN all 3 reviews are returned in chronological order

#### Scenario: No reviews returns empty

- GIVEN no reviews exist for proposal "prop-2"
- WHEN `getConsensus("prop-2")` is called
- THEN an empty array is returned

#### Scenario: Scoped consensus for a proposal

- GIVEN 3 reviews exist for proposal "prop-1" — 2 with `seller_id = "plasticov"`, 1 with `seller_id = NULL`
- WHEN `getConsensus("prop-1", "plasticov")` is called
- THEN 3 reviews are returned (2 account-scoped + 1 global)

#### Scenario: Scoped query isolates accounts

- GIVEN 3 reviews for Plasticov proposals and 2 for Maustian
- WHEN `getConsensusBySeller("plasticov")` is called
- THEN only Plasticov's 3 reviews MUST be returned

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

`createAgentConsensusStore(db)` MUST accept a `better-sqlite3` Database instance, run the idempotent schema migration (including `seller_id` column), prepare all statements, and return an object implementing the `AgentConsensusStore` interface with `submitReview`, `getConsensus`, `getConsensusBySeller`, and `requiresConsensus` methods.

(Previously: factory returned `submitReview`, `getConsensus`, `requiresConsensus` only. Now adds `getConsensusBySeller`.)

#### Scenario: Factory returns valid store

- GIVEN a `:memory:` Database instance
- WHEN `createAgentConsensusStore(db)` is called
- THEN a non-null store object is returned with all four methods

#### Scenario: Existing tables unaffected

- GIVEN the database contains `agent_message_bus` table
- WHEN `createAgentConsensusStore(db)` runs
- THEN `agent_message_bus` rows are unchanged

### Requirement: Seller-Scoped Review Schema

The `agent_reviews` table MUST include `seller_id TEXT` via idempotent `ALTER TABLE ADD COLUMN`. Existing rows SHALL default to `NULL`. The migration MUST be safe for existing data.

#### Scenario: Migration adds seller_id

- GIVEN `agent_reviews` has rows without `seller_id`
- WHEN migration runs
- THEN the column is added and all existing rows have `seller_id = NULL`

#### Scenario: New review records seller_id

- GIVEN a review is submitted for a proposal scoped to "plasticov"
- WHEN `submitReview` is called
- THEN the persisted row MUST have `seller_id = "plasticov"`

### Requirement: Scoped Consensus Queries

`getConsensus(proposalId, sellerId?)` MUST accept optional `sellerId`. When provided, results MUST be filtered to reviews matching that `seller_id` or `NULL`. `getConsensusBySeller(sellerId)` MUST return all reviews for a specific account.

#### Scenario: Scoped query isolates accounts

- GIVEN 3 reviews for Plasticov proposals and 2 for Maustian
- WHEN `getConsensusBySeller("plasticov")` is called
- THEN only Plasticov's 3 reviews MUST be returned

### Requirement: Agent Generates Findings Scoped to One Account

When a specialist agent reviews a proposal, the resulting `agent_review` MUST be scoped to the `seller_id` of the account the proposal targets.

#### Scenario: Review scoped to correct account

- GIVEN a `price-change` proposal targets a listing owned by Maustian
- WHEN an agent submits a consensus review
- THEN `seller_id` on the review MUST be `"maustian"`
