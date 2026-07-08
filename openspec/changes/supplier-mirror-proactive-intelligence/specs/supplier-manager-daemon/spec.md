# Delta for Supplier Manager Daemon

## ADDED Requirements

### Requirement: Daemon AI Enrichment

The daemon SHALL accept an optional `SupplierMirrorDeepSeekAdvisor` instance in its handler context.

When an advisor is present and a stock-gap signal is detected, the daemon SHALL call `advisor.analyze()` using `ReasoningLevel.classification` before enqueuing the proposal.

Advisor calls SHALL be isolated behind try/catch — an advisor failure SHALL NOT crash the daemon or prevent the rule-only proposal from enqueuing.

Advisor calls SHALL use the existing hourly idempotency key pattern (`stock-gap_{supplierId}_{supplierItemId}_{hourKey}`) to prevent duplicate API calls within the same hour for the same signal.

#### Scenario: Advisor called for stock-gap signal

- GIVEN advisor is present, stock-gap signal detected, and no idempotency key matches this hour
- WHEN daemon processes the signal
- THEN `advisor.analyze()` SHALL be called with supplier context and a stock-gap-specific question
- AND enriched findings SHALL be appended to the proposal payload via `aiEnrichment`

#### Scenario: Advisor failure does not block daemon

- GIVEN `advisor.analyze()` throws an exception or times out
- WHEN the daemon processes the failing signal
- THEN the daemon SHALL catch the error, log it, and enqueue the rule-only proposal without `aiEnrichment`
- AND remaining signals SHALL continue processing unaffected

#### Scenario: Advisor call deduplicated hourly

- GIVEN advisor was already called this hour for the same (supplierId, supplierItemId)
- WHEN the daemon detects the same stock-gap signal again
- THEN `advisor.analyze()` SHALL NOT be called — the idempotency key prevents the duplicate

#### Scenario: No advisor in context

- GIVEN the daemon handler input has no advisor instance
- WHEN any signal is detected
- THEN all proposals SHALL be rule-only with no enrichment — the daemon operates as before this change

## MODIFIED Requirements

### Requirement: Daemon Contract

The daemon MUST export an `investigate` function conforming to `DaemonHandler`. It SHALL accept `supplierMirrorStore` and an optional `advisor` (`SupplierMirrorDeepSeekAdvisor | undefined`) via the extended handler input. Findings MUST use `{ kind, severity, summary, evidenceIds }`. Proposals SHALL be enqueued to the `ceo` lane via the message bus.

(Previously: the handler input accepted `supplierMirrorStore` but did not accept an advisor.)

#### Scenario: Findings enqueued

- GIVEN one or more signals detected
- WHEN `investigate()` completes
- THEN `proposalEnqueued: true`, messageIds populated

#### Scenario: No findings

- GIVEN all signals pass or data missing
- WHEN `investigate()` completes
- THEN empty findings, `proposalEnqueued: false`
