# Delta for Creative Commercial Enrichment

## MODIFIED Requirements

### Requirement: Creative Commercial Signal Enrichment

The `creativeCommercialDaemon` MUST continue to detect all existing signals (high-visit low-conversion, creative candidate, stagnant stock) via rule-based logic. When a `creativeAdvisor` is present in the daemon handler context, the daemon MUST additionally:

- Group warning severity findings into an `actionableFindings` structure
- Call `creativeAdvisor.analyze()` with those findings
- Attach the returned `aiEnrichment` to the CEO proposal payload when enrichment succeeds
- Continue with rule-only proposals when enrichment fails (isolated try/catch)
- NOT enrich "info" severity findings (creative candidate, stagnant stock)

(Previously: the daemon produced rule-only proposals with no AI enrichment.)

#### Scenario: Enrichment added for warning findings

- GIVEN a daemon cycle with `creativeAdvisor` present
- AND warning findings exist (high-visit low-conversion)
- WHEN the daemon enqueues a CEO proposal
- THEN the proposal payload MUST include an `aiEnrichment` field with findings and summary from the advisor

#### Scenario: Info-only findings excluded from enrichment

- GIVEN a daemon cycle with `creativeAdvisor` present
- AND only "info" severity findings exist (creative candidate, stagnant stock)
- WHEN the daemon enqueues a CEO proposal
- THEN the proposal payload MUST NOT include enrichment

#### Scenario: Advisor failure falls back to rule-only

- GIVEN a daemon cycle with `creativeAdvisor` present
- AND the advisor throws or returns unparseable output
- WHEN the daemon enqueues a CEO proposal
- THEN the proposal MUST be enqueued without enrichment (no error propagation)

#### Scenario: Advisor absent produces rule-only

- GIVEN a daemon cycle without `creativeAdvisor`
- WHEN findings exist
- THEN the proposal payload MUST NOT include enrichment (backward compatible)

### Requirement: Info Signals Stay Rule-Based

The "creative candidate" and "stagnant stock" signals (both severity "info") MUST NOT be enriched by the advisor. They remain purely rule-based as they represent opportunities, not risks requiring AI prioritization.
