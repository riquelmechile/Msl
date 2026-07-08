# Delta for Creative Assets Enrichment

## MODIFIED Requirements

### Requirement: Creative Assets Signal Detection

The `creativeAssetsDaemon` MUST continue to detect all five existing signals (low image count, moderation blocked, poor PICTURES score, high-traffic poor creative, moderated-in-campaign) via rule-based logic. When a `creativeAdvisor` is present in the daemon handler context, the daemon MUST additionally:

- Group critical + warning findings into an `actionableFindings` structure
- Call `creativeAdvisor.analyze()` with those findings
- Attach the returned `aiEnrichment` to the CEO proposal payload when enrichment succeeds
- Continue with rule-only proposals when enrichment fails (isolated try/catch)

(Previously: the daemon produced rule-only proposals with no AI enrichment.)

#### Scenario: Enrichment added for critical + warning findings

- GIVEN a daemon cycle with `creativeAdvisor` present
- AND findings exist with severity "critical" or "warning"
- WHEN the daemon enqueues a CEO proposal
- THEN the proposal payload MUST include an `aiEnrichment` field with findings and summary from the advisor

#### Scenario: Info-only findings excluded from enrichment

- GIVEN a daemon cycle with `creativeAdvisor` present
- AND only "info" severity findings exist
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
