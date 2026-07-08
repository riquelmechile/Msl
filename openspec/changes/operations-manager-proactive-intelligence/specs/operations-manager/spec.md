# Operations Manager Specification

## Purpose

Proactive operational intelligence: detect claims, reputation drops, delayed orders, and unanswered questions. Enrich critical signals (claims + reputation) with AI analysis via DeepSeek.

## Requirements

### Requirement: Operations Daemon AI Enrichment

The daemon SHALL call `OperationsDeepSeekAdvisor.analyze()` for claim and reputation signals after rule detection.

The advisor SHALL use `ReasoningLevel.Classification` (Flash model) for enrichment calls.

If the advisor fails (timeout, error, or unavailable), the daemon SHALL fall back to the rule-only proposal — enrichment is best-effort.

The enriched proposal payload SHALL include an `aiEnrichment` field with `prioritizedActions` (array) and `summary` (string).

Delayed-order and unanswered-question (>24h) signals SHALL remain rule-only — no AI enrichment.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Claims enriched with AI | Daemon detects open claims and `OperationsDeepSeekAdvisor` is available | Daemon prepares the proposal | Payload SHALL include `aiEnrichment` with `prioritizedActions` from the advisor |
| Reputation signals enriched with AI | Daemon detects reputation score below threshold and `OperationsDeepSeekAdvisor` is available | Daemon prepares the proposal | Payload SHALL include `aiEnrichment` with `prioritizedActions` from the advisor |
| Advisor failure falls back to rule-only | Advisor is present but `analyze()` throws or times out | Daemon detects claims or reputation signals | Daemon SHALL log the error, skip enrichment, and enqueue a rule-only proposal without `aiEnrichment` |
| Delayed orders remain rule-only | Daemon detects a delayed order | Proposal is prepared | Payload SHALL NOT include `aiEnrichment`; advisor SHALL NOT be called |
| Unanswered questions remain rule-only | Daemon detects an unanswered question past the 24h deadline | Proposal is prepared | Payload SHALL NOT include `aiEnrichment`; advisor SHALL NOT be called |
