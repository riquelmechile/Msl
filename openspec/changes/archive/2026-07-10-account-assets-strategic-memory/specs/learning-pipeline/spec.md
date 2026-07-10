# Delta for learning-pipeline

## ADDED Requirements

### Requirement: Seller-Scoped Lesson Schema

The `company_agent_lessons` table MUST include `seller_id TEXT` via idempotent `ALTER TABLE ADD COLUMN`. Existing rows SHALL default to `NULL`. The migration MUST be safe for existing data.

#### Scenario: Migration adds seller_id

- GIVEN `company_agent_lessons` has rows without `seller_id`
- WHEN migration runs
- THEN the column is added and all existing rows have `seller_id = NULL`

### Requirement: Scoped Lesson Attribution

When the learning pipeline processes an outcome message, it MUST extract `seller_id` from the bus message and persist it on the resulting `company_agent_lesson`. An outcome in one account MUST NOT create a lesson in another account.

#### Scenario: Outcome in Maustian creates lesson only in Maustian

- GIVEN a resolved bus message with `seller_id = "maustian"`
- WHEN `LearningOutcomePipeline` scores and saves the lesson
- THEN `company_agent_lessons.seller_id` MUST be `"maustian"`
- AND querying lessons for `seller_id = "plasticov"` MUST NOT return this lesson

#### Scenario: Outcome in Plasticov isolated

- GIVEN a resolved bus message with `seller_id = "plasticov"`
- WHEN the pipeline processes it
- THEN the lesson is scoped to `"plasticov"` only

### Requirement: Scoped Lesson Queries

`getLessonsByAgent(targetAgentId, sellerId?)` MUST accept optional `sellerId` filter. `getLessonsBySeller(sellerId)` MUST return all lessons for a specific account.

#### Scenario: Lessons filtered by account

- GIVEN 5 lessons for Plasticov and 3 for Maustian across various agents
- WHEN `getLessonsBySeller("maustian")` is called
- THEN only 3 lessons MUST be returned

### Requirement: Cortex Chain: AccountAsset → Action → Outcome → Lesson

The learning pipeline SHALL feed the chain `AccountAsset → PreparedAction → Outcome → Lesson` into Cortex by writing `proposal_outcome_*` nodes scoped to the action's `sellerId`. This enables CEO queries about which account maximizes profit.

#### Scenario: Full chain recorded per account

- GIVEN Plasticov executes a price change with positive outcome
- WHEN Cortex processes the outcome via Escribano
- THEN a `proposal_outcome_price_change` node MUST be created with `seller_id = "plasticov"`
- AND Hebbian reinforcement MUST be scoped to Plasticov's edges

## MODIFIED Requirements

### Requirement: Learning Feedback Loop

After scoring, the pipeline SHALL write a `learning_event` snapshot to the operational read model via `OperationalReadModelWriter`. The snapshot MUST include: `lane_id`, `seller_id`, `outcome_score`, `message_type`, and a summary. **The pipeline MUST extract `seller_id` from the bus message and persist it on the lesson record.** This data SHALL be consumable by daemon prompts as historical context per account.

(Previously: learning events were not seller-scoped in the lesson table.)

#### Scenario: Learning event written per account

- GIVEN pipeline scores a market-catalog proposal for Plasticov
- WHEN event is persisted
- THEN snapshot includes `seller_id = "plasticov"` and lesson is scoped accordingly

#### Scenario: Daemon reads scoped context

- GIVEN market-catalog daemon runs for Maustian
- WHEN `OperationalReadModelReader` queries learning events
- THEN only Maustian's learning events MUST be included in evidence

## REMOVED Requirements

(None)
