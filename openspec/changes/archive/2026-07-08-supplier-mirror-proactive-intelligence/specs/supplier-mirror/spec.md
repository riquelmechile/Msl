# Delta for Supplier Mirror

## ADDED Requirements

### Requirement: Supplier Mirror Daemon AI Enrichment

The daemon SHALL enrich stock-gap signals with AI analysis via `SupplierMirrorDeepSeekAdvisor.analyze()`.

The system SHALL use `ReasoningLevel.classification` (Flash model) for enrichment calls.

If the advisor fails (timeout, error, or unavailable), the daemon SHALL fall back to the rule-only proposal — enrichment is best-effort.

Non-stock-gap signals (price-change, unfilled-mirror) SHALL remain rule-only with no advisor call.

Context data for the advisor (policies, notifications, fallback policies) SHALL be loaded only for stock-gap signals — not preloaded for every detection cycle.

The enriched proposal payload SHALL include an `aiEnrichment` field containing `findings` (array of findings with kind, severity, summary, detail, evidenceIds) and `summary` (string).

#### Scenario: Stock-gap signal enriched

- GIVEN daemon detects a stock gap, advisor is available, and signal not deduplicated this hour
- WHEN daemon enriches the proposal
- THEN the payload SHALL include `aiEnrichment` with `findings` and `summary` from the advisor
- AND the advisor SHALL receive the supplier ID, name, and a stock-gap-specific question

#### Scenario: Advisor unavailable or fails

- GIVEN advisor is not present or `analyze()` throws
- WHEN daemon detects a stock gap
- THEN the proposal SHALL enqueue without `aiEnrichment`
- AND the daemon SHALL NOT crash

#### Scenario: Advisor call deduplicated

- GIVEN a stock-gap signal was already enriched this hour for the same (supplier, supplierItemId, hourKey)
- WHEN the daemon checks the signal again in the same hour
- THEN the advisor SHALL NOT be called again — idempotency key prevents duplicate API cost

#### Scenario: Price-change signal remains rule-only

- GIVEN daemon detects a price change >5%
- WHEN the proposal is enqueued
- THEN the payload SHALL NOT include `aiEnrichment`
- AND the advisor SHALL NOT be called

#### Scenario: Unfilled-mirror signal remains rule-only

- GIVEN daemon detects an unfilled mirror item
- WHEN the proposal is enqueued
- THEN the payload SHALL NOT include `aiEnrichment`
- AND the advisor SHALL NOT be called
