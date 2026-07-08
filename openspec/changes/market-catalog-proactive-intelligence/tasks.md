# Tasks: AI Enrichment for Market Catalog Signals

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~250 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-forecast |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Advisor Class

- [x] 1.1 Create `packages/agent/src/conversation/catalogDeepSeekAdvisor.ts` — `CatalogActionableFinding`, `CatalogAnalysisInput`, `CatalogAnalysisFinding`, `CatalogAnalysis` types + `CatalogDeepSeekAdvisor` class with `analyze()` method. Mirrors `OperationsDeepSeekAdvisor`: lazy gateway init, `ReasoningLevel.Classification`, Spanish system prompt (catalog analyst role), JSON parse with fallback, full cost telemetry output.

## Phase 2: Type Wiring

- [x] 2.1 Add `import type { CatalogDeepSeekAdvisor }` + `catalogAdvisor?: CatalogDeepSeekAdvisor` to `DaemonHandler` input type in `daemonTypes.ts`
- [x] 2.2 Add `catalogAdvisor?: CatalogDeepSeekAdvisor` to `DaemonSchedulerConfig` + pass as `catalogAdvisor: config.catalogAdvisor` in handler call at `daemonScheduler.ts`
- [x] 2.3 Instantiate `CatalogDeepSeekAdvisor` in `agentLoop.ts` alongside `operationsDeepSeekAdvisor` block (same guard: `openai && config.workforceCostCacheLedgerStore`)
- [x] 2.4 Export `CatalogDeepSeekAdvisor` + all types from `packages/agent/src/index.ts`

## Phase 3: Daemon Enrichment

- [x] 3.1 In `marketCatalogDaemon.ts`: destructure `catalogAdvisor` from handler input; after all 4 signal detections complete but **before** each `enqueueGroup()` call, call `catalogAdvisor.analyze()` for critical + warning groups only
- [x] 3.2 Build focused `CatalogAnalysisInput` for critical signals (relist-expiring listings with days-until-expiry, visit counts) and separately for warning signals (low-visit + above-market listings with prices, visits, category medians)
- [x] 3.3 Append `aiEnrichment` (findings, summary, modelUsed, enrichedAt) to critical + warning proposal payloads; wrap in try/catch — on failure log and skip enrichment
- [x] 3.4 Ensure opportunity (info-severity, paused-with-history) proposals do NOT call advisor or include `aiEnrichment`

## Phase 4: Testing

- [ ] 4.1 Add unit test `tests/workers/catalogDeepSeekAdvisor.test.ts` — verify prompt construction includes listing context, JSON parse fallback on invalid response, empty findings on parse failure
- [ ] 4.2 Add integration test in `tests/workers/marketCatalogDaemon.test.ts` — mock `CatalogDeepSeekAdvisor`, assert `aiEnrichment` in critical + warning proposals; verify rule-only fallback when advisor throws or is absent; verify info proposals excluded
