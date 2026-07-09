# learning-pipeline Specification

## Purpose

Retrospective outcome analysis pipeline that consumes resolved, failed, and cancelled bus messages, computes outcome scores, and feeds learnings back into the agent company's operational memory.

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

After scoring, the pipeline SHALL write a `learning_event` snapshot to the operational read model via `OperationalReadModelWriter`. The snapshot MUST include: `lane_id`, `seller_id`, `outcome_score`, `message_type`, and a summary derived from `result_json` or `error_json`. This data SHALL be consumable by daemon prompts as historical context.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Learning event written | Pipeline scores a market-catalog proposal | Event persisted | Snapshot with lane_id="market-catalog", outcome_score, summary |
| Daemon reads learning context | market-catalog daemon runs next cycle | OperationalReadModelReader called | Learning events included in daemon evidence |
| Seller-scoped events | Learning event for seller A | Queried for seller B | Seller A event not visible to seller B lane |
