# Delta for agent-consensus

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Agent Review Persistence

The system MUST persist agent reviews in an `agent_reviews` table with columns: `id` (INTEGER PK), `proposal_id` (TEXT NOT NULL), `reviewer_agent_id` (TEXT NOT NULL), `verdict` (TEXT NOT NULL), `rationale` (TEXT NOT NULL), `confidence` (REAL NOT NULL), `seller_id` (TEXT), `created_at` (TEXT NOT NULL DEFAULT datetime('now')). The migration MUST be idempotent.

(Previously: `agent_reviews` table had no `seller_id` column.)

#### Scenario: Migration is idempotent (unchanged)

- GIVEN the `agent_reviews` table already exists
- WHEN `createAgentConsensusStore` runs
- THEN no error is thrown and existing rows are preserved

#### Scenario: Review is inserted with seller scope

- GIVEN a valid review input (proposalId, reviewerAgentId, verdict, rationale, confidence, **sellerId**)
- WHEN `submitReview` is called
- THEN a row is persisted with an auto-incremented id, current timestamp, and the provided `seller_id`

### Requirement: Consensus Aggregation

`getConsensus(proposalId, sellerId?)` MUST return all reviews for a given proposal **optionally filtered by seller**. When `sellerId` is provided, only reviews with matching or NULL `seller_id` SHALL be returned.

(Previously: `getConsensus` was not seller-scoped.)

#### Scenario: Scoped consensus for a proposal

- GIVEN 3 reviews exist for proposal "prop-1" — 2 with `seller_id = "plasticov"`, 1 with `seller_id = NULL`
- WHEN `getConsensus("prop-1", "plasticov")` is called
- THEN 3 reviews are returned (2 account-scoped + 1 global)

### Requirement: Store Factory Contract

`createAgentConsensusStore(db)` MUST accept a `better-sqlite3` Database instance, run the idempotent schema migration (including `seller_id` column), and return an object with `submitReview`, `getConsensus`, `getConsensusBySeller`, and `requiresConsensus` methods.

(Previously: factory returned `submitReview`, `getConsensus`, `requiresConsensus` only. Now adds `getConsensusBySeller`.)

## REMOVED Requirements

(None)
