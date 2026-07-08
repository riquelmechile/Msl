# Delta for operations-manager-daemon

## ADDED Requirements

### Requirement: Daemon AI Enrichment

The operations manager daemon SHALL enrich claim and reputation proposals with AI analysis when an `operationsAdvisor` is available.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Signal enrichment with advisor | Daemon detects claim or reputation signals, and `operationsAdvisor` is present | Daemon calls `operationsAdvisor.analyze()` with focused evidence context | Proposal payload SHALL include `aiEnrichment` with `prioritizedActions` and `summary` |
| Graceful fallback on advisor failure | Daemon detects signals and `operationsAdvisor` is present | `operationsAdvisor.analyze()` throws or times out | Daemon SHALL log the error, enqueue rule-only proposal without `aiEnrichment`, and NOT crash |
| Rule-only when no advisor | No `operationsAdvisor` is provided to the daemon | Daemon detects any signal (claims, reputation, orders, questions) | All proposals SHALL be rule-only without `aiEnrichment`; no advisor calls SHALL be attempted |
| Signal scoping — non-enriched signals excluded | Daemon detects delayed orders or unanswered questions, and `operationsAdvisor` is present | Daemon prepares proposals | Those signals SHALL NOT trigger an advisor call; their proposals SHALL remain rule-only |

## MODIFIED Requirements

### Requirement: Daemon Contract — Accept Optional OperationsAdvisor

The `DaemonHandler` contract SHALL accept an optional `operationsAdvisor` of type `OperationsDeepSeekAdvisor`.

When `operationsAdvisor` is present, the operations manager daemon SHALL call `operationsAdvisor.analyze()` for claim and reputation signals before enqueuing proposals. When absent, the daemon SHALL enqueue rule-only proposals without AI enrichment.

(Previously: DaemonHandler had no `operationsAdvisor` field; all operations proposals were rule-only.)
