# Tasks: AI Reasoning for Operations Manager Signals

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

- [x] 1.1 Create `packages/agent/src/conversation/operationsDeepSeekAdvisor.ts` — `OperationsAnalysisInput`, `OperationsAnalysis` types + `OperationsDeepSeekAdvisor` class with `analyze()` method (mirrors `SupplierMirrorDeepSeekAdvisor` — lazy gateway, `ReasoningLevel.Classification`, JSON parse with fallback)

## Phase 2: Wiring

- [x] 2.1 Add `import type { OperationsDeepSeekAdvisor }` + `operationsAdvisor?: OperationsDeepSeekAdvisor` to `DaemonHandler` type in `daemonTypes.ts`
- [x] 2.2 Add `operationsAdvisor?: OperationsDeepSeekAdvisor` to `DaemonSchedulerConfig` + pass as `operationsAdvisor: config.operationsAdvisor` in handler call at `daemonScheduler.ts`
- [x] 2.3 Instantiate `OperationsDeepSeekAdvisor` in `agentLoop.ts` (inside `createAgentLoop`, alongside `SupplierMirrorDeepSeekAdvisor` block, same guard: `openai && config.workforceCostCacheLedgerStore`)
- [x] 2.4 Export `OperationsDeepSeekAdvisor` + types from `packages/agent/src/index.ts`

## Phase 3: Core Enrichment

- [x] 3.1 In `operationsManagerDaemon.ts`: destructure `operationsAdvisor` from handler input; after claims + reputation detection, call `operationsAdvisor.analyze()` with focused evidence context (open claims, reputation snapshot, unanswered questions, seller IDs, cortex)
- [x] 3.2 Append `aiEnrichment` (findings, summary, modelUsed, enrichedAt) to critical + warning proposal payloads; wrap in try/catch — on failure log and skip enrichment

## Phase 4: Cleanup

- [x] 4.1 Remove `unansweredQuestionsWatcher.ts` file + its import from `daemonScheduler.ts` + its entry in `daemonHandlerMap` + its export from `index.ts`
- [x] 4.2 Keep `"unanswered-questions"` in `LaneId` type union for backward compat with enqueued bus messages

## Phase 5: Testing

- [ ] 5.1 Add unit test file `tests/workers/operationsDeepSeekAdvisor.test.ts` — verify prompt construction, JSON parse fallback, empty findings on invalid response
- [ ] 5.2 Add integration test in `tests/workers/operationsManagerDaemon.test.ts` — mock `OperationsDeepSeekAdvisor`, assert `aiEnrichment` in claim/reputation proposals; verify rule-only fallback when advisor throws or is absent
