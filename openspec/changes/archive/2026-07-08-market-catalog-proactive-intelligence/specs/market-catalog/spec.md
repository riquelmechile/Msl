# market-catalog — Delta Spec

## ADDED: AI Enrichment for Catalog Signals

### Requirement: The market catalog AI advisor SHALL provide reasoning-enriched findings for catalog health signals.

The `CatalogDeepSeekAdvisor` SHALL accept a set of actionable findings (low-visit listings, above-market pricing, relist-expiring alerts) and produce structured enrichment that the daemon appends to CEO proposals.

#### Scenario: Advisor enriches low-visit findings

- **GIVEN** the daemon has detected 3 low-visit listings (visits < 10)
- **AND** a `CatalogDeepSeekAdvisor` instance is available
- **WHEN** the daemon calls `advisor.analyze()` with the listing context
- **THEN** the response SHALL contain `findings` with kind `visibility-risk` or `catalog-insight`
- **AND** each finding SHALL include `summary`, `detail`, and `evidenceIds`
- **AND** the result SHALL include cost telemetry (`costMicros`, `cacheHitTokens`, `cacheMissTokens`, `outputTokens`)

#### Scenario: Advisor enriches above-market findings

- **GIVEN** the daemon has detected listings priced >20% above category median
- **AND** a `CatalogDeepSeekAdvisor` instance is available
- **WHEN** the daemon calls `advisor.analyze()` with price context and category medians
- **THEN** the response SHALL contain findings with kind `pricing-strategy` or `catalog-insight`
- **AND** findings SHALL reference the listing evidence IDs

#### Scenario: Advisor enriches relist-expiring findings

- **GIVEN** the daemon has detected relist candidates within the 7-day expiry window
- **AND** a `CatalogDeepSeekAdvisor` instance is available
- **WHEN** the daemon calls `advisor.analyze()` with visiting history and closing dates
- **THEN** the response SHALL contain findings with kind `relist-priority`
- **AND** findings SHALL prioritize items by days-until-expiry and visit count

#### Scenario: Advisor unavailable — graceful fallback

- **GIVEN** `CatalogDeepSeekAdvisor` is `undefined` or throws during `analyze()`
- **WHEN** the daemon processes catalog signals
- **THEN** the daemon SHALL enqueue rule-only proposals with no `aiEnrichment` field
- **AND** the daemon SHALL NOT throw or crash

### Requirement: The `aiEnrichment` payload SHALL follow the established contract from supplier-manager and operations-manager.

The `aiEnrichment` field on CEO proposals SHALL conform to:

```typescript
aiEnrichment?: {
  findings: Array<{ kind: string; severity: string; summary: string; detail: string; evidenceIds: string[] }>;
  summary: string;
  modelUsed: string;
  enrichedAt: string;
}
```

#### Scenario: aiEnrichment appended to critical proposal payload

- **GIVEN** the daemon detected relist-expiring signals (severity: critical)
- **AND** advisor returned enrichment
- **WHEN** the daemon enqueues the critical CEO proposal
- **THEN** the payload SHALL include `aiEnrichment` with `findings`, `summary`, `modelUsed`, and `enrichedAt`

#### Scenario: aiEnrichment appended to warning proposal payload

- **GIVEN** the daemon detected low-visit or above-market signals (severity: warning)
- **AND** advisor returned enrichment for those signals
- **WHEN** the daemon enqueues the warning CEO proposal
- **THEN** the payload SHALL include `aiEnrichment`

#### Scenario: No aiEnrichment for info-only proposals

- **GIVEN** the daemon only detected paused-with-history signals (severity: info)
- **WHEN** the daemon enqueues the opportunity CEO proposal
- **THEN** the payload SHALL NOT include `aiEnrichment`
