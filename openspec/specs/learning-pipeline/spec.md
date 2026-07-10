# learning-pipeline Specification

## Purpose

Retrospective outcome analysis pipeline that consumes resolved, failed, and cancelled bus messages, computes outcome scores, and feeds learnings back into the agent company's operational memory. Lessons and learning events are now scoped per `seller_id`.

## Requirements

### Requirement: LearningOutcomePipeline Batch Processing

`LearningOutcomePipeline` MUST run on a configurable interval (default: 1 hour) and process resolved bus messages that have `outcome_score IS NULL` and `learned_at IS NULL`. The pipeline SHALL batch-process up to `MSL_LEARNING_BATCH_SIZE` (default: 50) messages per cycle. After scoring, the pipeline SHALL update `outcome_score` and set `learned_at` to the current timestamp.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Unscored resolved messages exist | 10 resolved messages without outcome_score | Pipeline cycle runs | All 10 scored and learned_at set |
| Batch limited | 80 unresolved messages, batch_size=50 | Pipeline cycle runs | 50 processed; remaining 30 processed next cycle |
| No unscored messages | All resolved messages already scored | Pipeline cycle runs | No work; pipeline sleeps until next interval |
| Failed messages scored | Failed message with error_json | Pipeline evaluates | Outcome_score derived from failure context (low score) |
| Cancelled messages scored | Cancelled message with cancel_reason | Pipeline evaluates | Outcome_score derived from cancellation context |

### Requirement: Outcome Scoring Heuristics

The pipeline MUST compute `outcome_score` (0.0–1.0) using heuristics: resolved with result_json → base 0.7, adjusted by findings count and severity; failed with error_json → 0.0–0.3 based on error type (transient vs permanent); cancelled → 0.0–0.5 based on cancel_reason. Scores SHALL be stored as REAL in the bus `outcome_score` column. The scoring function MUST be configurable via `MSL_LEARNING_SCORING_STRATEGY` (default: "heuristic").

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Resolved with findings | result_json has 3 findings, severity "critical" | Scoring calculated | outcome_score ≥ 0.7 (adjusted upward for severity) |
| Resolved with no findings | result_json has empty findings | Scoring calculated | outcome_score ≈ 0.5 (resolved but no action) |
| Permanent failure | error_json="exhausted", attempts=3 | Scoring calculated | outcome_score ≈ 0.1 (permanent failure, low value) |
| Transient failure | error_json="timeout", attempts=1 | Scoring calculated | outcome_score ≈ 0.3 (transient, may succeed later) |

### Requirement: Learning Feedback Loop

After scoring, the pipeline SHALL write a `learning_event` snapshot to the operational read model via `OperationalReadModelWriter`. The snapshot MUST include: `lane_id`, `seller_id`, `outcome_score`, `message_type`, and a summary derived from `result_json` or `error_json`. The pipeline MUST extract `seller_id` from the bus message and persist it on the resulting `company_agent_lesson`. This data SHALL be consumable by daemon prompts as historical context per account.

(Previously: learning events were not seller-scoped in the lesson table.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Learning event written | Pipeline scores a market-catalog proposal | Event persisted | Snapshot with lane_id="market-catalog", outcome_score, summary |
| Daemon reads learning context | market-catalog daemon runs next cycle | OperationalReadModelReader called | Learning events included in daemon evidence |
| Seller-scoped events | Learning event for seller A | Queried for seller B | Seller A event not visible to seller B lane |

#### Scenario: Learning event written per account

- GIVEN pipeline scores a market-catalog proposal for Plasticov
- WHEN event is persisted
- THEN snapshot includes `seller_id = "plasticov"` and lesson is scoped accordingly

#### Scenario: Daemon reads scoped context

- GIVEN market-catalog daemon runs for Maustian
- WHEN `OperationalReadModelReader` queries learning events
- THEN only Maustian's learning events MUST be included in evidence

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
