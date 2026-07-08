# market-catalog-daemon — Delta Spec

## MODIFIED: Optional Catalog Advisor Dependency

### Requirement: The market catalog daemon SHALL accept an optional `CatalogDeepSeekAdvisor` instance.

The `DaemonHandler` input type SHALL be extended with:

```typescript
catalogAdvisor?: CatalogDeepSeekAdvisor;
```

#### Scenario: Daemon runs with advisor injected

- **GIVEN** a `CatalogDeepSeekAdvisor` instance is provided
- **WHEN** the daemon detects critical or warning signals
- **THEN** the daemon SHALL call `catalogAdvisor.analyze()` before enqueuing proposals
- **AND** proposals SHALL include `aiEnrichment` on success

#### Scenario: Daemon runs without advisor

- **GIVEN** no `CatalogDeepSeekAdvisor` instance is provided
- **WHEN** the daemon runs
- **THEN** the daemon SHALL detect signals and enqueue rule-only proposals as before
- **AND** no `aiEnrichment` field SHALL be present

### Requirement: The daemon scheduler SHALL forward the advisor to the handler.

The `DaemonSchedulerConfig` SHALL be extended with `catalogAdvisor?: CatalogDeepSeekAdvisor`. The scheduler SHALL pass `config.catalogAdvisor` as `catalogAdvisor` when invoking `marketCatalogDaemon`.

#### Scenario: Scheduler passes advisor to daemon

- **GIVEN** `DaemonSchedulerConfig` includes a `catalogAdvisor`
- **WHEN** the scheduler dispatches a market-catalog claim
- **THEN** the handler SHALL receive `catalogAdvisor` in its input

## ADDED: Enrichment Scenarios

### Requirement: The daemon SHALL enrich critical signals (relist-expiring) with AI findings.

#### Scenario: Relist-expiring signal enriched

- **GIVEN** the daemon detected relist candidates with days-until-expiry ≤ 7
- **AND** `catalogAdvisor` is available
- **WHEN** the daemon builds the critical CEO proposal
- **THEN** advisor SHALL be called with the affected listing context
- **AND** on success, `aiEnrichment` SHALL be appended to the critical proposal payload
- **AND** on advisor failure, the rule-only proposal SHALL still enqueue

### Requirement: The daemon SHALL enrich warning signals (low-visit + above-market) with AI findings.

#### Scenario: Low-visit signal enriched

- **GIVEN** the daemon detected listings with visits < 10
- **AND** `catalogAdvisor` is available
- **WHEN** the daemon builds the warning CEO proposal
- **THEN** advisor SHALL be called with listing + visit context
- **AND** on success, `aiEnrichment` SHALL be appended to the warning proposal payload

#### Scenario: Above-market signal enriched

- **GIVEN** the daemon detected listings priced >20% above category median
- **AND** `catalogAdvisor` is available
- **WHEN** the daemon builds the warning CEO proposal
- **THEN** advisor SHALL be called with listing + price + category median context
- **AND** on success, `aiEnrichment` SHALL be appended to the warning proposal payload

### Requirement: The daemon SHALL NOT enrich info-severity signals (paused-with-history).

#### Scenario: Paused-with-history stays rule-only

- **GIVEN** the daemon detected paused listings with sales history (severity: info)
- **AND** `catalogAdvisor` is available
- **WHEN** the daemon builds the opportunity CEO proposal
- **THEN** advisor SHALL NOT be called
- **AND** the proposal payload SHALL NOT include `aiEnrichment`
